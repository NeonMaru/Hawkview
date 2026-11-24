"""
Court Calibration & White-Line Refinement Engine for Hawkview
Solves:
1. 2D Ground Homography H (court ground plane <-> broadcast pixels)
2. 3D Camera Pose P = K[R | t] via cv2.solvePnP from 4 corners + 2 net-post tops
3. Sub-pixel white line fitting and refinement
4. Measured reprojection error tracking & validation
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
from scipy.optimize import minimize, least_squares

from engine.court_geometry import BWF

BWF_NET_Y = BWF.net_y


class CourtCalibrator:
    """
    Manages court keypoint calibration, PnP camera recovery, line refinement,
    and measured reprojection error validation.
    """

    def __init__(self, match_id: str = "lzj_popov", image_width: int = 1920, image_height: int = 1080):
        self.match_id = match_id
        self.bwf = BWF
        self.image_width = int(image_width or 1920)
        self.image_height = int(image_height or 1080)

        # 3D Reference points in meters
        # 4 Outer corners at ground Z = 0
        # 2 Net post tops at Z = 1.55m, net tape center at Z = 1.524m
        # Ground service line & court intersections
        self.ref_3d_points = {
            "corner_near_left": np.array([0.0, 0.0, 0.0], dtype=np.float64),
            "corner_near_right": np.array([self.bwf.width, 0.0, 0.0], dtype=np.float64),
            "corner_far_right": np.array([self.bwf.width, self.bwf.length, 0.0], dtype=np.float64),
            "corner_far_left": np.array([0.0, self.bwf.length, 0.0], dtype=np.float64),
            "net_post_left": np.array([0.0, self.bwf.net_y, self.bwf.net_height_posts], dtype=np.float64),
            "net_post_right": np.array([self.bwf.width, self.bwf.net_y, self.bwf.net_height_posts], dtype=np.float64),
            "net_tape_center": np.array([self.bwf.center_x, self.bwf.net_y, self.bwf.net_height_center], dtype=np.float64),
            "short_service_near_center": np.array([self.bwf.center_x, self.bwf.short_service_near_y, 0.0], dtype=np.float64),
            "short_service_far_center": np.array([self.bwf.center_x, self.bwf.short_service_far_y, 0.0], dtype=np.float64),
            "short_service_near_left": np.array([0.0, self.bwf.short_service_near_y, 0.0], dtype=np.float64),
            "short_service_near_right": np.array([self.bwf.width, self.bwf.short_service_near_y, 0.0], dtype=np.float64),
            "short_service_far_left": np.array([0.0, self.bwf.short_service_far_y, 0.0], dtype=np.float64),
            "short_service_far_right": np.array([self.bwf.width, self.bwf.short_service_far_y, 0.0], dtype=np.float64),
            "doubles_service_near_center": np.array([self.bwf.center_x, self.bwf.doubles_service_near_y, 0.0], dtype=np.float64),
            "doubles_service_far_center": np.array([self.bwf.center_x, self.bwf.doubles_service_far_y, 0.0], dtype=np.float64),
            "net_line_ground_left": np.array([0.0, self.bwf.net_y, 0.0], dtype=np.float64),
            "net_line_ground_right": np.array([self.bwf.width, self.bwf.net_y, 0.0], dtype=np.float64),
            "net_line_ground_center": np.array([self.bwf.center_x, self.bwf.net_y, 0.0], dtype=np.float64),
        }

        # 2D Pixel keypoints
        self.pixel_points: Dict[str, Tuple[float, float]] = {}
        self.H_court_to_pixel: Optional[np.ndarray] = None
        self.H_pixel_to_court: Optional[np.ndarray] = None
        self.K: Optional[np.ndarray] = None
        self.R: Optional[np.ndarray] = None
        self.rvec: Optional[np.ndarray] = None
        self.tvec: Optional[np.ndarray] = None
        self.camera_position: Optional[np.ndarray] = None
        self.reprojection_error_px: float = 0.0
        self.line_sample_rmse_px: float = 0.0

    def set_keypoints(
        self,
        keypoints: Dict[str, Tuple[float, float]],
        image_width: Optional[int] = None,
        image_height: Optional[int] = None,
    ):
        """Sets the reference pixel coordinates and computes initial homography & camera pose."""
        if image_width is not None and image_width > 0:
            self.image_width = int(image_width)
        if image_height is not None and image_height > 0:
            self.image_height = int(image_height)

        self.pixel_points = {k: (float(v[0]), float(v[1])) for k, v in keypoints.items() if v is not None and len(v) >= 2}
        if "net_tape_center" not in self.pixel_points and "net_post_left" in self.pixel_points and "net_post_right" in self.pixel_points:
            npl = self.pixel_points["net_post_left"]
            npr = self.pixel_points["net_post_right"]
            sag_px = max(2.0, 0.0035 * float(self.image_height))
            self.pixel_points["net_tape_center"] = (
                0.5 * (npl[0] + npr[0]),
                0.5 * (npl[1] + npr[1]) + sag_px,
            )
        self._compute_initial_calibration()

    def _compute_initial_calibration(self):
        """Computes ground homography H and PnP camera pose from the 6 keypoints."""
        # 1. Ground Homography H from 4 corners
        court_corners = np.array([
            self.ref_3d_points["corner_near_left"][:2],
            self.ref_3d_points["corner_near_right"][:2],
            self.ref_3d_points["corner_far_right"][:2],
            self.ref_3d_points["corner_far_left"][:2],
        ], dtype=np.float32)

        pixel_corners = np.array([
            self.pixel_points["corner_near_left"],
            self.pixel_points["corner_near_right"],
            self.pixel_points["corner_far_right"],
            self.pixel_points["corner_far_left"],
        ], dtype=np.float32)

        H, _ = cv2.findHomography(court_corners, pixel_corners)
        self.H_court_to_pixel = H
        self.H_pixel_to_court = np.linalg.inv(H)

        # 2. 3D Camera Pose with optical center at (image_width / 2, image_height / 2)
        self._solve_camera_pose()

    def _solve_camera_pose(self):
        """
        Solves square-pixel camera focal length (fx = fy = f), fixed principal point at
        image center (cx = image_width / 2.0, cy = image_height / 2.0), and 3D camera pose (R, t)
        across the court ground keypoints and 3D net keypoints.
        """
        pts_3d = []
        pts_2d = []

        # 1. Ground points (4 outer corners + short-service/centre-line intersections)
        ground_keys = [
            "corner_near_left",
            "corner_near_right",
            "corner_far_right",
            "corner_far_left",
            "short_service_near_center",
            "short_service_far_center",
            "doubles_service_near_center",
            "doubles_service_far_center",
            "short_service_near_left",
            "short_service_near_right",
            "short_service_far_left",
            "short_service_far_right",
        ]
        for key in ground_keys:
            p3 = self.ref_3d_points[key]
            p_pix = self.H_court_to_pixel @ np.array([p3[0], p3[1], 1.0])
            pts_3d.append(p3)
            pts_2d.append([p_pix[0] / p_pix[2], p_pix[1] / p_pix[2]])

        # 2. Net points with measured 2D image coordinates (posts on doubles sidelines)
        for key in ["net_post_left", "net_post_right", "net_tape_center"]:
            if key in self.pixel_points:
                pts_3d.append(self.ref_3d_points[key])
                pts_2d.append([self.pixel_points[key][0], self.pixel_points[key][1]])

        obj_pts = np.array(pts_3d, dtype=np.float64)
        img_pts = np.array(pts_2d, dtype=np.float64)

        cx_mid = float(self.image_width) / 2.0
        cy_mid = float(self.image_height) / 2.0
        f_init = max(800.0, 1.5625 * float(max(self.image_width, self.image_height)))

        def residuals(params):
            f_len = max(300.0, float(params[0]))
            rvec, tvec = params[1:4], params[4:7]
            K = np.array([[f_len, 0.0, cx_mid], [0.0, f_len, cy_mid], [0.0, 0.0, 1.0]], dtype=np.float64)
            proj, _ = cv2.projectPoints(obj_pts, rvec, tvec, K, np.zeros(5))
            return (proj.reshape(-1, 2) - img_pts).ravel()

        # Initial PnP solve with square pixels and exact image center
        K_guess = np.array([[f_init, 0.0, cx_mid], [0.0, f_init, cy_mid], [0.0, 0.0, 1.0]], dtype=np.float64)
        _, rvec0, tvec0 = cv2.solvePnP(obj_pts, img_pts, K_guess, np.zeros(5))

        x0 = [f_init] + list(rvec0.ravel()) + list(tvec0.ravel())
        res = least_squares(residuals, x0, method="lm")

        f_opt = max(300.0, float(res.x[0]))
        self.rvec = res.x[1:4]
        self.tvec = res.x[4:7]
        self.K = np.array([[f_opt, 0.0, cx_mid], [0.0, f_opt, cy_mid], [0.0, 0.0, 1.0]], dtype=np.float64)
        self.R, _ = cv2.Rodrigues(self.rvec)
        self.camera_position = -self.R.T @ self.tvec

        # Compute measured reprojection error across all reference points
        proj, _ = cv2.projectPoints(obj_pts, self.rvec, self.tvec, self.K, np.zeros(5))
        proj = proj.reshape(-1, 2)
        errors = np.linalg.norm(proj - img_pts, axis=1)
        self.reprojection_error_px = float(np.sqrt(np.mean(errors ** 2)))

    def _validate_homography_geometry(self, H: np.ndarray, check_shift: bool = True) -> bool:
        """
        Enforces BWF broadcast trapezoid geometry invariants on a candidate homography H
        so player shoes/shirts, floor logos, or net banners can never twist or distort the court wireframe.
        Supports both wide-angle and telephoto BWF broadcast cameras (e.g., Hong Kong Open, Paris, Arctic Open).
        """
        if H is None:
            return False
        try:
            corners_m = np.array([
                [0.0, 0.0],
                [self.bwf.width, 0.0],
                [self.bwf.width, self.bwf.length],
                [0.0, self.bwf.length],
            ], dtype=np.float32).reshape(-1, 1, 2)
            pts = cv2.perspectiveTransform(corners_m, H).reshape(-1, 2)
        except Exception:
            return False

        w = float(self.image_width or 1920)
        h = float(self.image_height or 1080)
        nl, nr, fr, fl = pts[0], pts[1], pts[2], pts[3]

        # 1. Bounds check
        for u, v in pts:
            if not (np.isfinite(u) and np.isfinite(v)):
                return False
            if u < -0.08 * w or u > 1.08 * w or v < 0.10 * h or v > 1.05 * h:
                return False

        # 2. Width & perspective foreshortening invariants (supports telephoto BWF cameras up to ratio 0.90)
        near_w = float(nr[0] - nl[0])
        far_w = float(fr[0] - fl[0])
        if near_w < 0.36 * w or far_w < 0.18 * w:
            return False
        ratio = far_w / max(1.0, near_w)
        if ratio < 0.35 or ratio > 0.90:
            return False

        # 3. Baseline horizontality & anti-shear check
        m_near = (nr[1] - nl[1]) / max(1.0, nr[0] - nl[0])
        m_far = (fr[1] - fl[1]) / max(1.0, fr[0] - fl[0])
        if abs(m_near) > 0.045 or abs(m_far) > 0.045 or abs(m_near - m_far) > 0.032:
            return False

        # 4. Sideline convergence & symmetry check (u = mV * v + bV)
        dy_l = nl[1] - fl[1]
        dy_r = nr[1] - fr[1]
        if dy_l < 0.22 * h or dy_r < 0.22 * h:
            return False
        mv_left = (nl[0] - fl[0]) / dy_l   # should be negative (left sideline leans inward toward top)
        mv_right = (nr[0] - fr[0]) / dy_r  # should be positive (right sideline leans inward toward top)
        if not (-0.88 <= mv_left <= -0.07 and 0.07 <= mv_right <= 0.88):
            return False
        if abs(mv_left + mv_right) > 0.22:
            return False

        # 5. Maximum displacement guard against current corners (skipped for zero-prior trapezoid detection)
        if check_shift:
            max_shift = 0.085 * w
            for key, pt in zip(
                ["corner_near_left", "corner_near_right", "corner_far_right", "corner_far_left"],
                [nl, nr, fr, fl],
            ):
                if key in self.pixel_points:
                    old_u, old_v = self.pixel_points[key]
                    if float(np.hypot(pt[0] - old_u, pt[1] - old_v)) > max_shift:
                        return False

        return True

    def measure_court_line_coverage(self, frame_bgr: np.ndarray) -> Dict:
        """
        Probes all 12 official BWF ground court lines (20 samples each) using the Top-Hat
        white-line ridge + chroma filter to verify that the projected homography actually aligns
        with real court markings (rejecting zoomed/angled replays and misaligned fallbacks).
        """
        empty = {
            "segment_hits_count": 0,
            "total_segments": 12,
            "segment_coverage_pct": 0.0,
            "outer_boundary_ok": False,
            "mean_line_hit_pct": 0.0,
            "green_in_poly_pct": 0.0,
        }
        if self.H_court_to_pixel is None or frame_bgr is None or frame_bgr.size == 0:
            return empty

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).astype(np.float64)
        chroma = (
            np.max(frame_bgr, axis=2).astype(np.float64)
            - np.min(frame_bgr, axis=2).astype(np.float64)
        )
        h_img, w_img = gray.shape
        scale = float(w_img) / 1920.0
        flank = max(2, int(round(4.0 * scale)))
        r = max(2, int(round(4.0 * scale)))
        pad = r + flank + 1

        bwf = self.bwf
        segments = [
            (0.0, 0.0, bwf.width, 0.0, "h", True),                        # Near baseline (outer)
            (0.0, 0.76, bwf.width, 0.76, "h", False),                     # Near doubles service line
            (0.0, 4.72, bwf.width, 4.72, "h", False),                     # Near short service line
            (0.0, 8.68, bwf.width, 8.68, "h", False),                     # Far short service line
            (0.0, 12.64, bwf.width, 12.64, "h", False),                   # Far doubles service line
            (0.0, 13.40, bwf.width, 13.40, "h", True),                    # Far baseline (outer)
            (0.0, 0.0, 0.0, 13.40, "v", True),                            # Left doubles sideline (outer)
            (0.46, 0.0, 0.46, 13.40, "v", False),                         # Left singles sideline
            (3.05, 0.0, 3.05, 4.72, "v", False),                          # Center service line near
            (3.05, 8.68, 3.05, 13.40, "v", False),                        # Center service line far
            (bwf.width - 0.46, 0.0, bwf.width - 0.46, 13.40, "v", False), # Right singles sideline
            (bwf.width, 0.0, bwf.width, 13.40, "v", True),                # Right doubles sideline (outer)
        ]

        num_samples = 20
        seg_pcts = []
        outer_pcts = []

        for x1, y1, x2, y2, orient, is_outer in segments:
            xs = np.linspace(x1, x2, num_samples)
            ys = np.linspace(y1, y2, num_samples)
            hits = 0
            for cx, cy in zip(xs, ys):
                p = self.H_court_to_pixel @ np.array([cx, cy, 1.0], dtype=np.float64)
                if abs(p[2]) < 1e-9:
                    continue
                u, v = p[0] / p[2], p[1] / p[2]
                if not (np.isfinite(u) and np.isfinite(v)):
                    continue
                ix, iy = int(round(u)), int(round(v))
                if ix < pad or ix >= w_img - pad or iy < pad or iy >= h_img - pad:
                    continue
                if orient == "h":
                    win = gray[iy - r : iy + r + 1, ix]
                    c_win = chroma[iy - r : iy + r + 1, ix]
                    f_neg = gray[iy - r - flank : iy + r + 1 - flank, ix]
                    f_pos = gray[iy - r + flank : iy + r + 1 + flank, ix]
                else:
                    win = gray[iy, ix - r : ix + r + 1]
                    c_win = chroma[iy, ix - r : ix + r + 1]
                    f_neg = gray[iy, ix - r - flank : ix + r + 1 - flank]
                    f_pos = gray[iy, ix - r + flank : ix + r + 1 + flank]
                ridge = win - 0.5 * (f_neg + f_pos)
                if np.any((win >= 140.0) & (c_win <= 68.0) & (ridge >= 12.0)):
                    hits += 1
            pct = 100.0 * float(hits) / float(num_samples)
            seg_pcts.append(pct)
            if is_outer:
                outer_pcts.append(pct)

        segment_hits_count = sum(1 for pct in seg_pcts if pct >= 20.0)
        total_segments = len(segments)
        segment_coverage_pct = 100.0 * float(segment_hits_count) / float(total_segments)
        outer_boundary_ok = len(outer_pcts) == 4 and all(pct >= 20.0 for pct in outer_pcts)
        mean_line_hit_pct = float(np.mean(seg_pcts)) if seg_pcts else 0.0

        # Measure green BWF court mat coverage inside projected outer court polygon
        green_in_poly_pct = 0.0
        try:
            corners_m = np.array([
                [0.0, 0.0],
                [bwf.width, 0.0],
                [bwf.width, bwf.length],
                [0.0, bwf.length],
            ], dtype=np.float32).reshape(-1, 1, 2)
            poly_pts = cv2.perspectiveTransform(corners_m, self.H_court_to_pixel).reshape(-1, 2)
            if np.all(np.isfinite(poly_pts)):
                poly_mask = np.zeros((h_img, w_img), dtype=np.uint8)
                cv2.fillPoly(poly_mask, [np.round(poly_pts).astype(np.int32)], 255)
                poly_area = int(np.count_nonzero(poly_mask))
                if poly_area > 0:
                    hsv_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
                    g_mask = cv2.inRange(hsv_frame, (32, 35, 35), (92, 255, 255))
                    green_in_poly_pct = 100.0 * float(np.count_nonzero(cv2.bitwise_and(g_mask, poly_mask))) / float(poly_area)
        except Exception:
            pass

        return {
            "segment_hits_count": int(segment_hits_count),
            "total_segments": int(total_segments),
            "segment_coverage_pct": round(float(segment_coverage_pct), 1),
            "outer_boundary_ok": bool(outer_boundary_ok),
            "mean_line_hit_pct": round(float(mean_line_hit_pct), 1),
            "green_in_poly_pct": round(float(green_in_poly_pct), 1),
        }

    def refine_with_white_lines(self, frame_bgr: np.ndarray, search_radius_px: int = 12) -> float:
        """
        Samples visible white court lines across the court using a 1D Top-Hat White-Line Ridge
        + Chroma filter (rejecting player shoes/shirts and floor logos), refines the homography
        with RANSAC, validates BWF trapezoid geometry invariants, co-updates net posts, and
        re-solves 3D camera pose. Returns the measured line-sample RMSE in pixels.
        """
        if self.H_court_to_pixel is None:
            raise ValueError("Initial calibration must be set before line refinement.")

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).astype(np.float64)
        chroma = (np.max(frame_bgr, axis=2).astype(np.float64) - np.min(frame_bgr, axis=2).astype(np.float64))

        # Standard BWF line segments in metric court coordinates (x1, y1, x2, y2, orientation)
        segments = [
            (0.0, 0.0, self.bwf.width, 0.0, "h"),              # Near baseline
            (0.0, 0.76, self.bwf.width, 0.76, "h"),            # Near doubles service line
            (0.0, 4.72, self.bwf.width, 4.72, "h"),            # Near short service line
            (0.0, 8.68, self.bwf.width, 8.68, "h"),            # Far short service line
            (0.0, 12.64, self.bwf.width, 12.64, "h"),          # Far doubles service line
            (0.0, 13.40, self.bwf.width, 13.40, "h"),          # Far baseline
            (0.0, 0.0, 0.0, 13.40, "v"),                       # Left doubles sideline
            (0.46, 0.0, 0.46, 13.40, "v"),                     # Left singles sideline
            (3.05, 0.0, 3.05, 4.72, "v"),                      # Center service line near
            (3.05, 8.68, 3.05, 13.40, "v"),                    # Center service line far
            (self.bwf.width - 0.46, 0.0, self.bwf.width - 0.46, 13.40, "v"),  # Right singles sideline
            (self.bwf.width, 0.0, self.bwf.width, 13.40, "v"), # Right doubles sideline
        ]

        sample_court_pts = []
        sample_target_pix = []

        h_img, w_img = gray.shape
        scale_factor = float(w_img) / 1920.0
        flank_step = max(2, int(round(4.0 * scale_factor)))
        margin = max(16, int(round(30.0 * scale_factor)))
        r = max(8, int(search_radius_px))

        for x1, y1, x2, y2, orient in segments:
            num_samples = 25
            xs = np.linspace(x1, x2, num_samples)
            ys = np.linspace(y1, y2, num_samples)
            for cx, cy in zip(xs, ys):
                p = self.H_court_to_pixel @ np.array([cx, cy, 1.0])
                u, v = p[0] / p[2], p[1] / p[2]
                ix, iy = int(round(u)), int(round(v))
                if ix < margin + r + flank_step or ix >= w_img - (margin + r + flank_step):
                    continue
                if iy < margin + r + flank_step or iy >= h_img - (margin + r + flank_step):
                    continue

                if orient == "h":
                    window = gray[iy - r : iy + r + 1, ix]
                    c_win = chroma[iy - r : iy + r + 1, ix]
                    flank_up = gray[iy - r - flank_step : iy + r + 1 - flank_step, ix]
                    flank_dn = gray[iy - r + flank_step : iy + r + 1 + flank_step, ix]
                    ridge = window - 0.5 * (flank_up + flank_dn)
                    valid = (window >= 145.0) & (c_win <= 65.0) & (ridge >= 14.0)
                    if np.any(valid):
                        scores = np.where(valid, ridge + 0.25 * window, -1e9)
                        pk = int(np.argmax(scores))
                        if 0 < pk < len(window) - 1:
                            dy = (window[pk + 1] - window[pk - 1]) / (
                                2.0 * (2.0 * window[pk] - window[pk - 1] - window[pk + 1]) + 1e-6
                            )
                            dy = float(np.clip(dy, -0.5, 0.5))
                            target_v = iy - r + pk + dy
                            sample_court_pts.append([cx, cy])
                            sample_target_pix.append([u, target_v])
                else:
                    window = gray[iy, ix - r : ix + r + 1]
                    c_win = chroma[iy, ix - r : ix + r + 1]
                    flank_l = gray[iy, ix - r - flank_step : ix + r + 1 - flank_step]
                    flank_r = gray[iy, ix - r + flank_step : ix + r + 1 + flank_step]
                    ridge = window - 0.5 * (flank_l + flank_r)
                    valid = (window >= 145.0) & (c_win <= 65.0) & (ridge >= 14.0)
                    if np.any(valid):
                        scores = np.where(valid, ridge + 0.25 * window, -1e9)
                        pk = int(np.argmax(scores))
                        if 0 < pk < len(window) - 1:
                            dx = (window[pk + 1] - window[pk - 1]) / (
                                2.0 * (2.0 * window[pk] - window[pk - 1] - window[pk + 1]) + 1e-6
                            )
                            dx = float(np.clip(dx, -0.5, 0.5))
                            target_u = ix - r + pk + dx
                            sample_court_pts.append([cx, cy])
                            sample_target_pix.append([target_u, v])

        if len(sample_court_pts) >= 20:
            sample_court_pts_arr = np.array(sample_court_pts, dtype=np.float32)
            sample_target_pix_arr = np.array(sample_target_pix, dtype=np.float32)

            ransac_thresh = max(2.2, 4.0 * scale_factor)
            H_ref, inlier_mask = cv2.findHomography(
                sample_court_pts_arr, sample_target_pix_arr, cv2.RANSAC, ransac_thresh
            )
            if H_ref is not None and self._validate_homography_geometry(H_ref):
                # Backup current calibration state in case PnP error degrades
                backup_H = self.H_court_to_pixel.copy()
                backup_H_inv = self.H_pixel_to_court.copy()
                backup_pixels = dict(self.pixel_points)
                backup_reproj = self.reprojection_error_px

                # Compute ground displacement at the net line (y = 6.70m) so 2D net posts stay locked to the refined sidelines
                net_ground_m = np.array([
                    [0.0, self.bwf.net_y],
                    [self.bwf.width, self.bwf.net_y],
                    [self.bwf.center_x, self.bwf.net_y],
                ], dtype=np.float32).reshape(-1, 1, 2)
                old_net_g = cv2.perspectiveTransform(net_ground_m, backup_H).reshape(-1, 2)
                new_net_g = cv2.perspectiveTransform(net_ground_m, H_ref).reshape(-1, 2)
                d_net = new_net_g - old_net_g

                self.H_court_to_pixel = H_ref
                self.H_pixel_to_court = np.linalg.inv(H_ref)

                # Update corner pixel coordinates from refined H
                court_corners = np.array([
                    self.ref_3d_points["corner_near_left"][:2],
                    self.ref_3d_points["corner_near_right"][:2],
                    self.ref_3d_points["corner_far_right"][:2],
                    self.ref_3d_points["corner_far_left"][:2],
                ], dtype=np.float32)
                p_corners = cv2.perspectiveTransform(court_corners.reshape(-1, 1, 2), H_ref).reshape(-1, 2)
                self.pixel_points["corner_near_left"] = (float(p_corners[0, 0]), float(p_corners[0, 1]))
                self.pixel_points["corner_near_right"] = (float(p_corners[1, 0]), float(p_corners[1, 1]))
                self.pixel_points["corner_far_right"] = (float(p_corners[2, 0]), float(p_corners[2, 1]))
                self.pixel_points["corner_far_left"] = (float(p_corners[3, 0]), float(p_corners[3, 1]))

                # Co-update net post pixel coordinates before solving 3D camera pose
                for idx, nkey in enumerate(["net_post_left", "net_post_right", "net_tape_center"]):
                    if nkey in self.pixel_points:
                        ou, ov = self.pixel_points[nkey]
                        self.pixel_points[nkey] = (float(ou + d_net[idx, 0]), float(ov + d_net[idx, 1]))

                # Update 3D camera pose and reprojection error with refined points
                self._solve_camera_pose()

                max_allowed_reproj = max(6.5, 11.0 * scale_factor)
                if self.reprojection_error_px <= max_allowed_reproj:
                    proj_lines = cv2.perspectiveTransform(sample_court_pts_arr.reshape(-1, 1, 2), H_ref).reshape(-1, 2)
                    err_lines = np.linalg.norm(proj_lines - sample_target_pix_arr, axis=1)
                    inliers = err_lines[inlier_mask.ravel() == 1]
                    self.line_sample_rmse_px = float(np.sqrt(np.mean(inliers ** 2))) if len(inliers) > 0 else 0.0
                else:
                    # Roll back if PnP reprojection error spiked
                    self.H_court_to_pixel = backup_H
                    self.H_pixel_to_court = backup_H_inv
                    self.pixel_points = backup_pixels
                    self._solve_camera_pose()
                    self.reprojection_error_px = backup_reproj
                    self.line_sample_rmse_px = 0.0

        return self.line_sample_rmse_px

    def project_lines(self, frame_bgr: np.ndarray, color=(0, 255, 255), thickness=2) -> np.ndarray:
        """
        Projects and draws the complete official BWF line model onto the frame.
        """
        out = frame_bgr.copy()
        if self.H_court_to_pixel is None:
            return out

        H = self.H_court_to_pixel
        bwf = self.bwf

        # All regulation lines
        line_specs = [
            # Baselines
            ([0.0, 0.0], [bwf.width, 0.0]),
            ([0.0, bwf.length], [bwf.width, bwf.length]),
            # Outer doubles sidelines
            ([0.0, 0.0], [0.0, bwf.length]),
            ([bwf.width, 0.0], [bwf.width, bwf.length]),
            # Inner singles sidelines
            ([0.46, 0.0], [0.46, bwf.length]),
            ([bwf.width - 0.46, 0.0], [bwf.width - 0.46, bwf.length]),
            # Doubles service lines
            ([0.0, 0.76], [bwf.width, 0.76]),
            ([0.0, bwf.length - 0.76], [bwf.width, bwf.length - 0.76]),
            # Short service lines
            ([0.0, 4.72], [bwf.width, 4.72]),
            ([0.0, bwf.length - 4.72], [bwf.width, bwf.length - 4.72]),
            # Center line
            ([3.05, 0.0], [3.05, 4.72]),
            ([3.05, bwf.length - 4.72], [3.05, bwf.length]),
        ]

        for pt1, pt2 in line_specs:
            p1 = H @ np.array([pt1[0], pt1[1], 1.0])
            p1 = (int(round(p1[0] / p1[2])), int(round(p1[1] / p1[2])))
            p2 = H @ np.array([pt2[0], pt2[1], 1.0])
            p2 = (int(round(p2[0] / p2[2])), int(round(p2[1] / p2[2])))
            cv2.line(out, p1, p2, color, thickness)

        # Draw net line on ground
        pn1 = H @ np.array([0.0, bwf.net_y, 1.0])
        pn1 = (int(round(pn1[0] / pn1[2])), int(round(pn1[1] / pn1[2])))
        pn2 = H @ np.array([bwf.width, bwf.net_y, 1.0])
        pn2 = (int(round(pn2[0] / pn2[2])), int(round(pn2[1] / pn2[2])))
        cv2.line(out, pn1, pn2, (0, 165, 255), 1)

        # Draw net top cord and posts on doubles sidelines (BWF Law 1.6: x=0.0 and x=6.10)
        if self.K is not None and self.rvec is not None and self.tvec is not None:
            post_left_3d = np.array([[0.0, bwf.net_y, bwf.net_height_posts]])
            net_center_3d = np.array([[bwf.center_x, bwf.net_y, bwf.net_height_center]])
            post_right_3d = np.array([[bwf.width, bwf.net_y, bwf.net_height_posts]])
            p_post_l, _ = cv2.projectPoints(post_left_3d, self.rvec, self.tvec, self.K, np.zeros(5))
            p_net_c, _ = cv2.projectPoints(net_center_3d, self.rvec, self.tvec, self.K, np.zeros(5))
            p_post_r, _ = cv2.projectPoints(post_right_3d, self.rvec, self.tvec, self.K, np.zeros(5))
            pl = (int(round(p_post_l[0, 0, 0])), int(round(p_post_l[0, 0, 1])))
            pc = (int(round(p_net_c[0, 0, 0])), int(round(p_net_c[0, 0, 1])))
            pr = (int(round(p_post_r[0, 0, 0])), int(round(p_post_r[0, 0, 1])))
            cv2.line(out, pn1, pl, (255, 255, 255), 2)
            cv2.line(out, pn2, pr, (255, 255, 255), 2)
            cv2.line(out, pl, pc, (255, 255, 255), 2)
            cv2.line(out, pc, pr, (255, 255, 255), 2)
            cv2.circle(out, pl, 4, (0, 240, 255), -1)
            cv2.circle(out, pc, 4, (0, 240, 255), -1)
            cv2.circle(out, pr, 4, (0, 240, 255), -1)

        return out

    def save_calibration(self, output_path: Optional[str] = None):
        """Exports calibration parameters and measured reprojection error to calibration.json."""
        if output_path is None:
            output_path = f"data/matches/{self.match_id}/calibration.json"

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        data = {
            "match_id": self.match_id,
            "image_width": self.image_width,
            "image_height": self.image_height,
            "reprojection_error_px": round(self.reprojection_error_px, 3),
            "line_sample_rmse_px": round(self.line_sample_rmse_px, 3),
            "pixel_points": self.pixel_points,
            "homography_H": self.H_court_to_pixel.tolist() if self.H_court_to_pixel is not None else None,
            "camera_matrix_K": self.K.tolist() if self.K is not None else None,
            "rotation_matrix_R": self.R.tolist() if self.R is not None else None,
            "rotation_vector_rvec": self.rvec.tolist() if self.rvec is not None else None,
            "translation_vector_t": self.tvec.tolist() if self.tvec is not None else None,
            "camera_position_m": self.camera_position.tolist() if self.camera_position is not None else None,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        return output_path

    def load_calibration(self, input_path: Optional[str] = None):
        """Loads calibration parameters from JSON."""
        if input_path is None:
            input_path = f"data/matches/{self.match_id}/calibration.json"

        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Calibration file not found: {input_path}")

        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.match_id = data.get("match_id", self.match_id)
        if data.get("image_width"):
            self.image_width = int(data["image_width"])
        if data.get("image_height"):
            self.image_height = int(data["image_height"])
        self.reprojection_error_px = data.get("reprojection_error_px", 0.0)
        self.line_sample_rmse_px = data.get("line_sample_rmse_px", 0.0)
        self.pixel_points = data.get("pixel_points", {})

        if data.get("homography_H") is not None:
            self.H_court_to_pixel = np.array(data["homography_H"], dtype=np.float64)
            self.H_pixel_to_court = np.linalg.inv(self.H_court_to_pixel)

        if data.get("camera_matrix_K") is not None:
            self.K = np.array(data["camera_matrix_K"], dtype=np.float64)
        if data.get("rotation_matrix_R") is not None:
            self.R = np.array(data["rotation_matrix_R"], dtype=np.float64)
        if data.get("rotation_vector_rvec") is not None:
            self.rvec = np.array(data["rotation_vector_rvec"], dtype=np.float64)
        if data.get("translation_vector_t") is not None:
            self.tvec = np.array(data["translation_vector_t"], dtype=np.float64)
        if data.get("camera_position_m") is not None:
            self.camera_position = np.array(data["camera_position_m"], dtype=np.float64)

    def load(self, input_path: Optional[str] = None):
        """Alias for load_calibration()."""
        return self.load_calibration(input_path)

    def pixel_to_court(self, u: float, v: float) -> Tuple[float, float]:
        """Projects a ground-plane image pixel (u, v) to court coordinates (x, y) in meters via H_inv."""
        if self.H_pixel_to_court is None:
            raise ValueError("Calibration homography H_pixel_to_court is not loaded.")
        p = self.H_pixel_to_court @ np.array([float(u), float(v), 1.0], dtype=np.float64)
        return float(p[0] / p[2]), float(p[1] / p[2])

    def court_to_pixel(self, x: float, y: float) -> Tuple[float, float]:
        """Projects court ground coordinates (x, y) in meters to image pixel (u, v) via H."""
        if self.H_court_to_pixel is None:
            raise ValueError("Calibration homography H_court_to_pixel is not loaded.")
        p = self.H_court_to_pixel @ np.array([float(x), float(y), 1.0], dtype=np.float64)
        return float(p[0] / p[2]), float(p[1] / p[2])

    def project_3d_to_pixel(self, pts_3d: np.ndarray) -> np.ndarray:
        """Projects Nx3 court 3D points (x, y, z) in meters to Nx2 image pixels using K, rvec, tvec."""
        arr = np.asarray(pts_3d, dtype=np.float64).reshape(-1, 1, 3)
        proj, _ = cv2.projectPoints(arr, self.rvec, self.tvec, self.K, np.zeros(5))
        return proj.reshape(-1, 2)

    @classmethod
    def default_keypoints_for_size(cls, width: int = 1920, height: int = 1080) -> Dict[str, List[float]]:
        """Returns proportional BWF court keypoints scaled to (width, height)."""
        sx = float(width) / 1920.0
        sy = float(height) / 1080.0
        return {
            "corner_near_left": [round(323.84 * sx, 1), round(963.18 * sy, 1)],
            "corner_near_right": [round(1592.03 * sx, 1), round(968.72 * sy, 1)],
            "corner_far_right": [round(1293.55 * sx, 1), round(427.70 * sy, 1)],
            "corner_far_left": [round(627.70 * sx, 1), round(423.38 * sy, 1)],
            "net_post_left": [round(516.50 * sx, 1), round(390.50 * sy, 1)],
            "net_post_right": [round(1404.50 * sx, 1), round(396.00 * sy, 1)],
            "net_tape_center": [round(960.50 * sx, 1), round(397.00 * sy, 1)],
        }

    @classmethod
    def detect_court_trapezoid_from_frame(cls, frame_bgr: np.ndarray) -> Optional[Dict[str, Tuple[float, float]]]:
        """
        Zero-prior BWF court & net detector using:
        1. 1D Projective Cross-Ratio matching across the 6 horizontal BWF lines [0.0, 0.76, 4.72, 8.68, 12.64, 13.40]m
        2. Analytical vertical vanishing point (v_inf = a/c) + 5-line BWF sideline cross-ratio matching [-0.5, -0.4246, 0, +0.4246, +0.5]
        3. Outer-wing net top cord ridge detection for 3D net post tops (z = 1.55m)
        """
        if frame_bgr is None or frame_bgr.size == 0:
            return None
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).astype(np.float64)
        chroma = (np.max(frame_bgr, axis=2).astype(np.float64) - np.min(frame_bgr, axis=2).astype(np.float64))
        scale = float(w) / 1920.0
        flank = max(2, int(round(4.0 * scale)))

        valid_white = (gray >= 135.0) & (chroma <= 65.0)
        R_h = np.zeros_like(gray)
        R_h[flank:-flank, :] = gray[flank:-flank, :] - 0.5 * (gray[:-2 * flank, :] + gray[2 * flank:, :])
        R_h = np.where(valid_white & (R_h >= 10.0), R_h, 0.0)

        R_v = np.zeros_like(gray)
        R_v[:, flank:-flank] = gray[:, flank:-flank] - 0.5 * (gray[:, :-2 * flank] + gray[:, 2 * flank:])
        R_v = np.where(valid_white & (R_v >= 10.0), R_v, 0.0)

        x_c1, x_c2 = int(0.28 * w), int(0.72 * w)
        h_prof = np.mean(R_h[:, x_c1:x_c2], axis=1)
        h_smooth = np.convolve(h_prof, [0.25, 0.5, 0.25], mode="same")

        y_min, y_max = int(0.26 * h), int(0.965 * h)
        peaks = []
        for y in range(y_min + 2, y_max - 2):
            if h_smooth[y] >= h_smooth[y - 1] and h_smooth[y] >= h_smooth[y + 1] and h_smooth[y] > 2.8:
                denom = 2.0 * (2.0 * h_smooth[y] - h_smooth[y - 1] - h_smooth[y + 1])
                dy = (h_smooth[y + 1] - h_smooth[y - 1]) / denom if abs(denom) > 1e-6 else 0.0
                peaks.append((float(y + np.clip(dy, -0.5, 0.5)), float(h_smooth[y])))

        peaks.sort(key=lambda x: -x[1])
        nms_peaks = []
        min_sep = max(4.0, 6.0 * scale)
        for yp, val in peaks:
            if all(abs(yp - yq) >= min_sep for yq, _ in nms_peaks):
                nms_peaks.append((yp, val))
        nms_peaks.sort(key=lambda x: x[0])

        y_m = np.array([0.0, 0.76, 4.72, 8.68, 12.64, 13.40], dtype=np.float64)
        best_h_score = -1e9
        best_h = None

        near_cands = [p for p in nms_peaks if 0.72 * h <= p[0] <= 0.965 * h]
        mid_cands = [p for p in nms_peaks if 0.44 * h <= p[0] <= 0.80 * h]
        far_cands = [p for p in nms_peaks if 0.26 * h <= p[0] <= 0.62 * h]

        for v0, _ in near_cands:
            for v2, _ in mid_cands:
                if not (0.14 * h <= v0 - v2 <= 0.38 * h):
                    continue
                for v4, _ in far_cands:
                    if not (0.12 * h <= v2 - v4 <= 0.36 * h):
                        continue
                    for y_far_m in (12.64, 13.40):
                        b = v0
                        M = np.array([[4.72, -4.72 * v2], [y_far_m, -y_far_m * v4]], dtype=np.float64)
                        if abs(np.linalg.det(M)) < 1e-6:
                            continue
                        a, c = np.linalg.solve(M, np.array([v2 - b, v4 - b], dtype=np.float64))
                        if not (0.005 < c < 0.15):
                            continue
                        v_pred = (a * y_m + b) / (c * y_m + 1.0)
                        if v_pred[5] < 0.22 * h or v_pred[0] > 0.968 * h:
                            continue
                        score = 0.0
                        hits = 0
                        for idx_l, vp in enumerate(v_pred):
                            iy = int(round(vp))
                            if 2 <= iy < h - 2:
                                lmax = float(np.max(h_smooth[iy - 2 : iy + 3]))
                                if lmax > 2.6:
                                    hits += 1
                                # Cap per-line peak magnitude so a single bright net tape (85+)
                                # never outweighs matching all 6 true horizontal BWF court lines.
                                score += (1.5 if idx_l in (0, 1, 2, 4, 5) else 1.0) * min(lmax, 32.0)
                        score += 28.0 * hits
                        if hits >= 5 and score > best_h_score:
                            best_h_score = score
                            best_h = (float(a), float(b), float(c), v_pred)

        if best_h is None:
            return None

        a, b, c, v_pred = best_h
        v_near = float(v_pred[0])
        v_far = float(v_pred[5])
        v_inf = float(a / c)

        R_v_smooth = cv2.GaussianBlur(R_v, (3, 1), 0)
        sample_vs = np.linspace(v_far + 6.0, v_near - 6.0, 40).astype(int)
        x_offsets = np.array([-3.05, -2.59, 0.0, 2.59, 3.05], dtype=np.float64) / 6.10
        scales_v = (sample_vs - v_inf) / (v_near - v_inf)

        best_v_score = -1e9
        best_u_inf = 0.5 * w
        best_w_near = 0.65 * w

        for u_inf in np.linspace(0.44 * w, 0.56 * w, 25):
            for w_near in np.linspace(0.40 * w, 0.88 * w, 61):
                total_s = 0.0
                for xi in x_offsets:
                    us = np.round(u_inf + (xi * w_near) * scales_v).astype(int)
                    valid_u = (us >= 4) & (us < w - 4)
                    if np.any(valid_u):
                        total_s += float(np.sum(R_v_smooth[sample_vs[valid_u], us[valid_u]]))
                if total_s > best_v_score:
                    best_v_score = total_s
                    best_u_inf = float(u_inf)
                    best_w_near = float(w_near)

        for u_inf in np.linspace(best_u_inf - 0.015 * w, best_u_inf + 0.015 * w, 21):
            for w_near in np.linspace(best_w_near - 0.025 * w, best_w_near + 0.025 * w, 25):
                total_s = 0.0
                for xi in x_offsets:
                    us = np.round(u_inf + (xi * w_near) * scales_v).astype(int)
                    valid_u = (us >= 4) & (us < w - 4)
                    if np.any(valid_u):
                        total_s += float(np.sum(R_v_smooth[sample_vs[valid_u], us[valid_u]]))
                if total_s > best_v_score:
                    best_v_score = total_s
                    best_u_inf = float(u_inf)
                    best_w_near = float(w_near)

        scale_far = (v_far - v_inf) / (v_near - v_inf)
        w_far = best_w_near * scale_far
        c_nl = (best_u_inf - 0.5 * best_w_near, v_near)
        c_nr = (best_u_inf + 0.5 * best_w_near, v_near)
        c_fr = (best_u_inf + 0.5 * w_far, v_far)
        c_fl = (best_u_inf - 0.5 * w_far, v_far)

        v_net_g = float((a * 6.70 + b) / (c * 6.70 + 1.0))
        scale_net = (v_net_g - v_inf) / (v_near - v_inf)
        w_net = best_w_near * scale_net
        u_net_l = best_u_inf - 0.5 * w_net
        u_net_r = best_u_inf + 0.5 * w_net

        wing_l1, wing_l2 = int(round(u_net_l + 6)), int(round(c_fl[0] - 6))
        wing_r1, wing_r2 = int(round(c_fr[0] + 6)), int(round(u_net_r - 6))
        net_y_min = max(10, int(round(v_net_g - 0.28 * h)))
        net_y_max = min(h - 10, int(round(v_net_g - 0.08 * h)))
        best_net_v = v_far - 0.025 * h
        if wing_l2 > wing_l1 + 8 and wing_r2 > wing_r1 + 8 and net_y_max > net_y_min + 4:
            wing_prof = 0.5 * (
                np.mean(R_h[net_y_min:net_y_max, wing_l1:wing_l2], axis=1)
                + np.mean(R_h[net_y_min:net_y_max, wing_r1:wing_r2], axis=1)
            )
            pk_net = int(np.argmax(wing_prof))
            if wing_prof[pk_net] > 4.0:
                best_net_v = float(net_y_min + pk_net)

        return {
            "corner_near_left": c_nl,
            "corner_near_right": c_nr,
            "corner_far_right": c_fr,
            "corner_far_left": c_fl,
            "net_post_left": (u_net_l, best_net_v),
            "net_post_right": (u_net_r, best_net_v),
            "net_tape_center": (0.5 * (u_net_l + u_net_r), best_net_v + 1.5 * scale),
        }

    @classmethod
    def auto_detect_court_keypoints(cls, frame_bgr: Optional[np.ndarray] = None, width: int = 1920, height: int = 1080) -> Dict:
        """
        Attempts automatic BWF court corner & white-line refinement on a video frame.
        First runs the zero-prior projective cross-ratio + vanishing-point court detector,
        then refines sub-pixel white line intersections via RANSAC, and verifies full
        12-segment & 4-outer-boundary line coverage so zoomed/angled replays are rejected.
        Returns { keypoints, reprojection_error_px, line_sample_rmse_px, segment_coverage_pct, outer_boundary_ok, auto_refined }.
        """
        if frame_bgr is not None:
            height, width = frame_bgr.shape[:2]

        kps = cls.default_keypoints_for_size(width, height)
        cal = cls("auto_detect", image_width=width, image_height=height)
        cal.set_keypoints({k: (v[0], v[1]) for k, v in kps.items()}, image_width=width, image_height=height)

        auto_refined = False
        cov = {
            "segment_hits_count": 0,
            "total_segments": 12,
            "segment_coverage_pct": 0.0,
            "outer_boundary_ok": False,
            "mean_line_hit_pct": 0.0,
            "green_in_poly_pct": 0.0,
        }
        if frame_bgr is not None:
            try:
                detected_kps = cls.detect_court_trapezoid_from_frame(frame_bgr)
                if detected_kps is not None:
                    cal_det = cls("auto_detect_proj", image_width=width, image_height=height)
                    cal_det.set_keypoints(detected_kps, image_width=width, image_height=height)
                    det_cov = cal_det.measure_court_line_coverage(frame_bgr)
                    if (
                        det_cov["green_in_poly_pct"] >= 55.0
                        and cal_det._validate_homography_geometry(cal_det.H_court_to_pixel, check_shift=False)
                        and cal_det.reprojection_error_px < 14.0
                    ):
                        cal = cal_det

                pre_cov = cal.measure_court_line_coverage(frame_bgr)
                if pre_cov["green_in_poly_pct"] >= 55.0:
                    line_rmse = cal.refine_with_white_lines(
                        frame_bgr, search_radius_px=max(12, int(round(18 * width / 1920.0)))
                    )
                    if line_rmse > 0.0:
                        # Second tight pass for crisp sub-pixel alignment across all 12 segments
                        cal.refine_with_white_lines(
                            frame_bgr, search_radius_px=max(6, int(round(8 * width / 1920.0)))
                        )

                cov = cal.measure_court_line_coverage(frame_bgr)
                if (
                    cov["outer_boundary_ok"]
                    and cov["segment_coverage_pct"] >= 58.0
                    and cov["green_in_poly_pct"] >= 55.0
                    and cal.reprojection_error_px < 10.0
                    and (cal.line_sample_rmse_px > 0.0 and cal.line_sample_rmse_px < 4.5)
                ):
                    auto_refined = True
                    if cal.K is not None and cal.rvec is not None and cal.tvec is not None:
                        net_pts = cal.project_3d_to_pixel(np.array([
                            cal.ref_3d_points["net_post_left"],
                            cal.ref_3d_points["net_post_right"],
                            cal.ref_3d_points["net_tape_center"],
                        ]))
                        cal.pixel_points["net_post_left"] = (float(net_pts[0, 0]), float(net_pts[0, 1]))
                        cal.pixel_points["net_post_right"] = (float(net_pts[1, 0]), float(net_pts[1, 1]))
                        cal.pixel_points["net_tape_center"] = (float(net_pts[2, 0]), float(net_pts[2, 1]))
            except Exception:
                pass

        out_kps = {
            k: [round(float(v[0]), 1), round(float(v[1]), 1)]
            for k, v in cal.pixel_points.items()
        }
        return {
            "keypoints": out_kps,
            "image_width": width,
            "image_height": height,
            "reprojection_error_px": round(cal.reprojection_error_px, 2),
            "line_sample_rmse_px": round(cal.line_sample_rmse_px, 2),
            "segment_coverage_pct": round(float(cov["segment_coverage_pct"]), 1),
            "outer_boundary_ok": bool(cov["outer_boundary_ok"]),
            "green_in_poly_pct": round(float(cov["green_in_poly_pct"]), 1),
            "auto_refined": auto_refined,
        }


def main():
    calibrator = CourtCalibrator("lzj_popov")

    # High-precision clicked / line-intersection keypoints (net posts on doubles sidelines)
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
    print(f"📐 Initial Reprojection Error (3D Keypoints): {calibrator.reprojection_error_px:.2f} px")

    # Refine against clear rally frame (frame 450 / 750)
    video_path = "assets/LZJvPopov.mp4"
    if os.path.exists(video_path):
        cap = cv2.VideoCapture(video_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, 450)
        ret, frame = cap.read()
        cap.release()
        if ret:
            calibrator.refine_with_white_lines(frame)
            print(f"✨ White-Line Refinement RMSE: {calibrator.line_sample_rmse_px:.2f} px")
            print(f"📐 Post-Refinement Reprojection Error: {calibrator.reprojection_error_px:.2f} px")

    out_json = calibrator.save_calibration()
    print(f"💾 Calibration saved to: {out_json}")


if __name__ == "__main__":
    main()
