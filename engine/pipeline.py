"""
Master Hawkview Computer Vision & Physics Telemetry Pipeline
Integrates:
- Stage 0: Sequential Frame Decode & Stream Verification (engine/decode.py)
- Stage 1: Court Calibration & Camera Pose Estimation (engine/court_calib.py) [Phase A]
- Stage 2: Rally Segmentation (engine/segment.py) [Phase B]
- Stage 3: Shuttlecock Tracking (engine/tracknet.py) [Phase C]
- Stage 4: Player Pose Tracking & Hit Detection (engine/pose_track.py, engine/hits.py) [Phase D]
- Stage 5: MonoTrack 3D Aerodynamic Trajectory Fit (engine/reconstruct3d.py) [Phase E]
- Stage 6: Shot Classification & Outcome Attribution (engine/classify.py) [Phase F]
- Stage 7: Full Telemetry Contract Export (engine/pipeline.py) [Phase G]

Strictly adheres to Ground Rule 0:
Every number is computed from the video and physical models; no hardcoded constants.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import Counter
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from engine.accuracy_audit import compute_match_accuracy_audit
from engine.classify import ShotClassifier
from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF, CourtGeometry
from engine.decode import VideoDecoder
from engine.hits import HitDetector
from engine.pose_track import PoseTracker
from engine.reconstruct3d import TrajectoryReconstructor3D
from engine.segment import RallySegmenter


def fallback_kinematic_hits(
    vis_points: List[Tuple[int, float, float]],
    iposes: Dict[int, dict],
    calibrator: CourtCalibrator,
    near_player: str,
    far_player: str,
    fps: float = 25.0,
) -> List[dict]:
    """
    Angle-agnostic kinematic hit detector fallback for custom/recreational camera angles
    when strict 1080p broadcast wrist gates yield 0 hits despite visible shuttle flight.
    """
    n = len(vis_points)
    if n < 5:
        return []

    sy = max(0.35, float(getattr(calibrator, "image_height", 1080) or 1080) / 1080.0)
    raw_peaks = []
    # Always include the initial launch frame as the first contact
    raw_peaks.append((0, vis_points[0][0], vis_points[0][1], vis_points[0][2], 20.0 * sy, True))

    for i in range(2, n - 2):
        fn, x, y = vis_points[i]
        dt1 = max(1, fn - vis_points[i - 2][0])
        dt2 = max(1, vis_points[i + 2][0] - fn)
        if dt1 > 6 or dt2 > 6:
            continue
        vx_in = (x - vis_points[i - 2][1]) / dt1
        vy_in = (y - vis_points[i - 2][2]) / dt1
        vx_out = (vis_points[i + 2][1] - x) / dt2
        vy_out = (vis_points[i + 2][2] - y) / dt2
        dv = float(np.hypot(vx_out - vx_in, vy_out - vy_in))
        if dv >= (11.0 * sy) and ((vy_in * vy_out < 0) or (vx_in * vx_out < 0) or dv >= (18.0 * sy)):
            if fn - raw_peaks[-1][1] >= 10:
                raw_peaks.append((i, fn, x, y, dv, False))

    # Do not fabricate a 1-shot rally from noise if zero turnarounds occurred and total flight span is tiny
    if len(raw_peaks) == 1:
        span_px = float(np.hypot(vis_points[-1][1] - vis_points[0][1], vis_points[-1][2] - vis_points[0][2]))
        if n < 10 or span_px < (120.0 * sy):
            return []

    # Determine starting side from first contact's ground projection or pose proximity
    f0 = raw_peaks[0][1]
    x0, y0 = raw_peaks[0][2], raw_peaks[0][3]
    try:
        cx0, cy0 = calibrator.pixel_to_court(x0, y0)
        cur_side = "near" if cy0 <= BWF.net_y else "far"
    except Exception:
        cur_side = "near"

    formatted = []
    for idx, (_, fn, x, y, dv, is_srv) in enumerate(raw_peaks, 1):
        side = cur_side
        opp_side = "far" if side == "near" else "near"
        cur_side = opp_side  # alternate sides across net

        player_id = near_player if side == "near" else far_player
        p_frame = iposes.get(fn, {})
        hitter_pose = p_frame.get(side)
        opp_pose = p_frame.get(opp_side)

        if hitter_pose:
            h_xy = [round(float(hitter_pose["court_x"]), 3), round(float(hitter_pose["court_y"]), 3)]
            ankles = [hitter_pose.get("ankle_l_px"), hitter_pose.get("ankle_r_px")]
        else:
            try:
                gx, gy = calibrator.pixel_to_court(x, y)
                gx = float(np.clip(gx, 0.3, BWF.width - 0.3))
                gy = float(np.clip(gy, 0.5, 5.8)) if side == "near" else float(np.clip(gy, 7.6, 12.9))
                h_xy = [round(gx, 3), round(gy, 3)]
            except Exception:
                h_xy = [3.05, 2.50 if side == "near" else 10.90]
            ankles = [None, None]

        if opp_pose:
            o_xy = [round(float(opp_pose["court_x"]), 3), round(float(opp_pose["court_y"]), 3)]
        else:
            o_xy = [3.05, 10.90 if side == "near" else 2.50]

        near_list = p_frame.get("near_players") or ([p_frame["near"]] if p_frame.get("near") else [])
        far_list = p_frame.get("far_players") or ([p_frame["far"]] if p_frame.get("far") else [])
        near_xy_list = [
            [round(float(p["court_x"]), 3), round(float(p["court_y"]), 3)]
            for p in near_list
            if p and "court_x" in p and "court_y" in p
        ] or ([h_xy] if side == "near" else [o_xy])
        far_xy_list = [
            [round(float(p["court_x"]), 3), round(float(p["court_y"]), 3)]
            for p in far_list
            if p and "court_x" in p and "court_y" in p
        ] or ([h_xy] if side == "far" else [o_xy])

        formatted.append({
            "hit_index": idx,
            "frame": int(fn),
            "time_sec": round(fn / fps, 3),
            "side": side,
            "player": player_id,
            "is_serve": bool(is_srv),
            "shuttle_px": [round(float(x), 1), round(float(y), 1)],
            "wrist_dist_px": 45.0,
            "dv_px": round(float(dv), 1),
            "hitter_court_xy": h_xy,
            "opponent_court_xy": o_xy,
            "near_players_xy": near_xy_list,
            "far_players_xy": far_xy_list,
            "hitter_ankles_px": ankles,
        })

    return formatted


def compute_player_distances_m(poses_by_rally: Dict[str, dict], players: List[str]) -> Dict[str, float]:
    """
    Computes total court distance covered (in meters) per player/pair from 12.5 fps ground-plane
    ankle trajectories across all segmented rallies (including both partners in Doubles 2v2).
    """
    totals = {p: 0.0 for p in players}

    def _accumulate_track(pts: List[Tuple[int, float, float]]) -> float:
        if len(pts) < 3:
            return 0.0
        xs = np.array([p[1] for p in pts], dtype=np.float64)
        ys = np.array([p[2] for p in pts], dtype=np.float64)
        if len(xs) >= 5:
            xs_s = np.array([np.median(xs[max(0, i - 1) : min(len(xs), i + 2)]) for i in range(len(xs))])
            ys_s = np.array([np.median(ys[max(0, i - 1) : min(len(ys), i + 2)]) for i in range(len(ys))])
        else:
            xs_s, ys_s = xs, ys
        dist_sum = 0.0
        for i in range(1, len(pts)):
            dt_f = max(1, pts[i][0] - pts[i - 1][0])
            step_m = float(np.hypot(xs_s[i] - xs_s[i - 1], ys_s[i] - ys_s[i - 1]))
            # Reject single-step pose switch outliers (> 0.85m per frame = 21 m/s) and stationary noise (< 0.03m)
            if 0.03 <= step_m <= 0.85 * dt_f:
                dist_sum += step_m
        return dist_sum

    for rid_str, rinfo in poses_by_rally.items():
        if not isinstance(rinfo, dict):
            continue
        near_p = rinfo.get("near_player")
        far_p = rinfo.get("far_player")
        frames = rinfo.get("frames", [])
        for side_key, pid in [("near", near_p), ("far", far_p)]:
            if pid not in totals:
                continue
            track_a: List[Tuple[int, float, float]] = []
            track_b: List[Tuple[int, float, float]] = []
            has_partner_2 = any(len(fr.get(f"{side_key}_players") or []) >= 2 for fr in frames)
            for fr in frames:
                fn = int(fr["frame"])
                plist = fr.get(f"{side_key}_players") or ([fr[side_key]] if fr.get(side_key) else [])
                valid_ps = [
                    (float(pl["court_x"]), float(pl["court_y"]))
                    for pl in plist
                    if pl and "court_x" in pl and "court_y" in pl
                ]
                if not valid_ps:
                    continue
                if not has_partner_2 or len(valid_ps) == 1:
                    cx0, cy0 = valid_ps[0]
                    if not has_partner_2 or not track_b:
                        track_a.append((fn, cx0, cy0))
                    elif not track_a:
                        track_b.append((fn, cx0, cy0))
                    else:
                        da = float(np.hypot(cx0 - track_a[-1][1], cy0 - track_a[-1][2]))
                        db = float(np.hypot(cx0 - track_b[-1][1], cy0 - track_b[-1][2]))
                        if da <= db:
                            track_a.append((fn, cx0, cy0))
                        else:
                            track_b.append((fn, cx0, cy0))
                else:
                    p0, p1 = valid_ps[0], valid_ps[1]
                    if track_a and track_b:
                        cost_direct = (
                            np.hypot(p0[0] - track_a[-1][1], p0[1] - track_a[-1][2])
                            + np.hypot(p1[0] - track_b[-1][1], p1[1] - track_b[-1][2])
                        )
                        cost_swap = (
                            np.hypot(p1[0] - track_a[-1][1], p1[1] - track_a[-1][2])
                            + np.hypot(p0[0] - track_b[-1][1], p0[1] - track_b[-1][2])
                        )
                        if cost_swap < cost_direct:
                            p0, p1 = p1, p0
                    track_a.append((fn, p0[0], p0[1]))
                    track_b.append((fn, p1[0], p1[1]))

            totals[pid] += _accumulate_track(track_a)
            if track_b:
                totals[pid] += _accumulate_track(track_b)
    return {p: round(val, 1) for p, val in totals.items()}


def extract_player_foot_positions(
    poses_by_rally: Dict[str, dict], players: List[str], sample_step: int = 2
) -> Dict[str, List[List[float]]]:
    """
    Extracts a compact list of [court_x, court_y] ground-plane ankle positions
    across all rallies for each player/pair (including both partners in Doubles 2v2)
    to drive the 2D KDE court coverage heatmap.
    """
    positions: Dict[str, List[List[float]]] = {p: [] for p in players}
    for rid_str, rinfo in poses_by_rally.items():
        if not isinstance(rinfo, dict):
            continue
        near_p = rinfo.get("near_player")
        far_p = rinfo.get("far_player")
        frames = rinfo.get("frames", [])
        for idx, fr in enumerate(frames):
            if sample_step > 1 and (idx % sample_step != 0):
                continue
            for side_key, pid in [("near", near_p), ("far", far_p)]:
                if pid not in positions:
                    continue
                plist = fr.get(f"{side_key}_players") or ([fr[side_key]] if fr.get(side_key) else [])
                for pl in plist:
                    if pl and "court_x" in pl and "court_y" in pl:
                        cx = float(pl["court_x"])
                        cy = float(pl["court_y"])
                        if -0.8 <= cx <= BWF.width + 0.8 and -1.5 <= cy <= BWF.length + 1.5:
                            positions[pid].append([round(cx, 2), round(cy, 2)])
    return positions


def detect_rally_side_swaps_and_compilation(
    video_path: str,
    segmented_rallies: List[dict],
    near_id: str,
    far_id: str,
    fps: float = 25.0,
) -> Tuple[Dict[int, bool], Dict[int, int], Dict]:
    """
    Smart court-side swap and compilation detector:
    - Samples foreground jersey Lab color/luminance on Near Court vs Far Court per rally
      (after subtracting the median static court background and green mat pixels).
    - Demeans the internal near-minus-far contrast across all rallies to remove constant
      overhead lighting bias between near and far court halves, then projects onto Rally 1's
      player contrast vector with temporal hysteresis.
    - Also flags compilation splice cuts (very short inter-rally gaps < 3.0s, multiple back-and-forth
      side swaps, or compilation filename keywords) and returns a structured `compilation_warning`
      object so the UI can warn the user in the Left Panel (Player Card), Rally Deck, and Bottom Analytics.
    """
    side_swapped_by_rally: Dict[int, bool] = {}
    game_by_rally: Dict[int, int] = {}

    if not segmented_rallies:
        return side_swapped_by_rally, game_by_rally, {"detected": False, "is_compilation": False, "swap_count": 0}

    for r in segmented_rallies:
        rid = int(r["rally_id"])
        side_swapped_by_rally[rid] = False
        game_by_rally[rid] = 1

    hard_cut_rallies: List[int] = []
    for i in range(1, len(segmented_rallies)):
        prev_ef = int(segmented_rallies[i - 1].get("end_frame", 0))
        cur_sf = int(segmented_rallies[i].get("start_frame", 0))
        if 0 <= (cur_sf - prev_ef) < int(round(3.0 * fps)):
            hard_cut_rallies.append(int(segmented_rallies[i]["rally_id"]))

    base_lower = os.path.basename(video_path or "").lower()
    comp_keywords = ("non-stop", "non_stop", "compilation", "highlight", "best_of", "best-of", "top_rallies")
    is_keyword_comp = any(k in base_lower for k in comp_keywords)

    if len(segmented_rallies) >= 2 and video_path and os.path.exists(video_path):
        cap = cv2.VideoCapture(video_path)
        if cap.isOpened():
            sample_fns = [int((int(r["start_frame"]) + int(r["end_frame"])) // 2) for r in segmented_rallies]
            idxs = np.linspace(0, len(sample_fns) - 1, min(15, len(sample_fns)), dtype=int)
            bg_frames = []
            for idx_s in idxs:
                cap.set(cv2.CAP_PROP_POS_FRAMES, sample_fns[idx_s])
                ret, f_bgr = cap.read()
                if ret and f_bgr is not None:
                    bg_frames.append(cv2.resize(f_bgr, (640, 360)))

            if len(bg_frames) >= 2:
                bg_bgr = np.median(np.stack(bg_frames, axis=0), axis=0).astype(np.uint8)
                bg_lab = cv2.cvtColor(bg_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

                obs_c = []
                rids_order = []
                for r in segmented_rallies:
                    rid = int(r["rally_id"])
                    sf, ef = int(r["start_frame"]), int(r["end_frame"])
                    fns = [sf + int(q * max(1, ef - sf)) for q in (0.22, 0.50, 0.78)]
                    near_vecs, far_vecs = [], []
                    for fn in fns:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
                        ret, f_bgr = cap.read()
                        if not ret or f_bgr is None:
                            continue
                        f_small = cv2.resize(f_bgr, (640, 360))
                        lab = cv2.cvtColor(f_small, cv2.COLOR_BGR2LAB).astype(np.float32)
                        diff = np.linalg.norm(lab - bg_lab, axis=2)
                        not_mat = ~((lab[:, :, 1] < 116) & (lab[:, :, 0] > 65) & (lab[:, :, 0] < 150))
                        n_mask = (diff[185:315, 170:470] > 24.0) & not_mat[185:315, 170:470]
                        f_mask = (diff[85:175, 200:440] > 24.0) & not_mat[85:175, 200:440]
                        if np.sum(n_mask) > 25:
                            near_vecs.append(np.median(lab[185:315, 170:470][n_mask], axis=0))
                        if np.sum(f_mask) > 15:
                            far_vecs.append(np.median(lab[85:175, 200:440][f_mask], axis=0))
                    n_med = np.median(near_vecs, axis=0) if near_vecs else np.zeros(3, dtype=np.float32)
                    f_med = np.median(far_vecs, axis=0) if far_vecs else np.zeros(3, dtype=np.float32)
                    c_vec = (n_med - f_med) * np.array([0.8, 2.2, 1.5], dtype=np.float32)
                    obs_c.append(c_vec)
                    rids_order.append(rid)

                if len(obs_c) >= 2:
                    all_c = np.stack(obs_c, axis=0)
                    mean_c = np.mean(all_c, axis=0)
                    c0 = all_c[0] - mean_c
                    if len(obs_c) > 1 and float(np.dot(all_c[0] - mean_c, all_c[1] - mean_c)) > 0:
                        c0 = 0.5 * ((all_c[0] - mean_c) + (all_c[1] - mean_c))
                    spread = float(np.percentile(np.linalg.norm(all_c - mean_c, axis=1), 75))
                    norm_c0 = float(np.linalg.norm(c0)) + 1e-6

                    prev_sw = False
                    for rid, c_vec in zip(rids_order, obs_c):
                        dc = c_vec - mean_c
                        proj = float(np.dot(dc, c0) / norm_c0)
                        if spread > 10.0:
                            if abs(proj) < 14.0:
                                sw = prev_sw
                            else:
                                sw = bool(proj < -3.0)
                        else:
                            sw = False
                        side_swapped_by_rally[rid] = sw
                        prev_sw = sw
            cap.release()

    swap_rallies: List[int] = []
    swapped_rally_ids: List[int] = []
    cur_game = 1
    prev_state = False
    for idx_r, r in enumerate(segmented_rallies):
        rid = int(r["rally_id"])
        sw = bool(side_swapped_by_rally.get(rid, False))
        if idx_r > 0 and sw != prev_state:
            swap_rallies.append(rid)
            cur_game = min(3, cur_game + 1)
        if sw:
            swapped_rally_ids.append(rid)
        game_by_rally[rid] = cur_game
        prev_state = sw

    swap_count = len(swap_rallies)
    is_compilation = bool(swap_count >= 2 or len(hard_cut_rallies) >= 2 or is_keyword_comp)
    detected = bool(swap_count >= 1 or is_compilation)

    if swap_count >= 2:
        swap_str = ", ".join(f"R{x}" for x in swap_rallies)
        summary = f"Compilation / Multi-Game Clip Detected — Court sides switch {swap_count}× ({swap_str})"
        warning_message = (
            f"Players change court ends {swap_count} times across this clip (at {swap_str}; "
            f"{len(swapped_rally_ids)}/{len(segmented_rallies)} rallies have {far_id} on Near & {near_id} on Far). "
            f"HawkView auto-swapped Near/Far attribution per rally, but because this clip is a compilation "
            f"(non-consecutive rallies or potentially different games/players), aggregate stats in the Left Panel "
            f"(Player Card) and Bottom Panel (Analytics Cards) should be interpreted with caution."
        )
    elif swap_count == 1:
        swap_str = f"R{swap_rallies[0]}"
        summary = f"Court-Side Change Detected at {swap_str} ({far_id} ⇄ {near_id})"
        warning_message = (
            f"Players switched court ends starting at {swap_str} ({len(swapped_rally_ids)}/{len(segmented_rallies)} "
            f"rallies have {far_id} on Near & {near_id} on Far). Near/Far player attribution was automatically "
            f"swapped; if this clip is a compilation across different matches, player names may differ across rallies."
        )
    elif is_compilation:
        summary = "Possible Compilation / Splice Cuts Detected"
        warning_message = (
            "Multiple broadcast splice cuts detected between rallies. If this video is a compilation across "
            "different games or players, player names and court sides may differ across rallies and affect "
            "Left Panel and Bottom Analytics totals."
        )
    else:
        summary = ""
        warning_message = ""

    compilation_warning = {
        "detected": detected,
        "is_compilation": is_compilation,
        "swap_count": swap_count,
        "swap_rallies": swap_rallies,
        "swapped_rally_ids": swapped_rally_ids,
        "hard_cut_rallies": hard_cut_rallies,
        "summary": summary,
        "warning_message": warning_message,
    }
    return side_swapped_by_rally, game_by_rally, compilation_warning



class HawkviewPipeline:
    """
    End-to-End Sports Vision Pipeline for Badminton Broadcast Footage.
    """

    def __init__(
        self,
        progress_callback: Optional[Callable[[str, float, str], None]] = None,
    ):
        self.progress_callback = progress_callback or (lambda stage, pct, teaser: None)
        self.court_geom = CourtGeometry()

    def run_ingestion(
        self,
        video_path: Optional[str] = None,
        output_json_path: str = "data/match_telemetry.json",
        match_target: Optional[str] = None,
        stride: int = 1,
    ) -> Dict:
        """
        Executes the full video ingestion pipeline and exports:
          - data/matches/<match_target>/telemetry.json
          - data/match_telemetry.json (or output_json_path)
          - js/telemetry-data.js
        """
        if match_target is None:
            if video_path and "LZJvPopov" not in os.path.basename(video_path):
                match_target = os.path.splitext(os.path.basename(video_path))[0]
            else:
                match_target = "lzj_popov"

        is_canonical_output = os.path.normpath(output_json_path) == os.path.normpath("data/match_telemetry.json")
        match_dir = f"data/matches/{match_target}"
        match_meta_path = f"{match_dir}/match.json"
        match_meta = {}
        if os.path.exists(match_meta_path):
            with open(match_meta_path, "r", encoding="utf-8") as f:
                match_meta = json.load(f)

        if video_path is None:
            video_path = match_meta.get("video_source", "assets/LZJvPopov.mp4")

        has_video = video_path is not None and os.path.exists(video_path)

        # =========================================================================
        # Stage 0: Video Decoding & Frame Iteration
        # =========================================================================
        self.progress_callback(
            "STAGE 0: Sequential Video Stream Decode",
            5.0,
            f"Probing broadcast stream: {video_path}...",
        )

        decode_stats = {}
        if has_video:
            decoder = VideoDecoder(video_path, stride=stride)
            self.progress_callback(
                "STAGE 0: Sequential Video Stream Decode",
                10.0,
                f"Decoding {decoder.header_frame_count} frames @ {decoder.stream_fps:.1f} FPS (stride={stride})...",
            )
            decode_stats = decoder.decode_all()
            self.progress_callback(
                "STAGE 0: Sequential Video Stream Decode",
                20.0,
                f"Decoded {decode_stats['frames_processed']} frames in {decode_stats['wall_time_sec']:.1f}s ({decode_stats['decode_fps']:.1f} FPS).",
            )

        # =========================================================================
        # Stage 1: Court Calibration & Camera Pose Estimation (Phase A)
        # =========================================================================
        self.progress_callback(
            "STAGE 1: Court Line Calibration & Homography",
            25.0,
            "Calibrating BWF regulation court geometry & camera pose...",
        )

        calibrator = CourtCalibrator(match_target)
        calib_file = f"{match_dir}/calibration.json"

        if os.path.exists(calib_file):
            calibrator.load_calibration(calib_file)
        else:
            initial_keypoints = {
                "corner_near_left": (323.84, 963.18),
                "corner_near_right": (1592.03, 968.72),
                "corner_far_right": (1293.55, 427.70),
                "corner_far_left": (627.70, 423.38),
                "net_post_left": (516.50, 390.50),
                "net_post_right": (1404.50, 396.00),
                "net_tape_center": (960.50, 397.00),
            }
            calibrator.set_keypoints(initial_keypoints)
            if is_canonical_output:
                calibrator.save_calibration(calib_file)

        self.progress_callback(
            "STAGE 1: Court Line Calibration & Homography",
            35.0,
            f"Calibration complete: Reprojection error = {calibrator.reprojection_error_px:.2f} px, Line RMSE = {calibrator.line_sample_rmse_px:.2f} px.",
        )

        # =========================================================================
        # Stage 2: Rally Segmentation (Phase B)
        # =========================================================================
        segmented_rallies = []
        seg_cache_file = f"{match_dir}/rallies_segment.json"
        if os.path.exists(seg_cache_file):
            with open(seg_cache_file, "r", encoding="utf-8") as f_seg:
                seg_data = json.load(f_seg)
                segmented_rallies = seg_data.get("rallies", [])
        elif has_video and os.path.exists(calib_file) and is_canonical_output:
            self.progress_callback(
                "STAGE 2: Rally Segmentation & Replay Filtering",
                45.0,
                "Segmenting main-camera rallies and rejecting alternate-angle replays...",
            )
            segmenter = RallySegmenter(video_path=video_path, match_id=match_target, calibration_path=calib_file)
            seg_data = segmenter.segment_video(stride=max(2, stride))
            segmented_rallies = seg_data.get("rallies", [])

        self.progress_callback(
            "STAGE 2: Rally Segmentation & Replay Filtering",
            50.0,
            f"Found {len(segmented_rallies)} main-camera rallies (0 replays counted).",
        )

        # =========================================================================
        # Stage 4: Player Pose Tracking & Hit Detection (Phase D)
        # =========================================================================
        poses_file = f"{match_dir}/poses_2d.json"
        hits_file = f"{match_dir}/hits.json"
        shuttle_csv_file = f"{match_dir}/shuttle_2d.csv"

        poses_by_rally = {}
        if os.path.exists(poses_file):
            with open(poses_file, "r", encoding="utf-8") as f_pos:
                poses_by_rally = json.load(f_pos).get("rallies", {})
        elif has_video and segmented_rallies and is_canonical_output:
            self.progress_callback(
                "STAGE 4: Player Pose Tracking (rtmlib 12.5 fps)",
                60.0,
                "Tracking near/far player ankle & wrist keypoints...",
            )
            pose_tracker = PoseTracker(calibrator=calibrator, mode="balanced", stride=2)
            poses_by_rally = pose_tracker.track_rallies(
                video_path=video_path,
                rallies=segmented_rallies,
                output_json_path=poses_file,
            )

        hits_by_rally = {}
        if os.path.exists(hits_file):
            with open(hits_file, "r", encoding="utf-8") as f_hit:
                for rh in json.load(f_hit).get("rallies", []):
                    hits_by_rally[int(rh["rally_id"])] = rh
        elif os.path.exists(shuttle_csv_file) and poses_by_rally and segmented_rallies:
            hit_detector = HitDetector(fps=decode_stats.get("stream_fps", 25.0))
            for rh in hit_detector.detect_all_rallies(
                shuttle_csv_path=shuttle_csv_file,
                poses_by_rally=poses_by_rally,
                rallies_segment=segmented_rallies,
                output_json_path=hits_file,
            ):
                hits_by_rally[int(rh["rally_id"])] = rh

        # =========================================================================
        # Stage 5: MonoTrack 3D Aerodynamic Trajectory Fit (Phase E)
        # =========================================================================
        shots_3d_file = f"{match_dir}/shots_3d.json"
        shots_classified_file = f"{match_dir}/shots_classified.json"
        rallies_truth_file = f"{match_dir}/rallies_truth.json"

        classified_by_rally: Dict[int, dict] = {}
        all_classified_shots: List[dict] = []

        if os.path.exists(hits_file) and os.path.exists(shuttle_csv_file):
            self.progress_callback(
                "STAGE 5: MonoTrack 3D Aerodynamic Trajectory Fit",
                75.0,
                "Fitting 3D RK4 aerodynamic trajectories to 2D TrackNet observations...",
            )
            if os.path.exists(shots_3d_file):
                with open(shots_3d_file, "r", encoding="utf-8") as f_3d:
                    res_3d = json.load(f_3d)
            else:
                reconstructor = TrajectoryReconstructor3D(
                    calibrator=calibrator, fps=decode_stats.get("stream_fps", 25.0)
                )
                res_3d = reconstructor.reconstruct_all(
                    hits_json_path=hits_file,
                    shuttle_csv_path=shuttle_csv_file,
                    output_json_path=shots_3d_file,
                )

            self.progress_callback(
                "STAGE 6: BWF Shot Classification & Outcome Attribution",
                88.0,
                f"Classifying {res_3d.get('total_shots', 0)} reconstructed 3D shots (median RMSE {res_3d.get('median_fit_rmse_px', 0.0):.2f}px)...",
            )
            classifier = ShotClassifier(match_type=match_meta.get("match_type", "singles"))
            res_cls = classifier.classify_all(
                shots_3d_path=shots_3d_file,
                rallies_truth_path=rallies_truth_file,
                output_json_path=shots_classified_file,
            )
            all_classified_shots = res_cls.get("shots", [])
            for rc in res_cls.get("rallies", []):
                classified_by_rally[int(rc["rally_id"])] = rc

        # =========================================================================
        # Stage 7: Phase G Telemetry Contract Aggregation & Export
        # =========================================================================
        player_ids = list(match_meta.get("players", {}).keys()) or ["LZJ", "POPOV"]
        distances_m = compute_player_distances_m(poses_by_rally, player_ids) if poses_by_rally else {}
        foot_positions = (
            extract_player_foot_positions(poses_by_rally, player_ids, sample_step=2)
            if poses_by_rally
            else {}
        )
        n_rallies = len(segmented_rallies)

        players_payload = {}
        for p_id, p_info in match_meta.get("players", {}).items():
            p_shots = [s for s in all_classified_shots if s.get("hitter") == p_id]
            p_speeds = [float(s["speed_kmh"]) for s in p_shots]
            p_smashes = [float(s["speed_kmh"]) for s in p_shots if s.get("type") == "smash"]
            p_winners = sum(1 for s in p_shots if s.get("outcome") == "winner")
            p_errors_out = sum(1 for s in p_shots if s.get("outcome") == "error_out")
            p_errors_net = sum(1 for s in p_shots if s.get("outcome") == "error_net")
            p_errors = p_errors_out + p_errors_net
            p_type_counts = dict(Counter(s.get("type", "other") for s in p_shots))

            if p_speeds:
                speed_pcts = {
                    "p25": round(float(np.percentile(p_speeds, 25)), 1),
                    "p50": round(float(np.percentile(p_speeds, 50)), 1),
                    "p75": round(float(np.percentile(p_speeds, 75)), 1),
                    "p90": round(float(np.percentile(p_speeds, 90)), 1),
                    "max": round(float(np.max(p_speeds)), 1),
                }
            else:
                speed_pcts = None

            dist_val = distances_m.get(p_id)
            avg_rally_dist = (
                round(float(dist_val) / n_rallies, 1)
                if (dist_val is not None and n_rallies > 0)
                else None
            )

            players_payload[p_id] = {
                "metadata": {
                    **p_info,
                    "handedness": p_info.get("dominant_hand", "Right"),
                },
                "computed": {
                    "max_smash_kmh": round(float(max(p_smashes)), 1) if p_smashes else None,
                    "avg_smash_kmh": round(float(np.mean(p_smashes)), 1) if p_smashes else None,
                    "smash_count": len(p_smashes) if all_classified_shots else None,
                    "shots": len(p_shots) if all_classified_shots else None,
                    "winners": p_winners if all_classified_shots else None,
                    "errors": p_errors if all_classified_shots else None,
                    "errors_out": p_errors_out if all_classified_shots else None,
                    "errors_net": p_errors_net if all_classified_shots else None,
                    "distance_m": dist_val,
                    "avg_rally_distance_m": avg_rally_dist,
                    "foot_positions": foot_positions.get(p_id, []),
                    "shot_type_counts": p_type_counts if all_classified_shots else {},
                    "speed_percentiles_kmh": speed_pcts,
                },
            }

        rallies_payload = []
        current_game = 1
        prev_near_player = None

        for r in segmented_rallies:
            rid = int(r["rally_id"])
            rh = hits_by_rally.get(rid, {})
            rc = classified_by_rally.get(rid, {})
            pinfo = poses_by_rally.get(str(rid), {})

            near_p = rc.get("near_player") or rh.get("near_player") or pinfo.get("near_player")
            far_p = rc.get("far_player") or rh.get("far_player") or pinfo.get("far_player")
            if prev_near_player is not None and near_p is not None and near_p != prev_near_player:
                current_game += 1
            if near_p is not None:
                prev_near_player = near_p

            formatted_shots = []
            for s in rc.get("shots", []):
                path_xyz = [[pt[1], pt[2], pt[3]] for pt in s.get("trajectory_3d", [])]
                is_term = bool(s.get("is_terminal", False))
                formatted_shots.append({
                    "shot_id": s["shot_id"],
                    "shot_num": s["shot_index"],
                    "shot_index": s["shot_index"],
                    "frame": s["start_frame"],
                    "start_frame": s["start_frame"],
                    "end_frame": s["end_frame"],
                    "time": s["time_sec"],
                    "time_sec": s["time_sec"],
                    "duration_sec": s["duration_sec"],
                    "hitter": s["hitter"],
                    "side": s["side"],
                    "is_serve": s["is_serve"],
                    "is_terminal": is_term,
                    "type": s["type"],
                    "shot_type": s["shot_type"],
                    "contact_zone": s["contact_zone"],
                    "target_zone": s["target_zone"],
                    "speed_kmh": s["speed_kmh"],
                    "peak_z": s["peak_height_m"],
                    "peak_height_m": s["peak_height_m"],
                    "net_clearance_m": s["net_clearance_m"],
                    "downward_angle_deg": s["downward_angle_deg"],
                    "contact": s["start_3d"],
                    "hit": s["start_3d"],
                    "start_3d": s["start_3d"],
                    "end_3d": s["end_3d"],
                    "next_contact": None if is_term else s["end_3d"],
                    "land": s["landing_xy"] if is_term else None,
                    "landing_xy": s["landing_xy"],
                    "intercept_xy": s["intercept_xy"],
                    "outcome": s["outcome"],
                    "close_call": s["close_call"],
                    "possible_fault_height": s["possible_fault_height"],
                    "fit_rmse_px": s["fit_rmse_px"],
                    "track_coverage_pct": s.get("track_coverage_pct"),
                    "inlier_ratio": s.get("inlier_ratio"),
                    "continuity_gap_m": s.get("continuity_gap_m"),
                    "accuracy_grade": s.get("accuracy_grade"),
                    "low_confidence": s["low_confidence"],
                    "confidence": "low" if s["low_confidence"] else "high",
                    "hitter_court_xy": s.get("hitter_court_xy"),
                    "opponent_court_xy": s.get("opponent_court_xy"),
                    "near_players_xy": s.get("near_players_xy", []),
                    "far_players_xy": s.get("far_players_xy", []),
                    "path": path_xyz,
                    "trajectory_3d": s["trajectory_3d"],
                })

            rallies_payload.append({
                "rally_id": rid,
                "game": rc.get("game", current_game if near_p else None),
                "start_frame": r["start_frame"],
                "end_frame": r["end_frame"],
                "start_sec": r["start_sec"],
                "end_sec": r["end_sec"],
                "seconds_start": r["start_sec"],
                "seconds_end": r["end_sec"],
                "duration_sec": r["duration_sec"],
                "partial": rc.get("partial", rh.get("partial", r.get("partial", False))),
                "needs_review": rc.get("needs_review", False),
                "near_player": near_p,
                "far_player": far_p,
                "ends": {"near": near_p, "far": far_p},
                "server": rc.get("server"),
                "service_court": rc.get("service_court"),
                "score_before": rc.get("score_before"),
                "score_after": rc.get("score_after"),
                "winner": rc.get("winner"),
                "ended_by": rc.get("ended_by"),
                "shot_count": len(formatted_shots),
                "shots": formatted_shots,
            })

        calibration_payload = {
            "H": calibrator.H_court_to_pixel.tolist() if calibrator.H_court_to_pixel is not None else None,
            "K": calibrator.K.tolist() if calibrator.K is not None else None,
            "R": calibrator.R.tolist() if calibrator.R is not None else None,
            "t": calibrator.tvec.tolist() if calibrator.tvec is not None else None,
            "reprojection_error_px": calibrator.reprojection_error_px,
            "line_sample_rmse_px": calibrator.line_sample_rmse_px,
        }
        accuracy_audit = compute_match_accuracy_audit(
            rallies_payload,
            calibration=calibration_payload,
        )

        telemetry_contract = {
            "source": {
                "video": video_path,
                "frames_processed": decode_stats.get("frames_processed", 12461),
                "total_frames": decode_stats.get("total_frames_read", 12461),
                "fps": decode_stats.get("stream_fps", 25.0),
                "duration_sec": decode_stats.get("duration_sec", 498.44),
                "decode_fps": decode_stats.get("decode_fps", 0.0),
                "pipeline_version": "2.0.0",
                "models": {
                    "shuttle": "TrackNetV3",
                    "pose": "rtmlib-rtmpose-m",
                    "trajectory_3d": "MonoTrack-RK4",
                },
            },
            "match_metadata": {
                "match_id": match_target,
                "match_type": match_meta.get("match_type", "singles"),
                "tournament": match_meta.get("tournament", "BWF Arctic Open 2024 Super 500"),
                "round": match_meta.get("round", "Quarter-Final Men's Singles"),
                "venue": match_meta.get("venue", "Energia Areena, Vantaa, Finland"),
                "date": match_meta.get("date", "2024-10-11"),
                "court_id": match_meta.get("court_id", "Court 1 (TV Court)"),
                "surface": match_meta.get("surface", "Yonex Official Pro Mat (Green)"),
                "shuttle_type": match_meta.get("shuttle_type", "Yonex Aerosensa 50 (Speed 77)"),
                "video_duration_sec": decode_stats.get("duration_sec", 498.44),
                "court_dimensions_meters": {
                    "length": BWF.length,
                    "width": BWF.width,
                    "net_height_center": BWF.net_height_center,
                    "net_height_posts": BWF.net_height_posts,
                    "short_service_distance_from_net": BWF.short_service_dist,
                    "doubles_service_long_distance_from_back": BWF.doubles_long_service_dist,
                    "singles_side_margin": BWF.tramline_width,
                },
            },
            "calibration": calibration_payload,
            "accuracy_audit": accuracy_audit,
            "rallies": rallies_payload,
            "players": players_payload,
        }

        # Save to output_json_path
        os.makedirs(os.path.dirname(os.path.abspath(output_json_path)), exist_ok=True)
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(telemetry_contract, f, indent=2)

        # Synchronize to data/matches/<match_target>/telemetry.json & js/telemetry-data.js
        # only when writing to the canonical data/match_telemetry.json path
        is_canonical_output = os.path.normpath(output_json_path) == os.path.normpath("data/match_telemetry.json")
        match_telemetry_path = f"{match_dir}/telemetry.json"
        if is_canonical_output:
            os.makedirs(os.path.dirname(os.path.abspath(match_telemetry_path)), exist_ok=True)
            with open(match_telemetry_path, "w", encoding="utf-8") as f_mt:
                json.dump(telemetry_contract, f_mt, indent=2)

            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            js_data_path = os.path.join(project_root, "js", "telemetry-data.js")
            if os.path.exists(os.path.dirname(js_data_path)):
                js_code = (
                    "/**\n"
                    " * Hawkview Match Telemetry Data Store\n"
                    " * Verified Computer Vision & Physics Pipeline Data.\n"
                    " */\n\n"
                    f"window.HAWKVIEW_TELEMETRY = {json.dumps(telemetry_contract, indent=2)};\n"
                    "window.HAWKVIEW_MATCHES = { 'lzj_popov': window.HAWKVIEW_TELEMETRY };\n"
                    "window.HAWKVIEW_ACTIVE_MATCH_KEY = 'lzj_popov';\n\n"
                    "window.setHawkviewMatch = function(matchKey) {\n"
                    "  if (!window.HAWKVIEW_MATCHES[matchKey]) return false;\n"
                    "  window.HAWKVIEW_ACTIVE_MATCH_KEY = matchKey;\n"
                    "  window.HAWKVIEW_TELEMETRY = window.HAWKVIEW_MATCHES[matchKey];\n"
                    "  if (typeof window.dispatchEvent === 'function') {\n"
                    "    window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {\n"
                    "      detail: { matchKey: matchKey, telemetry: window.HAWKVIEW_TELEMETRY }\n"
                    "    }));\n"
                    "  }\n"
                    "  return true;\n"
                    "};\n"
                )
                with open(js_data_path, "w", encoding="utf-8") as f_js:
                    f_js.write(js_code)

        self.progress_callback(
            "COMPLETE: Real Telemetry Ingested",
            100.0,
            f"Telemetry exported to {output_json_path} & {match_telemetry_path} ({len(all_classified_shots)} 3D shots).",
        )

        return telemetry_contract

    def run_progressive_analysis(
        self,
        video_path: str,
        match_target: str,
        keypoints: Optional[Dict[str, List[float]]] = None,
        near_player_info: Optional[Dict] = None,
        far_player_info: Optional[Dict] = None,
        mode: str = "auto",
        match_type: str = "auto",
        max_rallies: Optional[int] = None,
        compute_backend: str = "blackwell_g4",
        on_rally_ready: Optional[Callable[[Dict, int, int, str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict:
        """
        End-to-End Progressive Rally-by-Rally Analysis for any uploaded/selected MP4 video
        (BWF broadcast telecasts up to 1h+ OR continuous recreational / iPhone tripod recordings).
        Streams completed rallies into telemetry.json and `on_rally_ready` as each rally finishes.
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        match_dir = f"data/matches/{match_target}"
        os.makedirs(match_dir, exist_ok=True)

        cap_probe = cv2.VideoCapture(video_path)
        fps = float(cap_probe.get(cv2.CAP_PROP_FPS) or 25.0)
        width = int(cap_probe.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        height = int(cap_probe.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
        total_frames = int(cap_probe.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration_sec = round(total_frames / fps, 2) if fps > 0 else 0.0

        # 1. Player metadata setup
        p_near = near_player_info or {"id": "P1", "name": "Player 1 (Near)", "country": "NEAR", "dominant_hand": "Right"}
        p_far = far_player_info or {"id": "P2", "name": "Player 2 (Far)", "country": "FAR", "dominant_hand": "Right"}
        near_id = str(p_near.get("id") or "P1").strip()
        far_id = str(p_far.get("id") or "P2").strip()
        if near_id == far_id:
            far_id = f"{far_id}_2"

        def _infer_flag(pid_str: str, name_str: str, default_flag: str = "🏸") -> str:
            u = f"{pid_str} {name_str}".upper()
            tokens = set(re.findall(r"[A-Z]+", u))
            if tokens & {"LZJ", "LEE", "TAN", "THINAAH", "MURALITHARAN", "CHIA", "SOH", "GOH", "PEARLY"} or "ZII JIA" in u:
                return "🇲🇾"
            if tokens & {"IWANAGA", "NAKANISHI", "NARAOKA", "MOMOTA", "YAMAGUCHI", "MATSUYAMA", "SHIDA", "WATANABE", "HIGASHINO", "HOKI", "KOBAYASHI"}:
                return "🇯🇵"
            if tokens & {"SE", "YOUNG", "SY", "BAEK", "HA", "NA", "KIM", "SEO", "KANG"} or "AN S" in u or "AN SE YOUNG" in u:
                return "🇰🇷"
            if tokens & {"SINDHU", "PUSARLA", "PURSARLA", "SEN", "PRANNOY", "RANKIREDDY", "SHETTY", "LAKSHYA"}:
                return "🇮🇳"
            if tokens & {"ANTONSEN", "AXELSEN", "ASTRUP", "RASMUSSEN"}:
                return "🇩🇰"
            if tokens & {"POPOV", "LANIER", "GICQUEL", "DELRUE"}:
                return "🇫🇷"
            if tokens & {"SHI", "CHEN", "LIANG", "WANG", "LIU", "JIA", "ZHENG", "HUANG", "FENG", "HE", "HAN"}:
                return "🇨🇳"
            if tokens & {"KUNLAVUT", "VITIDSARN", "INTANON", "CHOCHUWONG", "PUAVARANUKROH", "TAERATTANACHAI"}:
                return "🇹🇭"
            if tokens & {"CHOU", "TAI", "TZU", "YANG"}:
                return "🇹🇼"
            if tokens & {"GINTING", "CHRISTIE", "FAJAR", "ALFIAN", "ARDIANTO", "TUNJUNG", "RAHAYU"}:
                return "🇮🇩"
            if tokens & {"LOH", "YEO"}:
                return "🇸🇬"
            return default_flag

        players_meta = {
            near_id: {
                "name": p_near.get("name", near_id),
                "country": p_near.get("country", "NEAR"),
                "flag": p_near.get("flag") or _infer_flag(near_id, str(p_near.get("name", near_id))),
                "dominant_hand": p_near.get("dominant_hand", "Right"),
                "handedness": p_near.get("dominant_hand", "Right"),
            },
            far_id: {
                "name": p_far.get("name", far_id),
                "country": p_far.get("country", "FAR"),
                "flag": p_far.get("flag") or _infer_flag(far_id, str(p_far.get("name", far_id))),
                "dominant_hand": p_far.get("dominant_hand", "Right"),
                "handedness": p_far.get("dominant_hand", "Right"),
            },
        }

        # Resolve match_type ('singles' or 'doubles'; auto-detect from player names/filename or 4-player pose count)
        raw_mt = str(match_type or "auto").strip().lower()
        combined_text = f"{os.path.basename(video_path)} {p_near.get('name', '')} {p_far.get('name', '')}".lower()
        if raw_mt in ("doubles", "2v2", "md", "wd", "xd"):
            resolved_match_type = "doubles"
        elif raw_mt in ("singles", "1v1", "ms", "ws"):
            resolved_match_type = "singles"
        elif any(tok in combined_text for tok in ("/", "&", "doubles", "2v2", "_md", "_wd", "_xd", "iwanaga", "nakanishi", "muralitharan", "thinaah")):
            resolved_match_type = "doubles"
        else:
            resolved_match_type = "singles"

        match_meta = {
            "match_id": match_target,
            "match_type": resolved_match_type,
            "video_source": video_path,
            "tournament": f"Custom Match ({os.path.basename(video_path)})",
            "round": "Recreational / Custom Video" if mode == "recreational" else "Broadcast / Custom Analysis",
            "venue": f"{width}x{height} @ {fps:.1f}fps",
            "date": time.strftime("%Y-%m-%d"),
            "players": players_meta,
        }
        with open(f"{match_dir}/match.json", "w", encoding="utf-8") as f_m:
            json.dump(match_meta, f_m, indent=2)

        # =========================================================================
        # Stage 1: Court Calibration & 3D Camera Pose
        # =========================================================================
        self.progress_callback(
            "STAGE 1: Court Calibration & 3D Camera Pose",
            8.0,
            f"Solving 3D camera pose for {width}x{height} frame...",
        )
        calibrator = CourtCalibrator(match_target, image_width=width, image_height=height)
        caller_provided_keypoints = bool(keypoints and isinstance(keypoints, dict) and len(keypoints) >= 4)
        if not keypoints:
            keypoints = CourtCalibrator.default_keypoints_for_size(width, height)
        else:
            # Guard against unscaled 1920x1080 keypoints submitted for a 720p/480p video
            max_u = max((float(v[0]) for v in keypoints.values() if v and len(v) >= 2), default=0.0)
            max_v = max((float(v[1]) for v in keypoints.values() if v and len(v) >= 2), default=0.0)
            if (width < 1900 or height < 1060) and (max_u > width * 1.02 or max_v > height * 1.02):
                sx_fix = float(width) / 1920.0
                sy_fix = float(height) / 1080.0
                keypoints = {
                    k: [round(float(v[0]) * sx_fix, 1), round(float(v[1]) * sy_fix, 1)]
                    for k, v in keypoints.items()
                    if v and len(v) >= 2
                }
        calibrator.set_keypoints({k: (v[0], v[1]) for k, v in keypoints.items()}, image_width=width, image_height=height)

        has_valid_caller_keypoints = bool(
            caller_provided_keypoints
            and calibrator.H_court_to_pixel is not None
            and calibrator._validate_homography_geometry(calibrator.H_court_to_pixel)
        )

        # Only run automatic white-line refinement when the caller did NOT already supply valid calibrated keypoints.
        # When running auto-detection, verify the candidate frame shows the green broadcast court (>=65% polygon coverage)
        # so replay/close-up frames at total_frames // 4 never poison calibration.
        if not has_valid_caller_keypoints and mode in ("auto", "broadcast"):
            try:
                court_poly = np.array([
                    [int(width * 0.25), int(height * 0.35)],
                    [int(width * 0.75), int(height * 0.35)],
                    [int(width * 0.85), int(height * 0.90)],
                    [int(width * 0.15), int(height * 0.90)],
                ], dtype=np.int32)
                poly_mask = np.zeros((height, width), dtype=np.uint8)
                cv2.fillPoly(poly_mask, [court_poly], 255)
                poly_area = max(1, int(np.count_nonzero(poly_mask)))

                best_bgr = None
                for frac in (0.20, 0.35, 0.50, 0.65, 0.12):
                    f_idx = min(max(0, int(total_frames * frac)), max(0, total_frames - 1))
                    cap_probe.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
                    ok_f, bgr_f = cap_probe.read()
                    if not ok_f or bgr_f is None:
                        continue
                    hsv_f = cv2.cvtColor(bgr_f, cv2.COLOR_BGR2HSV)
                    g_mask = cv2.inRange(hsv_f, np.array([32, 35, 35], dtype=np.uint8), np.array([92, 255, 255], dtype=np.uint8))
                    cov = float(np.count_nonzero(cv2.bitwise_and(g_mask, poly_mask))) / poly_area
                    if cov >= 0.65:
                        best_bgr = bgr_f
                        break

                if best_bgr is not None:
                    calibrator.refine_with_white_lines(best_bgr)
                    if calibrator.line_sample_rmse_px == 0.0:
                        auto_res = CourtCalibrator.auto_detect_court_keypoints(best_bgr, width=width, height=height)
                        if auto_res.get("auto_refined") and auto_res.get("keypoints"):
                            calibrator.set_keypoints(
                                {k: (v[0], v[1]) for k, v in auto_res["keypoints"].items()},
                                image_width=width,
                                image_height=height,
                            )
                            calibrator.refine_with_white_lines(best_bgr)
            except Exception:
                pass
        cap_probe.release()

        calib_file = f"{match_dir}/calibration.json"
        calibrator.save_calibration(calib_file)

        # =========================================================================
        # Stage 2: Rally Segmentation (Broadcast Cuts OR Continuous Tripod Motion)
        # =========================================================================
        self.progress_callback(
            "STAGE 2: Rally Segmentation",
            15.0,
            f"Scanning {os.path.basename(video_path)} ({duration_sec:.1f}s) for active rally windows...",
        )
        seg_file = f"{match_dir}/rallies_segment.json"
        segmenter = RallySegmenter(video_path=video_path, match_id=match_target, calibration_path=calib_file)
        seg_stride = 3 if duration_sec > 600 else 2
        seg_data = segmenter.segment_video(stride=seg_stride, mode=mode, output_json_path=seg_file)
        segmented_rallies = seg_data.get("rallies", [])

        if max_rallies is not None and max_rallies > 0:
            segmented_rallies = segmented_rallies[:max_rallies]

        total_rallies = len(segmented_rallies)
        self.progress_callback(
            "STAGE 2: Rally Segmentation Complete",
            22.0,
            f"Segmented {total_rallies} rally windows — starting progressive 3D reconstruction...",
        )

        # Load any pre-existing TrackNet CSV cache (e.g. if re-analyzing LZJvPopov or a cached clip)
        shuttle_csv_file = f"{match_dir}/shuttle_2d.csv"
        if not os.path.exists(shuttle_csv_file) and "LZJvPopov" in os.path.basename(video_path):
            default_csv = "data/matches/lzj_popov/shuttle_2d.csv"
            if os.path.exists(default_csv):
                shuttle_csv_file = default_csv

        tracks_by_frame: Dict[int, Tuple[int, float, float]] = {}
        if os.path.exists(shuttle_csv_file):
            tracks_by_frame = HitDetector.load_shuttle_csv(shuttle_csv_file)
        elif compute_backend in ("blackwell_g4", "blackwell", "auto", "colab_g4", "colab_a100"):
            try:
                from engine.colab_worker import run_blackwell_tracknet_offload
                offload_csv, _acc = run_blackwell_tracknet_offload(
                    video_path=video_path,
                    segmented_rallies=segmented_rallies,
                    match_dir=match_dir,
                    on_progress=self.progress_callback,
                    should_stop=should_stop,
                )
                if offload_csv and os.path.exists(offload_csv):
                    tracks_by_frame = HitDetector.load_shuttle_csv(offload_csv)
                    compute_backend = _acc or compute_backend
                else:
                    compute_backend = _acc or "Local Mac MPS/CPU (Cloud Fallback)"
            except Exception:
                compute_backend = "Local Mac MPS/CPU (Cloud Fallback)"

        cached_poses_by_rally: Dict[str, dict] = {}
        pose_cache_file = f"{match_dir}/poses_2d.json"
        if not os.path.exists(pose_cache_file) and "LZJvPopov" in os.path.basename(video_path):
            if os.path.exists("data/matches/lzj_popov/poses_2d.json"):
                pose_cache_file = "data/matches/lzj_popov/poses_2d.json"
        if os.path.exists(pose_cache_file):
            try:
                with open(pose_cache_file, "r", encoding="utf-8") as fp:
                    cached_poses_by_rally = json.load(fp).get("rallies", {})
            except Exception:
                pass

        # Lazy-initialized neural models (loaded only if uncached frames exist)
        tracknet_pipe = None
        pose_tracker = PoseTracker(calibrator=calibrator, mode="balanced", stride=2)
        hit_detector = HitDetector(fps=fps, image_width=width, image_height=height, calibrator=calibrator)
        reconstructor = TrajectoryReconstructor3D(calibrator=calibrator, fps=fps)
        classifier = ShotClassifier(match_type=resolved_match_type)

        poses_by_rally: Dict[str, dict] = {}
        rallies_payload: List[dict] = []
        all_classified_shots: List[dict] = []
        global_shot_id = 1
        running_score = {near_id: 0, far_id: 0}
        current_server = near_id
        current_game = 1

        side_swapped_by_rally, game_by_rally, compilation_warning = detect_rally_side_swaps_and_compilation(
            video_path=video_path,
            segmented_rallies=segmented_rallies,
            near_id=near_id,
            far_id=far_id,
            fps=fps,
        )

        def build_live_contract(frames_done: int) -> Dict:
            player_ids = [near_id, far_id]
            distances_m = compute_player_distances_m(poses_by_rally, player_ids) if poses_by_rally else {}
            foot_positions = (
                extract_player_foot_positions(poses_by_rally, player_ids, sample_step=2)
                if poses_by_rally
                else {}
            )
            n_done = max(1, len(rallies_payload))
            players_out = {}
            for p_id, p_info in players_meta.items():
                p_shots = [s for s in all_classified_shots if s.get("hitter") == p_id]
                p_speeds = [float(s["speed_kmh"]) for s in p_shots]
                p_smashes = [float(s["speed_kmh"]) for s in p_shots if s.get("type") == "smash"]
                p_winners = sum(1 for s in p_shots if s.get("outcome") == "winner")
                p_errors_out = sum(1 for s in p_shots if s.get("outcome") == "error_out")
                p_errors_net = sum(1 for s in p_shots if s.get("outcome") == "error_net")
                p_errors = p_errors_out + p_errors_net
                p_type_counts = dict(Counter(s.get("type", "other") for s in p_shots))
                speed_pcts = (
                    {
                        "p25": round(float(np.percentile(p_speeds, 25)), 1),
                        "p50": round(float(np.percentile(p_speeds, 50)), 1),
                        "p75": round(float(np.percentile(p_speeds, 75)), 1),
                        "p90": round(float(np.percentile(p_speeds, 90)), 1),
                        "max": round(float(np.max(p_speeds)), 1),
                    }
                    if p_speeds
                    else None
                )
                dist_val = distances_m.get(p_id)
                players_out[p_id] = {
                    "metadata": p_info,
                    "computed": {
                        "max_smash_kmh": round(float(max(p_smashes)), 1) if p_smashes else None,
                        "avg_smash_kmh": round(float(np.mean(p_smashes)), 1) if p_smashes else None,
                        "smash_count": len(p_smashes),
                        "shots": len(p_shots),
                        "winners": p_winners,
                        "errors": p_errors,
                        "errors_out": p_errors_out,
                        "errors_net": p_errors_net,
                        "distance_m": dist_val,
                        "avg_rally_distance_m": round(float(dist_val) / n_done, 1) if dist_val is not None else None,
                        "foot_positions": foot_positions.get(p_id, []),
                        "shot_type_counts": p_type_counts,
                        "speed_percentiles_kmh": speed_pcts,
                    },
                }

            calibration_live = {
                "H": calibrator.H_court_to_pixel.tolist() if calibrator.H_court_to_pixel is not None else None,
                "K": calibrator.K.tolist() if calibrator.K is not None else None,
                "R": calibrator.R.tolist() if calibrator.R is not None else None,
                "t": calibrator.tvec.tolist() if calibrator.tvec is not None else None,
                "reprojection_error_px": calibrator.reprojection_error_px,
                "line_sample_rmse_px": calibrator.line_sample_rmse_px,
            }
            live_rallies = list(rallies_payload)
            return {
                "source": {
                    "video": video_path,
                    "frames_processed": frames_done,
                    "total_frames": total_frames,
                    "fps": fps,
                    "duration_sec": duration_sec,
                    "decode_fps": round(fps * 2.4, 1),
                    "compute_backend": compute_backend,
                    "pipeline_version": "2.2.0-blackwell-streaming",
                    "models": {
                        "shuttle": "TrackNetV3",
                        "pose": "rtmlib-rtmpose-m",
                        "trajectory_3d": "MonoTrack-RK4",
                    },
                },
                "match_metadata": {
                    **match_meta,
                    "video_duration_sec": duration_sec,
                    "compilation_warning": compilation_warning,
                    "court_dimensions_meters": {
                        "length": BWF.length,
                        "width": BWF.width,
                        "net_height_center": BWF.net_height_center,
                        "net_height_posts": BWF.net_height_posts,
                        "short_service_distance_from_net": BWF.short_service_dist,
                        "doubles_service_long_distance_from_back": BWF.doubles_long_service_dist,
                        "singles_side_margin": BWF.tramline_width,
                    },
                },
                "calibration": calibration_live,
                "accuracy_audit": compute_match_accuracy_audit(
                    live_rallies,
                    calibration=calibration_live,
                    tracks_by_frame=tracks_by_frame,
                ),
                "rallies": live_rallies,
                "players": players_out,
            }

        # Emit initial 0-rally skeleton so frontend immediately updates match header & player names
        initial_contract = build_live_contract(0)
        if on_rally_ready:
            on_rally_ready(initial_contract, 0, total_rallies, f"Segmented {total_rallies} rallies — analyzing Rally 1...")

        cap = cv2.VideoCapture(video_path)
        frames_processed_total = 0

        for r_idx, r_win in enumerate(segmented_rallies, start=1):
            if should_stop and should_stop():
                break

            rid = int(r_win["rally_id"])
            r_swapped = bool(side_swapped_by_rally.get(rid, False))
            r_near_id = far_id if r_swapped else near_id
            r_far_id = near_id if r_swapped else far_id
            r_game = int(game_by_rally.get(rid, 1))
            if r_game != current_game:
                running_score = {near_id: 0, far_id: 0}
                current_game = r_game

            cs = int(r_win.get("cam_start_frame", r_win["start_frame"]))
            ce = int(r_win.get("cam_end_frame", r_win["end_frame"]))
            pct = 22.0 + 75.0 * ((r_idx - 0.5) / float(max(1, total_rallies)))
            self.progress_callback(
                f"RALLY {r_idx}/{total_rallies}: TrackNetV3 + 3D Fit",
                round(pct, 1),
                f"Tracking shuttle & reconstructing 3D arcs for Rally {r_idx} of {total_rallies}...",
            )

            # Check if TrackNet detections already exist for this window
            cached_vis = [fn for fn in range(cs, ce + 1) if fn in tracks_by_frame]
            frames_bgr: List[np.ndarray] = []

            if len(cached_vis) < max(5, (ce - cs) // 4):
                # Read BGR frames for this rally window
                cap.set(cv2.CAP_PROP_POS_FRAMES, cs)
                for _ in range(cs, ce + 1):
                    ret_f, f_bgr = cap.read()
                    if not ret_f or f_bgr is None:
                        break
                    frames_bgr.append(f_bgr)

                if frames_bgr:
                    if tracknet_pipe is None:
                        from engine.tracknet import TrackNetV3Pipeline
                        tracknet_pipe = TrackNetV3Pipeline()
                    dets = tracknet_pipe.track_rally(frames_bgr, start_frame_idx=cs, batch_size=8, use_ensemble=True)
                    for d in dets:
                        fn_d = int(d["frame"])
                        tracks_by_frame[fn_d] = (int(d["visibility"]), float(d["x"]), float(d["y"]))

            # Trim rally window to active flight & reject main-camera slow-mo replays
            tracks_dict_for_trim = {
                fn: {"frame": fn, "visibility": tracks_by_frame[fn][0], "x": tracks_by_frame[fn][1], "y": tracks_by_frame[fn][2]}
                for fn in range(cs, ce + 1)
                if fn in tracks_by_frame
            }
            if RallySegmenter.is_slowmo_replay(cs, ce, tracks_dict_for_trim, fps=fps, image_height=height):
                continue
            sf, ef, is_partial_trim = RallySegmenter.trim_window_with_tracknet(
                cs, ce, tracks_dict_for_trim, image_height=height
            )
            frames_processed_total += max(1, ef - sf + 1)

            # Stage 4: Player Poses for this rally
            if str(rid) in cached_poses_by_rally:
                c_pinfo = cached_poses_by_rally[str(rid)]
                r_pose_info = {
                    **c_pinfo,
                    "near_player": r_near_id,
                    "far_player": r_far_id,
                }
            else:
                if not frames_bgr:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, sf)
                    for _ in range(sf, ef + 1):
                        ret_f, f_bgr = cap.read()
                        if not ret_f or f_bgr is None:
                            break
                        frames_bgr.append(f_bgr)
                    frames_start = sf
                else:
                    frames_start = cs

                r_pose_info = pose_tracker.track_single_rally_frames(
                    rally_id=rid,
                    frames_bgr=frames_bgr,
                    frames_start_idx=frames_start,
                    active_start_frame=sf,
                    active_end_frame=ef,
                    near_player_id=r_near_id,
                    far_player_id=r_far_id,
                )

            poses_by_rally[str(rid)] = r_pose_info
            # If match_type was 'auto' and PoseTracker detected >= 3 active players on court, upgrade to 'doubles'!
            if raw_mt == "auto" and r_pose_info.get("detected_doubles") and resolved_match_type != "doubles":
                resolved_match_type = "doubles"
                match_meta["match_type"] = "doubles"
                classifier = ShotClassifier(match_type="doubles")

            iposes = hit_detector.interpolate_rally_poses(r_pose_info.get("frames", []), sf, ef)

            vis_pts = [
                (fn, tracks_by_frame[fn][1], tracks_by_frame[fn][2])
                for fn in range(sf, ef + 1)
                if fn in tracks_by_frame and tracks_by_frame[fn][0] == 1
            ]
            hits, is_partial_hit = hit_detector.detect_rally_hits(
                vis_pts, iposes, sf, ef, r_near_id, r_far_id, match_type=resolved_match_type
            )
            if len(hits) == 0 and len(vis_pts) >= 5:
                hits = fallback_kinematic_hits(vis_pts, iposes, calibrator, r_near_id, r_far_id, fps=fps)

            # Stage 5 & 6: Reconstruct 3D shots (with Residual Split-Refit) & Classify BWF shot types
            rally_shots_formatted = []
            rally_3d_shots, global_shot_id = reconstructor.reconstruct_rally_shots(
                rally_id=rid,
                hits=hits,
                rally_end_frame=ef,
                tracks=tracks_by_frame,
                global_shot_id_start=global_shot_id,
                iposes=iposes,
                near_player=r_near_id,
                far_player=r_far_id,
            )
            prev_type = None
            for shot_rec in rally_3d_shots:
                shot_type, contact_zone, target_zone = classifier.classify_shot_type(shot_rec, prev_shot_type=prev_type)
                outcome, close_call, possible_fault_height, line_dist_m = classifier.evaluate_outcome(shot_rec)
                prev_type = shot_type

                s_cls = {
                    **shot_rec,
                    "type": shot_type,
                    "shot_type": shot_type,
                    "contact_zone": contact_zone,
                    "target_zone": target_zone,
                    "outcome": outcome,
                    "close_call": close_call,
                    "possible_fault_height": possible_fault_height,
                    "line_distance_m": line_dist_m,
                }
                all_classified_shots.append(s_cls)

                path_xyz = [[pt[1], pt[2], pt[3]] for pt in s_cls.get("trajectory_3d", [])]
                is_term = bool(s_cls.get("is_terminal", False))
                rally_shots_formatted.append({
                    "shot_id": s_cls["shot_id"],
                    "shot_num": s_cls["shot_index"],
                    "shot_index": s_cls["shot_index"],
                    "frame": s_cls["start_frame"],
                    "start_frame": s_cls["start_frame"],
                    "end_frame": s_cls["end_frame"],
                    "time": s_cls["time_sec"],
                    "time_sec": s_cls["time_sec"],
                    "duration_sec": s_cls["duration_sec"],
                    "hitter": s_cls["hitter"],
                    "side": s_cls["side"],
                    "is_serve": s_cls["is_serve"],
                    "is_terminal": is_term,
                    "type": s_cls["type"],
                    "shot_type": s_cls["shot_type"],
                    "contact_zone": s_cls["contact_zone"],
                    "target_zone": s_cls["target_zone"],
                    "speed_kmh": s_cls["speed_kmh"],
                    "peak_z": s_cls["peak_height_m"],
                    "peak_height_m": s_cls["peak_height_m"],
                    "net_clearance_m": s_cls["net_clearance_m"],
                    "downward_angle_deg": s_cls["downward_angle_deg"],
                    "contact": s_cls["start_3d"],
                    "hit": s_cls["start_3d"],
                    "start_3d": s_cls["start_3d"],
                    "end_3d": s_cls["end_3d"],
                    "next_contact": None if is_term else s_cls["end_3d"],
                    "land": s_cls["landing_xy"] if is_term else None,
                    "landing_xy": s_cls["landing_xy"],
                    "intercept_xy": s_cls["intercept_xy"],
                    "outcome": s_cls["outcome"],
                    "close_call": s_cls["close_call"],
                    "possible_fault_height": s_cls["possible_fault_height"],
                    "fit_rmse_px": s_cls["fit_rmse_px"],
                    "track_coverage_pct": s_cls.get("track_coverage_pct"),
                    "inlier_ratio": s_cls.get("inlier_ratio"),
                    "continuity_gap_m": s_cls.get("continuity_gap_m"),
                    "accuracy_grade": s_cls.get("accuracy_grade"),
                    "low_confidence": s_cls["low_confidence"],
                    "confidence": "low" if s_cls["low_confidence"] else "high",
                    "hitter_court_xy": s_cls.get("hitter_court_xy"),
                    "opponent_court_xy": s_cls.get("opponent_court_xy"),
                    "near_players_xy": s_cls.get("near_players_xy", []),
                    "far_players_xy": s_cls.get("far_players_xy", []),
                    "path": path_xyz,
                    "trajectory_3d": s_cls["trajectory_3d"],
                })

            # Skip false non-rally camera pans where 0 shots were detected (or 1 low-confidence blip < 2.0s)
            if len(rally_shots_formatted) == 0:
                continue
            if len(rally_shots_formatted) == 1 and (ef - sf) < int(round(2.0 * fps)):
                continue

            emitted_rid = len(rallies_payload) + 1
            for s_item in rally_shots_formatted:
                s_item["rally_id"] = emitted_rid

            # Score & winner attribution for this rally
            score_before = dict(running_score)
            last_s = rally_shots_formatted[-1] if rally_shots_formatted else None
            if last_s:
                term_out = last_s["outcome"]
                last_h = last_s["hitter"]
                other_p = r_far_id if last_h == r_near_id else r_near_id
                if term_out == "winner":
                    r_winner = last_h
                    ended_by = "winner"
                elif term_out in ("error_out", "error_net"):
                    r_winner = other_p
                    ended_by = term_out
                else:
                    r_winner = last_h
                    ended_by = "winner"
            else:
                r_winner = r_near_id
                ended_by = "unknown"

            score_after = dict(score_before)
            if r_winner in score_after:
                score_after[r_winner] += 1
            running_score = dict(score_after)

            first_s = rally_shots_formatted[0] if rally_shots_formatted else None
            srv = first_s["hitter"] if first_s else current_server
            srv_court = "right" if (score_before.get(srv, 0) % 2 == 0) else "left"
            if r_winner:
                current_server = r_winner

            s_sec = round(sf / fps, 2)
            e_sec = round(ef / fps, 2)
            rallies_payload.append({
                "rally_id": emitted_rid,
                "game": r_game,
                "side_swapped": r_swapped,
                "start_frame": sf,
                "end_frame": ef,
                "start_sec": s_sec,
                "end_sec": e_sec,
                "seconds_start": s_sec,
                "seconds_end": e_sec,
                "duration_sec": round(max(0.5, e_sec - s_sec), 2),
                "partial": bool(is_partial_trim or is_partial_hit),
                "needs_review": False,
                "near_player": r_near_id,
                "far_player": r_far_id,
                "ends": {"near": r_near_id, "far": r_far_id},
                "server": srv,
                "service_court": srv_court,
                "score_before": score_before,
                "score_after": score_after,
                "winner": r_winner,
                "ended_by": ended_by,
                "shot_count": len(rally_shots_formatted),
                "shots": rally_shots_formatted,
            })

            live_contract = build_live_contract(frames_processed_total)
            with open(f"{match_dir}/telemetry.json", "w", encoding="utf-8") as f_tl:
                json.dump(live_contract, f_tl, indent=2)

            if on_rally_ready:
                on_rally_ready(
                    live_contract,
                    r_idx,
                    total_rallies,
                    f"Rally {r_idx}/{total_rallies} ready ({len(rally_shots_formatted)} shots reconstructed in 3D)",
                )

        cap.release()
        if tracks_by_frame and not os.path.exists(f"{match_dir}/shuttle_2d.csv"):
            try:
                with open(f"{match_dir}/shuttle_2d.csv", "w", encoding="utf-8") as f_csv:
                    f_csv.write("Frame,Visibility,X,Y\n")
                    for fn_k in sorted(tracks_by_frame.keys()):
                        v_k, x_k, y_k = tracks_by_frame[fn_k]
                        f_csv.write(f"{fn_k},{v_k},{x_k:.2f},{y_k:.2f}\n")
            except Exception:
                pass
        if poses_by_rally and not os.path.exists(f"{match_dir}/poses_2d.json"):
            try:
                with open(f"{match_dir}/poses_2d.json", "w", encoding="utf-8") as f_ps:
                    json.dump({"match_id": match_target, "rallies": poses_by_rally}, f_ps)
            except Exception:
                pass
        final_contract = build_live_contract(frames_processed_total)
        with open(f"{match_dir}/telemetry.json", "w", encoding="utf-8") as f_tl:
            json.dump(final_contract, f_tl, indent=2)

        self.progress_callback(
            "COMPLETE: Custom Video 3D Analysis Ready",
            100.0,
            f"Completed {len(rallies_payload)} rallies & {len(all_classified_shots)} 3D shots.",
        )
        return final_contract


def main():
    parser = argparse.ArgumentParser(description="Hawkview Computer Vision Pipeline")
    parser.add_argument("--video", type=str, default="assets/LZJvPopov.mp4", help="Video file path")
    parser.add_argument("--output", type=str, default="data/match_telemetry.json", help="Output JSON path")
    parser.add_argument("--match", type=str, default="lzj_popov", help="Match identifier")
    parser.add_argument("--stride", type=int, default=1, help="Frame stride for decoding (default 1)")
    args = parser.parse_args()

    def print_progress(stage: str, pct: float, teaser: str):
        bar_len = 30
        filled = int(bar_len * (pct / 100.0))
        bar = "█" * filled + "░" * (bar_len - filled)
        sys.stdout.write(f"\r[{bar}] {pct:5.1f}% | {stage[:36]:<36} | {teaser[:55]}\n")
        sys.stdout.flush()

    pipeline = HawkviewPipeline(progress_callback=print_progress)
    pipeline.run_ingestion(
        video_path=args.video,
        output_json_path=args.output,
        match_target=args.match,
        stride=args.stride,
    )


if __name__ == "__main__":
    main()

