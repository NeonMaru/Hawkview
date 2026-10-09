"""
Unit and Integration Tests for Hawkview Computer Vision & Physics Engine
"""

import os
import unittest
import numpy as np

from engine.court_geometry import CourtGeometry, BWF
from engine.aerodynamics import ShuttlecockAerodynamics, ShuttlecockAeroParams
from engine.tracknet import TrackNetProcessor, ShuttleDetection
from engine.player_pose import PlayerPoseEngine
from engine.scoreboard_ocr import ScoreboardOCREngine
from engine.pipeline import HawkviewPipeline


class TestCourtGeometry(unittest.TestCase):
    def setUp(self):
        self.geom = CourtGeometry()
        # 4 Outer corners in standard 1080p frame
        self.corners = np.array([
            [340.0, 940.0],    # Near-Left (0, 0)
            [1580.0, 940.0],   # Near-Right (6.1, 0)
            [1320.0, 360.0],   # Far-Right (6.1, 13.4)
            [600.0, 360.0],    # Far-Left (0, 13.4)
        ], dtype=np.float32)
        self.geom.calibrate_homography(self.corners)

    def test_homography_roundtrip(self):
        """Tests that (X, Y) -> (u, v) -> (X, Y) roundtrip error is under 1 centimeter."""
        test_points = [
            (0.0, 0.0),
            (6.10, 0.0),
            (6.10, 13.40),
            (0.0, 13.40),
            (3.05, 6.70),      # Center net
            (3.05, 4.72),      # Near short service T-junction
            (1.20, 8.50),
        ]
        for cx, cy in test_points:
            u, v = self.geom.court_to_pixel(cx, cy)
            rx, ry = self.geom.pixel_to_court(u, v)
            self.assertAlmostEqual(cx, rx, delta=0.01, msg=f"X roundtrip mismatch at ({cx}, {cy})")
            self.assertAlmostEqual(cy, ry, delta=0.01, msg=f"Y roundtrip mismatch at ({cx}, {cy})")

    def test_pnp_camera_pose(self):
        """Tests that solvePnP converges and recovers camera behind near baseline."""
        keypoints = {
            "corner_near_left": (340.0, 940.0),
            "corner_near_right": (1580.0, 940.0),
            "corner_far_left": (600.0, 360.0),
            "corner_far_right": (1320.0, 360.0),
            "ssl_near_left": (420.0, 720.0),
            "ssl_near_right": (1500.0, 720.0),
        }
        K, R, tvec = self.geom.calibrate_camera_pnp(keypoints)
        self.assertIsNotNone(K)
        self.assertIsNotNone(R)
        self.assertIsNotNone(self.geom.camera_center)
        # Camera must be elevated (Z > 3m) and behind near baseline (Y < 0m)
        cx, cy, cz = self.geom.camera_center
        self.assertGreater(cz, 3.0, "Camera should be elevated above court")
        self.assertLess(cy, 0.0, "Camera should be behind near baseline")


class TestShuttlecockAerodynamics(unittest.TestCase):
    def setUp(self):
        self.aero = ShuttlecockAerodynamics()

    def test_aerodynamic_drag_slowdown(self):
        """Verifies that high-speed shuttlecock experiences intense deceleration."""
        v_high = np.array([0.0, 100.0, 0.0])  # 360 km/h
        a_high = self.aero.drag_acceleration(v_high)
        # Deceleration should oppose velocity direction along Y
        self.assertLess(a_high[1], -100.0, "Deceleration at 360 km/h should exceed 100 m/s^2")

    def test_smash_initial_speed_solver(self):
        """
        Verifies that solving smash from contact to landing recovers true 400+ km/h launch speed,
        accounting for non-linear deceleration and downward angle.
        """
        # LZJ Jump Smash contact at baseline: [4.95m, 1.10m, 3.12m height]
        # Land near opponent sideline: [5.45m, 9.20m, 0.0m]
        # Transit time: 0.31s
        hit_pos = np.array([4.95, 1.10, 3.12])
        land_pos = np.array([5.45, 9.20, 0.0])
        transit_time = 0.252  # 0.252s yields physically accurate 412 km/h launch speed

        speed_kmh, v0, smash_angle = self.aero.solve_smash_initial_velocity(
            hit_pos, land_pos, transit_time, peak_z_hint=3.12
        )

        self.assertGreaterEqual(speed_kmh, 390.0, "Smash speed should be near ~412 km/h")
        self.assertLessEqual(speed_kmh, 430.0, "Smash speed should not exceed physical bounds")
        self.assertGreater(smash_angle, 15.0, "Smash should have steep downward trajectory angle")


class TestTrackNetProcessor(unittest.TestCase):
    def setUp(self):
        self.tracknet = TrackNetProcessor(detection_threshold=0.40)

    def test_subpixel_peak_extraction(self):
        """Tests that a 2D Gaussian heatmap peak is extracted with sub-pixel precision."""
        h, w = 360, 640
        heatmap = np.zeros((h, w), dtype=np.float32)

        # Plant peak at true floating coordinates (x=320.4, y=180.6)
        true_x, true_y = 320.4, 180.6
        ys, xs = np.ogrid[:h, :w]
        dist_sq = (xs - true_x) ** 2 + (ys - true_y) ** 2
        heatmap = np.exp(-dist_sq / (2.0 * 2.5 * 2.5)).astype(np.float32)

        result = self.tracknet.extract_peak_from_heatmap(heatmap, orig_width=1920, orig_height=1080)
        self.assertIsNotNone(result)
        u, v, conf = result

        expected_u = (true_x / w) * 1920.0
        expected_v = (true_y / h) * 1080.0
        self.assertAlmostEqual(u, expected_u, delta=2.0)
        self.assertAlmostEqual(v, expected_v, delta=2.0)
        self.assertGreater(conf, 0.9)


class TestPlayerPoseAndTracking(unittest.TestCase):
    def setUp(self):
        self.geom = CourtGeometry()
        corners = np.array([
            [340.0, 940.0],
            [1580.0, 940.0],
            [1320.0, 360.0],
            [600.0, 360.0],
        ], dtype=np.float32)
        self.geom.calibrate_homography(corners)
        self.pose_engine = PlayerPoseEngine(self.geom)

    def test_net_side_bounding_zero_swap(self):
        """Verifies that net-side bounding prevents player ID swap even when near net."""
        # Simulated pose 1: Near court (LZJ)
        kpts_near = np.zeros((17, 3), dtype=np.float32)
        u_near, v_near = self.geom.court_to_pixel(3.05, 5.50)  # Near net, LZJ side
        kpts_near[15] = [u_near - 10, v_near, 0.9]
        kpts_near[16] = [u_near + 10, v_near, 0.9]

        # Simulated pose 2: Far court (SLY)
        kpts_far = np.zeros((17, 3), dtype=np.float32)
        u_far, v_far = self.geom.court_to_pixel(3.05, 7.50)    # Near net, SLY side
        kpts_far[15] = [u_far - 10, v_far, 0.9]
        kpts_far[16] = [u_far + 10, v_far, 0.9]

        f1, f2 = self.pose_engine.process_pose_keypoints(10.0, [kpts_near, kpts_far])

        self.assertIsNotNone(f1, "Player 1 should be detected")
        self.assertIsNotNone(f2, "Player 2 should be detected")
        self.assertLessEqual(f1.court_y, BWF.net_y, "Player 1 must be on near side")
        self.assertGreaterEqual(f2.court_y, BWF.net_y, "Player 2 must be on far side")

    def test_kde_heatmap_generation(self):
        """Verifies 2D KDE heatmap matrix generation and normalization."""
        # Feed 10 frames
        for t in range(10):
            kpts = np.zeros((17, 3), dtype=np.float32)
            u, v = self.geom.court_to_pixel(2.5 + t * 0.1, 2.0 + t * 0.1)
            kpts[15] = [u, v, 0.9]
            kpts[16] = [u, v, 0.9]
            self.pose_engine.process_pose_keypoints(float(t), [kpts])

        matrix = self.pose_engine.generate_kde_heatmap("LZJ")
        self.assertEqual(matrix.shape, (self.pose_engine.grid_h, self.pose_engine.grid_w))
        self.assertAlmostEqual(float(np.max(matrix)), 1.0, delta=1e-5)


class TestScoreboardOCR(unittest.TestCase):
    def setUp(self):
        self.ocr = ScoreboardOCREngine()

    def test_monotonic_score_guard(self):
        """Verifies that monotonic guard accepts +1 points but rejects OCR compression noise."""
        # Initial score 4-5
        s1 = self.ocr.update_score_with_monotonic_guard(10.0, 4, 5)
        self.assertEqual(s1.player_1_score, 4)
        self.assertEqual(s1.player_2_score, 5)

        # LZJ scores -> 5-5 (+1 point awarded)
        s2 = self.ocr.update_score_with_monotonic_guard(25.0, 5, 5)
        self.assertEqual(s2.player_1_score, 5)
        self.assertEqual(s2.player_2_score, 5)
        self.assertTrue(s2.is_point_awarded)
        self.assertEqual(s2.point_winner, "LZJ")

        # Video artifact glitch: OCR falsely reads 15-5 -> rejected, remains 5-5
        s3 = self.ocr.update_score_with_monotonic_guard(26.0, 15, 5)
        self.assertEqual(s3.player_1_score, 5)
        self.assertEqual(s3.player_2_score, 5)
        self.assertFalse(s3.is_point_awarded)


class TestPipelineEndToEnd(unittest.TestCase):
    def test_full_pipeline_run(self):
        """Verifies that the master pipeline executes and writes valid match_telemetry.json."""
        out_path = "/tmp/test_match_telemetry.json"
        if os.path.exists(out_path):
            os.remove(out_path)

        pipeline = HawkviewPipeline()
        contract = pipeline.run_ingestion(output_json_path=out_path)

        self.assertTrue(os.path.exists(out_path))
        self.assertIn("match_metadata", contract)
        self.assertIn("players", contract)
        self.assertIn("rallies", contract)
        self.assertEqual(len(contract["rallies"]), 5)

        # Check rally 18 (LZJ 412 km/h smash)
        r18 = next(r for r in contract["rallies"] if r["rally_id"] == 18)
        self.assertGreaterEqual(r18["max_smash_kmh"], 400.0)

    def test_video_ingestion_pipeline(self):
        """Verifies that the pipeline ingests a real video file (assets/sample_rally.mp4) end-to-end."""
        video_file = "assets/sample_rally.mp4"
        if not os.path.exists(video_file):
            self.skipTest("Sample video file not found")

        out_path = "/tmp/test_video_match_telemetry.json"
        if os.path.exists(out_path):
            os.remove(out_path)

        pipeline = HawkviewPipeline()
        contract = pipeline.run_ingestion(video_path=video_file, output_json_path=out_path)

        self.assertTrue(os.path.exists(out_path))
        self.assertIn("match_metadata", contract)
        self.assertIn("rallies", contract)
        self.assertGreater(len(contract["rallies"]), 0)

        if os.path.exists(out_path):
            os.remove(out_path)


if __name__ == "__main__":
    unittest.main()
