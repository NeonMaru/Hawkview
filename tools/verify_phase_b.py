"""
Phase B Acceptance Verification Script — Rally Segmentation on LZJvPopov.mp4

Validates:
1. Full-video sequential segmentation via RallySegmenter (engine/segment.py)
2. Rejection of all alternate-angle / slow-mo replays (0 replays counted)
3. Trimming of main-camera windows using TrackNetV3 shuttle trajectories
4. Comparison against hand-verified ground truth (data/matches/lzj_popov/rallies_truth.json):
   - >= 90% of rallies found
   - Start and end boundaries match within +/- 0.50 s
   - 0 replays counted
5. Saves segmentation output to data/matches/lzj_popov/rallies_segment.json
   and visual timeline proof to data/matches/lzj_popov/debug/phase_b_timeline.png
"""

import os
import json
import time
import cv2
import numpy as np

from engine.segment import RallySegmenter


def render_timeline_debug_image(
    seg_result: dict,
    truth_data: dict,
    boundary_Matches: list,
    out_path: str,
):
    """Renders a visual timeline comparing ground-truth rallies, detected rallies, and rejected replays."""
    w, h = 1600, 720
    canvas = np.full((h, w, 3), (24, 26, 32), dtype=np.uint8)

    # Title
    cv2.putText(
        canvas,
        "HAWKVIEW PHASE B: FULL-VIDEO RALLY SEGMENTATION & REPLAY REJECTION (LZJvPopov.mp4)",
        (40, 45),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.78,
        (240, 244, 248),
        2,
        cv2.LINE_AA,
    )

    dur = float(truth_data.get("duration_sec", 498.44))
    x0, x1 = 160, w - 50
    span_w = x1 - x0

    def sec_to_x(s: float) -> int:
        return int(round(x0 + (s / dur) * span_w))

    # Draw time axis ticks
    for t_sec in range(0, 501, 50):
        tx = sec_to_x(float(t_sec))
        cv2.line(canvas, (tx, 80), (tx, 260), (55, 60, 72), 1)
        cv2.putText(canvas, f"{t_sec}s", (tx - 15, 285), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 170, 185), 1, cv2.LINE_AA)

    # Track 1: Ground Truth Rallies
    cv2.putText(canvas, "GROUND TRUTH", (25, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (180, 220, 255), 1, cv2.LINE_AA)
    for r in truth_data["rallies"]:
        sx = sec_to_x(r["start_sec"])
        ex = max(sx + 2, sec_to_x(r["end_sec"]))
        cv2.rectangle(canvas, (sx, 95), (ex, 125), (255, 190, 60), -1)

    # Track 2: Detected Rallies (Trimmed)
    cv2.putText(canvas, "DETECTED (22)", (25, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (120, 240, 140), 1, cv2.LINE_AA)
    for r in seg_result["rallies"]:
        csx = sec_to_x(r["cam_start_frame"] / 25.0)
        cex = max(csx + 2, sec_to_x(r["cam_end_frame"] / 25.0))
        sx = sec_to_x(r["start_sec"])
        ex = max(sx + 2, sec_to_x(r["end_sec"]))
        # Camera window in muted green, trimmed active rally in bright green
        cv2.rectangle(canvas, (csx, 150), (cex, 180), (50, 100, 60), -1)
        cv2.rectangle(canvas, (sx, 150), (ex, 180), (74, 200, 124), -1)

    # Track 3: Rejected Green Replays
    cv2.putText(canvas, "REPLAYS REJECTED", (25, 225), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 130, 255), 1, cv2.LINE_AA)
    for rep in seg_result["rejected_replays"]:
        sx = sec_to_x(rep["start_sec"])
        ex = max(sx + 2, sec_to_x(rep["end_sec"]))
        cv2.rectangle(canvas, (sx, 205), (ex, 235), (80, 80, 230), -1)

    # Table of all 22 rallies (2 columns of 11 rows)
    cv2.putText(
        canvas,
        "PER-RALLY BOUNDARY ACCURACY VS HAND-VERIFIED TRUTH (THRESHOLD <= 0.50s):",
        (40, 330),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.60,
        (220, 226, 235),
        1,
        cv2.LINE_AA,
    )

    for idx, m in enumerate(boundary_Matches):
        col = 0 if idx < 11 else 1
        row = idx if idx < 11 else (idx - 11)
        bx = 40 + col * 770
        by = 368 + row * 29

        txt = (
            f"R{m['rally_id']:02d} (G{m['game']}): "
            f"det [{m['det_start']:6.2f}s..{m['det_end']:6.2f}s] vs "
            f"truth [{m['truth_start']:6.2f}s..{m['truth_end']:6.2f}s] | "
            f"d_start={m['start_err']:+.2f}s, d_end={m['end_err']:+.2f}s"
        )
        color = (120, 235, 140) if m["within_tol"] else (80, 100, 255)
        cv2.putText(canvas, txt, (bx, by), cv2.FONT_HERSHEY_SIMPLEX, 0.46, color, 1, cv2.LINE_AA)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cv2.imwrite(out_path, canvas)


def verify_phase_b(
    video_path: str = "assets/LZJvPopov.mp4",
    match_id: str = "lzj_popov",
    stride: int = 2,
):
    print("=================================================================")
    print("🏸 HAWKVIEW PHASE B ACCEPTANCE CHECK: RALLY SEGMENTATION")
    print("=================================================================")

    truth_path = f"data/matches/{match_id}/rallies_truth.json"
    if not os.path.exists(truth_path):
        raise FileNotFoundError(f"Ground-truth rallies file not found: {truth_path}")

    with open(truth_path, "r", encoding="utf-8") as f:
        truth_data = json.load(f)

    print(f"\n[1/3] Running RallySegmenter on {video_path} (stride={stride})...")
    t0 = time.perf_counter()
    segmenter = RallySegmenter(video_path=video_path, match_id=match_id)
    seg_result = segmenter.segment_video(stride=stride)
    elapsed = time.perf_counter() - t0

    eff_fps = seg_result["frames_sampled"] / elapsed if elapsed > 0 else 0.0
    print(f"  • Total Video Frames Read: {seg_result['total_frames']:,}")
    print(f"  • Sampled Frames Evaluated (stride={stride}): {seg_result['frames_sampled']:,} ({eff_fps:.1f} sampled FPS in {elapsed:.2f}s)")
    print(f"  • Main-Camera Rallies Detected: {seg_result['rally_count']}")
    print(f"  • Alternate-Angle Green Replays Rejected: {len(seg_result['rejected_replays'])}")

    out_json = f"data/matches/{match_id}/rallies_segment.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(seg_result, f, indent=2)
    print(f"  • Saved Segmented Rally Windows: {out_json}")

    # Step 2: Compare against hand-verified ground truth
    print(f"\n[2/3] Comparing Detected Rallies Against {truth_path}...")
    truth_rallies = truth_data["rallies"]
    det_rallies = seg_result["rallies"]

    matched_count = 0
    within_tol_count = 0
    boundary_matches = []
    start_abs_errors = []
    end_abs_errors = []

    for tr in truth_rallies:
        # Find overlapping detected rally
        best_det = None
        best_overlap = 0.0
        for dr in det_rallies:
            ov = max(0.0, min(tr["end_sec"], dr["end_sec"]) - max(tr["start_sec"], dr["start_sec"]))
            if ov > best_overlap:
                best_overlap = ov
                best_det = dr

        if best_det is not None and best_overlap > 1.0:
            matched_count += 1
            s_err = best_det["start_sec"] - tr["start_sec"]
            e_err = best_det["end_sec"] - tr["end_sec"]
            start_abs_errors.append(abs(s_err))
            end_abs_errors.append(abs(e_err))
            ok = (abs(s_err) <= 0.50) and (abs(e_err) <= 0.50)
            if ok:
                within_tol_count += 1

            boundary_matches.append({
                "rally_id": tr["rally_id"],
                "game": tr["game"],
                "truth_start": tr["start_sec"],
                "truth_end": tr["end_sec"],
                "det_start": best_det["start_sec"],
                "det_end": best_det["end_sec"],
                "start_err": round(s_err, 2),
                "end_err": round(e_err, 2),
                "within_tol": ok,
            })
            status_icon = "✅" if ok else "❌"
            print(
                f"  {status_icon} Rally {tr['rally_id']:2d} (G{tr['game']}): "
                f"detected [{best_det['start_sec']:6.2f}s .. {best_det['end_sec']:6.2f}s] "
                f"vs truth [{tr['start_sec']:6.2f}s .. {tr['end_sec']:6.2f}s] "
                f"(Δstart={s_err:+.2f}s, Δend={e_err:+.2f}s, green={best_det['mean_green_pct']:.1f}%, line_hit={best_det['mean_line_hit_pct']:.1f}%)"
            )
        else:
            print(f"  ❌ Rally {tr['rally_id']:2d} (G{tr['game']}): MISSED")

    # Check if any detected window overlapped a replay instead of a truth rally
    false_positives = len(det_rallies) - matched_count

    debug_img = f"data/matches/{match_id}/debug/phase_b_timeline.png"
    render_timeline_debug_image(seg_result, truth_data, boundary_matches, debug_img)
    print(f"\n[3/3] Saved Timeline Proof Chart: {debug_img}")

    recall_pct = (matched_count / float(len(truth_rallies))) * 100.0 if truth_rallies else 0.0
    max_start_err = max(start_abs_errors) if start_abs_errors else 99.0
    max_end_err = max(end_abs_errors) if end_abs_errors else 99.0
    med_start_err = float(np.median(start_abs_errors)) if start_abs_errors else 99.0
    med_end_err = float(np.median(end_abs_errors)) if end_abs_errors else 99.0

    passed = (
        (recall_pct >= 90.0)
        and (within_tol_count == len(truth_rallies))
        and (false_positives == 0)
    )

    print("\n-----------------------------------------------------------------")
    print("📊 PHASE B ACCEPTANCE EVALUATION:")
    print(f"  • Ground-Truth Rallies: {len(truth_rallies)} (9 in Game 1, 13 in Game 2)")
    print(f"  • Rallies Found: {matched_count}/{len(truth_rallies)} ({recall_pct:.1f}%, threshold >= 90.0%)")
    print(f"  • Rallies Within ±0.50s Boundary Tolerance: {within_tol_count}/{len(truth_rallies)}")
    print(f"  • Start Boundary Error: median={med_start_err:.2f}s, max={max_start_err:.2f}s (threshold <= 0.50s)")
    print(f"  • End Boundary Error:   median={med_end_err:.2f}s, max={max_end_err:.2f}s (threshold <= 0.50s)")
    print(f"  • Replays Counted as Rallies: {false_positives} (rejected {len(seg_result['rejected_replays'])} alternate-angle green replay segments)")
    print(f"  • Result: {'✅ ACCEPTANCE CHECK PASSED' if passed else '❌ ACCEPTANCE CHECK FAILED'}")
    print("-----------------------------------------------------------------\n")

    return {
        "passed": passed,
        "rally_count": len(det_rallies),
        "matched_count": matched_count,
        "recall_pct": recall_pct,
        "max_start_err_sec": max_start_err,
        "max_end_err_sec": max_end_err,
        "false_positives": false_positives,
        "rejected_replays_count": len(seg_result["rejected_replays"]),
    }


if __name__ == "__main__":
    verify_phase_b()
