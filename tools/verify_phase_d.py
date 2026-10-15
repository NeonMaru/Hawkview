#!/usr/bin/env python3
"""
Phase D Acceptance Verification Script (tools/verify_phase_d.py)
================================================================
1. Runs PoseTracker (rtmlib Body-17 at 12.5 fps) across all 22 rallies of LZJvPopov.mp4
   and saves data/matches/lzj_popov/poses_2d.json.
2. Verifies automatic player court-side assignment (near/far swap between Game 1 & Game 2)
   against data/matches/lzj_popov/rallies_truth.json.
3. Runs HitDetector across all 22 rallies and saves data/matches/lzj_popov/hits.json.
4. Evaluates hit detection on the 5 hand-checked rallies (data/matches/lzj_popov/hits_truth.json):
   - Hit recall within +/- 2 frames (Target: >= 85%)
   - Hitter attribution accuracy (Target: >= 95%)
   - Strict alternation across all 22 rallies (Target: 100%)
5. Generates data/matches/lzj_popov/debug/phase_d_hits.png for visual inspection.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.court_calib import CourtCalibrator
from engine.pose_track import PoseTracker
from engine.hits import HitDetector


def main() -> int:
    match_dir = ROOT / "data" / "matches" / "lzj_popov"
    video_path = str(ROOT / "assets" / "LZJvPopov.mp4")
    calib_path = str(match_dir / "calibration.json")
    seg_path = str(match_dir / "rallies_segment.json")
    rallies_truth_path = str(match_dir / "rallies_truth.json")
    hits_truth_path = str(match_dir / "hits_truth.json")
    shuttle_csv_path = str(match_dir / "shuttle_2d.csv")
    poses_out_path = str(match_dir / "poses_2d.json")
    hits_out_path = str(match_dir / "hits.json")
    debug_img_path = str(match_dir / "debug" / "phase_d_hits.png")
    seed_cache_path = "/Users/anyasmac/.gemini/antigravity/brain/90a89046-3585-454f-8ff0-46b63cba39fa/scratch/pose_rallies_1_5.json"

    calibrator = CourtCalibrator()
    calibrator.load(calib_path)

    with open(seg_path, "r") as f:
        seg_data = json.load(f)
    rallies_seg = seg_data["rallies"]

    with open(rallies_truth_path, "r") as f:
        rallies_truth = {int(r["rally_id"]): r for r in json.load(f)["rallies"]}

    with open(hits_truth_path, "r") as f:
        hits_truth_data = json.load(f)

    # Merge any existing poses_2d.json into seed cache so interrupted runs resume cleanly
    merged_seed = {}
    if os.path.exists(seed_cache_path):
        with open(seed_cache_path, "r") as f:
            merged_seed.update(json.load(f))
    if os.path.exists(poses_out_path):
        with open(poses_out_path, "r") as f:
            existing = json.load(f).get("rallies", {})
            for k, v in existing.items():
                if isinstance(v, dict) and "frames" in v and len(v["frames"]) > 0:
                    merged_seed[k] = v["frames"]

    tmp_seed = "/tmp/hawkview_pose_seed.json"
    with open(tmp_seed, "w") as f:
        json.dump(merged_seed, f)

    tracker = PoseTracker(calibrator=calibrator, mode="balanced", stride=2)
    poses_by_rally = tracker.track_rallies(
        video_path=video_path,
        rallies=rallies_seg,
        output_json_path=poses_out_path,
        seed_cache_path=tmp_seed,
    )

    # 1. Verify automatic court-side identification (Game 1 vs Game 2 swap)
    side_correct = 0
    for rid_str, pinfo in sorted(poses_by_rally.items(), key=lambda x: int(x[0])):
        rid = int(rid_str)
        gt_r = rallies_truth.get(rid)
        if gt_r and pinfo["near_player"] == gt_r["near_player"] and pinfo["far_player"] == gt_r["far_player"]:
            side_correct += 1

    # 2. Run HitDetector across all 22 rallies
    detector = HitDetector(fps=25.0)
    all_rally_hits = detector.detect_all_rallies(
        shuttle_csv_path=shuttle_csv_path,
        poses_by_rally=poses_by_rally,
        rallies_segment=rallies_seg,
        output_json_path=hits_out_path,
    )
    pred_by_rally = {int(r["rally_id"]): r for r in all_rally_hits}

    # 3. Check strict alternation across all 22 rallies
    alternation_violations = 0
    total_detected_all_22 = 0
    for r in all_rally_hits:
        rhits = r["hits"]
        total_detected_all_22 += len(rhits)
        for i in range(1, len(rhits)):
            if rhits[i]["side"] == rhits[i - 1]["side"]:
                alternation_violations += 1

    # 4. Evaluate on the 5 hand-checked rallies (Rallies 1–5)
    gt_total_hits = 0
    matched_within_2f = 0
    hitter_correct = 0
    frame_errors = []
    pred_total_5 = 0

    print("\n============================================================")
    print("PHASE D ACCEPTANCE VERIFICATION REPORT")
    print("============================================================")
    for gt_r in hits_truth_data["rallies"]:
        rid = int(gt_r["rally_id"])
        gt_hits = gt_r["hits"]
        pred_r = pred_by_rally.get(rid, {"hits": []})
        pred_hits = pred_r["hits"]
        pred_total_5 += len(pred_hits)

        used_pred = set()
        r_matched = 0
        r_hitter_ok = 0
        for gh in gt_hits:
            gt_total_hits += 1
            gf = int(gh["frame"])
            gside = gh["side"]
            best_j = None
            best_diff = 999
            for j, ph in enumerate(pred_hits):
                if j in used_pred:
                    continue
                diff = abs(int(ph["frame"]) - gf)
                if diff <= 2 and diff < best_diff:
                    best_diff = diff
                    best_j = j
            if best_j is not None:
                used_pred.add(best_j)
                matched_within_2f += 1
                r_matched += 1
                frame_errors.append(best_diff)
                if pred_hits[best_j]["side"] == gside and pred_hits[best_j]["player"] == gh["player"]:
                    hitter_correct += 1
                    r_hitter_ok += 1

        print(
            f"Rally {rid:2d}: GT={len(gt_hits):2d} hits | Pred={len(pred_hits):2d} hits | "
            f"Matched(<=2f)={r_matched:2d}/{len(gt_hits):2d} ({100.0*r_matched/max(1,len(gt_hits)):5.1f}%) | "
            f"HitterOK={r_hitter_ok:2d}/{max(1,r_matched):2d}"
        )

    recall_pct = 100.0 * matched_within_2f / max(1, gt_total_hits)
    precision_pct = 100.0 * matched_within_2f / max(1, pred_total_5)
    hitter_pct = 100.0 * hitter_correct / max(1, matched_within_2f)
    side_swap_pct = 100.0 * side_correct / max(1, len(poses_by_rally))
    med_err = float(np.median(frame_errors)) if frame_errors else 0.0

    print("------------------------------------------------------------")
    print(f"5-Rally Ground Truth Hits : {gt_total_hits}")
    print(f"5-Rally Detected Hits     : {pred_total_5}")
    print(f"Hits Found (<= 2 frames)  : {matched_within_2f}/{gt_total_hits} ({recall_pct:.1f}%) [Target: >= 85.0%]")
    print(f"Hit Precision (5 Rallies) : {matched_within_2f}/{pred_total_5} ({precision_pct:.1f}%)")
    print(f"Hitter Accuracy           : {hitter_correct}/{matched_within_2f} ({hitter_pct:.1f}%) [Target: >= 95.0%]")
    print(f"Median Frame Error        : {med_err:.1f} frames")
    print(f"Auto End-Swap ID (22 ral) : {side_correct}/{len(poses_by_rally)} ({side_swap_pct:.1f}%)")
    print(f"Total Hits (All 22 ral)   : {total_detected_all_22} hits, Alternation Violations: {alternation_violations}")
    print("============================================================")

    # 5. Render visual verification summary (data/matches/lzj_popov/debug/phase_d_hits.png)
    os.makedirs(os.path.dirname(debug_img_path), exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    sample_hits = []
    # Pick 8 representative hits across Game 1 (Rallies 1–5) and Game 2 (Rallies 10–15)
    for rid in [1, 2, 3, 4, 5, 10, 14, 19]:
        pr = pred_by_rally.get(rid)
        if pr and pr["hits"]:
            mid_h = pr["hits"][min(len(pr["hits"]) - 1, len(pr["hits"]) // 2)]
            sample_hits.append((rid, pr["near_player"], pr["far_player"], mid_h))

    tiles = []
    for rid, near_p, far_p, h in sample_hits[:8]:
        fn = int(h["frame"])
        cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue
        sx, sy = int(h["shuttle_px"][0]), int(h["shuttle_px"][1])
        cv2.circle(frame, (sx, sy), 16, (0, 255, 255), 3)
        # Overlay interpolated player poses
        r_frames = poses_by_rally[str(rid)]["frames"]
        ip = detector.interpolate_rally_poses(r_frames, fn - 2, fn + 2).get(fn, {})
        for s_key, col in [("near", (0, 255, 100)), ("far", (255, 140, 0))]:
            pl = ip.get(s_key)
            if pl:
                ax, ay = int(pl["ankle_px"][0]), int(pl["ankle_px"][1])
                cv2.circle(frame, (ax, ay), 10, col, -1)
                for wk in ("wrist_l_px", "wrist_r_px"):
                    wx, wy = int(pl[wk][0]), int(pl[wk][1])
                    cv2.circle(frame, (wx, wy), 8, col, 2)
        thumb = cv2.resize(frame, (440, 248))
        h_xy = h["hitter_court_xy"]
        title = f"R{rid} F:{fn} Hitter:{h['player']}({h['side'].upper()})"
        sub = f"court=({h_xy[0]:.2f}m,{h_xy[1]:.2f}m) w_dist={h['wrist_dist_px']:.0f}px dv={h['dv_px']:.0f}"
        cv2.rectangle(thumb, (0, 0), (440, 52), (18, 20, 26), -1)
        cv2.putText(thumb, title, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 255, 255), 2)
        cv2.putText(thumb, sub, (10, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (220, 230, 240), 1)
        tiles.append(thumb)
    cap.release()

    while len(tiles) < 8:
        tiles.append(np.zeros((248, 440, 3), dtype=np.uint8))

    grid = np.vstack([np.hstack(tiles[:4]), np.hstack(tiles[4:8])])
    header = np.full((64, grid.shape[1], 3), (15, 17, 21), dtype=np.uint8)
    hdr_txt = (
        f"PHASE D VERIFICATION: Recall(<=2f)={recall_pct:.1f}% ({matched_within_2f}/{gt_total_hits}) | "
        f"Hitter Acc={hitter_pct:.1f}% | Auto Side-Swap={side_swap_pct:.0f}% ({side_correct}/22) | "
        f"Total Hits={total_detected_all_22}"
    )
    cv2.putText(header, hdr_txt, (16, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (124, 200, 74), 2)
    full_img = np.vstack([header, grid])
    cv2.imwrite(debug_img_path, full_img)
    print(f"Saved visual verification to {debug_img_path}")

    passed = (recall_pct >= 85.0) and (hitter_pct >= 95.0) and (alternation_violations == 0)
    if not passed:
        print("FAIL: Phase D acceptance criteria not met.")
        return 1
    print("PASS: Phase D acceptance criteria met.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
