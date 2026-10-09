"""
Player Pose Estimation, Net-Bounded Tracking & Court Heatmap Engine
Implements:
- 17-Keypoint Pose Anchor Extraction (COCO Ankle Midpoint Ground Projection)
- Net-Side Physical Bounding Rule (Zero Player ID Swaps across occlusions)
- Sprint Velocity and Cumulative Distance Telemetry
- 2D Kernel Density Estimation (KDE) Court Dominance Matrix (0.1m Resolution)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np

from engine.court_geometry import CourtGeometry, BWF


@dataclass
class PlayerTelemetryFrame:
    timestamp_sec: float
    court_x: float          # Meters [0.0, 6.10]
    court_y: float          # Meters [0.0, 13.40]
    velocity_kmh: float     # Instantaneous sprint speed
    is_sprint_burst: bool   # Sprint burst flag (> 14 km/h)
    is_jump: bool           # Jump elevation flag


@dataclass
class PlayerMatchTrack:
    player_id: str
    display_name: str
    court_side: str         # "near" or "far"
    frames: List[PlayerTelemetryFrame] = field(default_factory=list)
    total_distance_m: float = 0.0
    sprint_burst_count: int = 0
    max_velocity_kmh: float = 0.0


class PlayerPoseEngine:
    """
    Manages dual-player detection, ground plane projection, and KDE heatmap generation.
    """

    def __init__(self, court_geom: CourtGeometry, grid_res_m: float = 0.10):
        self.court_geom = court_geom
        self.grid_res = grid_res_m
        self.grid_w = int(np.ceil(BWF.width / self.grid_res))    # 61 bins
        self.grid_h = int(np.ceil(BWF.length / self.grid_res))   # 134 bins

        self.p1_track = PlayerMatchTrack("LZJ", "Lee Zii Jia", "near")
        self.p2_track = PlayerMatchTrack("SLY", "Su Li Yang", "far")

    def process_pose_keypoints(
        self,
        timestamp_sec: float,
        keypoints_detected: List[np.ndarray]
    ) -> Tuple[Optional[PlayerTelemetryFrame], Optional[PlayerTelemetryFrame]]:
        """
        Assigns detected human poses to Player 1 or Player 2 using the Net-Side Bounding Rule.
        
        Args:
            timestamp_sec: Video timestamp
            keypoints_detected: List of (17, 3) arrays [u, v, confidence] for each detected person
            
        Returns:
            (p1_frame, p2_frame)
        """
        p1_candidate: Optional[Tuple[float, float, float]] = None
        p2_candidate: Optional[Tuple[float, float, float]] = None

        for kpts in keypoints_detected:
            if kpts.shape[0] < 17:
                continue

            # COCO Keypoint Indices: 15 = Left Ankle, 16 = Right Ankle
            left_ankle = kpts[15]
            right_ankle = kpts[16]

            # Use visible ankle(s)
            ankle_pts = []
            if left_ankle[2] > 0.3:
                ankle_pts.append(left_ankle[:2])
            if right_ankle[2] > 0.3:
                ankle_pts.append(right_ankle[:2])

            if len(ankle_pts) == 0:
                # Fallback to hips: 11 = Left Hip, 12 = Right Hip
                if kpts[11][2] > 0.3 and kpts[12][2] > 0.3:
                    u_mid = (kpts[11][0] + kpts[12][0]) / 2.0
                    v_mid = (kpts[11][1] + kpts[12][1]) / 2.0
                else:
                    continue
            else:
                u_mid = float(np.mean([p[0] for p in ankle_pts]))
                v_mid = float(np.mean([p[1] for p in ankle_pts]))

            # Project ground pixel to court metric coordinates
            try:
                cx, cy = self.court_geom.pixel_to_court(u_mid, v_mid)
            except Exception:
                continue

            # Clamp within reasonable court apron boundaries
            cx = max(-0.5, min(BWF.width + 0.5, cx))
            cy = max(-0.5, min(BWF.length + 0.5, cy))

            # Net-Side Bounding Rule (Physical constraint: Net is at Y = 6.70m)
            if cy <= BWF.net_y:
                # Near court -> Player 1 (Lee Zii Jia)
                p1_candidate = (cx, cy, u_mid)
            else:
                # Far court -> Player 2 (Su Li Yang)
                p2_candidate = (cx, cy, u_mid)

        f1 = self._update_player_track(self.p1_track, timestamp_sec, p1_candidate)
        f2 = self._update_player_track(self.p2_track, timestamp_sec, p2_candidate)
        return f1, f2

    def _update_player_track(
        self,
        track: PlayerMatchTrack,
        time_sec: float,
        candidate: Optional[Tuple[float, float, float]]
    ) -> Optional[PlayerTelemetryFrame]:
        if candidate is None:
            return None

        cx, cy, _ = candidate
        speed_kmh = 0.0
        burst = False

        if len(track.frames) > 0:
            last = track.frames[-1]
            dt = time_sec - last.timestamp_sec
            if dt > 0.01:
                dist_m = float(np.hypot(cx - last.court_x, cy - last.court_y))
                # Discard unrealistic teleportation jumps (> 35 km/h)
                speed_ms = dist_m / dt
                calc_kmh = speed_ms * 3.6
                if calc_kmh < 35.0:
                    speed_kmh = calc_kmh
                    track.total_distance_m += dist_m
                    if speed_kmh > 14.0:
                        burst = True
                        if not last.is_sprint_burst:
                            track.sprint_burst_count += 1
                    track.max_velocity_kmh = max(track.max_velocity_kmh, speed_kmh)

        frame = PlayerTelemetryFrame(
            timestamp_sec=time_sec,
            court_x=cx,
            court_y=cy,
            velocity_kmh=speed_kmh,
            is_sprint_burst=burst,
            is_jump=False
        )
        track.frames.append(frame)
        return frame

    def generate_kde_heatmap(self, player_id: str, sigma_m: float = 0.60) -> np.ndarray:
        """
        Computes 2D Gaussian Kernel Density Estimation (KDE) court coverage heatmap matrix.
        
        Args:
            player_id: "LZJ" or "SLY"
            sigma_m: Gaussian kernel spread in meters (~0.6m foot reach)
            
        Returns:
            Normalized 2D matrix (grid_h, grid_w) with probabilities in [0.0, 1.0]
        """
        track = self.p1_track if player_id == "LZJ" else self.p2_track
        matrix = np.zeros((self.grid_h, self.grid_w), dtype=np.float32)

        if len(track.frames) == 0:
            return matrix

        sigma_bins = max(1.0, sigma_m / self.grid_res)
        kernel_rad = int(np.ceil(sigma_bins * 3))

        # Build 2D Gaussian kernel
        y, x = np.ogrid[-kernel_rad:kernel_rad + 1, -kernel_rad:kernel_rad + 1]
        kernel = np.exp(-(x * x + y * y) / (2.0 * sigma_bins * sigma_bins))
        kernel /= np.sum(kernel)

        for frame in track.frames:
            gx = int(frame.court_x / self.grid_res)
            gy = int(frame.court_y / self.grid_res)

            if 0 <= gx < self.grid_w and 0 <= gy < self.grid_h:
                # Stamp kernel onto matrix with boundary clipping
                y1 = max(0, gy - kernel_rad)
                y2 = min(self.grid_h, gy + kernel_rad + 1)
                x1 = max(0, gx - kernel_rad)
                x2 = min(self.grid_w, gx + kernel_rad + 1)

                ky1 = y1 - (gy - kernel_rad)
                ky2 = ky1 + (y2 - y1)
                kx1 = x1 - (gx - kernel_rad)
                kx2 = kx1 + (x2 - x1)

                matrix[y1:y2, x1:x2] += kernel[ky1:ky2, kx1:kx2]

        # Normalize to [0.0, 1.0]
        max_val = float(np.max(matrix))
        if max_val > 1e-6:
            matrix /= max_val

        return matrix
