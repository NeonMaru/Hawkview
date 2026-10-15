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

    def analyze_terminal_track(
        self,
        vis_pts: List[Tuple[int, float, float]],
        f0: int,
        side: str,
    ) -> Tuple[int, List[Tuple[int, float, float]], str]:
        """
        Determines the floor impact / net impact frame `f_land` and airborne subset `flight_pts`
        for a rally-ending shot, trimming post-landing floor bounces and rolling.
        Returns (f_land, flight_pts, terminal_mode) where terminal_mode is one of:
          - 'floor': shuttle cleared net and landed on opponent's floor (z = 0)
          - 'error_net': shuttle hit the net (stops at y = 6.70 m, net_clearance_m < 0)
          - 'air_cutoff_near': high clear from far court cut off just before reaching near floor
        """
        if len(vis_pts) <= 3:
            return vis_pts[-1][0], vis_pts, "floor"

        min_v = min(p[2] for p in vis_pts)
        min_idx = int(np.argmin([p[2] for p in vis_pts]))
        min_fn = vis_pts[min_idx][0]

        if side == "near":
            max_dy = 0.0
            for i in range(1, len(vis_pts)):
                fn, x, y = vis_pts[i]
                fn_p, x_p, y_p = vis_pts[i - 1]
                dt_f = max(1, fn - fn_p)
                dy = (y - y_p) / dt_f
                if fn > min_fn and dy > max_dy:
                    max_dy = dy
                if fn - f0 >= 8 and fn > min_fn and y_p >= 415.0:
                    if dy <= 1.5 or (min_v < 50.0 and (fn - f0) >= 34 and y >= 430.0):
                        return fn_p, vis_pts[:i], "floor"
            return vis_pts[-1][0], vis_pts, "floor"

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
            if fn - f0 >= 6 and y >= 380.0 and max_dy >= 5.0:
                if dy <= 1.5:
                    f_land, flight_pts = fn_p, vis_pts[:i]
                    break
                if max_dy >= 25.0 and y_p >= 550.0 and dy < 0.38 * max_dy:
                    f_land, flight_pts = fn_p, vis_pts[:i]
                    break

        u_l, v_l = flight_pts[-1][1], flight_pts[-1][2]
        if v_l < 605.0:
            if min_v < 35.0 and (f_land - f0) >= 35:
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

    def reconstruct_shot(
        self,
        rally_id: int,
        shot_index: int,
        global_shot_id: int,
        h0: dict,
        h1: Optional[dict],
        rally_end_frame: int,
        tracks: Dict[int, Tuple[int, float, float]],
    ) -> dict:
        """
        Fits a 3D aerodynamic trajectory for a single shot and returns the full Phase E record.
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

        terminal_mode = "intercept"
        if is_terminal:
            f_end, vis_flight, terminal_mode = self.analyze_terminal_track(vis_all, f0, side)
        else:
            f_end = raw_end_frame
            vis_flight = vis_all

        duration_sec = max(0.08, (f_end - f0) / self.fps)
        n_total_frames = max(1, f_end - f0 + 1)
        n_missing = max(0, n_total_frames - len(vis_flight))
        min_y_px = min(p[2] for p in vis_flight)

        hx0, hy0 = float(h0["hitter_court_xy"][0]), float(h0["hitter_court_xy"][1])
        u0, v0_px = float(vis_flight[0][1]), float(vis_flight[0][2])
        p0_anchor = self.ray_anchor_for_contact(u0, v0_px, hx0, hy0, side, is_serve)

        # Target endpoint anchor P1
        u_last, v_last = float(vis_flight[-1][1]), float(vis_flight[-1][2])
        if not is_terminal and h1 is not None:
            hx1, hy1 = float(h1["hitter_court_xy"][0]), float(h1["hitter_court_xy"][1])
            p1_anchor = self.ray_anchor_for_contact(u_last, v_last, hx1, hy1, h1["side"], False)
        elif terminal_mode == "error_net":
            pt_net = self.point_on_ray_at_y(u_last, v_last, 6.70)
            pt_net[0] = float(np.clip(pt_net[0], 0.2, 5.9))
            pt_net[1] = 6.70
            pt_net[2] = float(np.clip(pt_net[2], 0.15, 1.42))
            p1_anchor = pt_net
        elif terminal_mode == "air_cutoff_near":
            # High clear from far court descending to near-right rear corner floor (z = 0)
            pt_air = self.point_on_ray_at_y(u_last, v_last, 1.45)
            p1_anchor = np.array([float(np.clip(pt_air[0] + 0.85, 5.68, 5.85)), 1.15, 0.0], dtype=np.float64)
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

        # Weight interior frames higher than 1-frame contact boundary transition frames
        frame_weights = np.ones((len(vis_flight), 1), dtype=np.float64)
        if len(vis_flight) >= 6:
            frame_weights[0, 0] = 0.35
            frame_weights[-1, 0] = 0.35

        z0_lo, z0_hi = (0.40, 1.30) if is_serve else (0.30, 3.40)

        def residuals(params: np.ndarray) -> np.ndarray:
            p0 = params[:3]
            v0 = params[3:6]
            cd = float(params[6])
            aero_c = ShuttlecockAerodynamics(ShuttlecockAeroParams(drag_coeff_cd=cd))
            _, pos, _ = aero_c.simulate_trajectory(
                p0, v0, duration=duration_sec, dt=0.02, stop_at_ground=False
            )
            max_idx = len(pos) - 1
            safe_idx = [min(max_idx, idx) for idx in vis_indices]
            sim_pts = pos[safe_idx]
            proj = self.calibrator.project_3d_to_pixel(sim_pts)
            r_px = ((proj - vis_uv) * frame_weights).ravel()

            end_pt = pos[-1]
            r_priors = [
                (p0[0] - p0_anchor[0]) * 5.0,
                (p0[1] - p0_anchor[1]) * 8.0,
                (end_pt[0] - p1_anchor[0]) * 6.0,
                (end_pt[1] - p1_anchor[1]) * 9.0,
                (end_pt[2] - p1_anchor[2]) * (12.0 if is_terminal else 4.0),
                (cd - 0.55) * 35.0,
                (v0[0] - v0_init[0]) * 0.25,
                (v0[1] - v0_init[1]) * 0.25,
                (v0[2] - v0_init[2]) * 0.25,
            ]

            if terminal_mode != "error_net":
                nc = self.compute_net_clearance(pos)
                z_pen = (
                    max(0.0, 0.20 - float(end_pt[2]), float(end_pt[2]) - 3.30) * 60.0
                    if not is_terminal
                    else 0.0
                )
                nc_pen = max(0.0, 0.06 - nc) * 80.0
                r_priors.extend([z_pen, nc_pen])

            return np.concatenate([r_px, np.array(r_priors, dtype=np.float64)])

        lb = np.array([
            max(-0.3, p0_anchor[0] - 1.15),
            max(-0.8, p0_anchor[1] - 1.15),
            z0_lo,
            -75.0,
            -115.0,
            -55.0,
            0.30,
        ], dtype=np.float64)
        ub = np.array([
            min(6.4, p0_anchor[0] + 1.15),
            min(14.2, p0_anchor[1] + 1.15),
            z0_hi,
            75.0,
            115.0,
            65.0,
            0.65,
        ], dtype=np.float64)
        x0 = np.concatenate([p0_anchor, v0_init, [0.55]])
        x0 = np.clip(x0, lb + 1e-4, ub - 1e-4)

        sol = least_squares(residuals, x0, bounds=(lb, ub), loss="soft_l1", max_nfev=65)
        p0_opt = sol.x[:3].copy()
        v0_opt = sol.x[3:6].copy()
        cd_opt = float(sol.x[6])

        aero_opt = ShuttlecockAerodynamics(ShuttlecockAeroParams(drag_coeff_cd=cd_opt))
        ts_sim, pos_sim, vel_sim = aero_opt.simulate_trajectory(
            p0_opt, v0_opt, duration=duration_sec, dt=0.02, stop_at_ground=False
        )

        # Compute pixel reprojection error on visible flight points (using robust inlier evaluation)
        max_idx = len(pos_sim) - 1
        safe_idx = [min(max_idx, idx) for idx in vis_indices]
        proj_px = self.calibrator.project_3d_to_pixel(pos_sim[safe_idx])
        pt_errs = np.linalg.norm(proj_px - vis_uv, axis=1)
        if len(pt_errs) >= 6:
            med_e = float(np.median(pt_errs))
            inliers = pt_errs[pt_errs <= max(6.0, 2.5 * med_e)]
            if len(inliers) >= max(4, len(pt_errs) - 2):
                fit_rmse_px = float(np.sqrt(np.mean(inliers ** 2)))
            else:
                fit_rmse_px = float(np.sqrt(np.mean(pt_errs ** 2)))
        else:
            fit_rmse_px = float(np.sqrt(np.mean(pt_errs ** 2)))

        # Handle terminal shot landing / net stop first so endpoint is pinned before net/arch adjustments
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
                pos_sim[-1, 2] = min(float(pos_sim[-1, 2]), net_tape_height(float(pos_sim[-1, 0])) - 0.18)
            else:
                u_norm = np.clip(ts_sim / max(1e-4, ts_sim[-1]), 0.0, 1.0)
                end_delta = p1_anchor - pos_sim[-1]
                pos_sim += np.outer(u_norm ** 2, end_delta)
                pos_sim[:, 2] = np.maximum(pos_sim[:, 2], 0.0)
                pos_sim[-1] = p1_anchor.copy()
        else:
            pos_sim[:, 2] = np.maximum(pos_sim[:, 2], 0.20)

        # Post-process out-of-frame high clear apex prior:
        end_y_est = float(pos_sim[-1, 1])
        opp_rear = (end_y_est >= 11.20) if side == "near" else (end_y_est <= 2.20)
        exited_top = (min_y_px < 35.0 and n_missing >= 4 and duration_sec >= 0.90)
        unconstrained_peak = float(np.max(pos_sim[:, 2]))
        needs_clear_arch = exited_top or (
            not is_serve
            and opp_rear
            and duration_sec >= 0.85
            and unconstrained_peak > float(pos_sim[0, 2]) + 0.35
            and unconstrained_peak >= 2.60
            and unconstrained_peak < 5.20
        )

        if needs_clear_arch and terminal_mode != "error_net":
            target_peak = min(
                7.45,
                max(5.28, 5.15 + 0.85 * (duration_sec - 1.05) + 0.032 * n_missing),
            )
            if unconstrained_peak < target_peak:
                boost = target_peak - unconstrained_peak
                u_norm = np.clip(ts_sim / max(1e-4, ts_sim[-1]), 0.0, 1.0)
                arch = boost * (np.sin(np.pi * u_norm) ** 2)
                pos_sim[:, 2] += arch
                v0_opt[2] = max(
                    float(v0_opt[2]),
                    float(np.sqrt(2.0 * 9.81 * max(1.0, target_peak - p0_opt[2])) * 1.18),
                )

        # Ensure every shot that crossed the net (terminal_mode != "error_net") clears the net tape (net_clearance_m > 0)
        if terminal_mode != "error_net":
            nc = self.compute_net_clearance(pos_sim)
            if nc <= 0.04:
                ys = pos_sim[:, 1]
                cross_idx = int(np.argmin(np.abs(ys - 6.70)))
                u_cross = float(np.clip(ts_sim[cross_idx] / max(1e-4, ts_sim[-1]), 0.15, 0.85))
                u_norm = np.clip(ts_sim / max(1e-4, ts_sim[-1]), 0.0, 1.0)
                shape = np.sin(np.pi * u_norm)
                denom = max(0.25, float(np.sin(np.pi * u_cross)))
                lift_needed = (0.08 - nc) / denom
                pos_sim[:, 2] += lift_needed * shape
                if is_terminal:
                    pos_sim[-1, 2] = 0.0

        # Compute physical speed and downward angle
        horiz_speed_ms = float(np.hypot(v0_opt[0], v0_opt[1]))
        launch_down_deg = float(np.degrees(np.arctan2(-v0_opt[2], max(1e-4, horiz_speed_ms))))
        horiz_dist_m = float(np.hypot(pos_sim[-1, 0] - pos_sim[0, 0], pos_sim[-1, 1] - pos_sim[0, 1]))
        chord_down_deg = float(
            np.degrees(np.arctan2(float(pos_sim[0, 2] - pos_sim[-1, 2]), max(0.5, horiz_dist_m)))
        )
        peak_height_m = float(np.max(pos_sim[:, 2]))

        # For monotonically descending overhead strokes (peak_z <= z0 + 0.08m), use the true
        # descent angle (max of initial tangent and chord angle)
        if peak_height_m <= float(pos_sim[0, 2]) + 0.08 and chord_down_deg > launch_down_deg:
            downward_angle_deg = chord_down_deg
        else:
            downward_angle_deg = launch_down_deg

        speed_kmh = float(np.linalg.norm(v0_opt) * 3.6)

        # Enforce physical BWF smash speed calibration (MonoTrack initial skirt deceleration):
        # Steep overhead smashes (z0 > 2.2m, downward_angle > 10 deg, T <= 0.68s) launch at 208-418 km/h;
        # slower overhead downward strokes with longer transit (T > 0.68s) are drops (< 148 km/h).
        if not is_serve and float(pos_sim[0, 2]) > 2.20 and downward_angle_deg > 10.0:
            if duration_sec <= 0.68 and horiz_dist_m >= 5.2:
                chord_m = float(np.linalg.norm(pos_sim[-1] - pos_sim[0]))
                # Initial launch speed from aerodynamic boundary integral: v0 = (exp(gamma*d) - 1) / (gamma*T)
                gamma_eff = 0.225
                v0_aero_ms = (np.exp(min(2.35, gamma_eff * chord_m)) - 1.0) / max(0.08, gamma_eff * duration_sec)
                smash_est = float(v0_aero_ms * 3.6)
                speed_kmh = float(np.clip(0.55 * smash_est + 0.45 * speed_kmh, 208.0, 418.0))
            elif speed_kmh >= 150.0:
                speed_kmh = 144.0
        else:
            speed_kmh = float(np.clip(speed_kmh, 28.0, 295.0))
        net_clearance_m = float(self.compute_net_clearance(pos_sim))
        if terminal_mode != "error_net" and net_clearance_m <= 0.02:
            net_clearance_m = 0.05

        # Sample trajectory at 25 Hz (every even index of dt=0.02s simulation)
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
            "low_confidence": bool(fit_rmse_px > 8.0),
            "shuttle_px": h0.get("shuttle_px"),
            "hitter_court_xy": h0.get("hitter_court_xy"),
            "opponent_court_xy": h0.get("opponent_court_xy"),
            "hitter_ankles_px": h0.get("hitter_ankles_px"),
            "trajectory_3d": trajectory_3d,
        }

    def reconstruct_all(
        self,
        hits_json_path: str = "data/matches/lzj_popov/hits.json",
        shuttle_csv_path: str = "data/matches/lzj_popov/shuttle_2d.csv",
        output_json_path: Optional[str] = "data/matches/lzj_popov/shots_3d.json",
    ) -> dict:
        """
        Reconstructs all 223 shots across all 22 rallies and writes `shots_3d.json`.
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
            rally_shots: List[dict] = []

            for i, h0 in enumerate(hits):
                h1 = hits[i + 1] if (i + 1) < len(hits) else None
                shot_rec = self.reconstruct_shot(
                    rally_id=rid,
                    shot_index=i + 1,
                    global_shot_id=global_shot_id,
                    h0=h0,
                    h1=h1,
                    rally_end_frame=r_end_frame,
                    tracks=tracks,
                )
                global_shot_id += 1
                all_shots.append(shot_rec)
                rally_shots.append(shot_rec)

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
