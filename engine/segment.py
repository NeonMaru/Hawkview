"""
Hawkview Phase B — Rally Segmentation Engine (engine/segment.py)

Implements:
1. Calibrated court-polygon HSV green ratio measurement
2. Calibrated BWF line-reprojection verification (rejects alternate-angle / slow-mo replays)
3. Histogram-difference + structural L1 cut detection (splits back-to-back main-camera cuts)
4. TrackNetV3 active-flight boundary trimming (trims pre-serve waiting and post-point stationary floor frames)
"""

import os
import csv
import json
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np

from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF


@dataclass
class RallyWindow:
    rally_id: int
    cam_start_frame: int
    cam_end_frame: int
    start_frame: int
    end_frame: int
    start_sec: float
    end_sec: float
    duration_sec: float
    partial: bool
    mean_green_pct: float
    mean_line_hit_pct: float
    mean_line_err_px: float

    def to_dict(self) -> Dict:
        return asdict(self)


class RallySegmenter:
    """
    Segments a BWF broadcast video into verified main-camera rally windows,
    rejecting alternate-angle replays and trimming each window to active shuttle flight.
    """

    def __init__(
        self,
        video_path: str = "assets/LZJvPopov.mp4",
        match_id: str = "lzj_popov",
        calibration_path: Optional[str] = None,
    ):
        self.video_path = video_path
        self.match_id = match_id
        self.calibration_path = calibration_path or f"data/matches/{match_id}/calibration.json"

        self.calibrator = CourtCalibrator(match_id)
        if os.path.exists(self.calibration_path):
            self.calibrator.load_calibration(self.calibration_path)
        else:
            raise FileNotFoundError(f"Calibration file not found: {self.calibration_path}")

        self.H = self.calibrator.H_court_to_pixel
        self.poly_mask: Optional[np.ndarray] = None
        self.poly_area: float = 1.0
        self.sample_pts: List[Tuple[int, int, str]] = []
        self._init_geometry_masks(1920, 1080)

    def _init_geometry_masks(self, width: int, height: int):
        """Precomputes the calibrated court polygon mask and 64 BWF line sample coordinates."""
        pts_court = np.array([
            [0.0, 0.0],
            [BWF.width, 0.0],
            [BWF.width, BWF.length],
            [0.0, BWF.length],
        ], dtype=np.float32)

        pts_px = []
        for cx, cy in pts_court:
            p = self.H @ np.array([cx, cy, 1.0])
            pts_px.append([int(round(p[0] / p[2])), int(round(p[1] / p[2]))])
        pts_px_arr = np.array(pts_px, dtype=np.int32)

        self.poly_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(self.poly_mask, [pts_px_arr], 255)
        self.poly_area = float(max(1, np.count_nonzero(self.poly_mask)))

        test_segments = [
            (0.0, 0.0, BWF.width, 0.0, "h"),                         # Near baseline
            (0.0, 4.72, BWF.width, 4.72, "h"),                       # Near short service
            (0.0, 8.68, BWF.width, 8.68, "h"),                       # Far short service
            (0.0, 13.40, BWF.width, 13.40, "h"),                     # Far baseline
            (0.0, 0.0, 0.0, 13.40, "v"),                             # Left doubles sideline
            (0.46, 0.0, 0.46, 13.40, "v"),                           # Left singles sideline
            (BWF.width - 0.46, 0.0, BWF.width - 0.46, 13.40, "v"),   # Right singles sideline
            (BWF.width, 0.0, BWF.width, 13.40, "v"),                 # Right doubles sideline
        ]
        self.sample_pts = []
        for x1, y1, x2, y2, orient in test_segments:
            for t in np.linspace(0.15, 0.85, 8):
                cx = x1 + t * (x2 - x1)
                cy = y1 + t * (y2 - y1)
                p = self.H @ np.array([cx, cy, 1.0])
                ix, iy = int(round(p[0] / p[2])), int(round(p[1] / p[2]))
                if 20 <= ix < width - 20 and 20 <= iy < height - 20:
                    self.sample_pts.append((ix, iy, orient))

    def evaluate_frame(self, frame_bgr: np.ndarray) -> Tuple[float, float, float, bool]:
        """
        Evaluates a single BGR frame against the calibrated main camera model.
        Returns (green_in_poly_pct, line_hit_pct, median_line_err_px, is_main_camera).
        """
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, (35, 40, 40), (85, 255, 255))
        green_in_poly = float(np.count_nonzero(cv2.bitwise_and(green_mask, self.poly_mask)) / self.poly_area * 100.0)

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        hits = 0
        dists = []
        for ix, iy, orient in self.sample_pts:
            win = gray[iy - 6 : iy + 7, ix] if orient == "h" else gray[iy, ix - 6 : ix + 7]
            max_v = int(np.max(win))
            min_v = int(np.min(win))
            if max_v > 155 and (max_v - min_v) > 35:
                pk = int(np.argmax(win))
                d = abs(pk - 6)
                dists.append(d)
                if d <= 3:
                    hits += 1

        line_hit_pct = (hits / float(len(self.sample_pts))) * 100.0 if self.sample_pts else 0.0
        med_dist = float(np.median(dists)) if dists else 99.0
        is_main = (green_in_poly >= 70.0) and (line_hit_pct >= 55.0) and (med_dist <= 3.0)
        return green_in_poly, line_hit_pct, med_dist, is_main

    @staticmethod
    def load_shuttle_tracks(csv_path: str) -> Dict[int, Dict]:
        """Loads per-frame TrackNetV3 detections from shuttle_2d.csv."""
        tracks: Dict[int, Dict] = {}
        if not os.path.exists(csv_path):
            return tracks
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                fn = int(row["Frame"])
                tracks[fn] = {
                    "frame": fn,
                    "visibility": int(row["Visibility"]),
                    "x": float(row["X"]),
                    "y": float(row["Y"]),
                    "inpainted": bool(int(row.get("Inpainted", 0))),
                }
        return tracks

    @staticmethod
    def trim_window_with_tracknet(
        cam_start: int,
        cam_end: int,
        tracks_by_frame: Dict[int, Dict],
        min_speed_px: float = 4.5,
    ) -> Tuple[int, int, bool]:
        """
        Trims a main-camera window [cam_start, cam_end] to active shuttle flight [start_frame, end_frame].
        - Removes pre-serve setup frames before the shuttle is struck into sustained motion.
        - Removes post-point frames where the shuttle rests stationary on the floor.
        - Flags partial=True if the camera cut begins with the shuttle already flying mid-rally.
        """
        vis = [
            tracks_by_frame[fn]
            for fn in range(cam_start, cam_end + 1)
            if fn in tracks_by_frame and tracks_by_frame[fn]["visibility"] == 1
        ]
        if len(vis) < 5:
            return cam_start, cam_end, False

        n = len(vis)
        is_moving = [False] * n
        step_speeds = [0.0] * n
        for i in range(n - 1):
            dt = vis[i + 1]["frame"] - vis[i]["frame"]
            if 1 <= dt <= 3:
                sp = float(np.hypot(vis[i + 1]["x"] - vis[i]["x"], vis[i + 1]["y"] - vis[i]["y"]) / dt)
                step_speeds[i] = sp
                if sp >= min_speed_px:
                    is_moving[i] = True

        # Active rally start: first visible frame below top-banner noise (y >= 180 px)
        # where at least 3 of the next 4 visible steps exhibit sustained motion
        start_idx = 0
        for i in range(max(1, n - 4)):
            if vis[i]["y"] >= 180.0 and sum(is_moving[i : i + 4]) >= 3:
                start_idx = i
                break

        # Active rally end: last visible frame where at least 3 of the preceding 4 steps were moving
        end_idx = n - 1
        for i in range(n - 1, start_idx + 3, -1):
            if sum(is_moving[max(0, i - 4) : i]) >= 3:
                end_idx = i
                break

        start_frame = vis[start_idx]["frame"]
        end_frame = vis[end_idx]["frame"]

        # Detect if broadcast cut started mid-exchange (shuttle already high in flight at cut boundary)
        partial = bool(
            (start_frame - cam_start <= 1)
            and (vis[start_idx]["y"] < 260.0)
            and (step_speeds[start_idx] >= 20.0)
        )

        return start_frame, end_frame, partial

    def segment_video(
        self,
        stride: int = 2,
        min_duration_sec: float = 2.0,
        shuttle_csv_path: Optional[str] = None,
    ) -> Dict:
        """
        Sequential full-video pass (stride=2 by default) to detect all main-camera rally windows,
        reject alternate-angle replays, and trim boundaries using TrackNetV3 tracks.
        """
        if not os.path.exists(self.video_path):
            raise FileNotFoundError(f"Video file not found: {self.video_path}")

        cap = cv2.VideoCapture(self.video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
        self._init_geometry_masks(width, height)

        sampled_rows = []
        prev_hist = None
        prev_small = None
        prev_frame_bgr = None
        boundary_frames_cache: Dict[int, np.ndarray] = {}

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            if frame_idx % stride == 0:
                green_pct, line_hit_pct, med_err, is_main = self.evaluate_frame(frame)

                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
                cv2.normalize(hist, hist)
                gray_roi = cv2.cvtColor(frame[250:1000, 300:1620], cv2.COLOR_BGR2GRAY)
                small = cv2.resize(gray_roi, (160, 90)).astype(np.float32)

                hist_diff = (
                    float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA))
                    if prev_hist is not None
                    else 0.0
                )
                l1_diff = float(np.mean(np.abs(small - prev_small))) if prev_small is not None else 0.0

                # Cache odd transition neighbor if is_main state just flipped
                if sampled_rows and (sampled_rows[-1][4] != is_main) and prev_frame_bgr is not None:
                    boundary_frames_cache[frame_idx - 1] = prev_frame_bgr

                prev_hist = hist
                prev_small = small
                sampled_rows.append((frame_idx, green_pct, line_hit_pct, med_err, is_main, hist_diff, l1_diff))
            else:
                # Keep the most recent non-sampled frame in memory in case the next sampled frame flips state
                prev_frame_bgr = frame

            frame_idx += 1

        cap.release()
        total_frames = frame_idx

        # Group into contiguous main-camera runs, splitting on hard cuts
        min_frames = int(round(min_duration_sec * fps))
        raw_cam_windows = []
        in_seg = False
        start_i = 0

        for i, row in enumerate(sampled_rows):
            f_num, g_pct, l_pct, m_err, is_main, h_diff, l1_diff = row
            is_cut = (i > 0) and ((l1_diff > 18.0) or (h_diff > 0.18))

            if is_main and not in_seg:
                in_seg = True
                start_i = i
            elif in_seg and (not is_main or is_cut):
                end_i = i - 1
                sf = sampled_rows[start_i][0]
                ef = sampled_rows[end_i][0]
                # Refine exact +/- 1 frame boundary using cached odd frame if available
                if (sf - 1) in boundary_frames_cache and self.evaluate_frame(boundary_frames_cache[sf - 1])[3]:
                    sf -= 1
                if (ef + 1) in boundary_frames_cache and self.evaluate_frame(boundary_frames_cache[ef + 1])[3]:
                    ef += 1

                if (ef - sf) >= min_frames:
                    sub = sampled_rows[start_i : end_i + 1]
                    raw_cam_windows.append({
                        "cam_start": sf,
                        "cam_end": ef,
                        "mean_green_pct": float(np.mean([r[1] for r in sub])),
                        "mean_line_hit_pct": float(np.mean([r[2] for r in sub])),
                        "mean_line_err_px": float(np.mean([r[3] for r in sub])),
                    })
                if is_main and is_cut:
                    start_i = i
                else:
                    in_seg = False

        if in_seg:
            end_i = len(sampled_rows) - 1
            sf = sampled_rows[start_i][0]
            ef = sampled_rows[end_i][0]
            if (ef - sf) >= min_frames:
                sub = sampled_rows[start_i : end_i + 1]
                raw_cam_windows.append({
                    "cam_start": sf,
                    "cam_end": ef,
                    "mean_green_pct": float(np.mean([r[1] for r in sub])),
                    "mean_line_hit_pct": float(np.mean([r[2] for r in sub])),
                    "mean_line_err_px": float(np.mean([r[3] for r in sub])),
                })

        # Also count rejected green replay windows (green >= 40% but not calibrated main camera)
        rejected_replays = []
        i = 0
        while i < len(sampled_rows):
            if (sampled_rows[i][1] >= 40.0) and (not sampled_rows[i][4]):
                s = i
                while i < len(sampled_rows) and (sampled_rows[i][1] >= 40.0) and (not sampled_rows[i][4]):
                    i += 1
                e = i - 1
                if (e - s) >= 5:
                    sub = sampled_rows[s : e + 1]
                    rejected_replays.append({
                        "start_frame": sub[0][0],
                        "end_frame": sub[-1][0],
                        "start_sec": round(sub[0][0] / fps, 2),
                        "end_sec": round(sub[-1][0] / fps, 2),
                        "mean_green_pct": round(float(np.mean([r[1] for r in sub])), 1),
                        "mean_line_hit_pct": round(float(np.mean([r[2] for r in sub])), 1),
                    })
            else:
                i += 1

        # Trim main-camera windows using TrackNet 2D detections
        csv_path = shuttle_csv_path or f"data/matches/{self.match_id}/shuttle_2d.csv"
        tracks_by_frame = self.load_shuttle_tracks(csv_path)

        rallies: List[RallyWindow] = []
        for idx, cw in enumerate(raw_cam_windows, start=1):
            cs, ce = cw["cam_start"], cw["cam_end"]
            sf, ef, partial = self.trim_window_with_tracknet(cs, ce, tracks_by_frame)
            s_sec = round(sf / fps, 2)
            e_sec = round(ef / fps, 2)
            rallies.append(
                RallyWindow(
                    rally_id=idx,
                    cam_start_frame=cs,
                    cam_end_frame=ce,
                    start_frame=sf,
                    end_frame=ef,
                    start_sec=s_sec,
                    end_sec=e_sec,
                    duration_sec=round(e_sec - s_sec, 2),
                    partial=partial,
                    mean_green_pct=round(cw["mean_green_pct"], 1),
                    mean_line_hit_pct=round(cw["mean_line_hit_pct"], 1),
                    mean_line_err_px=round(cw["mean_line_err_px"], 2),
                )
            )

        return {
            "match_id": self.match_id,
            "video_path": self.video_path,
            "fps": fps,
            "total_frames": total_frames,
            "frames_sampled": len(sampled_rows),
            "stride": stride,
            "rally_count": len(rallies),
            "rallies": [r.to_dict() for r in rallies],
            "rejected_replays": rejected_replays,
        }
