"""
Hawkview Sample Match Video Generator
Generates a broadcast-quality synthetic BWF Arctic Open match rally video (assets/sample_rally.mp4)
at 1280x720 @ 30 FPS, depicting:
- BWF Regulation Emerald Green Court with perspective lines
- Stadium arena surround and floodlights
- Players (Lee Zii Jia in cyan kit, Su Li Yang in orange kit) executing shots
- Realistic 3D ballistic shuttlecock trajectories
- 412 km/h nuclear jump smash sequence
- Official BWF TV scorebug overlay
- H.264 MP4 encoding with faststart for zero-latency HTML5 video playback
"""

import os
import subprocess
import tempfile
import numpy as np
import cv2

from engine.court_geometry import CourtGeometry, BWF


def create_sample_rally_video(
    output_path: str = "assets/sample_rally.mp4",
    width: int = 1280,
    height: int = 720,
    fps: int = 30
):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # 1. Setup Camera Geometry & Calibration for 1280x720 Frame
    geom = CourtGeometry()

    # BWF Broadcast Camera Calibration Keypoints on 1280x720 canvas
    # (scaled proportionally from 1920x1080)
    sx = width / 1920.0
    sy = height / 1080.0

    keypoints_pixels = {
        "corner_near_left": (340.0 * sx, 940.0 * sy),
        "corner_near_right": (1580.0 * sx, 940.0 * sy),
        "corner_far_left": (600.0 * sx, 360.0 * sy),
        "corner_far_right": (1320.0 * sx, 360.0 * sy),
        "ssl_near_left": (420.0 * sx, 720.0 * sy),
        "ssl_near_right": (1500.0 * sx, 720.0 * sy),
        "ssl_far_left": (540.0 * sx, 480.0 * sy),
        "ssl_far_right": (1380.0 * sx, 480.0 * sy),
    }

    # Calibrate homography
    pixel_corners = np.array([
        keypoints_pixels["corner_near_left"],
        keypoints_pixels["corner_near_right"],
        keypoints_pixels["corner_far_right"],
        keypoints_pixels["corner_far_left"],
    ], dtype=np.float32)
    geom.calibrate_homography(pixel_corners)
    geom.calibrate_camera_pnp(keypoints_pixels, image_shape=(height, width), fov_vertical_deg=44.0)

    # 2. Rally Script: Rally #18 (Duration: ~19 seconds)
    # LZJ 412 km/h nuclear smash rally
    total_duration_sec = 19.1
    total_frames = int(total_duration_sec * fps)

    # Shots definition in rally
    shots = [
        {
            "start": 0.0, "end": 1.4,
            "hitter": "SLY", "stroke": "Low Serve",
            "from": [3.05, 8.68, 1.15], "to": [1.10, 0.55, 0.0], "peak_z": 1.65, "speed": 82
        },
        {
            "start": 1.4, "end": 3.2,
            "hitter": "LZJ", "stroke": "High Deep Lift",
            "from": [1.10, 0.55, 0.45], "to": [5.20, 12.80, 0.0], "peak_z": 6.80, "speed": 172
        },
        {
            "start": 3.2, "end": 4.8,
            "hitter": "SLY", "stroke": "Attacking Clear",
            "from": [5.20, 12.80, 2.20], "to": [1.80, 1.20, 0.0], "peak_z": 5.40, "speed": 185
        },
        {
            "start": 4.8, "end": 6.2,
            "hitter": "LZJ", "stroke": "Cross Net Tumble",
            "from": [1.80, 1.20, 0.60], "to": [4.90, 7.80, 0.0], "peak_z": 1.62, "speed": 74
        },
        {
            "start": 6.2, "end": 7.6,
            "hitter": "SLY", "stroke": "Desperate Net Lift",
            "from": [4.90, 7.80, 0.35], "to": [4.95, 1.10, 0.0], "peak_z": 5.90, "speed": 156
        },
        {
            "start": 7.6, "end": 8.05,
            "hitter": "LZJ", "stroke": "NUCLEAR JUMP SMASH",
            "from": [4.95, 1.10, 3.12], "to": [0.85, 9.40, 0.0], "peak_z": 3.12, "speed": 412,
            "is_smash": True
        },
        {
            "start": 8.05, "end": 19.1,
            "hitter": "LZJ", "stroke": "Celebration & Reset",
            "from": [0.85, 9.40, 0.0], "to": [0.85, 9.40, 0.0], "peak_z": 0.0, "speed": 0,
            "is_dead": True
        }
    ]

    # Pre-render static court background
    bg_frame = np.zeros((height, width, 3), dtype=np.uint8)

    # Arena background: deep navy gradient with top floodlights
    for y in range(height):
        ratio = y / height
        # Gradient from stadium dark blue (18, 26, 40) to floor blue (10, 15, 24)
        b = int(24 * (1 - ratio) + 40 * ratio)
        g = int(15 * (1 - ratio) + 26 * ratio)
        r = int(10 * (1 - ratio) + 18 * ratio)
        bg_frame[y, :] = (b, g, r)

    # Green Court Mat Polygon
    mat_corners_3d = [
        [-0.5, -0.6, 0.0],
        [6.6, -0.6, 0.0],
        [6.6, 14.0, 0.0],
        [-0.5, 14.0, 0.0],
    ]
    mat_poly = []
    for pt in mat_corners_3d:
        px, py = geom.project_3d_to_pixel(pt[0], pt[1], pt[2])
        mat_poly.append([int(px), int(py)])
    cv2.fillPoly(bg_frame, [np.array(mat_poly, dtype=np.int32)], (110, 118, 15))  # Emerald green

    # Draw BWF regulation court lines (white, 2px anti-aliased)
    line_color = (245, 245, 245)
    line_thickness = 2

    def draw_court_line(p1, p2, thick=line_thickness):
        u1, v1 = geom.project_3d_to_pixel(p1[0], p1[1], p1[2])
        u2, v2 = geom.project_3d_to_pixel(p2[0], p2[1], p2[2])
        cv2.line(bg_frame, (int(u1), int(v1)), (int(u2), int(v2)), line_color, thick, cv2.LINE_AA)

    # 1. Outer perimeter
    draw_court_line([0, 0, 0], [6.1, 0, 0], 3)
    draw_court_line([6.1, 0, 0], [6.1, 13.4, 0], 3)
    draw_court_line([6.1, 13.4, 0], [0, 13.4, 0], 3)
    draw_court_line([0, 13.4, 0], [0, 0, 0], 3)

    # 2. Singles tramlines
    draw_court_line([0.46, 0, 0], [0.46, 13.4, 0])
    draw_court_line([5.64, 0, 0], [5.64, 13.4, 0])

    # 3. Doubles service lines (0.76m inside baselines)
    draw_court_line([0, 0.76, 0], [6.1, 0.76, 0])
    draw_court_line([0, 12.64, 0], [6.1, 12.64, 0])

    # 4. Short service lines (1.98m from net)
    draw_court_line([0, 4.72, 0], [6.1, 4.72, 0])
    draw_court_line([0, 8.68, 0], [6.1, 8.68, 0])

    # 5. Center lines
    draw_court_line([3.05, 0, 0], [3.05, 4.72, 0])
    draw_court_line([3.05, 8.68, 0], [3.05, 13.4, 0])

    # 6. Net posts & cord
    post_color = (200, 200, 200)
    net_tape_color = (255, 255, 255)
    # Left post
    u_base_l, v_base_l = geom.project_3d_to_pixel(0, 6.70, 0)
    u_top_l, v_top_l = geom.project_3d_to_pixel(0, 6.70, 1.55)
    cv2.line(bg_frame, (int(u_base_l), int(v_base_l)), (int(u_top_l), int(v_top_l)), post_color, 4, cv2.LINE_AA)

    # Right post
    u_base_r, v_base_r = geom.project_3d_to_pixel(6.1, 6.70, 0)
    u_top_r, v_top_r = geom.project_3d_to_pixel(6.1, 6.70, 1.55)
    cv2.line(bg_frame, (int(u_base_r), int(v_base_r)), (int(u_top_r), int(v_top_r)), post_color, 4, cv2.LINE_AA)

    # Top net cord
    u_mid, v_mid = geom.project_3d_to_pixel(3.05, 6.70, 1.524)
    pts_net = np.array([
        [int(u_top_l), int(v_top_l)],
        [int(u_mid), int(v_mid)],
        [int(u_top_r), int(v_top_r)]
    ], dtype=np.int32)
    cv2.polylines(bg_frame, [pts_net], False, net_tape_color, 2, cv2.LINE_AA)

    # Net mesh body (dark mesh)
    pts_mesh = np.array([
        [int(u_top_l), int(v_top_l)],
        [int(u_top_r), int(v_top_r)],
        [int(u_base_r), int(v_base_r)],
        [int(u_base_l), int(v_base_l)],
    ], dtype=np.int32)
    overlay = bg_frame.copy()
    cv2.fillPoly(overlay, [pts_mesh], (40, 30, 20))
    cv2.addWeighted(overlay, 0.45, bg_frame, 0.55, 0, bg_frame)

    # Temporary file for raw mp4 frames
    temp_raw = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(temp_raw, fourcc, fps, (width, height))

    print(f"🎬 Generating synthetic BWF match footage ({total_frames} frames @ {fps}fps)...")

    # State tracking
    p1_pos = np.array([3.05, 2.50, 0.0])  # Near side (LZJ)
    p2_pos = np.array([3.05, 10.5, 0.0])  # Far side (SLY)
    shuttle_trail = []

    for f_idx in range(total_frames):
        t_sec = f_idx / fps
        frame = bg_frame.copy()

        # Find current shot
        cur_shot = shots[-1]
        for s in shots:
            if s["start"] <= t_sec < s["end"]:
                cur_shot = s
                break

        # Calculate progress in current shot
        s_dur = max(0.01, cur_shot["end"] - cur_shot["start"])
        s_prog = min(1.0, max(0.0, (t_sec - cur_shot["start"]) / s_dur))

        # Ballistic trajectory calculation
        p_from = np.array(cur_shot["from"])
        p_to = np.array(cur_shot["to"])
        peak_z = cur_shot["peak_z"]

        if cur_shot.get("is_dead"):
            s_pos = p_to
        else:
            # Linear horizontal interpolation
            s_x = p_from[0] + (p_to[0] - p_from[0]) * s_prog
            s_y = p_from[1] + (p_to[1] - p_from[1]) * s_prog
            # Parabolic vertical arc
            parabola = 4.0 * s_prog * (1.0 - s_prog)
            base_z = p_from[2] + (p_to[2] - p_from[2]) * s_prog
            s_z = max(0.0, base_z + (peak_z - max(p_from[2], p_to[2])) * parabola)
            s_pos = np.array([s_x, s_y, s_z])

        # Player positioning lerp
        if cur_shot["hitter"] == "LZJ":
            p1_target = p_from[:2]
            p2_target = p_to[:2]
        else:
            p2_target = p_from[:2]
            p1_target = p_to[:2]

        p1_pos[:2] += (p1_target - p1_pos[:2]) * 0.15
        p2_pos[:2] += (p2_target - p2_pos[:2]) * 0.15

        # Render Players (Athletes)
        def draw_player(pos, color, is_near, label, is_jumping=False):
            u, v = geom.project_3d_to_pixel(pos[0], pos[1], pos[2])
            scale = 1.0 if is_near else 0.65
            jump_dy = -int(35 * scale) if is_jumping else 0

            # Ground shadow
            cv2.ellipse(frame, (int(u), int(v)), (int(16 * scale), int(6 * scale)), 0, 0, 360, (15, 20, 25), -1)

            # Body torso
            torso_pt = (int(u), int(v - 45 * scale + jump_dy))
            cv2.circle(frame, torso_pt, int(14 * scale), color, -1)

            # Head
            head_pt = (int(u), int(v - 65 * scale + jump_dy))
            cv2.circle(frame, head_pt, int(8 * scale), (235, 210, 190), -1)

            # Name label
            cv2.putText(frame, label, (int(u - 24 * scale), int(v - 75 * scale + jump_dy)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4 * scale, (255, 255, 255), 1, cv2.LINE_AA)

        is_smash_frame = cur_shot.get("is_smash", False) and s_prog < 0.6
        draw_player(p2_pos, (34, 87, 255), is_near=False, label="SLY")  # Orange kit (BGR: 34, 87, 255)
        draw_player(p1_pos, (255, 240, 0), is_near=True, label="LZJ", is_jumping=is_smash_frame)  # Cyan kit

        # Render Shuttlecock & Vapor Trail
        sh_u, sh_v = geom.project_3d_to_pixel(s_pos[0], s_pos[1], s_pos[2])
        if not cur_shot.get("is_dead"):
            shuttle_trail.append((int(sh_u), int(sh_v)))
            if len(shuttle_trail) > 12:
                shuttle_trail.pop(0)

            # Trail line
            for i in range(1, len(shuttle_trail)):
                alpha = i / len(shuttle_trail)
                thickness = 1 if alpha < 0.5 else 2
                cv2.line(frame, shuttle_trail[i - 1], shuttle_trail[i], (255, 255, 200), thickness, cv2.LINE_AA)

            # Shuttle cork dot
            cv2.circle(frame, (int(sh_u), int(sh_v)), 3, (255, 255, 255), -1)
            # Ground shadow of shuttle
            sh_gu, sh_gv = geom.project_3d_to_pixel(s_pos[0], s_pos[1], 0.0)
            cv2.circle(frame, (int(sh_gu), int(sh_gv)), 2, (15, 20, 25), -1)

        # Draw Official BWF Broadcast Scorebug Overlay (Top-Left)
        # Bounding box for Scorebug OCR verification: (24, 20, 240, 72)
        sb_x, sb_y, sb_w, sb_h = 24, 20, 220, 76
        sb_overlay = frame.copy()
        cv2.rectangle(sb_overlay, (sb_x, sb_y), (sb_x + sb_w, sb_y + sb_h), (8, 12, 18), -1)
        cv2.rectangle(sb_overlay, (sb_x, sb_y), (sb_x + sb_w, sb_y + sb_h), (60, 75, 95), 1)
        cv2.addWeighted(sb_overlay, 0.85, frame, 0.15, 0, frame)

        # Header
        cv2.putText(frame, "BWF ARCTIC OPEN // G2", (sb_x + 8, sb_y + 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 240, 255), 1, cv2.LINE_AA)

        # Player 1 (MAS LZJ)
        cv2.putText(frame, "MAS  LEE Z.J.", (sb_x + 8, sb_y + 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "08", (sb_x + 180, sb_y + 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 240, 255), 2, cv2.LINE_AA)

        # Player 2 (TPE SLY)
        cv2.putText(frame, "TPE  SU L.Y.", (sb_x + 8, sb_y + 56),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "08", (sb_x + 180, sb_y + 56),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, (50, 150, 255), 2, cv2.LINE_AA)

        # Match timecode
        elapsed_str = f"RALLY #18  {t_sec:04.1f}s"
        cv2.putText(frame, elapsed_str, (sb_x + 8, sb_y + 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.32, (0, 229, 163), 1, cv2.LINE_AA)

        # Nuclear Smash Flash Overlay (when smash occurs: t = 7.6s to 9.2s)
        if 7.6 <= t_sec <= 9.2:
            flash_overlay = frame.copy()
            cv2.rectangle(flash_overlay, (width // 2 - 220, height - 70), (width // 2 + 220, height - 20),
                          (10, 10, 30), -1)
            cv2.rectangle(flash_overlay, (width // 2 - 220, height - 70), (width // 2 + 220, height - 20),
                          (40, 50, 255), 2)
            cv2.addWeighted(flash_overlay, 0.90, frame, 0.10, 0, frame)

            cv2.putText(frame, "⚡ BWF SMASH RADAR: 412 KM/H", (width // 2 - 195, height - 37),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.75, (40, 50, 255), 2, cv2.LINE_AA)

        out.write(frame)

    out.release()
    print("⏳ Re-encoding to H.264 MP4 with web faststart via FFmpeg...")

    # Re-encode using ffmpeg for standard browser faststart
    cmd = [
        "ffmpeg", "-y",
        "-i", temp_raw,
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level", "4.0",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if os.path.exists(temp_raw):
        os.remove(temp_raw)

    file_size_kb = os.path.getsize(output_path) / 1024.0
    print(f"✅ Generated sample match video: {output_path} ({file_size_kb:.1f} KB)")
    return output_path


if __name__ == "__main__":
    create_sample_rally_video()
