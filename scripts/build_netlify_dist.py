#!/usr/bin/env python3
"""
Builds a lean, 100% Mac-free `dist/` publish directory for Netlify.
Copies ONLY frontend assets + lightweight `telemetry.json` files (NO MP4s,
NO poses_2d.json, NO model weights, NO Mac tunnel URLs) and injects
`yt_video_id` so Netlify plays every YouTube match via YouTube IFrame API.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time


DIST_DIR = "dist"
YT_ID_PATTERNS = (
    re.compile(r"^(?:yt|stress)_([A-Za-z0-9_-]{11})$"),
    re.compile(r"(?:yt_|stress_test/)([A-Za-z0-9_-]{11})\.mp4$"),
)

# Curated matches to publish on Netlify (all YouTube matches + reference matches)
EXCLUDE_DUPLICATES = {
    "an_se_young_vs_pusarla_v_sindhu___hard-fought_rallies_with_relentless_retrieval_-_1080p_55551",
    "an_se_young_vs_pusarla_v_sindhu___hard-fought_rallies_with_relentless_retrieval_-_720p_83224",
    "an_se_young_vs_pusarla_v_sindhu_hard_fought_rall_55551",
    "iwanaga_nakanishi_vs_tan_muralitharan___control_and_confident_attacking_play_-_720p_5053",
    "iwanaga_nakanishi_vs_tan_muralitharan___control_and_confident_attacking_play_-_1080p_7384",
}


def detect_yt_id(match_id: str, tel: dict) -> str:
    src = tel.get("source") or {}
    mm = tel.get("match_metadata") or {}
    for cand in (src.get("yt_video_id"), mm.get("yt_video_id")):
        if isinstance(cand, str) and re.match(r"^[A-Za-z0-9_-]{11}$", cand.strip()):
            return cand.strip()
    for text in (match_id, str(src.get("video") or ""), str(src.get("yt_url") or "")):
        for pat in YT_ID_PATTERNS:
            m = pat.search(text)
            if m:
                return m.group(1)
    return ""


def build():
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR, exist_ok=True)

    # 1. Copy core static frontend files
    for fname in ("index.html", "manifest.json"):
        if os.path.exists(fname):
            shutil.copy2(fname, os.path.join(DIST_DIR, fname))

    for folder in ("css", "js"):
        if os.path.isdir(folder):
            shutil.copytree(folder, os.path.join(DIST_DIR, folder))

    # 2. Copy lightweight telemetry.json files and generate clean index.json
    matches_src = os.path.join("data", "matches")
    matches_dst = os.path.join(DIST_DIR, "data", "matches")
    os.makedirs(matches_dst, exist_ok=True)

    index_entries = []
    if os.path.isdir(matches_src):
        for m_id in sorted(os.listdir(matches_src)):
            if m_id in EXCLUDE_DUPLICATES:
                continue
            tel_p = os.path.join(matches_src, m_id, "telemetry.json")
            if not os.path.exists(tel_p):
                continue
            try:
                with open(tel_p, "r", encoding="utf-8") as f:
                    tel = json.load(f)
            except Exception:
                continue

            rallies = tel.get("rallies") or []
            if not rallies:
                continue

            yt_id = detect_yt_id(m_id, tel)
            if yt_id:
                tel.setdefault("source", {})["yt_video_id"] = yt_id
                tel.setdefault("match_metadata", {})["yt_video_id"] = yt_id

            dst_m = os.path.join(matches_dst, m_id)
            os.makedirs(dst_m, exist_ok=True)
            with open(os.path.join(dst_m, "telemetry.json"), "w", encoding="utf-8") as f_out:
                json.dump(tel, f_out, separators=(",", ":"))

            players = tel.get("players") or {}
            p_names = []
            for pk, pv in players.items():
                meta = (pv or {}).get("metadata") or {}
                flag = meta.get("flag") or "🏸"
                p_names.append(f"{flag} {meta.get('name') or pk}")
            vs_str = " vs ".join(p_names) if p_names else m_id
            shot_cnt = sum(len(r.get("shots") or []) for r in rallies)
            src = tel.get("source") or {}
            mm = tel.get("match_metadata") or {}

            index_entries.append({
                "match_id": m_id,
                "label": f"{vs_str} ({len(rallies)} rallies · {shot_cnt} shots)",
                "players_label": vs_str,
                "tournament": mm.get("tournament", ""),
                "video_path": src.get("video", ""),
                "yt_video_id": yt_id,
                "duration_sec": src.get("duration_sec", 0.0),
                "rallies_count": len(rallies),
                "shots_count": shot_cnt,
                "has_side_swap": bool((mm.get("compilation_warning") or {}).get("detected", False)),
                "updated_at": os.path.getmtime(tel_p),
            })

    # Prefer newest YouTube matches at the top of the selector
    index_entries.sort(key=lambda x: (1 if x.get("yt_video_id") else 0, x.get("updated_at", 0)), reverse=True)

    with open(os.path.join(matches_dst, "index.json"), "w", encoding="utf-8") as f_idx:
        json.dump(
            {
                "matches": index_entries,
                "cloud_mode": True,
                "built_at": time.time(),
            },
            f_idx,
            separators=(",", ":"),
        )
    shutil.copy2(
        os.path.join(matches_dst, "index.json"),
        os.path.join(DIST_DIR, "data", "matches_index.json"),
    )

    # Also write default fallback telemetry (`data/match_telemetry.json`) from top YouTube match or lzj_popov
    default_mid = next((m["match_id"] for m in index_entries if m["match_id"] == "yt_qdedPFFAJlI"), None) or (
        index_entries[0]["match_id"] if index_entries else None
    )
    if default_mid:
        shutil.copy2(
            os.path.join(matches_dst, default_mid, "telemetry.json"),
            os.path.join(DIST_DIR, "data", "match_telemetry.json"),
        )

    total_bytes = sum(
        os.path.getsize(os.path.join(r, fn))
        for r, _, files in os.walk(DIST_DIR)
        for fn in files
    )
    print(f"[build_netlify_dist] Built {DIST_DIR}/ with {len(index_entries)} matches ({total_bytes / (1024*1024):.2f} MB total, 0 MP4s)")


if __name__ == "__main__":
    build()
