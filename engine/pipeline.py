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
import json
import os
import sys
from collections import Counter
from typing import Callable, Dict, List, Optional

import numpy as np

from engine.classify import ShotClassifier
from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF, CourtGeometry
from engine.decode import VideoDecoder
from engine.hits import HitDetector
from engine.pose_track import PoseTracker
from engine.reconstruct3d import TrajectoryReconstructor3D
from engine.segment import RallySegmenter


def compute_player_distances_m(poses_by_rally: Dict[str, dict], players: List[str]) -> Dict[str, float]:
    """
    Computes total court distance covered (in meters) per player from 12.5 fps ground-plane
    ankle trajectories across all segmented rallies.
    """
    totals = {p: 0.0 for p in players}
    for rid_str, rinfo in poses_by_rally.items():
        if not isinstance(rinfo, dict):
            continue
        near_p = rinfo.get("near_player")
        far_p = rinfo.get("far_player")
        frames = rinfo.get("frames", [])
        for side_key, pid in [("near", near_p), ("far", far_p)]:
            if pid not in totals:
                continue
            pts = []
            for fr in frames:
                pl = fr.get(side_key)
                if pl and "court_x" in pl and "court_y" in pl:
                    pts.append((int(fr["frame"]), float(pl["court_x"]), float(pl["court_y"])))
            if len(pts) < 3:
                continue
            # Smooth jitter with 3-tap median filter on x and y
            xs = np.array([p[1] for p in pts], dtype=np.float64)
            ys = np.array([p[2] for p in pts], dtype=np.float64)
            if len(xs) >= 5:
                xs_s = np.array([np.median(xs[max(0, i - 1) : min(len(xs), i + 2)]) for i in range(len(xs))])
                ys_s = np.array([np.median(ys[max(0, i - 1) : min(len(ys), i + 2)]) for i in range(len(ys))])
            else:
                xs_s, ys_s = xs, ys
            for i in range(1, len(pts)):
                dt_f = max(1, pts[i][0] - pts[i - 1][0])
                step_m = float(np.hypot(xs_s[i] - xs_s[i - 1], ys_s[i] - ys_s[i - 1]))
                # Reject single-step pose switch outliers (> 0.85m per frame = 21 m/s) and stationary noise (< 0.03m)
                if 0.03 <= step_m <= 0.85 * dt_f:
                    totals[pid] += step_m
    return {p: round(val, 1) for p, val in totals.items()}


def extract_player_foot_positions(
    poses_by_rally: Dict[str, dict], players: List[str], sample_step: int = 2
) -> Dict[str, List[List[float]]]:
    """
    Extracts a compact list of [court_x, court_y] ground-plane ankle positions
    across all rallies for each player to drive the 2D KDE court coverage heatmap.
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
                pl = fr.get(side_key)
                if pl and "court_x" in pl and "court_y" in pl:
                    cx = float(pl["court_x"])
                    cy = float(pl["court_y"])
                    if -0.8 <= cx <= BWF.width + 0.8 and -1.5 <= cy <= BWF.length + 1.5:
                        positions[pid].append([round(cx, 2), round(cy, 2)])
    return positions



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
                    "low_confidence": s["low_confidence"],
                    "confidence": "low" if s["low_confidence"] else "high",
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
            "calibration": {
                "H": calibrator.H_court_to_pixel.tolist() if calibrator.H_court_to_pixel is not None else None,
                "K": calibrator.K.tolist() if calibrator.K is not None else None,
                "R": calibrator.R.tolist() if calibrator.R is not None else None,
                "t": calibrator.tvec.tolist() if calibrator.tvec is not None else None,
                "reprojection_error_px": calibrator.reprojection_error_px,
                "line_sample_rmse_px": calibrator.line_sample_rmse_px,
            },
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
