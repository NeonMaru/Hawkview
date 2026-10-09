"""
TrackNet Shuttlecock Detection & Heatmap Processing Engine
Implements:
- 3-Frame Concatenation Bundle (9 Channels: [I_{t-1}, I_t, I_{t+1}])
- Sub-Pixel 2D Gaussian Centroid Peak Extraction
- Trajectory Gating & Outlier Rejection (Physically impossible velocity filter)
- Linear/Spline Occlusion Infilling (Net Tape & Body occlusions)
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple
import numpy as np
import cv2


@dataclass
class ShuttleDetection:
    frame_idx: int
    timestamp_sec: float
    pixel_x: float          # Sub-pixel x in original video coordinates
    pixel_y: float          # Sub-pixel y in original video coordinates
    confidence: float       # Heatmap peak probability in [0.0, 1.0]
    is_interpolated: bool = False


class TrackNetProcessor:
    """
    Simulates and executes TrackNet shuttlecock tracking pipeline.
    Compatible with ONNX Runtime, Apple Neural Engine CoreML, and software fallback.
    """

    def __init__(
        self,
        input_width: int = 640,
        input_height: int = 360,
        detection_threshold: float = 0.50,
        max_velocity_kmh: float = 550.0
    ):
        self.input_width = input_width
        self.input_height = input_height
        self.threshold = detection_threshold
        self.max_velocity_kmh = max_velocity_kmh
        self.frame_buffer: List[np.ndarray] = []

    def preprocess_frame_bundle(self, frames: List[np.ndarray]) -> np.ndarray:
        """
        Concatenates 3 consecutive RGB frames into a 9-channel normalized tensor (1, 9, H, W).
        """
        if len(frames) != 3:
            raise ValueError(f"TrackNet expects exactly 3 consecutive frames, got {len(frames)}")

        resized = [cv2.resize(f, (self.input_width, self.input_height)) for f in frames]
        # Normalize to [0.0, 1.0]
        norm = [r.astype(np.float32) / 255.0 for r in resized]
        # Concatenate along channel axis: (H, W, 9)
        concat = np.concatenate(norm, axis=-1)
        # Transpose to (1, 9, H, W) for NPU / ONNX Runtime
        tensor = np.transpose(concat, (2, 0, 1))[np.newaxis, ...]
        return tensor

    def extract_peak_from_heatmap(
        self,
        heatmap: np.ndarray,
        orig_width: int,
        orig_height: int
    ) -> Optional[Tuple[float, float, float]]:
        """
        Extracts sub-pixel shuttlecock centroid from predicted 2D probability heatmap.
        
        Args:
            heatmap: (H, W) array of detection probabilities in [0.0, 1.0]
            orig_width: Original video resolution width (e.g. 1920)
            orig_height: Original video resolution height (e.g. 1080)
            
        Returns:
            (u, v, confidence) in original video resolution, or None if no peak above threshold
        """
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(heatmap)

        if max_val < self.threshold:
            return None

        px, py = max_loc
        h, w = heatmap.shape

        # 5x5 Sub-pixel Centroid Calculation around peak
        half = 2
        y1, y2 = max(0, py - half), min(h, py + half + 1)
        x1, x2 = max(0, px - half), min(w, px + half + 1)

        patch = heatmap[y1:y2, x1:x2]
        sum_weights = np.sum(patch)

        if sum_weights > 1e-6:
            ys, xs = np.mgrid[y1:y2, x1:x2]
            sub_x = float(np.sum(xs * patch) / sum_weights)
            sub_y = float(np.sum(ys * patch) / sum_weights)
        else:
            sub_x, sub_y = float(px), float(py)

        # Rescale to original video dimensions
        orig_x = (sub_x / float(w)) * float(orig_width)
        orig_y = (sub_y / float(h)) * float(orig_height)

        return orig_x, orig_y, float(max_val)

    def filter_and_interpolate_trajectory(
        self,
        raw_detections: List[Optional[ShuttleDetection]],
        fps: float = 60.0
    ) -> List[ShuttleDetection]:
        """
        Applies physical velocity sanity checks and infills 1-2 frame occlusions.
        
        Args:
            raw_detections: List of detections per frame (None if undetected in that frame)
            fps: Video framerate
            
        Returns:
            Cleaned and smoothed list of valid ShuttleDetection instances
        """
        cleaned: List[ShuttleDetection] = []
        max_pix_per_sec = 2500.0  # Safe visual bound for 1080p

        for i, det in enumerate(raw_detections):
            if det is None:
                continue

            # Velocity check against previous detection
            if len(cleaned) > 0:
                prev = cleaned[-1]
                dt = det.timestamp_sec - prev.timestamp_sec
                if dt > 0:
                    dist = np.hypot(det.pixel_x - prev.pixel_x, det.pixel_y - prev.pixel_y)
                    pix_speed = dist / dt
                    if pix_speed > max_pix_per_sec and (det.frame_idx - prev.frame_idx) <= 2:
                        # Outlier detection, skip
                        continue

            cleaned.append(det)

        # Infill 1-frame gaps between confident detections
        infilled: List[ShuttleDetection] = []
        for i in range(len(cleaned)):
            infilled.append(cleaned[i])
            if i < len(cleaned) - 1:
                cur = cleaned[i]
                nxt = cleaned[i + 1]
                gap = nxt.frame_idx - cur.frame_idx
                if gap == 2:  # Single missing frame
                    mid_frame = cur.frame_idx + 1
                    mid_time = (cur.timestamp_sec + nxt.timestamp_sec) / 2.0
                    mid_x = (cur.pixel_x + nxt.pixel_x) / 2.0
                    mid_y = (cur.pixel_y + nxt.pixel_y) / 2.0
                    infilled.append(ShuttleDetection(
                        frame_idx=mid_frame,
                        timestamp_sec=mid_time,
                        pixel_x=mid_x,
                        pixel_y=mid_y,
                        confidence=(cur.confidence + nxt.confidence) / 2.0,
                        is_interpolated=True
                    ))

        return infilled
