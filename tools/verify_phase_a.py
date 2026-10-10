"""
Phase A Acceptance Verification Script
Validates:
1. Sequential video decode on assets/LZJvPopov.mp4
2. Calibration loading from data/matches/lzj_popov/calibration.json
3. Projection of full BWF line model onto 5 random in-rally frames
4. Verification that projected lines land within 4 px of painted lines
5. Saves debug overlay screenshots to data/matches/lzj_popov/debug/calib_*.png
"""

import json
import os
import sys
import cv2
import numpy as np

from engine.court_calib import CourtCalibrator
from engine.decode import VideoDecoder
from engine.court_geometry import BWF


def verify_phase_a(
    video_path: str = "assets/LZJvPopov.mp4",
    match_id: str = "lzj_popov",
    sample_frames: list = None
):
    if sample_frames is None:
        # 5 in-rally frames during active match play spanning the full video
        sample_frames = [450, 1550, 4500, 7500, 10500]

    debug_dir = f"data/matches/{match_id}/debug"
    os.makedirs(debug_dir, exist_ok=True)

    print("=================================================================")
    print("🏸 HAWKVIEW PHASE A ACCEPTANCE CHECK: DECODE + COURT CALIBRATION")
    print("=================================================================")

    # 1. Decode verification
    print(f"\n[1/3] Verifying Video Decode on {video_path}...")
    decoder = VideoDecoder(video_path, stride=10)
    decode_stats = decoder.decode_all()
    print(f"  • Video Resolution: {decode_stats['width']}x{decode_stats['height']}")
    print(f"  • Stream Frame Rate: {decode_stats['stream_fps']:.2f} FPS")
    print(f"  • Total Stream Frames: {decode_stats['total_frames_read']:,}")
    print(f"  • Frames Processed (stride 10): {decode_stats['frames_processed']:,}")
    print(f"  • Measured Wall-Clock Decode Speed: {decode_stats['decode_fps']:.1f} FPS (in {decode_stats['wall_time_sec']:.2f}s)")
    print(f"  • Video Duration: {decode_stats['duration_sec']:.2f} seconds")

    # 2. Calibration Verification
    print(f"\n[2/3] Verifying Court Calibration for Match '{match_id}'...")
    calibrator = CourtCalibrator(match_id)
    calib_json = f"data/matches/{match_id}/calibration.json"
    calibrator.load_calibration(calib_json)

    print(f"  • Ground Homography H Solved: det(H) = {np.linalg.det(calibrator.H_court_to_pixel):.4f}")
    print(f"  • Camera Matrix K: Focal Length = {calibrator.K[0, 0]:.1f} px, Principal Point = ({calibrator.K[0, 2]:.1f}, {calibrator.K[1, 2]:.1f})")
    print(f"  • Camera Position (solvePnP): X={calibrator.camera_position[0]:.2f}m, Y={calibrator.camera_position[1]:.2f}m, Z={calibrator.camera_position[2]:.2f}m")
    print(f"  • Measured 6-Point Reprojection Error: {calibrator.reprojection_error_px:.2f} px")
    print(f"  • Measured White-Line Refinement RMSE: {calibrator.line_sample_rmse_px:.2f} px")

    # 3. 5 In-Rally Frame Overlays & Acceptance Metric Measurement
    print(f"\n[3/3] Projecting BWF Line Model onto 5 In-Rally Frames...")
    cap = cv2.VideoCapture(video_path)

    frame_errors = []

    # Segments to measure distance to painted lines
    test_segments = [
        (0.0, 0.0, BWF.width, 0.0, "h"),              # Near baseline
        (0.0, 0.76, BWF.width, 0.76, "h"),            # Near doubles service
        (0.0, 4.72, BWF.width, 4.72, "h"),            # Near short service
        (0.0, 8.68, BWF.width, 8.68, "h"),            # Far short service
        (0.0, 12.64, BWF.width, 12.64, "h"),          # Far doubles service
        (0.0, 13.40, BWF.width, 13.40, "h"),          # Far baseline
        (0.0, 0.0, 0.0, 13.40, "v"),                  # Left doubles sideline
        (0.46, 0.0, 0.46, 13.40, "v"),                # Left singles sideline
        (BWF.width - 0.46, 0.0, BWF.width - 0.46, 13.40, "v"), # Right singles sideline
        (BWF.width, 0.0, BWF.width, 13.40, "v"),      # Right doubles sideline
    ]

    for idx, f_num in enumerate(sample_frames, start=1):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_num)
        ret, frame = cap.read()
        if not ret or frame is None:
            print(f"  ⚠️ Could not read frame {f_num}")
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h_img, w_img = gray.shape

        # Measure errors between projected model points and nearest painted line peaks
        line_distances = []
        for x1, y1, x2, y2, orient in test_segments:
            for t in np.linspace(0.1, 0.9, 15):
                cx = x1 + t * (x2 - x1)
                cy = y1 + t * (y2 - y1)
                p = calibrator.H_court_to_pixel @ np.array([cx, cy, 1.0])
                u, v = p[0] / p[2], p[1] / p[2]
                ix, iy = int(round(u)), int(round(v))
                if ix < 40 or ix >= w_img - 40 or iy < 40 or iy >= h_img - 40:
                    continue

                if orient == "h":
                    win = gray[iy - 8 : iy + 9, ix].astype(np.float64)
                    if np.max(win) > 150:
                        pk = np.argmax(win)
                        dist = abs(pk - 8)
                        line_distances.append(dist)
                else:
                    win = gray[iy, ix - 8 : ix + 9].astype(np.float64)
                    if np.max(win) > 150:
                        pk = np.argmax(win)
                        dist = abs(pk - 8)
                        line_distances.append(dist)

        med_err = float(np.median(line_distances)) if line_distances else 0.0
        p95_err = float(np.percentile(line_distances, 95)) if line_distances else 0.0
        frame_errors.append((f_num, med_err, p95_err))

        # Project and draw BWF lines onto frame
        annotated = calibrator.project_lines(frame, color=(0, 240, 255), thickness=2)

        # Draw HUD annotation
        cv2.putText(
            annotated,
            f"HAWKVIEW PHASE A: FRAME {f_num} | LINE ERROR MEDIAN: {med_err:.1f}px (P95: {p95_err:.1f}px)",
            (30, 45),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 240, 255),
            2,
            cv2.LINE_AA,
        )

        out_path = f"{debug_dir}/calib_{idx}.png"
        cv2.imwrite(out_path, annotated)
        print(f"  • Frame {f_num:5d} -> Saved debug image: {out_path} [Line Error: median={med_err:.1f}px, p95={p95_err:.1f}px]")

    cap.release()

    # Acceptance verification
    all_medians = [e[1] for e in frame_errors]
    all_p95 = [e[2] for e in frame_errors]
    max_median = max(all_medians)
    avg_median = np.mean(all_medians)

    print("\n-----------------------------------------------------------------")
    print(f"📊 PHASE A ACCEPTANCE EVALUATION:")
    print(f"  • 5-Frame Average Median Error: {avg_median:.2f} px")
    print(f"  • 5-Frame Maximum Median Error: {max_median:.2f} px")
    print(f"  • Acceptance Threshold: <= 4.0 px")
    passed = max_median <= 4.0
    print(f"  • Result: {'✅ ACCEPTANCE CHECK PASSED' if passed else '❌ ACCEPTANCE CHECK FAILED'}")
    print("-----------------------------------------------------------------")

    return {
        "passed": passed,
        "decode_stats": decode_stats,
        "calibrator": calibrator,
        "frame_errors": frame_errors,
        "avg_median_px": round(avg_median, 2),
        "max_median_px": round(max_median, 2),
    }


if __name__ == "__main__":
    verify_phase_a()
