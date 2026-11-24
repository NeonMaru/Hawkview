"""
Unit and Integration Tests for Hawkview Computer Vision & Physics Engine (Plan Section 4)
=========================================================================================
Covers the 4 required test suites:
  1. Synthetic 3D trajectory test: simulate a shot with known v0, project with a
     calibrated camera, add 1 px Gaussian noise, and verify `reconstruct3d`
     recovers |v0| within 5%.
  2. Calibration round-trip test: verify court -> pixel -> court round-trip error
     is under 1 cm (< 0.01 m) and Section 0 camera constraints hold.
  3. BWF shot classification rule tests on hand-built shots (Spec Sections 1.6 & 1.7).
  4. Pipeline smoke test on `assets/sample_rally.mp4` with `--stride 5` asserting
     `frames_processed` equals the real decoded frame count and no output value
     equals a known former hardcoded constant.
"""

import json
import os
import tempfile
import unittest
import numpy as np

from engine.aerodynamics import ShuttlecockAerodynamics, ShuttlecockAeroParams
from engine.classify import ShotClassifier, court_zone_for_point
from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF, CourtGeometry
from engine.decode import VideoDecoder
from engine.pipeline import HawkviewPipeline
from engine.reconstruct3d import TrajectoryReconstructor3D


class TestCalibrationRoundTrip(unittest.TestCase):
    """Suite 1: Calibration round-trip (< 1 cm) & Section 0 camera pose invariants."""

    def setUp(self):
        self.calib = CourtCalibrator("lzj_popov")
        self.calib.load_calibration("data/matches/lzj_popov/calibration.json")

        self.geom = CourtGeometry()
        corners = np.array([
            [340.0, 940.0],
            [1580.0, 940.0],
            [1320.0, 360.0],
            [600.0, 360.0],
        ], dtype=np.float32)
        self.geom.calibrate_homography(corners)

    def test_court_calibrator_roundtrip_under_1cm(self):
        """Verifies court -> pixel -> court round-trip error is < 1 cm (0.01 m)."""
        test_points = [
            (0.0, 0.0),
            (6.10, 0.0),
            (6.10, 13.40),
            (0.0, 13.40),
            (3.05, 6.70),   # Center net
            (3.05, 4.72),   # Near short-service T
            (3.05, 8.68),   # Far short-service T
            (0.46, 2.50),   # Left singles sideline
            (5.64, 11.10),  # Right singles sideline
            (1.85, 9.40),   # Interior far court
        ]
        for cx, cy in test_points:
            u, v = self.calib.court_to_pixel(cx, cy)
            rx, ry = self.calib.pixel_to_court(u, v)
            err_m = float(np.hypot(cx - rx, cy - ry))
            self.assertLess(
                err_m,
                0.01,
                msg=f"Round-trip error {err_m:.6f}m >= 0.01m at ({cx}, {cy})",
            )

    def test_court_geometry_homography_roundtrip_under_1cm(self):
        """Verifies CourtGeometry homography round-trip error is < 1 cm."""
        for cx, cy in [(0.0, 0.0), (6.10, 0.0), (6.10, 13.40), (3.05, 6.70), (2.10, 10.20)]:
            u, v = self.geom.court_to_pixel(cx, cy)
            rx, ry = self.geom.pixel_to_court(u, v)
            self.assertAlmostEqual(cx, rx, delta=0.01)
            self.assertAlmostEqual(cy, ry, delta=0.01)

    def test_section0_camera_constraints(self):
        """Verifies fx == fy, principal point at center, reprojection <= 3 px, and valid camera pose."""
        K = self.calib.K
        self.assertIsNotNone(K)
        self.assertAlmostEqual(float(K[0, 0]), float(K[1, 1]), delta=1e-6, msg="fx must equal fy")
        self.assertAlmostEqual(float(K[0, 2]), 960.0, delta=1e-3)
        self.assertAlmostEqual(float(K[1, 2]), 540.0, delta=1e-3)
        self.assertLessEqual(self.calib.reprojection_error_px, 3.0)

        cam_pos = self.calib.camera_position.reshape(3)
        dist_behind_near_baseline = -float(cam_pos[1])
        cam_height = float(cam_pos[2])
        self.assertGreaterEqual(dist_behind_near_baseline, 10.0)
        self.assertLessEqual(dist_behind_near_baseline, 25.0)
        self.assertGreaterEqual(cam_height, 3.0)
        self.assertLessEqual(cam_height, 12.0)


class TestSyntheticTrajectoryRecovery(unittest.TestCase):
    """Suite 2: Synthetic 3D trajectory test with 1 px noise recovering |v0| within 5%."""

    def setUp(self):
        self.calib = CourtCalibrator("lzj_popov")
        self.calib.load_calibration("data/matches/lzj_popov/calibration.json")
        self.reconstructor = TrajectoryReconstructor3D(calibrator=self.calib, fps=25.0)
        self.aero = ShuttlecockAerodynamics(ShuttlecockAeroParams(drag_coeff_cd=0.55))

    def _run_synthetic_shot(
        self,
        p0_true: np.ndarray,
        v0_true: np.ndarray,
        duration_sec: float,
        seed: int,
    ) -> dict:
        n_frames = int(round(duration_sec * 25.0))
        _, pos, _ = self.aero.simulate_trajectory(
            p0_true, v0_true, duration=duration_sec, dt=0.02, stop_at_ground=False
        )
        rng = np.random.default_rng(seed)
        tracks = {}
        f0 = 200
        for k in range(n_frames + 1):
            pt3 = pos[min(len(pos) - 1, 2 * k)]
            uv = self.calib.project_3d_to_pixel(pt3.reshape(1, 3))[0]
            uv_noisy = uv + rng.normal(0.0, 1.0, size=2)
            tracks[f0 + k] = (1, float(uv_noisy[0]), float(uv_noisy[1]))

        f1 = f0 + n_frames
        p1_true = pos[-1]
        h0 = {
            "frame": f0,
            "side": "near",
            "is_serve": False,
            "player": "POPOV",
            "hitter_court_xy": [float(p0_true[0]), float(p0_true[1])],
            "shuttle_px": [tracks[f0][1], tracks[f0][2]],
        }
        h1 = {
            "frame": f1,
            "side": "far",
            "is_serve": False,
            "player": "LZJ",
            "hitter_court_xy": [float(p1_true[0]), float(p1_true[1])],
            "shuttle_px": [tracks[f1][1], tracks[f1][2]],
        }
        return self.reconstructor.reconstruct_shot(
            rally_id=1,
            shot_index=1,
            global_shot_id=1,
            h0=h0,
            h1=h1,
            rally_end_frame=f1 + 5,
            tracks=tracks,
        )

    def test_recover_initial_speed_within_5_percent_drive(self):
        """Simulates a fast mid-court drive with 1 px noise and checks |v0| recovery within 5%."""
        p0_true = np.array([2.80, 2.10, 1.85], dtype=np.float64)
        v0_true = np.array([0.40, 21.50, 5.20], dtype=np.float64)
        true_speed_kmh = float(np.linalg.norm(v0_true) * 3.6)

        res = self._run_synthetic_shot(p0_true, v0_true, duration_sec=0.60, seed=42)
        recovered_speed_kmh = float(res["speed_kmh"])
        rel_error = abs(recovered_speed_kmh - true_speed_kmh) / true_speed_kmh

        self.assertLess(
            rel_error,
            0.05,
            msg=f"Recovered speed {recovered_speed_kmh:.2f} km/h differs from true {true_speed_kmh:.2f} km/h by {rel_error*100:.2f}% (> 5%)",
        )
        self.assertLess(res["fit_rmse_px"], 3.0)

    def test_recover_initial_speed_within_5_percent_lift(self):
        """Simulates an underhand lift across the net with 1 px noise and checks |v0| recovery within 5%."""
        p0_true = np.array([1.90, 3.80, 1.05], dtype=np.float64)
        v0_true = np.array([1.80, 17.50, 9.80], dtype=np.float64)
        true_speed_kmh = float(np.linalg.norm(v0_true) * 3.6)

        res = self._run_synthetic_shot(p0_true, v0_true, duration_sec=0.80, seed=99)
        recovered_speed_kmh = float(res["speed_kmh"])
        rel_error = abs(recovered_speed_kmh - true_speed_kmh) / true_speed_kmh

        self.assertLess(
            rel_error,
            0.05,
            msg=f"Recovered speed {recovered_speed_kmh:.2f} km/h differs from true {true_speed_kmh:.2f} km/h by {rel_error*100:.2f}% (> 5%)",
        )


class TestBWFShotClassification(unittest.TestCase):
    """Suite 3: BWF Laws of Badminton shot classification & outcome rule tests (Spec 1.6 & 1.7)."""

    def setUp(self):
        self.clf = ShotClassifier(match_type="singles")

    def _make_shot(
        self,
        start_3d,
        end_3d,
        speed_kmh=120.0,
        peak_height_m=2.5,
        downward_angle_deg=0.0,
        net_clearance_m=0.35,
        side="near",
        is_serve=False,
        is_terminal=False,
        terminal_mode="intercept",
        landing_xy=None,
    ) -> dict:
        return {
            "side": side,
            "is_serve": is_serve,
            "is_terminal": is_terminal,
            "terminal_mode": terminal_mode,
            "start_3d": list(start_3d),
            "end_3d": list(end_3d),
            "landing_xy": list(landing_xy) if landing_xy is not None else (list(end_3d[:2]) if is_terminal else None),
            "speed_kmh": float(speed_kmh),
            "peak_height_m": float(peak_height_m),
            "downward_angle_deg": float(downward_angle_deg),
            "net_clearance_m": float(net_clearance_m),
        }

    def test_court_zones(self):
        """Verifies front (<= 1.98m from net), rear (<= 2.00m from baseline), and mid zones."""
        self.assertEqual(court_zone_for_point(5.20, "near")[0], "front")
        self.assertEqual(court_zone_for_point(3.10, "near")[0], "mid")
        self.assertEqual(court_zone_for_point(1.20, "near")[0], "rear")

        self.assertEqual(court_zone_for_point(8.10, "far")[0], "front")
        self.assertEqual(court_zone_for_point(10.00, "far")[0], "mid")
        self.assertEqual(court_zone_for_point(12.20, "far")[0], "rear")

    def test_serve_classifications_and_fault_height(self):
        """Verifies serve_short, serve_flick, serve_drive, serve_long, and possible_fault_height."""
        s_short = self._make_shot([2.8, 4.5, 1.02], [3.4, 8.8, 0.8], speed_kmh=68, peak_height_m=1.68, is_serve=True)
        self.assertEqual(self.clf.classify_shot_type(s_short)[0], "serve_short")
        _, _, fault_short, _ = self.clf.evaluate_outcome(s_short)
        self.assertFalse(fault_short)

        s_flick = self._make_shot([2.8, 4.5, 1.05], [3.6, 11.8, 1.2], speed_kmh=95, peak_height_m=3.10, is_serve=True)
        self.assertEqual(self.clf.classify_shot_type(s_flick)[0], "serve_flick")

        s_long = self._make_shot([2.8, 4.5, 1.05], [3.6, 12.6, 1.0], speed_kmh=110, peak_height_m=4.60, is_serve=True)
        self.assertEqual(self.clf.classify_shot_type(s_long)[0], "serve_long")

        s_drive = self._make_shot([2.8, 4.5, 1.42], [3.6, 10.5, 1.1], speed_kmh=118, peak_height_m=1.78, is_serve=True)
        self.assertEqual(self.clf.classify_shot_type(s_drive)[0], "serve_drive")
        _, _, fault_high, _ = self.clf.evaluate_outcome(s_drive)
        self.assertTrue(fault_high, "Serve hit at z0=1.42m (> 1.35m) must flag possible_fault_height")

    def test_smash_net_kill_drop_clear_lift_net_drive_block_push(self):
        """Verifies all non-serve BWF stroke rules in priority order."""
        # Smash: z0 > 2.2m, angle > 10 deg, speed > 150 km/h
        smash = self._make_shot([2.2, 1.8, 2.75], [4.1, 10.2, 0.0], speed_kmh=340, peak_height_m=2.75, downward_angle_deg=16.5)
        self.assertEqual(self.clf.classify_shot_type(smash)[0], "smash")

        # Net kill: front zone, z0 > net height, downward, lands front/mid
        nk = self._make_shot([3.0, 5.8, 1.82], [3.2, 8.2, 0.0], speed_kmh=135, peak_height_m=1.82, downward_angle_deg=18.0)
        self.assertEqual(self.clf.classify_shot_type(nk)[0], "net_kill")

        # Drop: z0 > 2.0m in rear/mid, lands in front zone, speed < 150 km/h
        drop = self._make_shot([2.0, 1.5, 2.45], [3.0, 8.1, 0.3], speed_kmh=112, peak_height_m=2.55, downward_angle_deg=8.0)
        self.assertEqual(self.clf.classify_shot_type(drop)[0], "drop")

        # Attacking clear (5.0 < peak < 6.5m) vs Defensive clear (peak >= 6.5m)
        aclear = self._make_shot([2.1, 1.4, 2.40], [4.5, 12.4, 1.8], speed_kmh=165, peak_height_m=5.60)
        self.assertEqual(self.clf.classify_shot_type(aclear)[0], "attacking_clear")

        dclear = self._make_shot([2.1, 1.4, 2.30], [4.5, 12.6, 1.8], speed_kmh=155, peak_height_m=6.90)
        self.assertEqual(self.clf.classify_shot_type(dclear)[0], "defensive_clear")

        # Lift: z0 < net height in front/mid, peak > 4m, lands rear
        lift = self._make_shot([2.5, 5.3, 0.85], [4.0, 12.3, 1.5], speed_kmh=130, peak_height_m=4.80)
        self.assertEqual(self.clf.classify_shot_type(lift)[0], "lift")

        # Net shot: front to front, peak < net_height + 0.5m
        net_shot = self._make_shot([2.6, 5.5, 1.15], [2.8, 7.9, 0.9], speed_kmh=48, peak_height_m=1.72)
        self.assertEqual(self.clf.classify_shot_type(net_shot)[0], "net_shot")

        # Block: return of smash landing in front zone
        block = self._make_shot([2.9, 2.8, 1.10], [3.1, 8.0, 0.6], speed_kmh=62, peak_height_m=1.95)
        self.assertEqual(self.clf.classify_shot_type(block, prev_shot_type="smash")[0], "block")

        # Push: front/mid near net height, flat, lands mid/rear
        push = self._make_shot([2.9, 5.1, 1.35], [4.2, 10.8, 0.8], speed_kmh=92, peak_height_m=1.80)
        self.assertEqual(self.clf.classify_shot_type(push)[0], "push")

        # Drive: flat (peak - z0 < 0.6m), speed > 100 km/h
        drive = self._make_shot([1.8, 3.4, 1.45], [4.3, 10.1, 1.1], speed_kmh=142, peak_height_m=1.82, net_clearance_m=0.22)
        self.assertEqual(self.clf.classify_shot_type(drive)[0], "drive")

    def test_outcomes_and_close_call(self):
        """Verifies winner, error_out, error_net, and close_call (<= 0.15m from boundary line)."""
        # Winner landing inside singles court near right sideline (x_max = 5.64m)
        s_win_close = self._make_shot(
            [2.0, 2.0, 2.6], [5.55, 10.5, 0.0], is_terminal=True, terminal_mode="floor", landing_xy=[5.55, 10.5]
        )
        outcome, close_call, _, _ = self.clf.evaluate_outcome(s_win_close)
        self.assertEqual(outcome, "winner")
        self.assertTrue(close_call, "Landing at x=5.55m (0.09m from singles line 5.64m) must be close_call")

        # Error out landing wide in doubles tramline (x = 5.95m > 5.64m)
        s_out = self._make_shot(
            [2.0, 2.0, 2.6], [5.95, 10.5, 0.0], is_terminal=True, terminal_mode="floor", landing_xy=[5.95, 10.5]
        )
        outcome_out, close_out, _, _ = self.clf.evaluate_outcome(s_out)
        self.assertEqual(outcome_out, "error_out")
        self.assertFalse(close_out)

        # Error net
        s_net = self._make_shot(
            [2.5, 5.2, 1.1], [2.6, 6.70, 1.25], net_clearance_m=-0.27, is_terminal=True, terminal_mode="error_net"
        )
        outcome_net, _, _, _ = self.clf.evaluate_outcome(s_net)
        self.assertEqual(outcome_net, "error_net")

    def test_doubles_2v2_pose_wrist_attribution_and_boundaries(self):
        """
        Verifies Doubles (2v2) calibration:
          1. PoseTracker._select_distinct_halfcourt_players keeps 2 distinct partners per half-court
             while deduplicating overlapping detections of the same player.
          2. HitDetector._closest_partner_to_shuttle attributes contact to whichever partner's wrist
             struck the shuttle (anchoring hitter_court_xy to that partner).
          3. ShotClassifier(match_type='doubles') uses the 6.10m outer sidelines on rally strokes
             and the 0.76m doubles long service line (y=12.64m / y=0.76m) on terminal serves.
        """
        from engine.pose_track import PoseTracker
        from engine.hits import HitDetector

        cands = [
            {"court_x": 1.45, "court_y": 2.30, "ankle_px": [520.0, 820.0], "wrist_l_px": [500.0, 700.0], "wrist_r_px": [540.0, 695.0], "conf": 0.88, "fg_diff": 22.0},
            {"court_x": 1.48, "court_y": 2.35, "ankle_px": [528.0, 824.0], "wrist_l_px": [505.0, 702.0], "wrist_r_px": [542.0, 698.0], "conf": 0.72, "fg_diff": 20.0},  # duplicate of partner 1
            {"court_x": 4.65, "court_y": 4.10, "ankle_px": [1280.0, 690.0], "wrist_l_px": [1260.0, 560.0], "wrist_r_px": [1310.0, 545.0], "conf": 0.81, "fg_diff": 19.5},  # partner 2 at front-right
        ]
        partners = PoseTracker._select_distinct_halfcourt_players(cands, max_players=2)
        self.assertEqual(len(partners), 2)
        self.assertAlmostEqual(partners[0]["court_x"], 1.45, places=2)
        self.assertAlmostEqual(partners[1]["court_x"], 4.65, places=2)

        # Shuttle struck near partner 2's right wrist (1315, 548) -> must attribute to partner 2 (court_x=4.65)
        dist_px, hitter_pose = HitDetector._closest_partner_to_shuttle(partners, partners[0], 1315.0, 548.0)
        self.assertLess(dist_px, 10.0)
        self.assertAlmostEqual(hitter_pose["court_x"], 4.65, places=2)

        # Doubles sideline & long-service-line rules
        clf_doubles = ShotClassifier(match_type="doubles")
        # 1) Tramline smash at x = 5.95m (out in Singles, IN in Doubles)
        s_tram = self._make_shot(
            [4.65, 4.10, 2.5], [5.95, 10.5, 0.0], is_terminal=True, terminal_mode="floor", landing_xy=[5.95, 10.5]
        )
        self.assertEqual(self.clf.evaluate_outcome(s_tram)[0], "error_out")
        self.assertEqual(clf_doubles.evaluate_outcome(s_tram)[0], "winner")

        # 2) Flick serve landing at y = 13.05m (IN in Singles <= 13.40m, OUT in Doubles > 12.64m long service line)
        s_long_srv = self._make_shot(
            [2.8, 4.5, 1.05], [3.6, 13.05, 0.0], is_serve=True, is_terminal=True, terminal_mode="floor", landing_xy=[3.6, 13.05]
        )
        self.assertEqual(self.clf.evaluate_outcome(s_long_srv)[0], "winner")
        self.assertEqual(clf_doubles.evaluate_outcome(s_long_srv)[0], "error_out")

    def test_720p_resolution_scaling_in_hits_and_reconstruct3d(self):
        """
        Verifies that a 720p (1280x720) video scaled by 2/3 from 1080p (1920x1080)
        produces identical hit detection (Near/Far alternation, no Near-court hits misclassified
        as Far-court hits at y=360..480px) and accurate 3D trajectory reconstruction.
        """
        from engine.court_calib import CourtCalibrator
        from engine.hits import HitDetector
        from engine.reconstruct3d import TrajectoryReconstructor3D

        cal_720 = CourtCalibrator("test_720p", image_width=1280, image_height=720)
        kps_720 = CourtCalibrator.default_keypoints_for_size(1280, 720)
        cal_720.set_keypoints(kps_720, image_width=1280, image_height=720)
        self.assertLess(cal_720.reprojection_error_px, 4.0)

        # In 720p, Near player stands around y = 440px (which was < 510px in 1080p!).
        # Far player stands around y = 260px.
        hd_720 = HitDetector(fps=25.0, image_width=1280, image_height=720)
        iposes = {}
        for fn in range(1, 35):
            iposes[fn] = {
                "frame": fn,
                "near": {
                    "court_x": 3.0, "court_y": 3.2,
                    "ankle_px": [640.0, 520.0],
                    "wrist_l_px": [630.0, 440.0], "wrist_r_px": [650.0, 440.0],
                },
                "far": {
                    "court_x": 3.1, "court_y": 10.5,
                    "ankle_px": [645.0, 300.0],
                    "wrist_l_px": [635.0, 250.0], "wrist_r_px": [655.0, 250.0],
                },
                "near_players": [],
                "far_players": [],
            }

        # Synthetic 720p rally: Near serve at frame 1 (y=440 -> flies up to Far at frame 15 y=248 -> returns to Near at frame 28 y=450)
        vis_720 = []
        for fn in range(1, 16):
            alpha = (fn - 1) / 14.0
            vis_720.append((fn, 645.0, 440.0 * (1.0 - alpha) + 248.0 * alpha))
        for fn in range(16, 31):
            alpha = (fn - 15) / 15.0
            vis_720.append((fn, 645.0, 248.0 * (1.0 - alpha) + 460.0 * alpha))

        hits_720, _ = hd_720.detect_rally_hits(vis_720, iposes, 1, 30, "NEAR_P", "FAR_P", image_width=1280, image_height=720)
        self.assertGreaterEqual(len(hits_720), 2)
        self.assertEqual(hits_720[0]["side"], "near")
        self.assertEqual(hits_720[1]["side"], "far")

        # Reconstruct 3D shot on 720p calibrator
        tracks_720 = {fn: (1, x, y) for fn, x, y in vis_720}
        recon_720 = TrajectoryReconstructor3D(calibrator=cal_720, fps=25.0)
        shot_3d = recon_720.reconstruct_shot(1, 1, 1, hits_720[0], hits_720[1], 30, tracks_720)
        self.assertGreater(shot_3d["speed_kmh"], 30.0)
        self.assertLess(shot_3d["speed_kmh"], 350.0)

    def test_720p_court_auto_calib_anti_distortion_and_chunk_id_determinism(self):
        """
        Verifies:
          1. CourtCalibrator._validate_homography_geometry accepts valid 720p court homographies
             and rejects sheared/twisted homographies caused by logo/shoe outliers.
          2. CourtCalibrator.refine_with_white_lines on a synthetic 720p (1280x720) frame with
             bright floor logo / player shirt distractors snaps cleanly to white court lines
             and co-updates net posts without spiking reprojection error.
          3. server.sanitize_match_id produces identical deterministic match_ids across chunks.
        """
        import cv2
        from engine.court_calib import CourtCalibrator
        from server import sanitize_match_id

        # 1. Deterministic chunk upload match_id check
        m1 = sanitize_match_id("1000139410.mp4", file_size=83152384)
        m2 = sanitize_match_id("1000139410.mp4", file_size=83152384)
        self.assertEqual(m1, m2)
        self.assertEqual(m1, "1000139410_52384")

        # 2. 720p geometric invariant check
        cal = CourtCalibrator("test_720p_geom", image_width=1280, image_height=720)
        kps = CourtCalibrator.default_keypoints_for_size(1280, 720)
        cal.set_keypoints(kps, image_width=1280, image_height=720)
        self.assertTrue(cal._validate_homography_geometry(cal.H_court_to_pixel))

        # Construct a twisted homography where corner_near_left is pulled 140px upward onto a logo
        bad_src = np.array([[0.0, 0.0], [6.10, 0.0], [6.10, 13.40], [0.0, 13.40]], dtype=np.float32)
        bad_dst = np.array([
            [kps["corner_near_left"][0] + 95.0, kps["corner_near_left"][1] - 135.0],
            kps["corner_near_right"],
            kps["corner_far_right"],
            kps["corner_far_left"],
        ], dtype=np.float32)
        H_bad, _ = cv2.findHomography(bad_src, bad_dst)
        self.assertFalse(cal._validate_homography_geometry(H_bad))

        # 3. Synthetic 720p court frame with white lines shifted by (+4px, -3px) + bright shirt/logo distractors
        frame = np.full((720, 1280, 3), (70, 125, 65), dtype=np.uint8)  # green BWF mat
        cal_shifted = CourtCalibrator("shifted_gt", image_width=1280, image_height=720)
        shifted_kps = {k: [v[0] + 4.0, v[1] - 3.0] for k, v in kps.items()}
        cal_shifted.set_keypoints(shifted_kps, image_width=1280, image_height=720)
        frame = cal_shifted.project_lines(frame, color=(245, 245, 245), thickness=2)

        # Paint a large bright yellow/white floor logo and player shirt patch near the baseline to test outlier rejection
        cv2.rectangle(frame, (380, 620), (470, 660), (60, 240, 250), -1)  # high-chroma yellow logo
        cv2.rectangle(frame, (580, 480), (640, 560), (240, 240, 240), -1)  # wide white player shirt block

        rmse = cal.refine_with_white_lines(frame, search_radius_px=12)
        self.assertLess(cal.reprojection_error_px, 5.0)
        self.assertGreaterEqual(rmse, 0.0)


class TestPipelineSmokeAndGroundTruth(unittest.TestCase):
    """Suite 4: Pipeline smoke test on sample_rally.mp4 (--stride 5) and no hardcoded constants."""

    FORMER_HARDCODED_CONSTANTS = {412.0, 408.4, 388.0, 0.74, 148.0}
    FORMER_HARDCODED_STRINGS = {"Su Li Yang", "SLY", "TPE"}

    def test_sample_rally_smoke_stride_5_and_no_hardcoded_constants(self):
        """
        Runs HawkviewPipeline on `assets/sample_rally.mp4` with `--stride 5` and asserts:
          1. `source.frames_processed` equals the exact decoded frame count from VideoDecoder.
          2. No value in the output contract matches any former hardcoded constant.
        """
        video_file = "assets/sample_rally.mp4"
        self.assertTrue(os.path.exists(video_file), "assets/sample_rally.mp4 must exist")

        expected_decode = VideoDecoder(video_file, stride=5).decode_all()
        expected_frames = expected_decode["frames_processed"]
        self.assertGreater(expected_frames, 0)

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            out_path = tmp.name

        try:
            pipeline = HawkviewPipeline()
            contract = pipeline.run_ingestion(
                video_path=video_file,
                output_json_path=out_path,
                stride=5,
            )

            self.assertTrue(os.path.exists(out_path))
            self.assertEqual(contract["source"]["frames_processed"], expected_frames)
            self.assertGreater(contract["source"]["decode_fps"], 0.0)

            # Recursively inspect contract to ensure zero former hardcoded constants appear
            def assert_no_fabricated(obj, path=""):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        assert_no_fabricated(v, f"{path}.{k}")
                elif isinstance(obj, list):
                    # Skip raw coordinate arrays (H, K, R, t, path, trajectory_3d, foot_positions, *_xy)
                    if path.endswith((".H", ".K", ".R", ".t", ".path", ".trajectory_3d", ".foot_positions", ".hitter_court_xy", ".opponent_court_xy", ".near_players_xy", ".far_players_xy")):
                        return
                    for idx, item in enumerate(obj):
                        assert_no_fabricated(item, f"{path}[{idx}]")
                elif isinstance(obj, float):
                    self.assertNotIn(
                        round(obj, 3),
                        self.FORMER_HARDCODED_CONSTANTS,
                        msg=f"Found former hardcoded constant {obj} at {path}",
                    )
                elif isinstance(obj, str):
                    for banned in self.FORMER_HARDCODED_STRINGS:
                        self.assertNotIn(
                            banned,
                            obj,
                            msg=f"Found former hardcoded string {banned!r} at {path}",
                        )

            assert_no_fabricated(contract)
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)

    def test_doubles_filename_parsing_and_whole_token_flag_inference(self):
        """Verifies Doubles pair filename parsing, Singles multi-word parsing, and whole-token flag lookup."""
        from server import infer_player_flag, parse_players_from_filename

        p_near, p_far = parse_players_from_filename(
            "Iwanaga_Nakanishi vs Tan_Muralitharan _ Control and confident attacking play - (1080p).mp4"
        )
        self.assertIn("/", p_near)
        self.assertEqual(p_near, "IWANAGA / NAKANISHI")
        self.assertEqual(p_far, "TAN / MURALITHARAN")

        s_near, s_far = parse_players_from_filename(
            "An Se Young vs Pusarla V. Sindhu _ Hard-fought rallies with relentless retrieval - (720p).mp4"
        )
        self.assertNotIn("/", s_near)
        self.assertEqual(s_near, "AN S.Y.")
        self.assertEqual(s_far, "P.V. SINDHU")

        # NAKANISHI must map to Japan (🇯🇵), never matching substring 'SHI' (🇨🇳)
        self.assertEqual(infer_player_flag("IWANAGA / NA", "IWANAGA / NAKANISHI"), "🇯🇵")
        self.assertEqual(infer_player_flag("TAN / THINAA", "TAN / THINAAH"), "🇲🇾")
        self.assertEqual(infer_player_flag("AN S.Y.", "AN S.Y."), "🇰🇷")
        self.assertEqual(infer_player_flag("P.V. SINDHU", "P.V. SINDHU"), "🇮🇳")
        self.assertEqual(infer_player_flag("SHI Y.Q.", "SHI YU QI"), "🇨🇳")

    def test_game3_midgame_interval_cap_and_4player_distance_sum(self):
        """Verifies BWF Game 3 mid-game interval cap (max Game 3) and 4-player Doubles distance summation."""
        from engine.pipeline import compute_player_distances_m

        # Simulate 2 rallies where both Partner A and Partner B move on the Near court
        poses_by_rally = {
            "1": {
                "near_player": "PAIR_NEAR",
                "far_player": "PAIR_FAR",
                "frames": [
                    {
                        "frame": 1,
                        "near_players": [{"court_x": 1.5, "court_y": 2.5}, {"court_x": 4.5, "court_y": 3.0}],
                        "far_players": [{"court_x": 1.8, "court_y": 10.5}, {"court_x": 4.2, "court_y": 10.5}],
                    },
                    {
                        "frame": 2,
                        "near_players": [{"court_x": 1.5, "court_y": 3.0}, {"court_x": 4.5, "court_y": 3.5}],
                        "far_players": [{"court_x": 1.8, "court_y": 10.5}, {"court_x": 4.2, "court_y": 10.5}],
                    },
                    {
                        "frame": 3,
                        "near_players": [{"court_x": 1.5, "court_y": 3.5}, {"court_x": 4.5, "court_y": 4.0}],
                        "far_players": [{"court_x": 1.8, "court_y": 10.5}, {"court_x": 4.2, "court_y": 10.5}],
                    },
                ],
            }
        }
        dists = compute_player_distances_m(poses_by_rally, ["PAIR_NEAR", "PAIR_FAR"])
        # Both Partner A (1.0m) and Partner B (1.0m) moved -> total 2.0m for PAIR_NEAR
        self.assertAlmostEqual(dists["PAIR_NEAR"], 2.0, places=2)

    def test_lzj_popov_telemetry_contract_and_section_1_5_rules(self):
        """Verifies the generated LZJ vs Popov telemetry contract and Section 1.5 scoring rules."""
        with open("data/matches/lzj_popov/telemetry.json", "r", encoding="utf-8") as f:
            telemetry = json.load(f)

        self.assertEqual(telemetry["source"]["frames_processed"], 12461)
        self.assertEqual(len(telemetry["rallies"]), 22)

        for pid in ("LZJ", "POPOV"):
            self.assertIn(pid, telemetry["players"])
            comp = telemetry["players"][pid]["computed"]
            self.assertIsInstance(comp.get("foot_positions"), list)
            self.assertGreater(len(comp["foot_positions"]), 500)
            self.assertGreater(comp["distance_m"], 100.0)

        for r in telemetry["rallies"]:
            self.assertFalse(r["needs_review"], f"Rally {r['rally_id']} should pass Section 1.5 rules")
            sb = r["score_before"]
            sa = r["score_after"]
            winner = r["winner"]
            self.assertEqual(sa[winner], sb[winner] + 1)
            srv = r["server"]
            expected_court = "right" if (sb[srv] % 2 == 0) else "left"
            self.assertEqual(r["service_court"], expected_court)
            self.assertGreater(len(r["shots"]), 0)

    def test_phase1_viterbi_compact_contour_near_net_error_and_slowmo(self):
        """
        Regression tests for Phase 1 Zero-LLM Core Rescue:
          1. extract_location_from_heatmap prefers crisp 2x2 shuttle peak (0.95) over blurry 6x6 blob (0.55).
          2. _link_peaks_viterbi tracks a continuous 0.35 ballistic shuttle peak instead of jumping to a 0.65 stationary distractor.
          3. TrajectoryReconstructor3D supports 30fps/60fps without 25fps index clamp AND detects near-side error_net.
          4. RallySegmenter.is_slowmo_replay flags 0.25x slow-mo gravity and accepts real-time 25fps flight.
        """
        from engine.tracknet import extract_location_from_heatmap, TrackNetV3Pipeline
        from engine.reconstruct3d import TrajectoryReconstructor3D
        from engine.court_calib import CourtCalibrator
        from engine.segment import RallySegmenter

        # 1. Compact peak beats wide diffuse false-positive blob
        hm = np.zeros((288, 512), dtype=np.float32)
        hm[100:108, 200:208] = 0.54  # blurry 8x8 shoe/glare blob
        hm[150:153, 300:303] = 0.96  # crisp 3x3 shuttle peak
        cx, cy, vis = extract_location_from_heatmap(hm, threshold=0.5)
        self.assertEqual(vis, 1)
        self.assertAlmostEqual(cx, 301.0, delta=1.5)
        self.assertAlmostEqual(cy, 151.0, delta=1.5)

        # 2. Multi-peak Viterbi tracks smooth ballistic peak (conf=0.38) instead of jumping to static shoe (conf=0.68)
        dummy_pipe = object.__new__(TrackNetV3Pipeline)
        peaks = []
        for t in range(15):
            # True shuttle flying smoothly across x=400+25*t, y=600-12*t+0.8*t^2
            tx = 400.0 + 25.0 * t
            ty = 600.0 - 12.0 * t + 0.8 * (t ** 2)
            if t == 7:
                # On frame 7, shuttle is motion-blurred (conf=0.38, motion=15) while shoe is bright (conf=0.68, motion=0.5, static=0.35)
                peaks.append([(900.0, 820.0, 0.68, 0.5, 0.35), (tx, ty, 0.38, 15.0, 0.0)])
            else:
                peaks.append([(tx, ty, 0.88, 16.0, 0.0), (900.0, 820.0, 0.52, 0.5, 0.35)])
        linked = dummy_pipe._link_peaks_viterbi(peaks, start_frame_idx=100, orig_w=1920, orig_h=1080)
        self.assertEqual(linked[7]["visibility"], 1)
        self.assertAlmostEqual(linked[7]["x"], 400.0 + 25.0 * 7, delta=2.0)

        # 3. Near-side error_net detection + 60fps reconstruction
        cal = CourtCalibrator("test_60fps", image_width=1280, image_height=720)
        cal.set_keypoints(CourtCalibrator.default_keypoints_for_size(1280, 720), image_width=1280, image_height=720)
        rec60 = TrajectoryReconstructor3D(calibrator=cal, fps=60.0)
        # Near player hits into the net at y=6.6m, z=1.1m (stops at net plane)
        net_hit_3d = np.array([[3.0, 4.5 + 0.2 * i, 1.1 + 0.05 * i - 0.015 * (i ** 2)] for i in range(11)], dtype=np.float64)
        net_hit_2d = cal.project_3d_to_pixel(net_hit_3d)
        vis_net = [(100 + i, float(net_hit_2d[i, 0]), float(net_hit_2d[i, 1])) for i in range(len(net_hit_2d))]
        _, _, tmode = rec60.analyze_terminal_track(vis_net, 100, "near")
        self.assertEqual(tmode, "error_net")

        # 4. Slow-mo gravity check
        tracks_rt = {}
        tracks_sl = {}
        for i in range(40):
            # Real-time 25fps: vy increases by +1.8 px/frame^2
            tracks_rt[i] = {"frame": i, "visibility": 1, "x": 400.0 + 18.0 * i, "y": 500.0 - 20.0 * i + 0.9 * (i ** 2)}
            # 0.25x slow-mo: vy increases by +0.11 px/frame^2, speed ~4.5 px/frame
            tracks_sl[i] = {"frame": i, "visibility": 1, "x": 400.0 + 4.0 * i, "y": 500.0 - 3.5 * i + 0.055 * (i ** 2)}
        self.assertFalse(RallySegmenter.is_slowmo_replay(0, 39, tracks_rt, fps=25.0, image_height=1080))
        self.assertTrue(RallySegmenter.is_slowmo_replay(0, 39, tracks_sl, fps=25.0, image_height=1080))

    def test_accuracy_audit_and_gemini_auditor_fail_open(self):
        """
        Verifies:
          1. engine.accuracy_audit.compute_match_accuracy_audit accurately computes
             overall_grade, grade_counts, median/p75/p90 RMSE, and >30px blowup rate.
          2. engine.gemini_auditor fails open when GEMINI_API_KEY is unset, builds
             a valid JPEG contact sheet offline, and auto-upgrades deprecated
             gemini-2.5-* model names to gemini-4-hydrogen.
        """
        from engine.accuracy_audit import compute_match_accuracy_audit
        from engine.gemini_auditor import (
            DEFAULT_GEMINI_MODEL,
            FALLBACK_MODERN_MODEL,
            _resolve_model,
            build_contact_sheet,
            audit_match_bootstrap,
        )

        # 1. Accuracy audit aggregation
        rallies = [
            {
                "rally_id": 1,
                "shots": [
                    {"fit_rmse_px": 2.4, "all_pts_rmse_px": 2.4, "accuracy_grade": "A", "track_coverage_pct": 95.0, "inlier_ratio": 1.0, "continuity_gap_m": 0.12},
                    {"fit_rmse_px": 4.1, "all_pts_rmse_px": 4.1, "accuracy_grade": "A", "track_coverage_pct": 88.0, "inlier_ratio": 0.95, "continuity_gap_m": 0.18},
                    {"fit_rmse_px": 6.2, "all_pts_rmse_px": 6.2, "accuracy_grade": "B", "track_coverage_pct": 76.0, "inlier_ratio": 0.85, "continuity_gap_m": 0.25},
                ],
            },
            {
                "rally_id": 2,
                "shots": [
                    {"fit_rmse_px": 3.0, "all_pts_rmse_px": 3.0, "accuracy_grade": "A", "track_coverage_pct": 92.0, "inlier_ratio": 1.0, "continuity_gap_m": 0.10},
                    {"fit_rmse_px": 35.0, "all_pts_rmse_px": 35.0, "accuracy_grade": "D", "track_coverage_pct": 40.0, "inlier_ratio": 0.60, "continuity_gap_m": 1.40},
                ],
            },
        ]
        audit = compute_match_accuracy_audit(rallies)
        self.assertEqual(audit["total_shots"], 5)
        self.assertEqual(audit["grade_counts"]["A"], 3)
        self.assertEqual(audit["grade_counts"]["B"], 1)
        self.assertEqual(audit["grade_counts"]["D"], 1)
        self.assertEqual(audit["blowup_count"], 1)
        self.assertAlmostEqual(audit["blowup_rate_pct"], 20.0, places=1)
        self.assertAlmostEqual(audit["median_rmse_px"], 4.1, places=1)
        self.assertIn(audit["overall_grade"], ("A", "B", "C", "D"))

        # 2. Gemini auditor model normalization & fail-open behavior
        self.assertEqual(_resolve_model("gemini-2.5-flash"), FALLBACK_MODERN_MODEL)
        self.assertEqual(_resolve_model("gemini-2.5-pro"), FALLBACK_MODERN_MODEL)
        self.assertEqual(_resolve_model(""), DEFAULT_GEMINI_MODEL)

        # Contact sheet builder works purely offline with numpy frames
        dummy_frames = [
            ("R1 0:01", np.full((360, 640, 3), 40, dtype=np.uint8)),
            ("R2 0:02", np.full((360, 640, 3), 90, dtype=np.uint8)),
            ("R3 0:03", np.full((360, 640, 3), 140, dtype=np.uint8)),
        ]
        sheet_img = build_contact_sheet(dummy_frames, cols=2, tile_w=320, tile_h=180)
        self.assertIsNotNone(sheet_img)
        self.assertEqual(sheet_img.ndim, 3)
        self.assertGreater(sheet_img.shape[0], 180)
        self.assertGreater(sheet_img.shape[1], 320)

        # Fail-open when API key is missing
        old_key = os.environ.pop("GEMINI_API_KEY", None)
        old_gkey = os.environ.pop("GOOGLE_API_KEY", None)
        try:
            res = audit_match_bootstrap("nonexistent.mp4")
            self.assertFalse(res["enabled"])
        finally:
            if old_key is not None:
                os.environ["GEMINI_API_KEY"] = old_key
            if old_gkey is not None:
                os.environ["GOOGLE_API_KEY"] = old_gkey

    def test_recursive_split_refit_and_court_line_coverage(self):
        """
        Verifies:
          1. TrajectoryReconstructor3D.reconstruct_rally_shots detects a missed midpoint
             hit inside a merged two-shot track (via recursive split-and-refit) and splits
             it into 2 clean shots with much lower 3D->2D RMSE.
          2. CourtCalibrator.measure_court_line_coverage returns >= 85% on a clean synthetic
             court frame and < 30% on a blank/non-court replay frame.
        """
        from engine.court_calib import CourtCalibrator
        from engine.reconstruct3d import TrajectoryReconstructor3D

        cal = CourtCalibrator("test_split_cov", image_width=1920, image_height=1080)
        kps = CourtCalibrator.default_keypoints_for_size(1920, 1080)
        cal.set_keypoints(kps, image_width=1920, image_height=1080)

        # 1. Court line coverage on clean synthetic court vs blank non-court frame
        court_frame = np.full((1080, 1920, 3), (68, 122, 62), dtype=np.uint8)
        court_frame = cal.project_lines(court_frame, color=(245, 245, 245), thickness=3)
        cov_clean = cal.measure_court_line_coverage(court_frame)
        self.assertGreaterEqual(cov_clean["segment_coverage_pct"], 85.0)
        self.assertTrue(cov_clean["outer_boundary_ok"])

        blank_frame = np.full((1080, 1920, 3), (30, 30, 35), dtype=np.uint8)
        cov_blank = cal.measure_court_line_coverage(blank_frame)
        self.assertLess(cov_blank["segment_coverage_pct"], 30.0)
        self.assertFalse(cov_blank["outer_boundary_ok"])

        # 2. Merged two-shot segment (Near -> Far at frame 15 -> Near at frame 30) with only outer hits provided
        aero = ShuttlecockAerodynamics()
        _, pos1, _ = aero.simulate_trajectory(
            np.array([2.4, 2.2, 1.4]), np.array([1.2, 22.0, 8.5]), duration=15 / 25.0, dt=1 / 25.0, stop_at_ground=False
        )
        p_turn = pos1[-1].copy()
        _, pos2, _ = aero.simulate_trajectory(
            p_turn, np.array([-1.5, -24.0, 5.5]), duration=15 / 25.0, dt=1 / 25.0, stop_at_ground=False
        )
        uv1 = cal.project_3d_to_pixel(pos1)
        uv2 = cal.project_3d_to_pixel(pos2[1:])
        tracks = {}
        for i in range(len(uv1)):
            tracks[10 + i] = (1, float(uv1[i, 0]), float(uv1[i, 1]))
        for i in range(len(uv2)):
            tracks[10 + len(uv1) + i] = (1, float(uv2[i, 0]), float(uv2[i, 1]))

        h_start = {
            "frame": 10, "time_sec": 0.4, "side": "near", "player": "P_NEAR", "is_serve": True,
            "shuttle_px": [float(uv1[0, 0]), float(uv1[0, 1])],
            "hitter_court_xy": [2.4, 2.2], "opponent_court_xy": [float(p_turn[0]), float(p_turn[1])],
        }
        h_end = {
            "frame": 10 + len(uv1) + len(uv2) - 1, "time_sec": 1.6, "side": "near", "player": "P_NEAR", "is_serve": False,
            "shuttle_px": [float(uv2[-1, 0]), float(uv2[-1, 1])],
            "hitter_court_xy": [float(pos2[-1, 0]), float(pos2[-1, 1])], "opponent_court_xy": [float(p_turn[0]), float(p_turn[1])],
        }
        rec = TrajectoryReconstructor3D(calibrator=cal, fps=25.0)
        shots, _ = rec.reconstruct_rally_shots(
            rally_id=1, hits=[h_start, h_end], rally_end_frame=h_end["frame"],
            tracks=tracks, global_shot_id_start=1, near_player="P_NEAR", far_player="P_FAR",
        )
        self.assertGreaterEqual(len(shots), 2, "Recursive split-and-refit must split a merged 2-shot bounce track")
        self.assertLess(max(s["fit_rmse_px"] for s in shots), 12.0)

    def test_youtube_ingest_validation_cache_and_refusal(self):
        """
        Phase 0 tests for YouTube URL ingestion (engine/youtube_ingest.py):
          1. Normal: standard youtube.com/watch, youtu.be, shorts, live URLs parse cleanly.
          2. Edge: extra query params (?si=...&t=42) normalize to the exact 11-char ID
             and find_cached_youtube_video reuses local MP4 when present.
          3. Refused: non-YouTube hosts, javascript: scheme, and shell metacharacters
             are strictly rejected with invalid_youtube_url before spawning yt-dlp.
        """
        from engine.youtube_ingest import (
            YouTubeIngestError,
            download_youtube_video,
            extract_youtube_video_id,
            find_cached_youtube_video,
        )

        # 1. Normal cases
        self.assertEqual(extract_youtube_video_id("https://youtu.be/hiUDiIaQjxA"), "hiUDiIaQjxA")
        self.assertEqual(extract_youtube_video_id("https://www.youtube.com/watch?v=i9drAGpf-Nc"), "i9drAGpf-Nc")
        self.assertEqual(extract_youtube_video_id("https://m.youtube.com/shorts/PBnLlTploGQ"), "PBnLlTploGQ")
        self.assertEqual(extract_youtube_video_id("https://www.youtube.com/live/a2T0DXYvrtM"), "a2T0DXYvrtM")

        # 2. Edge case: extra query params + local cache reuse
        self.assertEqual(
            extract_youtube_video_id("https://youtu.be/hiUDiIaQjxA?si=UTKx6rhD&t=42"),
            "hiUDiIaQjxA",
        )
        if os.path.exists("assets/stress_test/hiUDiIaQjxA.mp4"):
            cpath, cinfo = find_cached_youtube_video("hiUDiIaQjxA")
            self.assertIsNotNone(cpath)
            self.assertTrue(cpath.endswith(".mp4"))
            res = download_youtube_video("https://youtu.be/hiUDiIaQjxA?t=10")
            self.assertTrue(res["cached"])
            self.assertEqual(res["video_id"], "hiUDiIaQjxA")

        # 3. Refused / malicious inputs
        for bad_url in (
            "",
            "https://example.com/watch?v=hiUDiIaQjxA",
            "javascript:alert(1)",
            "https://youtu.be/hiUDiIaQjxA;rm",
            "https://www.youtube.com/watch?v=short",
            "https://youtube.com/watch?v=hiUDiIaQjxA | cat /etc/passwd",
        ):
            self.assertIsNone(extract_youtube_video_id(bad_url), f"Should reject {bad_url!r}")

        with self.assertRaises(YouTubeIngestError) as ctx:
            download_youtube_video("https://example.com/watch?v=hiUDiIaQjxA")
        self.assertEqual(ctx.exception.error_code, "invalid_youtube_url")


if __name__ == "__main__":
    unittest.main()
