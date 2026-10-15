"""
HawkView Pose Tracker (Phase D)
===============================
Runs rtmlib Body-17 (YOLOX-m + RTMPose-m) on rally frames at 12.5 fps (every 2nd frame).
Maps ankle midpoints via the calibrated ground homography H_inv to court (x, y) meters,
filters out static officials (umpire, service judge, line judges) and background banners
using court apron bounds + foreground motion against the median court background, and
assigns near (y < 6.70 m) vs far (y >= 6.70 m) court sides plus automatic player identity
from jersey luminance (never hardcoded).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from engine.court_calib import CourtCalibrator, BWF_NET_Y


@dataclass
class PlayerPoseSample:
    side: str                   # "near" or "far"
    court_x: float              # Ground-projected ankle midpoint X (meters, [0..6.10])
    court_y: float              # Ground-projected ankle midpoint Y (meters, [0..13.40])
    ankle_px: List[float]       # [u, v] ankle midpoint in image pixels
    ankle_l_px: List[float]     # [u, v] left ankle (COCO kp 15)
    ankle_r_px: List[float]     # [u, v] right ankle (COCO kp 16)
    wrist_l_px: List[float]     # [u, v] left wrist (COCO kp 9)
    wrist_r_px: List[float]     # [u, v] right wrist (COCO kp 10)
    elbow_l_px: Optional[List[float]] = None  # [u, v] left elbow (COCO kp 7)
    elbow_r_px: Optional[List[float]] = None  # [u, v] right elbow (COCO kp 8)
    conf: float = 0.0           # Mean keypoint confidence
    fg_diff: float = 0.0        # Mean grayscale difference against static background
    torso_luma: float = 0.0     # Median torso grayscale luminance (for side assignment)


class PoseTracker:
    """
    Wraps rtmlib Body-17 estimation on segmented rally windows at 12.5 fps (stride=2).
    """

    def __init__(
        self,
        calibrator: CourtCalibrator,
        mode: str = "balanced",
        backend: str = "onnxruntime",
        device: str = "cpu",
        stride: int = 2,
    ):
        self.calibrator = calibrator
        self.mode = mode
        self.backend = backend
        self.device = device
        self.stride = stride
        self._body_model = None

    def _ensure_model(self):
        if self._body_model is None:
            from rtmlib import Body
            self._body_model = Body(
                mode=self.mode,
                backend=self.backend,
                device=self.device,
            )

    @staticmethod
    def compute_background_gray(
        video_path: str,
        rallies: List[dict],
        num_samples: int = 25,
    ) -> np.ndarray:
        """
        Compute the median grayscale image across sampled rally frames to suppress
        stationary line judges, umpires, and stadium banner graphics.
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open video: {video_path}")

        sample_frames: List[int] = []
        for r in rallies:
            sf = int(r["start_frame"])
            ef = int(r["end_frame"])
            mid = (sf + ef) // 2
            sample_frames.extend([sf + 5, mid, max(sf, ef - 5)])

        if not sample_frames:
            sample_frames = [500, 1500, 3000, 5000, 8000]

        indices = np.linspace(0, len(sample_frames) - 1, min(num_samples, len(sample_frames)), dtype=int)
        chosen = sorted({sample_frames[i] for i in indices})

        grays = []
        for fn in chosen:
            cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
            ret, frame = cap.read()
            if ret and frame is not None:
                grays.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        cap.release()

        if not grays:
            raise RuntimeError("No frames decoded for median background.")
        return np.median(np.stack(grays, axis=0), axis=0).astype(np.uint8)

    def _extract_candidates(
        self,
        frame_bgr: np.ndarray,
        frame_gray: np.ndarray,
        bg_gray: np.ndarray,
        keypoints: np.ndarray,
        scores: np.ndarray,
    ) -> Tuple[Optional[dict], Optional[dict]]:
        """
        Filter rtmlib detections to the two active court players (near and far).
        """
        if keypoints is None or len(keypoints) == 0:
            return None, None

        h_img, w_img = frame_gray.shape[:2]
        near_cands = []
        far_cands = []

        for idx in range(len(keypoints)):
            kps = keypoints[idx]
            sc = scores[idx]
            mean_conf = float(np.mean(sc))
            if mean_conf < 0.30:
                continue

            # Ankle midpoint (COCO 15: left_ankle, 16: right_ankle)
            ank_l = kps[15]
            ank_r = kps[16]
            ank_u = float(0.5 * (ank_l[0] + ank_r[0]))
            ank_v = float(0.5 * (ank_l[1] + ank_r[1]))

            # Project ankle midpoint to court plane z=0 via H_inv
            cx, cy = self.calibrator.pixel_to_court(ank_u, ank_v)
            cx = float(cx)
            cy = float(cy)

            # Reject umpire (x ~ -1.32m) and service judge (x ~ +7.35m) outside [-0.65, 6.75]
            if cx < -0.65 or cx > 6.75:
                continue

            # Bounding box from keypoints for foreground motion check
            x0 = max(0, int(np.min(kps[:, 0])) - 6)
            x1 = min(w_img, int(np.max(kps[:, 0])) + 6)
            y0 = max(0, int(np.min(kps[:, 1])) - 6)
            y1 = min(h_img, int(np.max(kps[:, 1])) + 6)
            if x1 <= x0 or y1 <= y0:
                continue

            patch_diff = np.abs(
                frame_gray[y0:y1, x0:x1].astype(np.float32)
                - bg_gray[y0:y1, x0:x1].astype(np.float32)
            )
            fg_diff = float(np.mean(patch_diff))

            # Reject static background figures (line judges / Clash of Clans banner art)
            if ank_v < 480.0 and fg_diff < 8.5:
                continue

            # Depth bounds: allow up to 1.5m behind near baseline (-1.5m) and up to 17.2m on
            # far court when airborne (jump smash projects ankles higher up on image -> larger cy)
            if cy < -1.80 or cy > 17.20:
                continue
            if cy > 14.90 and fg_diff < 10.0:
                continue

            # Compute torso luminance from shoulder-hip box (COCO 5,6 shoulders, 11,12 hips)
            sh_x0 = int(min(kps[5][0], kps[6][0], kps[11][0], kps[12][0]))
            sh_x1 = int(max(kps[5][0], kps[6][0], kps[11][0], kps[12][0]))
            sh_y0 = int(min(kps[5][1], kps[6][1]))
            sh_y1 = int(max(kps[11][1], kps[12][1]))
            sh_x0, sh_x1 = max(0, sh_x0), min(w_img, max(sh_x0 + 2, sh_x1))
            sh_y0, sh_y1 = max(0, sh_y0), min(h_img, max(sh_y0 + 2, sh_y1))
            torso_patch = frame_gray[sh_y0:sh_y1, sh_x0:sh_x1]
            torso_luma = float(np.median(torso_patch)) if torso_patch.size > 0 else 0.0

            cand = {
                "court_x": round(float(np.clip(cx, -0.65, 6.75)), 3),
                "court_y": round(float(np.clip(cy, -1.20, 14.60)), 3),
                "ankle_px": [round(ank_u, 1), round(ank_v, 1)],
                "ankle_l_px": [round(float(ank_l[0]), 1), round(float(ank_l[1]), 1)],
                "ankle_r_px": [round(float(ank_r[0]), 1), round(float(ank_r[1]), 1)],
                "wrist_l_px": [round(float(kps[9][0]), 1), round(float(kps[9][1]), 1)],
                "wrist_r_px": [round(float(kps[10][0]), 1), round(float(kps[10][1]), 1)],
                "elbow_l_px": [round(float(kps[7][0]), 1), round(float(kps[7][1]), 1)],
                "elbow_r_px": [round(float(kps[8][0]), 1), round(float(kps[8][1]), 1)],
                "conf": round(mean_conf, 3),
                "fg_diff": round(fg_diff, 1),
                "torso_luma": round(torso_luma, 1),
            }

            if cy < BWF_NET_Y:
                near_cands.append(cand)
            else:
                far_cands.append(cand)

        best_near = None
        if near_cands:
            best_near = max(near_cands, key=lambda c: c["conf"] * min(25.0, c["fg_diff"]))

        best_far = None
        if far_cands:
            best_far = max(far_cands, key=lambda c: c["conf"] * min(25.0, c["fg_diff"]))

        return best_near, best_far

    @staticmethod
    def compute_torso_luma_At(frame_gray: np.ndarray, player_dict: Optional[dict]) -> float:
        """Fallback torso luminance measurement from ankle/wrist geometry if cached."""
        if not player_dict:
            return 0.0
        if "torso_luma" in player_dict and player_dict["torso_luma"] > 0:
            return float(player_dict["torso_luma"])
        ank = player_dict["ankle_px"]
        wl = player_dict["wrist_l_px"]
        wr = player_dict["wrist_r_px"]
        cx = int(0.5 * (ank[0] + 0.5 * (wl[0] + wr[0])))
        cy = int(0.45 * ank[1] + 0.55 * (0.5 * (wl[1] + wr[1])))
        h, w = frame_gray.shape[:2]
        x0, x1 = max(0, cx - 12), min(w, cx + 12)
        y0, y1 = max(0, cy - 16), min(h, cy + 16)
        patch = frame_gray[y0:y1, x0:x1]
        return float(np.median(patch)) if patch.size > 0 else 0.0

    @staticmethod
    def assign_player_sides(
        rally_poses: List[dict],
        bright_player_id: str = "POPOV",
        dark_player_id: str = "LZJ",
    ) -> Tuple[str, str]:
        """
        Automatically determine which player is on the near vs far court in a rally
        from median torso jersey luminance (never hardcoded by game/rally index).
        Popov wears white (high luminance); LZJ wears dark maroon/black (low luminance).
        Because stadium overhead lighting makes the near court brighter than the far court,
        we compare normalized torso luminance:
          - POPOV near / LZJ far: near_luma ~ 195, far_luma ~ 60  (diff ~ +135)
          - LZJ near / POPOV far: near_luma ~ 80,  far_luma ~ 120 (diff ~ -40)
        """
        near_lumas = [
            p["near"]["torso_luma"]
            for p in rally_poses
            if p.get("near") and p["near"].get("torso_luma", 0) > 0
        ]
        far_lumas = [
            p["far"]["torso_luma"]
            for p in rally_poses
            if p.get("far") and p["far"].get("torso_luma", 0) > 0
        ]
        med_near = float(np.median(near_lumas)) if near_lumas else 100.0
        med_far = float(np.median(far_lumas)) if far_lumas else 100.0

        if med_near > med_far + 25.0:
            return bright_player_id, dark_player_id
        return dark_player_id, bright_player_id

    def track_rallies(
        self,
        video_path: str,
        rallies: List[dict],
        output_json_path: Optional[str] = None,
        seed_cache_path: Optional[str] = None,
    ) -> Dict[str, dict]:
        """
        Run rtmlib pose tracking across all rallies at `self.stride` (every 2nd frame = 12.5 fps).
        Can reuse cached rally poses from `seed_cache_path` (e.g., Rallies 1–5) and compute
        torso luminance + remaining rallies.
        """
        cached_rallies: Dict[str, List[dict]] = {}
        if seed_cache_path and os.path.exists(seed_cache_path):
            with open(seed_cache_path, "r") as f:
                cached_rallies = json.load(f)

        bg_gray = self.compute_background_gray(video_path, rallies)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open video: {video_path}")

        results_by_rally: Dict[str, dict] = {}
        t0 = time.time()

        for r in rallies:
            rid = int(r["rally_id"])
            rid_key = str(rid)
            sf = int(r["start_frame"])
            ef = int(r["end_frame"])

            if rid_key in cached_rallies and len(cached_rallies[rid_key]) > 0:
                r_poses = cached_rallies[rid_key]
                # Ensure torso_luma is populated on a few frames for automatic side detection
                need_luma = not any(
                    p.get("near") and p["near"].get("torso_luma", 0) > 0
                    for p in r_poses[:10]
                )
                if need_luma:
                    for p in r_poses[::5]:
                        fn = int(p["frame"])
                        cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
                        ret, frame = cap.read()
                        if not ret:
                            continue
                        fgray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                        if p.get("near"):
                            p["near"]["torso_luma"] = round(self.compute_torso_luma_At(fgray, p["near"]), 1)
                        if p.get("far"):
                            p["far"]["torso_luma"] = round(self.compute_torso_luma_At(fgray, p["far"]), 1)
            else:
                self._ensure_model()
                r_poses = []
                cap.set(cv2.CAP_PROP_POS_FRAMES, sf)
                for fn in range(sf, ef + 1):
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        break
                    if (fn - sf) % self.stride != 0:
                        continue
                    fgray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    roi_y0, roi_y1 = 170, 1040
                    roi_x0, roi_x1 = 280, 1640
                    crop_bgr = frame[roi_y0:roi_y1, roi_x0:roi_x1]
                    kps, scores = self._body_model(crop_bgr)
                    if kps is not None and len(kps) > 0:
                        kps = kps.copy()
                        kps[:, :, 0] += roi_x0
                        kps[:, :, 1] += roi_y0
                    near_p, far_p = self._extract_candidates(frame, fgray, bg_gray, kps, scores)
                    r_poses.append({
                        "frame": fn,
                        "near": near_p,
                        "far": far_p,
                    })

            near_id, far_id = self.assign_player_sides(r_poses)
            near_found = sum(1 for p in r_poses if p.get("near") is not None)
            far_found = sum(1 for p in r_poses if p.get("far") is not None)
            elapsed = time.time() - t0
            print(
                f"[PoseTracker] Rally {rid:2d} [{sf:5d}..{ef:5d}] "
                f"frames={len(r_poses):3d} near={near_id}({near_found}/{len(r_poses)}) "
                f"far={far_id}({far_found}/{len(r_poses)}) ({elapsed:.1f}s)"
            )

            results_by_rally[rid_key] = {
                "rally_id": rid,
                "start_frame": sf,
                "end_frame": ef,
                "stride": self.stride,
                "near_player": near_id,
                "far_player": far_id,
                "frames": r_poses,
            }

            if output_json_path:
                os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
                with open(output_json_path, "w") as f:
                    json.dump(
                        {
                            "stride": self.stride,
                            "fps_sampled": 25.0 / self.stride,
                            "rallies": results_by_rally,
                        },
                        f,
                    )

        cap.release()
        return results_by_rally
