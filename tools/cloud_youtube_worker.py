#!/usr/bin/env python3
"""
Hawkview Cloud CV Worker (tools/cloud_youtube_worker.py)
========================================================
Runs 100% Mac-free inside GitHub Actions (`ubuntu-latest`) or any cloud container:
  1. Downloads <=1080p H.264 MP4 from YouTube via `engine/youtube_ingest.py`
  2. Auto-calibrates 12 BWF court lines + detects Singles/Doubles & player names
  3. Runs TrackNetV3 + InpaintNet + RTMPose + 3D RK4 aerodynamic trajectory fit
  4. Streams live progress & per-rally `telemetry.json` back to Netlify Blobs
     via `POST <callback_url>` authenticated with `X-Hawkview-Secret`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import urllib.request
from typing import Optional

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from engine.colab_worker import get_colab_quota, stop_blackwell_session
from engine.pipeline import HawkviewPipeline
from engine.youtube_ingest import YouTubeIngestError, download_youtube_video, extract_youtube_video_id
from server import infer_player_flag, probe_video_and_keypoints


def post_callback(
    callback_url: str,
    secret: str,
    payload: dict,
) -> None:
    if not callback_url or not secret:
        return
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        callback_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Hawkview-Secret": secret,
            "User-Agent": "Hawkview-Cloud-CV-Worker/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except Exception as exc:
        print(f"[cloud-worker] Warning: callback POST failed: {exc}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Hawkview Cloud YouTube -> 3D Telemetry Worker")
    ap.add_argument("--url", required=True)
    ap.add_argument("--job-id", required=True)
    ap.add_argument("--match-id", default="")
    ap.add_argument("--max-rallies", type=int, default=3)
    ap.add_argument("--callback-url", default="")
    ap.add_argument("--cookies-file", default="")
    args = ap.parse_args()

    secret = os.environ.get("HAWKVIEW_CALLBACK_SECRET", "").strip()
    vid = extract_youtube_video_id(args.url)
    match_id = args.match_id.strip() or (f"yt_{vid}" if vid else "yt_custom")

    def notify(
        status: str,
        stage: str,
        percent: float,
        message: str,
        rallies_completed: int = 0,
        rallies_total: int = args.max_rallies,
        telemetry: Optional[dict] = None,
        error: Optional[str] = None,
        error_code: Optional[str] = None,
    ):
        print(f"[cloud-worker] [{status}] {percent:.1f}% | {stage} — {message}", flush=True)
        body = {
            "job_id": args.job_id,
            "match_id": match_id,
            "video_id": vid or "",
            "status": status,
            "stage": stage,
            "percent": round(float(percent), 1),
            "message": message,
            "rallies_completed": int(rallies_completed),
            "rallies_total": int(rallies_total),
            "error": error,
            "error_code": error_code,
        }
        if telemetry is not None:
            body["telemetry"] = telemetry
        post_callback(args.callback_url, secret, body)

    try:
        notify(
            "running",
            "STAGE 1: Downloading 1080p YouTube Stream",
            10.0,
            f"Fetching H.264 video {vid} on Cloud CV Runner...",
        )

        last_pct_sent = [10.0]

        def on_dl_prog(stage: str, pct: float, msg: str):
            mapped = 10.0 + 0.25 * float(pct)  # 10% -> 35%
            if mapped - last_pct_sent[0] >= 6.0:
                last_pct_sent[0] = mapped
                notify("running", f"STAGE 1: {stage}", mapped, msg)

        cookies_path = args.cookies_file if (args.cookies_file and os.path.exists(args.cookies_file)) else None
        dl = download_youtube_video(args.url, progress_cb=on_dl_prog, cookies_file=cookies_path)

        notify(
            "running",
            "STAGE 2: Auto-Calibrating 12 BWF Court Lines",
            38.0,
            f"Probing court homography & player scorebug for {dl['title']}...",
        )
        probe = probe_video_and_keypoints(
            dl["video_path"],
            sample_time_sec=-1.0,
            match_id=match_id,
            original_filename=dl["title"],
        )
        cal_prev = probe.get("calibration_preview") or {}
        keypoints = cal_prev.get("keypoints")
        near_name = probe.get("suggested_near_player") or "NEAR PLAYER"
        far_name = probe.get("suggested_far_player") or "FAR PLAYER"
        mtype = probe.get("suggested_match_type") or "auto"

        near_info = {
            "id": near_name,
            "name": near_name,
            "country": "NEAR",
            "flag": infer_player_flag(near_name, near_name),
            "dominant_hand": "Right",
        }
        far_info = {
            "id": far_name,
            "name": far_name,
            "country": "FAR",
            "flag": infer_player_flag(far_name, far_name),
            "dominant_hand": "Right",
        }

        colab_quota_pre = get_colab_quota(force_refresh=True)
        use_blackwell = bool(colab_quota_pre.get("available"))
        backend_choice = "blackwell_g4" if use_blackwell else "local"
        backend_label = (
            f"Google Blackwell G4 GPU ({colab_quota_pre.get('balance_cu', 0)} CU)"
            if use_blackwell
            else "Cloud CPU Runner"
        )

        notify(
            "running",
            f"STAGE 3: {backend_label} — TrackNetV3 + 3D Physics",
            42.0,
            f"{near_name} vs {far_name} ({mtype}) · Court RMSE {cal_prev.get('line_sample_rmse_px', '?')}px — launching {backend_label}...",
        )

        def on_pipe_progress(stage: str, pct: float, msg: str):
            mapped = 42.0 + 0.14 * float(pct)  # 42% -> 56% during Colab GPU offload
            notify("running", stage, min(56.0, mapped), msg)

        def on_rally_ready(tel_contract: dict, r_done: int, r_total: int, msg: str):
            tel_contract.setdefault("source", {})["yt_video_id"] = dl["video_id"]
            tel_contract["source"]["yt_url"] = dl["canonical_url"]
            tel_contract["source"]["compute_backend"] = backend_choice
            tel_contract.setdefault("match_metadata", {})["yt_video_id"] = dl["video_id"]
            tel_contract["match_metadata"]["tournament"] = dl["title"]
            pct = 56.0 + 40.0 * (r_done / max(1, r_total))
            notify(
                "running",
                f"STAGE 3: Reconstructed Rally {r_done}/{r_total} ({backend_choice})",
                min(96.0, pct),
                msg,
                rallies_completed=r_done,
                rallies_total=r_total,
                telemetry=tel_contract if r_done >= 1 else None,
            )

        pipe = HawkviewPipeline(progress_callback=on_pipe_progress)
        max_r_val = args.max_rallies if args.max_rallies > 0 else None
        try:
            final_tel = pipe.run_progressive_analysis(
                video_path=dl["video_path"],
                match_target=match_id,
                keypoints=keypoints,
                near_player_info=near_info,
                far_player_info=far_info,
                mode="broadcast",
                match_type=mtype,
                max_rallies=max_r_val,
                compute_backend=backend_choice,
                on_rally_ready=on_rally_ready,
            )
        finally:
            stop_blackwell_session()

        colab_quota_post = get_colab_quota(force_refresh=True)
        final_tel.setdefault("source", {})["yt_video_id"] = dl["video_id"]
        final_tel["source"]["yt_url"] = dl["canonical_url"]
        final_tel["source"]["compute_backend"] = backend_choice
        final_tel.setdefault("match_metadata", {})["yt_video_id"] = dl["video_id"]
        final_tel["match_metadata"]["tournament"] = dl["title"]

        rallies = final_tel.get("rallies") or []
        shots_n = sum(len(r.get("shots") or []) for r in rallies)
        audit = final_tel.get("accuracy_audit") or {}
        grade = audit.get("overall_grade", "—")
        med_px = audit.get("median_rmse_px", "—")

        post_callback(
            args.callback_url,
            secret,
            {
                "job_id": args.job_id,
                "match_id": match_id,
                "video_id": vid or "",
                "status": "completed",
                "stage": f"COMPLETE: {backend_label} 3D Match Ready",
                "percent": 100.0,
                "message": f"{near_name} vs {far_name} · {len(rallies)} rallies · {shots_n} shots · Grade {grade} ({med_px}px RMSE)",
                "rallies_completed": len(rallies),
                "rallies_total": len(rallies),
                "telemetry": final_tel,
                "colab_quota": colab_quota_post,
            },
        )
        print(
            f"[cloud-worker] [completed] {near_name} vs {far_name} · {len(rallies)} rallies · {shots_n} shots · "
            f"Grade {grade} ({med_px}px) · Colab CU={colab_quota_post.get('balance_cu')}",
            flush=True,
        )
    except YouTubeIngestError as yexc:
        notify(
            "error",
            "YouTube Import Blocked",
            100.0,
            str(yexc),
            error=str(yexc),
            error_code=yexc.error_code,
        )
        sys.exit(1)
    except Exception as exc:
        tb = traceback.format_exc()
        print(tb, flush=True)
        notify(
            "error",
            "Cloud CV Worker Error",
            100.0,
            str(exc),
            error=str(exc),
            error_code="cloud_worker_failed",
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
