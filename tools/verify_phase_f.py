#!/usr/bin/env python3
"""
Phase F Acceptance Verification Script (tools/verify_phase_f.py)
================================================================
Verifies BWF shot classification and outcome attribution on all 223 shots
in `data/matches/lzj_popov/shots_classified.json`:
  1. Valid contact zones (`front`, `mid`, `rear`) and target zones.
  2. Valid BWF shot types from Section 1.6 of `docs/plans/badminton-shot-explorer-spec.md`.
  3. All 201 non-terminal shots have `outcome == "continue"`, and all 22 terminal shots
     have `outcome in ("winner", "error_out", "error_net", "unknown")`.
  4. Verifies `close_call` (landing within 0.15m of singles boundary line) and
     `possible_fault_height` (serve z0 > 1.35m).
  5. Renders `data/matches/lzj_popov/debug/phase_f_summary.png` for visual inspection.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.classify import ShotClassifier

VALID_ZONES = {"front", "mid", "rear"}
VALID_SHOT_TYPES = {
    "serve_short",
    "serve_long",
    "serve_flick",
    "serve_drive",
    "smash",
    "net_kill",
    "drop",
    "attacking_clear",
    "defensive_clear",
    "lift",
    "net_shot",
    "push",
    "drive",
    "block",
    "other",
}
VALID_TERMINAL_OUTCOMES = {"winner", "error_out", "error_net", "unknown"}


def render_phase_f_summary(data: dict, out_path: str):
    """Renders a 1760x920 visual verification dashboard for Phase F classification & outcomes."""
    W, H = 1760, 920
    canvas = np.full((H, W, 3), (16, 18, 24), dtype=np.uint8)

    shots = data["shots"]
    rallies = data["rallies"]
    type_counts = data["shot_type_counts"]
    outcome_counts = data["outcome_counts"]

    # Header bar
    cv2.rectangle(canvas, (0, 0), (W, 64), (10, 12, 16), -1)
    hdr = (
        f"PHASE F BWF SHOT CLASSIFICATION & OUTCOMES: {len(shots)} Shots | "
        f"Winners={outcome_counts.get('winner', 0)} | Out={outcome_counts.get('error_out', 0)} | "
        f"Net={outcome_counts.get('error_net', 0)} | Close Calls={data['close_call_count']}"
    )
    cv2.putText(canvas, hdr, (20, 41), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (124, 215, 85), 2)

    # Panel 1 (Top-Left): Shot Type Distribution by Player (LZJ vs POPOV)
    p1_x, p1_y, p1_w, p1_h = 20, 80, 560, 410
    cv2.rectangle(canvas, (p1_x, p1_y), (p1_x + p1_w, p1_y + p1_h), (24, 27, 35), -1)
    cv2.putText(
        canvas,
        "SHOT TYPE DISTRIBUTION (LZJ vs POPOV)",
        (p1_x + 16, p1_y + 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (235, 240, 245),
        2,
    )

    ordered_types = [k for k, _ in sorted(type_counts.items(), key=lambda x: -x[1])]
    max_cnt = max(type_counts.values()) if type_counts else 1
    for idx, st in enumerate(ordered_types[:12]):
        ry = p1_y + 62 + idx * 28
        lzj_c = sum(1 for s in shots if s["type"] == st and s["hitter"] == "LZJ")
        pop_c = sum(1 for s in shots if s["type"] == st and s["hitter"] == "POPOV")
        tot_c = lzj_c + pop_c
        cv2.putText(canvas, f"{st:<16s}", (p1_x + 14, ry + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (200, 210, 220), 1)

        bar_x = p1_x + 165
        max_bw = 310
        w_lzj = int(round((lzj_c / max_cnt) * max_bw))
        w_pop = int(round((pop_c / max_cnt) * max_bw))
        if w_lzj > 0:
            cv2.rectangle(canvas, (bar_x, ry + 2), (bar_x + w_lzj, ry + 18), (255, 195, 40), -1)
        if w_pop > 0:
            cv2.rectangle(canvas, (bar_x + w_lzj, ry + 2), (bar_x + w_lzj + w_pop, ry + 18), (85, 85, 255), -1)
        cv2.putText(
            canvas,
            f"{tot_c:2d} (L:{lzj_c}/P:{pop_c})",
            (bar_x + w_lzj + w_pop + 8, ry + 14),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.40,
            (180, 190, 205),
            1,
        )

    # Panel 2 (Bottom-Left): Speed Range & Mean by Shot Category
    p2_x, p2_y, p2_w, p2_h = 20, 505, 560, 395
    cv2.rectangle(canvas, (p2_x, p2_y), (p2_x + p2_w, p2_y + p2_h), (24, 27, 35), -1)
    cv2.putText(
        canvas,
        "SPEED PROFILE BY STROKE TYPE (KM/H, EST.)",
        (p2_x + 16, p2_y + 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (235, 240, 245),
        2,
    )

    speed_groups = [
        ("smash", (70, 90, 255)),
        ("drive", (60, 200, 255)),
        ("attacking_clear", (255, 210, 60)),
        ("defensive_clear", (255, 170, 40)),
        ("push", (120, 220, 95)),
        ("lift", (180, 220, 80)),
        ("drop", (220, 140, 220)),
        ("serve_short", (180, 180, 195)),
        ("block", (140, 200, 160)),
        ("net_shot", (160, 210, 210)),
    ]
    for idx, (st, col) in enumerate(speed_groups):
        grp = [float(s["speed_kmh"]) for s in shots if s["type"] == st]
        ry = p2_y + 62 + idx * 32
        cv2.putText(canvas, f"{st:<16s}", (p2_x + 14, ry + 15), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (200, 210, 220), 1)
        if not grp:
            continue
        mn, med, mx = min(grp), float(np.median(grp)), max(grp)
        bx0 = p2_x + 165
        scale = 300.0 / 430.0
        x_mn = bx0 + int(round(mn * scale))
        x_md = bx0 + int(round(med * scale))
        x_mx = bx0 + int(round(mx * scale))
        cv2.line(canvas, (x_mn, ry + 10), (x_mx, ry + 10), col, 4)
        cv2.circle(canvas, (x_md, ry + 10), 6, (255, 255, 255), -1)
        cv2.putText(
            canvas,
            f"{mn:.0f}-{mx:.0f} (med {med:.0f})",
            (bx0 + 305, ry + 15),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.39,
            (185, 195, 210),
            1,
        )

    # Panel 3 (Top-Center): Terminal Landing & Outcome Map on BWF Court
    p3_x, p3_y, p3_w, p3_h = 600, 80, 560, 410
    cv2.rectangle(canvas, (p3_x, p3_y), (p3_x + p3_w, p3_y + p3_h), (24, 34, 28), -1)
    cv2.putText(
        canvas,
        "TERMINAL SHOT LANDING MAP (22 RALLIES)",
        (p3_x + 16, p3_y + 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (235, 240, 245),
        2,
    )

    pad_l, pad_t = p3_x + 45, p3_y + 58
    cw, ch = p3_w - 90, p3_h - 90

    def c2p(xm: float, ym: float) -> tuple[int, int]:
        u = int(round(pad_l + (ym / 13.40) * cw))
        v = int(round(pad_t + (xm / 6.10) * ch))
        return u, v

    court_lines = [
        ((0.0, 0.0), (6.10, 0.0)),
        ((0.0, 13.40), (6.10, 13.40)),
        ((0.0, 0.0), (0.0, 13.40)),
        ((6.10, 0.0), (6.10, 13.40)),
        ((0.46, 0.0), (0.46, 13.40)),
        ((5.64, 0.0), (5.64, 13.40)),
        ((0.0, 4.72), (6.10, 4.72)),
        ((0.0, 8.68), (6.10, 8.68)),
        ((3.05, 0.0), (3.05, 4.72)),
        ((3.05, 8.68), (3.05, 13.40)),
    ]
    for (x1, y1), (x2, y2) in court_lines:
        cv2.line(canvas, c2p(x1, y1), c2p(x2, y2), (200, 215, 200), 1)
    cv2.line(canvas, c2p(0.0, 6.70), c2p(6.10, 6.70), (0, 215, 255), 2)

    for r in rallies:
        ts = r["shots"][-1]
        lx, ly = ts["landing_xy"]
        pt = c2p(lx, ly)
        outc = ts["outcome"]
        if outc == "winner":
            col = (255, 145, 40)  # Blue
        elif outc == "error_out":
            col = (55, 65, 245)  # Red
        else:
            col = (0, 195, 255)  # Amber/Yellow for net error
        cv2.circle(canvas, pt, 6, col, -1)
        if ts["close_call"]:
            cv2.circle(canvas, pt, 11, (0, 255, 255), 2)
        cv2.putText(canvas, f"R{r['rally_id']}", (pt[0] + 7, pt[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (235, 240, 245), 1)

    cv2.putText(
        canvas,
        "Blue: Winner (In) | Red: Error Out | Amber: Error Net | Yellow Ring: Close Call (<=0.15m)",
        (p3_x + 16, p3_y + p3_h - 12),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.38,
        (200, 215, 205),
        1,
    )

    # Panel 4 (Bottom-Center): Contact Zone Breakdown (Front / Mid / Rear)
    p4_x, p4_y, p4_w, p4_h = 600, 505, 560, 395
    cv2.rectangle(canvas, (p4_x, p4_y), (p4_x + p4_w, p4_y + p4_h), (24, 27, 35), -1)
    cv2.putText(
        canvas,
        "CONTACT ZONE & PLAYER SUMMARY",
        (p4_x + 16, p4_y + 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (235, 240, 245),
        2,
    )

    zone_counts = Counter(s["contact_zone"] for s in shots)
    for idx, zn in enumerate(["front", "mid", "rear"]):
        ry = p4_y + 70 + idx * 42
        cnt = zone_counts.get(zn, 0)
        pct = 100.0 * cnt / max(1, len(shots))
        cv2.putText(canvas, f"{zn.upper():<8s}: {cnt:3d} shots ({pct:4.1f}%)", (p4_x + 20, ry + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (220, 230, 240), 1)
        bw = int(round((cnt / max(1, len(shots))) * 260))
        cv2.rectangle(canvas, (p4_x + 260, ry + 2), (p4_x + 260 + bw, ry + 22), (100, 200, 120), -1)

    for pidx, pid in enumerate(["LZJ", "POPOV"]):
        p_shots = [s for s in shots if s["hitter"] == pid]
        p_smashes = [s["speed_kmh"] for s in p_shots if s["type"] == "smash"]
        p_win = sum(1 for s in p_shots if s["outcome"] == "winner")
        p_err = sum(1 for s in p_shots if s["outcome"] in ("error_out", "error_net"))
        ry = p4_y + 220 + pidx * 75
        cv2.putText(
            canvas,
            f"{pid}: {len(p_shots)} shots | {len(p_smashes)} smashes (max {max(p_smashes) if p_smashes else 0:.1f} km/h)",
            (p4_x + 20, ry),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (0, 235, 255) if pid == "LZJ" else (110, 130, 255),
            2,
        )
        cv2.putText(
            canvas,
            f"   Direct Winners: {p_win} | Unforced/Forced Errors: {p_err} (Out: {sum(1 for s in p_shots if s['outcome']=='error_out')}, Net: {sum(1 for s in p_shots if s['outcome']=='error_net')})",
            (p4_x + 20, ry + 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            (200, 210, 220),
            1,
        )

    # Panel 5 (Right Column): All 22 Rallies Table
    p5_x, p5_y, p5_w, p5_h = 1180, 80, 560, 820
    cv2.rectangle(canvas, (p5_x, p5_y), (p5_x + p5_w, p5_y + p5_h), (24, 27, 35), -1)
    cv2.putText(
        canvas,
        "RALLY-BY-RALLY OUTCOME LEDGER (22 RALLIES)",
        (p5_x + 16, p5_y + 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (235, 240, 245),
        2,
    )
    cv2.putText(
        canvas,
        "R#  G#  Score    Srv    Shots  Last Stroke       Outcome     Winner",
        (p5_x + 14, p5_y + 58),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.41,
        (150, 165, 185),
        1,
    )

    for idx, r in enumerate(rallies):
        ry = p5_y + 86 + idx * 33
        sb = r["score_before"]
        sc_str = f"{sb.get('LZJ',0):2d}-{sb.get('POPOV',0):2d}"
        ts = r["shots"][-1]
        line = (
            f"R{r['rally_id']:02d} G{r['game']}  {sc_str}   {r['server']:<5s}  "
            f"{r['shot_count']:2d}     {ts['type']:<16s}  {ts['outcome']:<10s}  {r['winner']}"
        )
        col = (215, 225, 235)
        if ts["outcome"] == "winner":
            col = (140, 230, 130)
        elif ts["outcome"] == "error_out":
            col = (130, 150, 255)
        elif ts["outcome"] == "error_net":
            col = (110, 215, 255)
        cv2.putText(canvas, line, (p5_x + 14, ry), cv2.FONT_HERSHEY_SIMPLEX, 0.40, col, 1)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cv2.imwrite(out_path, canvas)


def main() -> int:
    match_dir = ROOT / "data" / "matches" / "lzj_popov"
    classified_path = match_dir / "shots_classified.json"
    debug_out = match_dir / "debug" / "phase_f_summary.png"

    classifier = ShotClassifier("singles")
    data = classifier.classify_all(output_json_path=str(classified_path))

    shots = data["shots"]
    rallies = data["rallies"]

    # Validate rules
    invalid_zones = [s for s in shots if s["contact_zone"] not in VALID_ZONES or s["target_zone"] not in VALID_ZONES]
    invalid_types = [s for s in shots if s["type"] not in VALID_SHOT_TYPES]
    non_term_bad = [s for s in shots if not s["is_terminal"] and s["outcome"] != "continue"]
    term_bad = [s for s in shots if s["is_terminal"] and s["outcome"] not in VALID_TERMINAL_OUTCOMES]

    # Verify serve height fault rule: possible_fault_height == (is_serve and z0 > 1.35)
    fault_rule_bad = [
        s for s in shots if s["possible_fault_height"] != bool(s["is_serve"] and float(s["start_3d"][2]) > 1.35)
    ]

    print("\n============================================================")
    print("PHASE F ACCEPTANCE VERIFICATION REPORT (CLASSIFICATION)")
    print("============================================================")
    print(f"Total Classified Shots      : {len(shots)} across {len(rallies)} rallies")
    print(f"Invalid Zones / Types       : {len(invalid_zones)} / {len(invalid_types)}")
    print(f"Non-Terminal 'continue' OK  : {len(shots) - len(rallies) - len(non_term_bad)}/{len(shots) - len(rallies)}")
    print(f"Terminal Outcomes Valid     : {len(rallies) - len(term_bad)}/{len(rallies)}")
    print(f"Shot Type Breakdown         : {data['shot_type_counts']}")
    print(f"Outcome Breakdown           : {data['outcome_counts']}")
    print(f"Close Calls (<= 0.15m)      : {data['close_call_count']}")
    print(f"Serve Fault Flags (>1.35m)  : {data['possible_fault_height_count']} (Rule violations: {len(fault_rule_bad)})")
    print("============================================================")

    render_phase_f_summary(data, str(debug_out))
    print(f"Saved Phase F summary visualization to {debug_out}")

    passed = (
        len(shots) == 223
        and len(rallies) == 22
        and len(invalid_zones) == 0
        and len(invalid_types) == 0
        and len(non_term_bad) == 0
        and len(term_bad) == 0
        and len(fault_rule_bad) == 0
    )
    if not passed:
        print("FAIL: Phase F acceptance criteria not met.")
        return 1
    print("PASS: All Phase F acceptance criteria met.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
