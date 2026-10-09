"""
BWF Badminton Court Geometry & Camera Calibration Module
Implements:
- Official Badminton World Federation (BWF) regulation court dimensions
- 2D Planar Homography H (court ground plane <-> broadcast video pixels)
- 3D Camera Pose Estimation via cv2.solvePnP (P = K[R | t])
- 3D-to-2D projection and 2D-to-3D optical ray back-projection
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np
import cv2


@dataclass(frozen=True)
class BWFDimensions:
    """Official BWF Regulation Court Dimensions (all values in meters)"""
    length: float = 13.40              # Full court length (Y-axis)
    width: float = 6.10                # Full court doubles width (X-axis)
    singles_width: float = 5.18        # Singles court width
    tramline_width: float = 0.46       # (6.10 - 5.18) / 2
    net_y: float = 6.70                # Net position along Y-axis (midpoint)
    net_height_posts: float = 1.55     # Net height at posts
    net_height_center: float = 1.524   # Net height at center
    short_service_dist: float = 1.98   # Distance from net to short service line
    doubles_long_service_dist: float = 0.76  # Distance from baseline to doubles service line
    line_width: float = 0.04           # 40mm official line width

    @property
    def short_service_near_y(self) -> float:
        return self.net_y - self.short_service_dist  # 4.72m

    @property
    def short_service_far_y(self) -> float:
        return self.net_y + self.short_service_dist  # 8.68m

    @property
    def doubles_service_near_y(self) -> float:
        return self.doubles_long_service_dist        # 0.76m

    @property
    def doubles_service_far_y(self) -> float:
        return self.length - self.doubles_long_service_dist  # 12.64m

    @property
    def center_x(self) -> float:
        return self.width / 2.0                      # 3.05m


BWF = BWFDimensions()


class CourtGeometry:
    """
    Manages BWF 3D metric court coordinate system and transforms to/from camera pixel space.
    
    Court Coordinate System (Meters):
    - X in [0.0, 6.10]: 0 is court-left (singles tramline side), 6.10 is court-right
    - Y in [0.0, 13.40]: 0 is near baseline (Player 1 / LZJ), 13.40 is far baseline (Player 2 / SLY)
    - Z in [0.0, +inf]: Altitude above court surface in meters (net top is 1.55m)
    """

    def __init__(self):
        self.bwf = BWF
        self.H_pixel_to_court: Optional[np.ndarray] = None
        self.H_court_to_pixel: Optional[np.ndarray] = None
        self.camera_matrix_K: Optional[np.ndarray] = None
        self.dist_coeffs: Optional[np.ndarray] = None
        self.rvec: Optional[np.ndarray] = None
        self.tvec: Optional[np.ndarray] = None
        self.R: Optional[np.ndarray] = None
        self.camera_center: Optional[np.ndarray] = None

    def get_reference_3d_keypoints(self) -> Dict[str, np.ndarray]:
        """Returns standard 3D metric keypoints of the BWF court in meters [X, Y, Z]."""
        b = self.bwf
        return {
            # 4 Outer Doubles Corners (Ground Plane Z = 0)
            "corner_near_left": np.array([0.0, 0.0, 0.0], dtype=np.float64),
            "corner_near_right": np.array([b.width, 0.0, 0.0], dtype=np.float64),
            "corner_far_left": np.array([0.0, b.length, 0.0], dtype=np.float64),
            "corner_far_right": np.array([b.width, b.length, 0.0], dtype=np.float64),
            # Net Top Keypoints (Z = 1.55m at posts, 1.524m at center)
            "net_top_left": np.array([0.0, b.net_y, b.net_height_posts], dtype=np.float64),
            "net_top_right": np.array([b.width, b.net_y, b.net_height_posts], dtype=np.float64),
            "net_top_center": np.array([b.center_x, b.net_y, b.net_height_center], dtype=np.float64),
            # Short Service Lines (Ground Plane)
            "ssl_near_left": np.array([0.0, b.short_service_near_y, 0.0], dtype=np.float64),
            "ssl_near_right": np.array([b.width, b.short_service_near_y, 0.0], dtype=np.float64),
            "ssl_far_left": np.array([0.0, b.short_service_far_y, 0.0], dtype=np.float64),
            "ssl_far_right": np.array([b.width, b.short_service_far_y, 0.0], dtype=np.float64),
            # Center T-Junctions
            "t_junction_near": np.array([b.center_x, b.short_service_near_y, 0.0], dtype=np.float64),
            "t_junction_far": np.array([b.center_x, b.short_service_far_y, 0.0], dtype=np.float64),
        }

    def calibrate_homography(
        self,
        pixel_corners: np.ndarray,
        corner_order: Tuple[str, str, str, str] = (
            "corner_near_left",
            "corner_near_right",
            "corner_far_right",
            "corner_far_left",
        )
    ) -> np.ndarray:
        """
        Calibrates the 2D planar homography between camera image pixels and the court floor (Z=0).
        
        Args:
            pixel_corners: 4x2 array of pixel coordinates [(u, v)] in order specified by corner_order
            corner_order: Names of the 4 reference corners
            
        Returns:
            3x3 Homography matrix projecting court (X, Y) -> pixel (u, v)
        """
        ref_points = self.get_reference_3d_keypoints()
        court_pts = np.array([ref_points[k][:2] for k in corner_order], dtype=np.float32)
        pix_pts = np.array(pixel_corners, dtype=np.float32)

        # H_court_to_pixel maps (X, Y) -> (u, v)
        H_c2p, _ = cv2.findHomography(court_pts, pix_pts)
        self.H_court_to_pixel = H_c2p
        self.H_pixel_to_court = np.linalg.inv(H_c2p)
        return H_c2p

    def pixel_to_court(self, u: float, v: float) -> Tuple[float, float]:
        """Projects a 2D camera pixel (u, v) onto the court floor ground plane (X, Y, Z=0)."""
        if self.H_pixel_to_court is None:
            raise ValueError("Homography has not been calibrated. Call calibrate_homography() first.")
        p = np.array([u, v, 1.0], dtype=np.float64)
        c = self.H_pixel_to_court @ p
        if abs(c[2]) < 1e-8:
            return (0.0, 0.0)
        return float(c[0] / c[2]), float(c[1] / c[2])

    def court_to_pixel(self, x: float, y: float) -> Tuple[float, float]:
        """Projects a 2D court floor point (X, Y, Z=0) to camera image pixel (u, v)."""
        if self.H_court_to_pixel is None:
            raise ValueError("Homography has not been calibrated.")
        p = np.array([x, y, 1.0], dtype=np.float64)
        pix = self.H_court_to_pixel @ p
        if abs(pix[2]) < 1e-8:
            return (0.0, 0.0)
        return float(pix[0] / pix[2]), float(pix[1] / pix[2])

    def calibrate_camera_pnp(
        self,
        image_points: Dict[str, Tuple[float, float]],
        image_shape: Tuple[int, int] = (1080, 1920),
        fov_vertical_deg: float = 44.0
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Solves full 3D camera pose (K, R, t) using cv2.solvePnP from court correspondences.
        
        Args:
            image_points: Dictionary mapping court keypoint names to (u, v) image pixel coordinates
            image_shape: (height, width) of the video feed
            fov_vertical_deg: Approximate vertical field-of-view of broadcast TV camera (~44 degrees)
            
        Returns:
            (K, R, tvec): 3x3 camera matrix, 3x3 rotation matrix, 3x1 translation vector
        """
        h, w = image_shape
        focal_y = (h / 2.0) / np.tan(np.radians(fov_vertical_deg / 2.0))
        focal_x = focal_y  # Square pixels
        cx, cy = w / 2.0, h / 2.0

        K = np.array([
            [focal_x, 0.0, cx],
            [0.0, focal_y, cy],
            [0.0, 0.0, 1.0]
        ], dtype=np.float64)
        self.camera_matrix_K = K
        self.dist_coeffs = np.zeros(5, dtype=np.float64)  # Broadcast lenses are rectilinear

        ref_points = self.get_reference_3d_keypoints()
        obj_pts_list = []
        img_pts_list = []

        for name, pix in image_points.items():
            if name in ref_points:
                obj_pts_list.append(ref_points[name])
                img_pts_list.append([pix[0], pix[1]])

        if len(obj_pts_list) < 4:
            raise ValueError(f"Need at least 4 keypoints for solvePnP, got {len(obj_pts_list)}")

        obj_pts = np.array(obj_pts_list, dtype=np.float64)
        img_pts = np.array(img_pts_list, dtype=np.float64)

        success, rvec, tvec = cv2.solvePnP(
            obj_pts,
            img_pts,
            K,
            self.dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not success:
            raise RuntimeError("solvePnP failed to converge on court keypoints")

        self.rvec = rvec
        self.tvec = tvec
        R, _ = cv2.Rodrigues(rvec)
        self.R = R

        # Optical center in world coordinates: C = -R^T * t
        self.camera_center = -R.T @ tvec.reshape(-1)
        return K, R, tvec

    def project_3d_to_pixel(self, x: float, y: float, z: float) -> Tuple[float, float]:
        """Projects any 3D metric coordinate (X, Y, Z) in meters to image pixel (u, v)."""
        if self.R is None or self.tvec is None or self.camera_matrix_K is None:
            # Fall back to 2D homography if 3D camera is not calibrated
            return self.court_to_pixel(x, y)

        pt_world = np.array([x, y, z], dtype=np.float64).reshape(3, 1)
        pt_cam = self.R @ pt_world + self.tvec.reshape(3, 1)
        if pt_cam[2] <= 0:
            return (-1.0, -1.0)  # Behind camera

        pt_proj = self.camera_matrix_K @ pt_cam
        u = float(pt_proj[0] / pt_proj[2])
        v = float(pt_proj[1] / pt_proj[2])
        return u, v

    def pixel_to_ray(self, u: float, v: float) -> Tuple[np.ndarray, np.ndarray]:
        """
        Back-projects a 2D pixel (u, v) into a 3D optical ray origin C and unit direction d.
        
        Returns:
            (origin, direction): Both are 3D numpy vectors in world coordinates (meters)
        """
        if self.R is None or self.camera_center is None or self.camera_matrix_K is None:
            raise ValueError("Full 3D camera calibration required for ray back-projection")

        # Unproject pixel into camera coordinates
        pix_homo = np.array([u, v, 1.0], dtype=np.float64)
        ray_cam = np.linalg.inv(self.camera_matrix_K) @ pix_homo
        # Rotate into world coordinates
        ray_world = self.R.T @ ray_cam
        ray_dir = ray_world / np.linalg.norm(ray_world)

        return self.camera_center.copy(), ray_dir
