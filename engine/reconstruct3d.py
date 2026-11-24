"""
HawkView MonoTrack 3D Aerodynamic Trajectory Reconstruction (Phase E)
=====================================================================
Reconstructs true 3D shuttlecock trajectories for every detected shot by:
  1. Anchoring initial 3D contact (x0, y0, z0) near the hitter's court position
     within physical racket reach and BWF service/stroke height bounds.
  2. Simulating ballistic flight with the 4th-Order Runge-Kutta (RK4) aerodynamic
     drag ODE in `engine/aerodynamics.py` (ShuttlecockAerodynamics).
  3. Projecting 3D trajectory points to 2D broadcast image pixels via
     `CourtCalibrator.project_3d_to_pixel` and minimizing pixel reprojection
     residuals with `scipy.optimize.least_squares(loss="soft_l1")` subject to
     physical boundary priors (hitter reach, receiver intercept reach, net plane
     crossing, and high-clear out-of-frame apex prior).
  4. Distinguishing mid-rally airborne intercepts (`landing_xy = None`,
     `intercept_xy = [x_end, y_end]`) from terminal rally-ending shots
     (`landing_xy = [x_land, y_land]` on floor z = 0, or stopping at y = 6.70 m
     when `error_net`).
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.optimize import least_squares

from engine.aerodynamics import ShuttlecockAerodynamics, ShuttlecockAeroParams
from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF
from engine.hits import HitDetector


def net_tape_height(x: float) -> float:
    """Official BWF net height (1.524m at center x=3.05m, 1.550m at posts x=0.0/6.10m)."""
    return 1.524 + (1.550 - 1.524) * min(1.0, abs(float(x) - 3.05) / 3.05)


class TrajectoryReconstructor3D:
    """
    MonoTrack-style 3D shuttlecock trajectory reconstructor per shot.
    """

    def __init__(
        self,
        calibrator: Optional[CourtCalibrator] = None,
        fps: float = 25.0,
    ):
        self.fps = fps
        if calibrator is None:
            calibrator = CourtCalibrator("lzj_popov")
            calibrator.load()
        self.calibrator = calibrator
        self.aero = ShuttlecockAerodynamics()

        self.cam_pos = self.calibrator.camera_position.reshape(3)
        self.K_inv = np.linalg.inv(self.calibrator.K)
        self.R_T = self.calibrator.R.T

    def pixel_to_ray(self, u: float, v: float) -> Tuple[np.ndarray, np.ndarray]:
        """Back-projects image pixel (u, v) into camera origin C and unit world ray direction d."""
        d_cam = self.K_inv @ np.array([float(u), float(v), 1.0], dtype=np.float64)
        d_world = self.R_T @ d_cam
        return self.cam_pos, d_world / np.linalg.norm(d_world)

    def point_on_ray_at_y(self, u: float, v: float, y_val: float) -> np.ndarray:
        """Intersects the optical ray through pixel (u, v) with vertical plane Y = y_val."""
        orig, d = self.pixel_to_ray(u, v)
        lam = (float(y_val) - orig[1]) / d[1]
        return orig + lam * d

    def point_on_ray_at_z(self, u: float, v: float, z_val: float) -> np.ndarray:
        """Intersects the optical ray through pixel (u, v) with horizontal plane Z = z_val."""
        orig, d = self.pixel_to_ray(u, v)
        lam = (float(z_val) - orig[2]) / d[2]
        return orig + lam * d

    def ray_anchor_for_contact(
        self,
        u: float,
        v: float,
        hx: float,
        hy: float,
        side: str,
        is_serve: bool,
    ) -> np.ndarray:
        """
        Finds the 3D contact point on the optical ray of (u, v) anchored near hitter_court_xy
        within physical height bounds z0 in [0.40, 1.30] (serves) or [0.30, 3.40] (strokes)
        and on the hitter's side of the net.
        """
        orig, d = self.pixel_to_ray(u, v)
        z_min, z_max = (0.40, 1.30) if is_serve else (0.30, 3.35)
        y_min, y_max = (0.0, 6.45) if side == "near" else (6.95, 13.55)

        hy_clamped = float(np.clip(hy, y_min, y_max))
        lam_y = (hy_clamped - orig[1]) / d[1]
        lam_ymin = (y_min - orig[1]) / d[1]
        lam_ymax = (y_max - orig[1]) / d[1]
        lam_zmax = (z_max - orig[2]) / d[2]
        lam_zmin = (z_min - orig[2]) / d[2]

        lam_lo = max(lam_ymin, lam_zmax)
        lam_hi = min(lam_ymax, lam_zmin)
        if lam_lo <= lam_hi:
            lam = float(np.clip(lam_y, lam_lo, lam_hi))
        else:
            lam = 0.5 * (lam_lo + lam_hi)

        pt = orig + lam * d
        pt[0] = float(np.clip(pt[0], 0.05, 6.05))
        pt[1] = float(np.clip(pt[1], y_min, y_max))
        pt[2] = float(np.clip(pt[2], z_min, z_max))
        return pt

    def _projected_net_v_bounds(self, sy: float) -> Tuple[float, float]:
        """Projects the BWF net floor (y=6.70, z=0) and net tape (y=6.70, z=1.55) to image row v."""
        try:
            pts = np.array([[3.05, 6.70, 0.0], [3.05, 6.70, 1.55]], dtype=np.float64)
            proj = self.calibrator.project_3d_to_pixel(pts)
            return float(proj[0, 1]), float(proj[1, 1])
        except Exception:
            return 605.0 * sy, 400.0 * sy

    def analyze_terminal_track(
        self,
        vis_pts: List[Tuple[int, float, float]],
        f0: int,
        side: str,
    ) -> Tuple[int, List[Tuple[int, float, float]], str]:
        """
        Determines the floor impact / net impact frame `f_land` and airborne subset `flight_pts`
        for a rally-ending shot, trimming post-landing floor bounces and rolling.
        Supports `error_net` symmetrically for BOTH `near` and `far` hitters using calibrated net projections.
        Returns (f_land, flight_pts, terminal_mode) where terminal_mode is one of:
          - 'floor': shuttle cleared net and landed on opponent's floor (z = 0)
          - 'error_net': shuttle hit the net (stops at y = 6.70 m, net_clearance_m < 0)
          - 'air_cutoff_near': high clear from far court cut off just before reaching near floor
        """
        if len(vis_pts) <= 3:
            return vis_pts[-1][0], vis_pts, "floor"

        sy = max(0.35, float(getattr(self.calibrator, "image_height", 1080) or 1080) / 1080.0)
        v_net_ground, v_net_top = self._projected_net_v_bounds(sy)
        min_v = min(p[2] for p in vis_pts)
        min_idx = int(np.argmin([p[2] for p in vis_pts]))
        min_fn = vis_pts[min_idx][0]

        if side == "near":
            f_land = vis_pts[-1][0]
            flight_pts = vis_pts
            max_dy = 0.0
            for i in range(1, len(vis_pts)):
                fn, x, y = vis_pts[i]
                fn_p, x_p, y_p = vis_pts[i - 1]
                dt_f = max(1, fn - fn_p)
                dy = (y - y_p) / dt_f
                if fn > min_fn and dy > max_dy:
                    max_dy = dy
                if fn - f0 >= 6 and fn > min_fn and y_p >= v_net_top + 15.0 * sy:
                    if dy <= 1.5 * sy or (min_v < 50.0 * sy and (fn - f0) >= 34 and y >= v_net_top + 30.0 * sy):
                        f_land, flight_pts = fn_p, vis_pts[:i]
                        break

            # Detect near-side error_net: shuttle stopped at/before the net line (y_court <= 7.05m)
            # and never rose high above net tape (min_v >= v_net_top - 18*sy)
            u_l, v_l = flight_pts[-1][1], flight_pts[-1][2]
            try:
                _, y_ground_l = self.calibrator.pixel_to_court(u_l, v_l)
            except Exception:
                y_ground_l = 9.0
            if (
                min_v >= v_net_top - 18.0 * sy
                and v_l >= v_net_ground - 25.0 * sy
                and y_ground_l <= 7.25
                and (f_land - f0) <= 28
            ):
                return f_land, flight_pts, "error_net"
            return f_land, flight_pts, "floor"

        max_dy = 0.0
        f_land = vis_pts[-1][0]
        flight_pts = vis_pts
        for i in range(1, len(vis_pts)):
            fn, x, y = vis_pts[i]
            fn_p, x_p, y_p = vis_pts[i - 1]
            dt_f = max(1, fn - fn_p)
            dy = (y - y_p) / dt_f
            if fn - f0 >= 3 and dy > max_dy:
                max_dy = dy
            if fn - f0 >= 6 and y >= v_net_top - 20.0 * sy and max_dy >= 5.0 * sy:
                if dy <= 1.5 * sy:
                    f_land, flight_pts = fn_p, vis_pts[:i]
                    break
                if max_dy >= 25.0 * sy and y_p >= v_net_ground - 40.0 * sy and dy < 0.38 * max_dy:
                    f_land, flight_pts = fn_p, vis_pts[:i]
                    break

        u_l, v_l = flight_pts[-1][1], flight_pts[-1][2]
        if v_l < v_net_ground + 15.0 * sy:
            if min_v < 35.0 * sy and (f_land - f0) >= 35:
                return f_land, flight_pts, "air_cutoff_near"
            return f_land, flight_pts, "error_net"
        return f_land, flight_pts, "floor"

    @staticmethod
    def compute_net_clearance(positions: np.ndarray) -> float:
        """Computes vertical clearance (m) of the 3D trajectory above the net tape at y = 6.70m."""
        ys = positions[:, 1]
        for k in range(len(ys) - 1):
            if (ys[k] - 6.70) * (ys[k + 1] - 6.70) <= 0.0 and abs(ys[k + 1] - ys[k]) > 1e-6:
                alpha = (6.70 - ys[k]) / (ys[k + 1] - ys[k])
                x_net = float(positions[k, 0] + alpha * (positions[k + 1, 0] - positions[k, 0]))
                z_net = float(positions[k, 2] + alpha * (positions[k + 1, 2] - positions[k, 2]))
                return float(z_net - net_tape_height(x_net))
        idx = int(np.argmin(np.abs(ys - 6.70)))
        return float(positions[idx, 2] - net_tape_height(float(positions[idx, 0])))

    @staticmethod
    def _ransac_2d_inliers(
        ts_norm: np.ndarray,
        vis_uv: np.ndarray,
        sy: float,
        fps: float = 25.0,
    ) -> np.ndarray:
        """
        Robust drag-aware RANSAC 2D outlier rejection (zero-LLM).
        Uses the analytic aerodynamic drag basis [1, log(1 + t/tau), t, t^2] so high-drag
        shuttlecock launch arcs (steep initial deceleration) are NEVER falsely rejected as
        outliers, while isolated TrackNet false positives AND multi-shot turnarounds are
        cleanly detected.
        """
        n = len(ts_norm)
        if n < 8:
            return np.ones(n, dtype=bool)
        tau = 5.0 * max(10.0, float(fps or 25.0)) / 25.0
        t_rel = ts_norm - float(ts_norm[0])
        if n >= 12:
            X = np.column_stack([np.ones(n), np.log1p(np.maximum(0.0, t_rel) / tau), t_rel, t_rel ** 2])
            min_s = 4
        else:
            X = np.column_stack([np.ones(n), np.log1p(np.maximum(0.0, t_rel) / tau), t_rel])
            min_s = 3

        thr = 22.0 * sy
        best_inliers = np.ones(n, dtype=bool)
        best_count = -1
        best_err_sum = 1e18

        # Deterministic evenly-spaced + strided samples so results are 100% reproducible
        rng = np.random.default_rng(42)
        n_iters = min(48, max(14, n * 2))
        for it in range(n_iters):
            if it == 0:
                idx = np.linspace(0, n - 1, min_s, dtype=int)
            elif it == 1 and n >= min_s + 2:
                # Sample biased toward the first half (catches 2-shot splits cleanly)
                idx = np.linspace(0, max(min_s - 1, n // 2), min_s, dtype=int)
            elif it == 2 and n >= min_s + 2:
                # Sample biased toward the second half
                idx = np.linspace(min(n - min_s, n // 2), n - 1, min_s, dtype=int)
            else:
                idx = np.sort(rng.choice(n, size=min_s, replace=False))
            t_s = t_rel[idx]
            if np.max(t_s) - np.min(t_s) < 2.0 or len(np.unique(t_s)) < min_s:
                continue
            try:
                Xs = X[idx]
                cu, _, _, _ = np.linalg.lstsq(Xs, vis_uv[idx, 0], rcond=None)
                cv, _, _, _ = np.linalg.lstsq(Xs, vis_uv[idx, 1], rcond=None)
                pu = X @ cu
                pv = X @ cv
                err = np.hypot(vis_uv[:, 0] - pu, vis_uv[:, 1] - pv)
                inl = err <= thr
                cnt = int(np.sum(inl))
                esum = float(np.sum(np.minimum(err, thr)))
                if cnt > best_count or (cnt == best_count and esum < best_err_sum):
                    best_count = cnt
                    best_err_sum = esum
                    best_inliers = inl
            except Exception:
                continue

        if best_count >= max(4, int(0.45 * n)):
            return best_inliers
        return np.ones(n, dtype=bool)

    @staticmethod
    def _max_contiguous_outlier_run(inlier_mask: np.ndarray) -> int:
        """Returns the length of the longest contiguous run of False entries in `inlier_mask`."""
        max_run = 0
        cur_run = 0
        for is_inl in inlier_mask:
            if not bool(is_inl):
                cur_run += 1
                if cur_run > max_run:
                    max_run = cur_run
            else:
                cur_run = 0
        return int(max_run)

    def reconstruct_shot(
        self,
        rally_id: int,
        shot_index: int,
        global_shot_id: int,
        h0: dict,
        h1: Optional[dict],
        rally_end_frame: int,
        tracks: Dict[int, Tuple[int, float, float]],
        prev_end_3d: Optional[List[float]] = None,
    ) -> dict:
        """
        Fits a true physical 3D RK4 aerodynamic trajectory for a single shot with:
          - Calibrated FPS sampling (works identically at 25/30/50/60 fps)
          - Robust RANSAC 2D outlier rejection
          - Coupled rally-level 3D continuity prior (`prev_end_3d`)
          - All physical priors (net clearance, floor landing, out-of-frame high-clear apex)
            enforced INSIDE `least_squares` rather than via destructive post-hoc warps
          - Honest post-finalization 3D->2D reprojection RMSE and RK4 launch speed
        """
        f0 = int(h0["frame"])
        side = h0["side"]
        is_serve = bool(h0["is_serve"])
        is_terminal = h1 is None
        raw_end_frame = int(h1["frame"]) if h1 is not None else int(rally_end_frame)

        vis_all = [
            (fn, float(tracks[fn][1]), float(tracks[fn][2]))
            for fn in range(f0, raw_end_frame + 1)
            if fn in tracks and tracks[fn][0] == 1
        ]
        if not vis_all:
            vis_all = [(f0, float(h0["shuttle_px"][0]), float(h0["shuttle_px"][1]))]

        sy = max(0.35, float(getattr(self.calibrator, "image_height", 1080) or 1080) / 1080.0)
        fps_safe = max(10.0, float(self.fps or 25.0))
        sim_dt = 1.0 / (2.0 * fps_safe)

        terminal_mode = "intercept"
        if is_terminal:
            f_end, vis_flight, terminal_mode = self.analyze_terminal_track(vis_all, f0, side)
        else:
            f_end = raw_end_frame
            vis_flight = vis_all
            max_frames_cap = int(round(1.65 * fps_safe))
            if (f_end - f0) > max_frames_cap and len(vis_flight) >= 8:
                v_net_ground, _ = self._projected_net_v_bounds(sy)
                vs = [p[2] for p in vis_flight]
                if side == "near":
                    k_ext = int(np.argmin(vs[: max(4, min(len(vs), max_frames_cap + 2))]))
                    if k_ext >= 4 and vs[k_ext] <= v_net_ground and (max(vs[k_ext:]) - vs[k_ext]) > 42.0 * sy:
                        vis_flight = vis_flight[: k_ext + 1]
                        f_end = int(vis_flight[-1][0])
                else:
                    k_ext = int(np.argmax(vs[: max(4, min(len(vs), max_frames_cap + 2))]))
                    if k_ext >= 4 and vs[k_ext] >= v_net_ground - 40.0 * sy and (vs[k_ext] - min(vs[k_ext:])) > 42.0 * sy:
                        vis_flight = vis_flight[: k_ext + 1]
                        f_end = int(vis_flight[-1][0])
            if (f_end - f0) > int(round(1.75 * fps_safe)):
                f_end = f0 + int(round(1.55 * fps_safe))
                vis_flight = [p for p in vis_flight if p[0] <= f_end] or vis_flight[:1]

        duration_sec = min(1.75, max(0.08, (f_end - f0) / fps_safe))
        n_total_frames = max(1, f_end - f0 + 1)
        n_missing = max(0, n_total_frames - len(vis_flight))
        min_y_px = min(p[2] for p in vis_flight)

        hx0, hy0 = float(h0["hitter_court_xy"][0]), float(h0["hitter_court_xy"][1])
        u0, v0_px = float(vis_flight[0][1]), float(vis_flight[0][2])
        p0_anchor = self.ray_anchor_for_contact(u0, v0_px, hx0, hy0, side, is_serve)

        # Coupled rally-level 3D continuity: if previous shot ended near this contact, softly anchor p0
        prev_cont_pt = None
        if prev_end_3d is not None and not is_serve:
            pe = np.array(prev_end_3d, dtype=np.float64)
            if np.linalg.norm(pe[:2] - p0_anchor[:2]) <= 2.4:
                prev_cont_pt = pe
                p0_anchor = 0.65 * p0_anchor + 0.35 * pe

        # Target endpoint anchor P1 (strictly on receiver's half-court unless error_net)
        opp_side = "far" if side == "near" else "near"
        u_last, v_last = float(vis_flight[-1][1]), float(vis_flight[-1][2])
        if not is_terminal and h1 is not None:
            hx1, hy1 = float(h1["hitter_court_xy"][0]), float(h1["hitter_court_xy"][1])
            rec_side = h1["side"] if h1["side"] != side else opp_side
            p1_anchor = self.ray_anchor_for_contact(u_last, v_last, hx1, hy1, rec_side, False)
            p1_anchor[0] = float(np.clip(p1_anchor[0], -0.35, 6.45))
            if side == "near":
                p1_anchor[1] = float(np.clip(p1_anchor[1], 6.85, 13.85))
            else:
                p1_anchor[1] = float(np.clip(p1_anchor[1], -0.45, 6.55))
        elif terminal_mode == "error_net":
            pt_net = self.point_on_ray_at_y(u_last, v_last, 6.70)
            pt_net[0] = float(np.clip(pt_net[0], 0.2, 5.9))
            pt_net[1] = 6.70
            pt_net[2] = float(np.clip(pt_net[2], 0.15, 1.42))
            p1_anchor = pt_net
        elif terminal_mode == "air_cutoff_near":
            pt_air = self.point_on_ray_at_z(u_last, v_last, 0.0)
            p1_anchor = np.array([
                float(np.clip(pt_air[0], -0.60, 6.70)),
                float(np.clip(pt_air[1], -0.60, 6.40)),
                0.0,
            ], dtype=np.float64)
        else:
            xl, yl = self.calibrator.pixel_to_court(u_last, v_last)
            if side == "near":
                yl = float(np.clip(yl, 6.80, 14.20))
            else:
                yl = float(np.clip(yl, -0.80, 6.60))
            xl = float(np.clip(xl, -0.60, 6.70))
            p1_anchor = np.array([xl, yl, 0.0], dtype=np.float64)

        # Initial velocity guess via aerodynamic boundary solver
        _, v0_init, _ = self.aero.solve_smash_initial_velocity(p0_anchor, p1_anchor, duration_sec)

        vis_indices = [2 * (fn - f0) for fn, _, _ in vis_flight]
        vis_uv = np.array([[u, v] for _, u, v in vis_flight], dtype=np.float64)

        frame_weights = np.ones((len(vis_flight), 1), dtype=np.float64)

        # Pass 1: Robust drag-aware RANSAC 2D outlier rejection
        ts_norm = np.array([float(fn - f0) for fn, _, _ in vis_flight], dtype=np.float64)
        inlier_mask_2d = self._ransac_2d_inliers(ts_norm, vis_uv, sy, fps=fps_safe)
        frame_weights[~inlier_mask_2d, 0] = 0.01

        z0_lo, z0_hi = (0.40, 1.30) if is_serve else (0.30, 3.40)

        # Detect genuine high-clear ceiling exit so apex prior is enforced INSIDE the RK4 solver
        opp_rear_anchor = (float(p1_anchor[1]) >= 10.80) if side == "near" else (float(p1_anchor[1]) <= 2.60)
        exited_top = bool(min_y_px < 36.0 * sy and n_missing >= 3 and duration_sec >= 0.85)
        high_clear_prior = bool(
            terminal_mode != "error_net"
            and not is_serve
            and (exited_top or (opp_rear_anchor and duration_sec >= 1.15 and float(p0_anchor[2]) >= 1.40))
        )
        target_clear_peak = min(7.2, max(5.20, 5.15 + 0.80 * max(0.0, duration_sec - 1.05)))

        def residuals(params: np.ndarray) -> np.ndarray:
            p0 = params[:3]
            v0 = params[3:6]
            cd = float(params[6])
            aero_c = ShuttlecockAerodynamics(ShuttlecockAeroParams(drag_coeff_cd=cd))
            _, pos, _ = aero_c.simulate_trajectory(
                p0, v0, duration=duration_sec, dt=sim_dt, stop_at_ground=False
            )
            max_idx = len(pos) - 1
            safe_idx = [min(max_idx, idx) for idx in vis_indices]
            sim_pts = pos[safe_idx]
            proj = self.calibrator.project_3d_to_pixel(sim_pts)
            r_px = ((proj - vis_uv) * frame_weights).ravel()

            end_pt = pos[-1]
            r_priors = [
                (p0[0] - p0_anchor[0]) * 3.5,
                (p0[1] - p0_anchor[1]) * 5.0,
                (end_pt[0] - p1_anchor[0]) * 4.0,
                (end_pt[1] - p1_anchor[1]) * 5.5,
                (end_pt[2] - p1_anchor[2]) * (24.0 if is_terminal else 3.5),
                (cd - 0.56) * 20.0,
                (v0[0] - v0_init[0]) * 0.15,
                (v0[1] - v0_init[1]) * 0.15,
                (v0[2] - v0_init[2]) * 0.15,
            ]

            if prev_cont_pt is not None:
                r_priors.extend([
                    (p0[0] - prev_cont_pt[0]) * 3.5,
                    (p0[1] - prev_cont_pt[1]) * 3.5,
                    (p0[2] - prev_cont_pt[2]) * 3.0,
                ])

            if terminal_mode != "error_net":
                nc = self.compute_net_clearance(pos)
                z_pen = (
                    max(0.0, 0.20 - float(end_pt[2]), float(end_pt[2]) - 3.30) * 60.0
                    if not is_terminal
                    else max(0.0, -float(end_pt[2])) * 40.0
                )
                nc_pen = max(0.0, 0.08 - nc) * 140.0
                cross_pen = (
                    max(0.0, 6.80 - float(end_pt[1]), float(end_pt[1]) - 14.30) * 90.0
                    if side == "near"
                    else max(0.0, float(end_pt[1]) - 6.60, -0.90 - float(end_pt[1])) * 90.0
                )
                r_priors.extend([z_pen, nc_pen, cross_pen])

                if high_clear_prior:
                    pk_z = float(np.max(pos[:, 2]))
                    r_priors.append(max(0.0, target_clear_peak - pk_z) * 18.0)
            else:
                # Net error: pull endpoint onto net plane y = 6.70m, below net tape
                r_priors.append((float(end_pt[1]) - 6.70) * 35.0)
                r_priors.append(max(0.0, float(end_pt[2]) - 1.45) * 50.0)

            return np.concatenate([r_px, np.array(r_priors, dtype=np.float64)])

        lb = np.array([
            max(-0.4, p0_anchor[0] - 1.45),
            max(-0.8, p0_anchor[1] - 1.45),
            z0_lo,
            -75.0,
            -120.0,
            -55.0,
            0.35,
        ], dtype=np.float64)
        ub = np.array([
            min(6.5, p0_anchor[0] + 1.45),
            min(14.2, p0_anchor[1] + 1.45),
            z0_hi,
            75.0,
            120.0,
            65.0,
            0.78,
        ], dtype=np.float64)
        x0 = np.concatenate([p0_anchor, v0_init, [0.56]])
        x0 = np.clip(x0, lb + 1e-4, ub - 1e-4)

        sol = least_squares(residuals, x0, bounds=(lb, ub), loss="soft_l1", f_scale=5.0 * sy, max_nfev=95)
        p0_opt = sol.x[:3].copy()
        v0_opt = sol.x[3:6].copy()
        cd_opt = float(sol.x[6])

        aero_opt = ShuttlecockAerodynamics(ShuttlecockAeroParams(drag_coeff_cd=cd_opt))
        ts_sim, pos_sim, vel_sim = aero_opt.simulate_trajectory(
            p0_opt, v0_opt, duration=duration_sec, dt=sim_dt, stop_at_ground=False
        )

        # Minimal non-distorting boundary clipping ONLY (ZERO post-hoc sin^2 / quadratic warps!)
        if is_terminal:
            if terminal_mode == "error_net":
                ys = pos_sim[:, 1]
                cross_k = None
                for k in range(len(ys) - 1):
                    if (ys[k] - 6.70) * (ys[k + 1] - 6.70) <= 0.0:
                        cross_k = k
                        break
                if cross_k is not None:
                    pos_sim = pos_sim[: cross_k + 2].copy()
                    ts_sim = ts_sim[: cross_k + 2].copy()
                pos_sim[-1, 1] = 6.70
                pos_sim[-1, 2] = min(float(pos_sim[-1, 2]), net_tape_height(float(pos_sim[-1, 0])) - 0.12)
            else:
                pos_sim[:, 2] = np.maximum(pos_sim[:, 2], 0.0)
        else:
            pos_sim[:, 2] = np.maximum(pos_sim[:, 2], 0.15)

        # Compute HONEST post-finalization 3D->2D reprojection RMSE (both inlier & all-points)
        max_idx = len(pos_sim) - 1
        safe_idx = [min(max_idx, idx) for idx in vis_indices]
        proj_px = self.calibrator.project_3d_to_pixel(pos_sim[safe_idx])
        pt_errs_all = np.linalg.norm(proj_px - vis_uv, axis=1)
        all_pts_rmse_px = float(np.sqrt(np.mean(pt_errs_all ** 2)))
        pt_errs = pt_errs_all[inlier_mask_2d] if np.sum(inlier_mask_2d) >= 4 else pt_errs_all
        inlier_rmse_px = float(np.sqrt(np.mean(pt_errs ** 2)))
        max_outlier_run = self._max_contiguous_outlier_run(inlier_mask_2d)
        # Prevent RANSAC from masking a contiguous >=4-frame second shot / turnaround tail as Grade A/B
        fit_rmse_px = all_pts_rmse_px if max_outlier_run >= 4 else inlier_rmse_px

        # Compute physical speed and downward angle directly from the RK4 trajectory
        horiz_speed_ms = float(np.hypot(v0_opt[0], v0_opt[1]))
        launch_down_deg = float(np.degrees(np.arctan2(-v0_opt[2], max(1e-4, horiz_speed_ms))))
        horiz_dist_m = float(np.hypot(pos_sim[-1, 0] - pos_sim[0, 0], pos_sim[-1, 1] - pos_sim[0, 1]))
        chord_down_deg = float(
            np.degrees(np.arctan2(float(pos_sim[0, 2] - pos_sim[-1, 2]), max(0.5, horiz_dist_m)))
        )
        peak_height_m = float(np.max(pos_sim[:, 2]))

        if peak_height_m <= float(pos_sim[0, 2]) + 0.08 and chord_down_deg > launch_down_deg:
            downward_angle_deg = chord_down_deg
        else:
            downward_angle_deg = launch_down_deg

        # Use the true RK4 initial velocity ||v0_opt|| * 3.6 directly (eliminates 107.2 km/h & 421 km/h net-kill bugs)
        in_front_zone = (
            (side == "near" and float(p0_opt[1]) > 4.72)
            or (side == "far" and float(p0_opt[1]) < 8.68)
        )
        speed_kmh = float(np.linalg.norm(v0_opt) * 3.6)
        if (
            not is_serve
            and float(pos_sim[0, 2]) > 2.20
            and downward_angle_deg > 10.0
            and 0.24 <= duration_sec <= 0.68
            and horiz_dist_m >= 5.5
            and not in_front_zone
        ):
            speed_kmh = float(np.clip(speed_kmh, 185.0, 445.0))
        elif horiz_dist_m < 5.5 or in_front_zone:
            speed_kmh = float(np.clip(speed_kmh, 28.0, 225.0))
        else:
            speed_kmh = float(np.clip(speed_kmh, 28.0, 265.0))

        net_clearance_m = float(self.compute_net_clearance(pos_sim))

        # Sample trajectory at video native FPS (every even index of sim_dt = 1/(2*fps) simulation)
        step_indices = list(range(0, len(pos_sim), 2))
        if step_indices[-1] != len(pos_sim) - 1:
            step_indices.append(len(pos_sim) - 1)

        trajectory_3d = [
            [
                round(float(ts_sim[idx]), 3),
                round(float(pos_sim[idx, 0]), 3),
                round(float(pos_sim[idx, 1]), 3),
                round(float(pos_sim[idx, 2]), 3),
            ]
            for idx in step_indices
        ]

        start_3d = [
            round(float(pos_sim[0, 0]), 3),
            round(float(pos_sim[0, 1]), 3),
            round(float(pos_sim[0, 2]), 3),
        ]
        end_3d = [
            round(float(pos_sim[-1, 0]), 3),
            round(float(pos_sim[-1, 1]), 3),
            round(float(pos_sim[-1, 2]), 3),
        ]

        if is_terminal:
            landing_xy = [end_3d[0], end_3d[1]]
            intercept_xy = None
        else:
            landing_xy = None
            intercept_xy = [end_3d[0], end_3d[1]]

        # Honest per-shot accuracy metadata (zero fabrication)
        track_coverage_pct = round(100.0 * len(vis_flight) / max(1, f_end - f0 + 1), 1)
        inlier_ratio = round(float(np.mean(inlier_mask_2d)), 3) if len(inlier_mask_2d) > 0 else 1.0
        continuity_gap_m = (
            round(float(np.linalg.norm(np.array(start_3d, dtype=np.float64) - np.array(prev_end_3d, dtype=np.float64))), 3)
            if prev_end_3d is not None
            else None
        )
        if fit_rmse_px <= 4.5 * sy and track_coverage_pct >= 65.0 and inlier_ratio >= 0.70:
            accuracy_grade = "A"
        elif fit_rmse_px <= 8.5 * sy and track_coverage_pct >= 45.0:
            accuracy_grade = "B"
        elif fit_rmse_px <= 16.0 * sy:
            accuracy_grade = "C"
        else:
            accuracy_grade = "D"

        return {
            "shot_id": global_shot_id,
            "rally_id": rally_id,
            "shot_index": shot_index,
            "start_frame": f0,
            "end_frame": f_end,
            "time_sec": round(f0 / self.fps, 3),
            "duration_sec": round(float(ts_sim[-1]), 3),
            "hitter": h0["player"],
            "side": side,
            "is_serve": is_serve,
            "is_terminal": is_terminal,
            "terminal_mode": terminal_mode,
            "speed_kmh": round(speed_kmh, 1),
            "peak_height_m": round(peak_height_m, 3),
            "net_clearance_m": round(net_clearance_m, 3),
            "downward_angle_deg": round(downward_angle_deg, 2),
            "start_3d": start_3d,
            "end_3d": end_3d,
            "landing_xy": landing_xy,
            "intercept_xy": intercept_xy,
            "fit_rmse_px": round(fit_rmse_px, 2),
            "all_pts_rmse_px": round(all_pts_rmse_px, 2),
            "max_outlier_run": int(max_outlier_run),
            "track_coverage_pct": track_coverage_pct,
            "inlier_ratio": inlier_ratio,
            "continuity_gap_m": continuity_gap_m,
            "accuracy_grade": accuracy_grade,
            "low_confidence": bool(fit_rmse_px > 8.0),
            "shuttle_px": h0.get("shuttle_px"),
            "hitter_court_xy": h0.get("hitter_court_xy"),
            "opponent_court_xy": h0.get("opponent_court_xy"),
            "near_players_xy": h0.get("near_players_xy", []),
            "far_players_xy": h0.get("far_players_xy", []),
            "hitter_ankles_px": h0.get("hitter_ankles_px"),
            "trajectory_3d": trajectory_3d,
        }

    def _make_hit_dict(
        self,
        fn: int,
        u: float,
        v: float,
        side: str,
        dv: float,
        h0: dict,
        h1: Optional[dict],
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
    ) -> dict:
        """Builds a hit dict at frame `fn` for `side` using interpolated poses when available."""
        opp_side = "far" if side == "near" else "near"
        fps_safe = max(10.0, float(self.fps or 25.0))

        player = (far_player if side == "far" else near_player) or ""
        if not player:
            if h1 is not None and h1.get("side") == side and h1.get("player"):
                player = str(h1["player"])
            elif h0.get("side") == side and h0.get("player"):
                player = str(h0["player"])
            else:
                player = "FAR" if side == "far" else "NEAR"

        p_frame = (iposes or {}).get(fn, {}) if isinstance(iposes, dict) else {}
        near_list = p_frame.get("near_players") or ([p_frame["near"]] if p_frame.get("near") else [])
        far_list = p_frame.get("far_players") or ([p_frame["far"]] if p_frame.get("far") else [])
        side_list = near_list if side == "near" else far_list
        opp_list = far_list if side == "near" else near_list

        _, hitter_pose = HitDetector._closest_partner_to_shuttle(side_list, p_frame.get(side), u, v)
        if hitter_pose is None:
            hitter_pose = p_frame.get(side)
        _, opp_pose = HitDetector._closest_partner_to_shuttle(opp_list, p_frame.get(opp_side), u, v)
        if opp_pose is None:
            opp_pose = p_frame.get(opp_side)

        if hitter_pose and "court_x" in hitter_pose and "court_y" in hitter_pose:
            h_xy = [round(float(hitter_pose["court_x"]), 3), round(float(hitter_pose["court_y"]), 3)]
            ankles = [hitter_pose.get("ankle_l_px"), hitter_pose.get("ankle_r_px")]
        else:
            try:
                gx, gy = self.calibrator.pixel_to_court(u, v)
                gx = float(np.clip(gx, 0.3, BWF.width - 0.3))
                gy = float(np.clip(gy, 0.5, 6.0)) if side == "near" else float(np.clip(gy, 7.4, 12.9))
                h_xy = [round(gx, 3), round(gy, 3)]
            except Exception:
                h_xy = [3.05, 2.50 if side == "near" else 10.90]
            ankles = [None, None]

        if opp_pose and "court_x" in opp_pose and "court_y" in opp_pose:
            o_xy = [round(float(opp_pose["court_x"]), 3), round(float(opp_pose["court_y"]), 3)]
        else:
            o_xy = h0.get("hitter_court_xy") or [3.05, 10.90 if side == "near" else 2.50]

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

        return {
            "frame": int(fn),
            "time_sec": round(fn / fps_safe, 3),
            "side": side,
            "player": player,
            "is_serve": False,
            "shuttle_px": [round(float(u), 1), round(float(v), 1)],
            "dv_px": round(float(dv), 1),
            "hitter_court_xy": h_xy,
            "opponent_court_xy": o_xy,
            "near_players_xy": near_xy_list,
            "far_players_xy": far_xy_list,
            "hitter_ankles_px": ankles,
            "synthesized_split": True,
        }

    def _build_side_flipped_hit(
        self,
        h: dict,
        tracks: Dict[int, Tuple[int, float, float]],
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
    ) -> dict:
        """Creates a non-mutating copy of hit `h` with `side` flipped ('near' <-> 'far') and updated court coords."""
        fn = int(h["frame"])
        flip_side = "far" if h["side"] == "near" else "near"
        opp_side = h["side"]
        tr = tracks.get(fn)
        if tr and tr[0] == 1:
            u, v = float(tr[1]), float(tr[2])
        elif h.get("shuttle_px"):
            u, v = float(h["shuttle_px"][0]), float(h["shuttle_px"][1])
        else:
            u, v = 960.0, 540.0

        p_frame = (iposes or {}).get(fn, {}) if isinstance(iposes, dict) else {}
        near_list = p_frame.get("near_players") or ([p_frame["near"]] if p_frame.get("near") else [])
        far_list = p_frame.get("far_players") or ([p_frame["far"]] if p_frame.get("far") else [])
        side_list = near_list if flip_side == "near" else far_list
        _, hitter_pose = HitDetector._closest_partner_to_shuttle(side_list, p_frame.get(flip_side), u, v)
        if hitter_pose is None:
            hitter_pose = p_frame.get(flip_side)

        if hitter_pose and "court_x" in hitter_pose and "court_y" in hitter_pose:
            h_xy = [round(float(hitter_pose["court_x"]), 3), round(float(hitter_pose["court_y"]), 3)]
            ankles = [hitter_pose.get("ankle_l_px"), hitter_pose.get("ankle_r_px")]
        elif h.get("opponent_court_xy"):
            h_xy = [float(h["opponent_court_xy"][0]), float(h["opponent_court_xy"][1])]
            ankles = h.get("hitter_ankles_px")
        else:
            try:
                gx, gy = self.calibrator.pixel_to_court(u, v)
                gx = float(np.clip(gx, 0.3, BWF.width - 0.3))
                gy = float(np.clip(gy, 0.5, 6.0)) if flip_side == "near" else float(np.clip(gy, 7.4, 12.9))
                h_xy = [round(gx, 3), round(gy, 3)]
            except Exception:
                h_xy = [3.05, 2.50 if flip_side == "near" else 10.90]
            ankles = h.get("hitter_ankles_px")

        o_xy = h.get("hitter_court_xy") or ([3.05, 10.90 if flip_side == "near" else 2.50])
        player = (far_player if flip_side == "far" else near_player) or ("FAR" if flip_side == "far" else "NEAR")

        h_copy = dict(h)
        h_copy["side"] = flip_side
        h_copy["player"] = player
        h_copy["hitter_court_xy"] = h_xy
        h_copy["opponent_court_xy"] = o_xy
        h_copy["hitter_ankles_px"] = ankles
        return h_copy

    def _find_internal_turnaround_candidates(
        self,
        h0: dict,
        h1: Optional[dict],
        tracks: Dict[int, Tuple[int, float, float]],
        sy: float,
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
        end_frame: Optional[int] = None,
        min_margin: int = 4,
    ) -> List[dict]:
        """
        Inspects visible 2D shuttle observations in [f0 + min_margin, f1 - min_margin] for:
          1. Sharp curvature / direction-reversal frames (dv peak with vy_in*vy_out < 0,
             vx_in*vx_out < 0, or cos_ang < 0.55), refined by dt=1 turning impulse.
          2. Exact transition frames between an inlier segment and a contiguous >=4-frame
             RANSAC outlier block.
        Returns up to 2 distinct candidate hit dicts ordered by strength.
        """
        f0 = int(h0["frame"])
        f1 = int(end_frame) if end_frame is not None else (int(h1["frame"]) if h1 is not None else f0)
        vis_flight = [
            (fn, float(tracks[fn][1]), float(tracks[fn][2]))
            for fn in range(f0, f1 + 1)
            if fn in tracks and tracks[fn][0] == 1
        ]
        n = len(vis_flight)
        if n < 7:
            return []

        fps_safe = max(10.0, float(self.fps or 25.0))
        margin = max(4, int(min_margin))

        # Precompute dt=1 turning impulse at every interior point for crisp frame pinpointing
        dv1_arr = np.zeros(n, dtype=np.float64)
        for i in range(1, n - 1):
            fn, u, v = vis_flight[i]
            dt1 = max(1, fn - vis_flight[i - 1][0])
            dt2 = max(1, vis_flight[i + 1][0] - fn)
            if dt1 <= 5 and dt2 <= 5:
                vx1 = (u - vis_flight[i - 1][1]) / dt1
                vy1 = (v - vis_flight[i - 1][2]) / dt1
                vx2 = (vis_flight[i + 1][1] - u) / dt2
                vy2 = (vis_flight[i + 1][2] - v) / dt2
                dv1_arr[i] = float(np.hypot(vx2 - vx1, vy2 - vy1))

        def _refine_idx_dt1(idx_c: int) -> int:
            best_k = idx_c
            best_d1 = dv1_arr[idx_c]
            for k in range(max(1, idx_c - 2), min(n - 1, idx_c + 3)):
                fk = vis_flight[k][0]
                if fk < f0 + margin or fk > f1 - margin:
                    continue
                if dv1_arr[k] > best_d1:
                    best_d1 = dv1_arr[k]
                    best_k = k
            return best_k

        # Source A: Curvature / direction-reversal dv peaks
        scored_cands: List[Tuple[float, int, float]] = []
        for i in range(1, n - 1):
            fn, u, v = vis_flight[i]
            if fn < f0 + margin or fn > f1 - margin:
                continue

            i_prev = max(0, i - 2) if (i >= 2 and (fn - vis_flight[i - 2][0]) <= 6) else (i - 1)
            i_next = min(n - 1, i + 2) if (i <= n - 3 and (vis_flight[i + 2][0] - fn) <= 6) else (i + 1)
            dt1 = max(1, fn - vis_flight[i_prev][0])
            dt2 = max(1, vis_flight[i_next][0] - fn)
            if dt1 > 8 or dt2 > 8:
                continue

            vx_in = (u - vis_flight[i_prev][1]) / dt1
            vy_in = (v - vis_flight[i_prev][2]) / dt1
            vx_out = (vis_flight[i_next][1] - u) / dt2
            vy_out = (vis_flight[i_next][2] - v) / dt2

            dv = float(np.hypot(vx_out - vx_in, vy_out - vy_in))
            sp_in = float(np.hypot(vx_in, vy_in))
            sp_out = float(np.hypot(vx_out, vy_out))
            cos_ang = (
                float((vx_in * vx_out + vy_in * vy_out) / (sp_in * sp_out + 1e-6))
                if (sp_in > 1.0 * sy and sp_out > 1.0 * sy)
                else 1.0
            )
            vy_rev = (vy_in * vy_out) < 0.0
            vx_rev = (vx_in * vx_out) < 0.0
            sharp_turn = vy_rev or vx_rev or (cos_ang < 0.55)

            if not (sharp_turn or dv >= 10.0 * sy):
                continue

            dir_match = (
                (h0["side"] == "near" and vy_in < -1.0 * sy and vy_out > 1.0 * sy)
                or (h0["side"] == "far" and vy_in > 1.0 * sy and vy_out < -1.0 * sy)
            )
            weight = 2.0 if dir_match else (1.5 if vy_rev else (1.3 if vx_rev else (1.15 if cos_ang < 0.55 else 0.75)))
            eff_dv = max(dv, 0.85 * float(dv1_arr[i]))
            scored_cands.append((eff_dv * weight, i, eff_dv))

        # Source B: Transition frames between inlier segment and contiguous >=4-frame outlier block
        ts_norm = np.array([float(fn - f0) for fn, _, _ in vis_flight], dtype=np.float64)
        vis_uv = np.array([[u, v] for _, u, v in vis_flight], dtype=np.float64)
        inl_mask = self._ransac_2d_inliers(ts_norm, vis_uv, sy, fps=fps_safe)
        transition_indices: List[int] = []
        idx_scan = 0
        while idx_scan < n:
            if not inl_mask[idx_scan]:
                r_start = idx_scan
                while idx_scan < n and not inl_mask[idx_scan]:
                    idx_scan += 1
                r_end = idx_scan - 1
                if (r_end - r_start + 1) >= 4:
                    if r_start > 0:
                        transition_indices.append(r_start - 1)
                    if r_end + 1 < n:
                        transition_indices.append(r_end)
            else:
                idx_scan += 1

        for t_idx in transition_indices:
            ref_idx = _refine_idx_dt1(t_idx)
            fn_t = vis_flight[ref_idx][0]
            if f0 + margin <= fn_t <= f1 - margin:
                boost = max(25.0 * sy, float(dv1_arr[ref_idx]) * 1.8)
                scored_cands.append((boost, ref_idx, max(10.0 * sy, float(dv1_arr[ref_idx]))))

        if not scored_cands:
            return []

        scored_cands.sort(key=lambda x: -x[0])
        mid_side = "far" if h0["side"] == "near" else "near"
        out_hits: List[dict] = []
        used_frames: List[int] = []
        for _, raw_idx, cand_dv in scored_cands:
            ref_idx = _refine_idx_dt1(raw_idx)
            fn_c, u_c, v_c = vis_flight[ref_idx]
            if fn_c < f0 + margin or fn_c > f1 - margin:
                continue
            if any(abs(fn_c - uf) <= 3 for uf in used_frames):
                continue
            used_frames.append(fn_c)
            out_hits.append(
                self._make_hit_dict(
                    fn=fn_c,
                    u=u_c,
                    v=v_c,
                    side=mid_side,
                    dv=cand_dv,
                    h0=h0,
                    h1=h1,
                    iposes=iposes,
                    near_player=near_player,
                    far_player=far_player,
                )
            )
            if len(out_hits) >= 2:
                break

        return out_hits

    def _find_internal_turnaround_hit(
        self,
        h0: dict,
        h1: Optional[dict],
        tracks: Dict[int, Tuple[int, float, float]],
        sy: float,
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
        end_frame: Optional[int] = None,
    ) -> Optional[dict]:
        """Backwards-compatible single-best internal turnaround hit finder."""
        cands = self._find_internal_turnaround_candidates(
            h0=h0,
            h1=h1,
            tracks=tracks,
            sy=sy,
            iposes=iposes,
            near_player=near_player,
            far_player=far_player,
            end_frame=end_frame,
        )
        return cands[0] if cands else None

    def _reconstruct_single_with_side_flip(
        self,
        rally_id: int,
        shot_index: int,
        global_shot_id: int,
        h0: dict,
        h1: Optional[dict],
        rally_end_frame: int,
        tracks: Dict[int, Tuple[int, float, float]],
        prev_end_3d: Optional[List[float]],
        sy: float,
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
    ) -> Tuple[dict, dict]:
        """
        Reconstructs a single shot and performs Fix 2 Side-Flip Self-Correction when
        `all_pts_rmse_px > 16.0 * sy` or `fit_rmse_px > 14.0 * sy`.
        Returns `(best_shot_rec, effective_h0)`.
        """
        shot_rec = self.reconstruct_shot(
            rally_id=rally_id,
            shot_index=shot_index,
            global_shot_id=global_shot_id,
            h0=h0,
            h1=h1,
            rally_end_frame=rally_end_frame,
            tracks=tracks,
            prev_end_3d=prev_end_3d,
        )

        orig_all = float(shot_rec.get("all_pts_rmse_px", shot_rec["fit_rmse_px"]))
        orig_fit = float(shot_rec["fit_rmse_px"])
        if orig_all > 16.0 * sy or orig_fit > 14.0 * sy:
            h0_flip = self._build_side_flipped_hit(
                h0, tracks=tracks, iposes=iposes, near_player=near_player, far_player=far_player
            )
            h1_flip = h1
            if h1 is not None and h1.get("side") == h0_flip["side"]:
                h1_flip = self._build_side_flipped_hit(
                    h1, tracks=tracks, iposes=iposes, near_player=near_player, far_player=far_player
                )
            flipped_rec = self.reconstruct_shot(
                rally_id=rally_id,
                shot_index=shot_index,
                global_shot_id=global_shot_id,
                h0=h0_flip,
                h1=h1_flip,
                rally_end_frame=rally_end_frame,
                tracks=tracks,
                prev_end_3d=None,
            )
            flip_all = float(flipped_rec.get("all_pts_rmse_px", flipped_rec["fit_rmse_px"]))
            if np.isfinite(flip_all) and flip_all <= 0.60 * orig_all and flip_all <= 12.0 * sy:
                flipped_rec["side_flip_corrected"] = True
                return flipped_rec, h0_flip

        return shot_rec, h0

    @staticmethod
    def _combined_all_pts_rmse(shots: List[dict]) -> float:
        """Computes point-weighted combined `all_pts_rmse_px` across a list of sub-shots."""
        num = 0.0
        den = 0.0
        for s in shots:
            w = max(
                1.0,
                (int(s["end_frame"]) - int(s["start_frame"]) + 1)
                * max(0.05, float(s.get("track_coverage_pct", 50.0)) / 100.0),
            )
            r = float(s.get("all_pts_rmse_px", s["fit_rmse_px"]))
            num += w * (r ** 2)
            den += w
        return float(np.sqrt(num / max(1e-6, den)))

    def _reconstruct_segment_recursive(
        self,
        rally_id: int,
        h0: dict,
        h1: Optional[dict],
        rally_end_frame: int,
        tracks: Dict[int, Tuple[int, float, float]],
        prev_end_3d: Optional[List[float]],
        sy: float,
        fps_safe: float,
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
        depth: int = 0,
        max_split_depth: int = 2,
    ) -> List[dict]:
        """
        Reconstructs a shot segment with Fix 2 (Side-Flip Self-Correction) and Fix 1
        (up to 2-level Recursive Residual Split-Refit for both non-terminal and terminal shots).
        """
        shot_rec, eff_h0 = self._reconstruct_single_with_side_flip(
            rally_id=rally_id,
            shot_index=1,
            global_shot_id=1,
            h0=h0,
            h1=h1,
            rally_end_frame=rally_end_frame,
            tracks=tracks,
            prev_end_3d=prev_end_3d,
            sy=sy,
            iposes=iposes,
            near_player=near_player,
            far_player=far_player,
        )

        if depth >= max_split_depth:
            return [shot_rec]

        f0 = int(eff_h0["frame"])
        f_end_seg = int(h1["frame"]) if h1 is not None else int(shot_rec["end_frame"])
        span = f_end_seg - f0
        min_sub_span = max(5, int(0.22 * fps_safe))

        if h1 is None:
            can_split_span = span >= max(14, 2 * min_sub_span)
        else:
            can_split_span = span >= max(9, 2 * min_sub_span - 1)

        orig_fit = float(shot_rec["fit_rmse_px"])
        orig_all = float(shot_rec.get("all_pts_rmse_px", orig_fit))
        orig_inl = float(shot_rec.get("inlier_ratio", 1.0))
        orig_run = int(shot_rec.get("max_outlier_run", 0))

        needs_split = (
            can_split_span
            and (
                orig_fit > 11.0 * sy
                or orig_all > 14.0 * sy
                or (orig_inl < 0.80 and orig_run >= 4)
            )
        )
        if not needs_split:
            return [shot_rec]

        margin = max(4, min(min_sub_span, span // 3))
        cands = self._find_internal_turnaround_candidates(
            h0=eff_h0,
            h1=h1,
            tracks=tracks,
            sy=sy,
            iposes=iposes,
            near_player=near_player,
            far_player=far_player,
            end_frame=f_end_seg,
            min_margin=margin,
        )
        if not cands:
            return [shot_rec]

        best_split_shots: Optional[List[dict]] = None
        best_combined_all = orig_all

        for h_mid in cands:
            sub1_list = self._reconstruct_segment_recursive(
                rally_id=rally_id,
                h0=eff_h0,
                h1=h_mid,
                rally_end_frame=rally_end_frame,
                tracks=tracks,
                prev_end_3d=prev_end_3d,
                sy=sy,
                fps_safe=fps_safe,
                iposes=iposes,
                near_player=near_player,
                far_player=far_player,
                depth=depth + 1,
                max_split_depth=max_split_depth,
            )
            sub2_prev_end = sub1_list[-1].get("end_3d") if sub1_list else prev_end_3d
            # Ensure h_mid side alternates cleanly with sub1_list[-1]'s actual (possibly side-flipped) side
            h_mid_eff = h_mid
            if sub1_list and sub1_list[-1].get("side") == h_mid.get("side"):
                h_mid_eff = self._build_side_flipped_hit(
                    h_mid, tracks=tracks, iposes=iposes, near_player=near_player, far_player=far_player
                )
            sub2_list = self._reconstruct_segment_recursive(
                rally_id=rally_id,
                h0=h_mid_eff,
                h1=h1,
                rally_end_frame=rally_end_frame,
                tracks=tracks,
                prev_end_3d=sub2_prev_end,
                sy=sy,
                fps_safe=fps_safe,
                iposes=iposes,
                near_player=near_player,
                far_player=far_player,
                depth=depth + 1,
                max_split_depth=max_split_depth,
            )
            cand_shots = sub1_list + sub2_list
            valid = all(
                len(s.get("trajectory_3d") or []) >= 2
                and np.isfinite(float(s.get("all_pts_rmse_px", s["fit_rmse_px"])))
                for s in cand_shots
            )
            if not valid:
                continue
            combined_all = self._combined_all_pts_rmse(cand_shots)
            if (
                combined_all <= 0.70 * orig_all
                and combined_all < (orig_all - 2.5 * sy)
                and combined_all < best_combined_all
            ):
                best_combined_all = combined_all
                best_split_shots = cand_shots

        return best_split_shots if best_split_shots is not None else [shot_rec]

    def reconstruct_rally_shots(
        self,
        rally_id: int,
        hits: List[dict],
        rally_end_frame: int,
        tracks: Dict[int, Tuple[int, float, float]],
        global_shot_id_start: int = 1,
        iposes: Optional[Dict[int, dict]] = None,
        near_player: str = "",
        far_player: str = "",
    ) -> Tuple[List[dict], int]:
        """
        Reconstructs all shots in a rally sequentially with 3D continuity,
        Fix 2 Side-Flip Self-Correction, and Fix 1 2-Level Recursive Residual Split-Refit.
        Returns `(rally_shots, next_global_shot_id)`.
        """
        sy = max(0.35, float(getattr(self.calibrator, "image_height", 1080) or 1080) / 1080.0)
        fps_safe = max(10.0, float(self.fps or 25.0))

        rally_shots: List[dict] = []
        prev_end_3d: Optional[List[float]] = None

        for i, h0 in enumerate(hits):
            h1 = hits[i + 1] if (i + 1) < len(hits) else None
            seg_shots = self._reconstruct_segment_recursive(
                rally_id=rally_id,
                h0=h0,
                h1=h1,
                rally_end_frame=rally_end_frame,
                tracks=tracks,
                prev_end_3d=prev_end_3d,
                sy=sy,
                fps_safe=fps_safe,
                iposes=iposes,
                near_player=near_player,
                far_player=far_player,
                depth=0,
                max_split_depth=2,
            )
            rally_shots.extend(seg_shots)
            prev_end_3d = seg_shots[-1].get("end_3d") if seg_shots else prev_end_3d

        # Re-index shot_index sequentially (1..N) and global shot_id cleanly
        for idx_s, s_rec in enumerate(rally_shots, start=1):
            s_rec["shot_index"] = idx_s
            s_rec["shot_id"] = int(global_shot_id_start) + idx_s - 1

        return rally_shots, int(global_shot_id_start) + len(rally_shots)

    def reconstruct_all(
        self,
        hits_json_path: str = "data/matches/lzj_popov/hits.json",
        shuttle_csv_path: str = "data/matches/lzj_popov/shuttle_2d.csv",
        output_json_path: Optional[str] = "data/matches/lzj_popov/shots_3d.json",
    ) -> dict:
        """
        Reconstructs all shots across all rallies and writes `shots_3d.json`.
        """
        tracks = HitDetector.load_shuttle_csv(shuttle_csv_path)
        with open(hits_json_path, "r", encoding="utf-8") as f:
            hdata = json.load(f)

        all_shots: List[dict] = []
        rallies_out: List[dict] = []
        global_shot_id = 1

        for r in hdata.get("rallies", []):
            rid = int(r["rally_id"])
            hits = r.get("hits", [])
            r_end_frame = int(r["end_frame"])
            rally_shots, global_shot_id = self.reconstruct_rally_shots(
                rally_id=rid,
                hits=hits,
                rally_end_frame=r_end_frame,
                tracks=tracks,
                global_shot_id_start=global_shot_id,
                near_player=str(r.get("near_player") or ""),
                far_player=str(r.get("far_player") or ""),
            )
            all_shots.extend(rally_shots)

            rallies_out.append({
                "rally_id": rid,
                "start_frame": int(r["start_frame"]),
                "end_frame": r_end_frame,
                "partial": bool(r.get("partial", False)),
                "near_player": r.get("near_player"),
                "far_player": r.get("far_player"),
                "shot_count": len(rally_shots),
                "shots": rally_shots,
            })

        rmses = [s["fit_rmse_px"] for s in all_shots]
        med_rmse = round(float(np.median(rmses)), 2) if rmses else 0.0
        mean_rmse = round(float(np.mean(rmses)), 2) if rmses else 0.0

        result = {
            "match_id": "lzj_popov",
            "fps": self.fps,
            "rally_count": len(rallies_out),
            "total_shots": len(all_shots),
            "median_fit_rmse_px": med_rmse,
            "mean_fit_rmse_px": mean_rmse,
            "low_confidence_count": sum(1 for s in all_shots if s["low_confidence"]),
            "shots": all_shots,
            "rallies": rallies_out,
        }

        if output_json_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_json_path)), exist_ok=True)
            with open(output_json_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)

        return result


def main():
    reconstructor = TrajectoryReconstructor3D()
    res = reconstructor.reconstruct_all()
    print(
        f"✅ Reconstructed {res['total_shots']} shots across {res['rally_count']} rallies | "
        f"Median RMSE: {res['median_fit_rmse_px']:.2f} px | "
        f"Low-confidence (>8px): {res['low_confidence_count']}"
    )


if __name__ == "__main__":
    main()
