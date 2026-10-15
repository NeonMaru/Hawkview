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

    def refine_with_white_lines(self, frame_bgr: np.ndarray, search_radius_px: int = 12) -> float:
        """
        Samples visible white court lines across the court, searches for sub-pixel intensity peaks
        perpendicular to each line, and refines the homography and camera pose.
        Returns the measured line-sample RMSE in pixels.
        """
        if self.H_court_to_pixel is None:
            raise ValueError("Initial calibration must be set before line refinement.")

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

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

        for x1, y1, x2, y2, orient in segments:
            num_samples = 25
            xs = np.linspace(x1, x2, num_samples)
            ys = np.linspace(y1, y2, num_samples)
            for cx, cy in zip(xs, ys):
                p = self.H_court_to_pixel @ np.array([cx, cy, 1.0])
                u, v = p[0] / p[2], p[1] / p[2]
                ix, iy = int(round(u)), int(round(v))
                if ix < 30 or ix >= w_img - 30 or iy < 30 or iy >= h_img - 30:
                    continue

                if orient == "h":
                    r = search_radius_px
                    window = gray[iy - r : iy + r + 1, ix].astype(np.float64)
                    if np.max(window) > 155:
                        pk = np.argmax(window)
                        if 0 < pk < len(window) - 1:
                            dy = (window[pk + 1] - window[pk - 1]) / (
                                2.0 * (2.0 * window[pk] - window[pk - 1] - window[pk + 1]) + 1e-6
                            )
                            target_v = iy - r + pk + dy
                            sample_court_pts.append([cx, cy])
                            sample_target_pix.append([u, target_v])
                else:
                    r = search_radius_px
                    window = gray[iy, ix - r : ix + r + 1].astype(np.float64)
                    if np.max(window) > 155:
                        pk = np.argmax(window)
                        if 0 < pk < len(window) - 1:
                            dx = (window[pk + 1] - window[pk - 1]) / (
                                2.0 * (2.0 * window[pk] - window[pk - 1] - window[pk + 1]) + 1e-6
                            )
                            target_u = ix - r + pk + dx
                            sample_court_pts.append([cx, cy])
                            sample_target_pix.append([target_u, v])

        if len(sample_court_pts) >= 20:
            sample_court_pts = np.array(sample_court_pts, dtype=np.float32)
            sample_target_pix = np.array(sample_target_pix, dtype=np.float32)

            # Refine H using RANSAC to eliminate player / logo occlusions
            H_ref, inlier_mask = cv2.findHomography(
                sample_court_pts, sample_target_pix, cv2.RANSAC, 4.0
            )
            if H_ref is not None:
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

                # Update 3D camera pose and reprojection error with refined points
                self._solve_camera_pose()

                # Calculate inlier line RMSE
                proj_lines = cv2.perspectiveTransform(sample_court_pts.reshape(-1, 1, 2), H_ref).reshape(-1, 2)
                err_lines = np.linalg.norm(proj_lines - sample_target_pix, axis=1)
                inliers = err_lines[inlier_mask.ravel() == 1]
                self.line_sample_rmse_px = float(np.sqrt(np.mean(inliers ** 2))) if len(inliers) > 0 else 0.0

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
    def auto_detect_court_keypoints(cls, frame_bgr: Optional[np.ndarray] = None, width: int = 1920, height: int = 1080) -> Dict:
        """
        Attempts automatic BWF court corner & white-line refinement on a video frame.
        Returns { keypoints, reprojection_error_px, line_sample_rmse_px, auto_refined }.
        """
        if frame_bgr is not None:
            height, width = frame_bgr.shape[:2]

        kps = cls.default_keypoints_for_size(width, height)
        cal = cls("auto_detect", image_width=width, image_height=height)
        cal.set_keypoints({k: (v[0], v[1]) for k, v in kps.items()}, image_width=width, image_height=height)

        auto_refined = False
        if frame_bgr is not None:
            try:
                line_rmse = cal.refine_with_white_lines(frame_bgr, search_radius_px=max(12, int(round(16 * width / 1920.0))))
                if line_rmse > 0.0 and line_rmse < 5.0 and cal.reprojection_error_px < 12.0:
                    auto_refined = True
                    # Also project updated 3D net posts if corners shifted slightly
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
