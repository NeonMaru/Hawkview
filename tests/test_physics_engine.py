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
                    # Skip raw coordinate arrays (H, K, R, t, path, trajectory_3d, foot_positions)
                    if path.endswith((".H", ".K", ".R", ".t", ".path", ".trajectory_3d", ".foot_positions")):
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


if __name__ == "__main__":
    unittest.main()
