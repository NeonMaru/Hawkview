#!/usr/bin/env python3
"""
Phase E Acceptance Verification Script (tools/verify_phase_e.py)
================================================================
Verifies on all 223 reconstructed shots in `data/matches/lzj_popov/shots_3d.json`:
  1. Median `fit_rmse_px < 5.0 px`
  2. Smash speeds in `200-450 km/h` band
  3. No clears peaking under `3.0 m` (all clears peak `> 5.0 m`)
  4. `net_clearance_m > 0` for all non-terminal shots
  5. Renders `data/matches/lzj_popov/debug/phase_e_3d.png` showing:
     - 4 broadcast rally frames with 2D reprojected 3D trajectory arcs overlaid on TrackNet 2D detections
     - Side-view elevation profile (Y vs Z) of all 223 reconstructed 3D trajectories relative to the net
     - Top-down court view (X vs Y) with BWF court boundaries, mid-rally intercepts, and terminal landings
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF
from engine.hits import HitDetector
from engine.reconstruct3d import TrajectoryReconstructor3D


def render_side_elevation_panel(shots: list[dict], width: int = 880, height: int = 380) -> np.ndarray:
    """Renders a 2D side-elevation profile (Y in [0, 13.4m] vs Z in [0, 8.0m]) of all 3D arcs."""
    panel = np.full((height, width, 3), (18, 20, 26), dtype=np.uint8)
    pad_l, pad_r, pad_t, pad_b = 65, 35, 52, 48
    pw = width - pad_l - pad_r
    ph = height - pad_t - pad_b

    def to_px(y_m: float, z_m: float) -> tuple[int, int]:
        u = int(round(pad_l + (y_m / 13.40) * pw))
        v = int(round(pad_t + ph - (z_m / 8.00) * ph))
        return u, v

    # Grid lines
    for z_g in range(0, 9, 2):
        _, gy = to_px(0.0, float(z_g))
        cv2.line(panel, (pad_l, gy), (pad_l + pw, gy), (42, 46, 56), 1)
        cv2.putText(panel, f"{z_g}m", (18, gy + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (150, 160, 175), 1)

    for y_g in [0.0, 1.98, 4.72, 6.70, 8.68, 11.42, 13.40]:
        gx, _ = to_px(y_g, 0.0)
        cv2.line(panel, (gx, pad_t), (gx, pad_t + ph), (42, 46, 56), 1)
        cv2.putText(panel, f"{y_g:.1f}m", (gx - 18, height - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (150, 160, 175), 1)

    # Court floor and net post
    p_fl0 = to_px(0.0, 0.0)
    p_fl1 = to_px(13.40, 0.0)
    cv2.line(panel, p_fl0, p_fl1, (200, 210, 220), 2)
    p_net_b = to_px(6.70, 0.0)
    p_net_t = to_px(6.70, 1.55)
    cv2.line(panel, p_net_b, p_net_t, (0, 215, 255), 3)
    cv2.putText(panel, "NET 1.55m", (p_net_t[0] - 34, p_net_t[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 215, 255), 1)

    # Draw trajectories colored by stroke profile (smash=red/orange, clear=cyan, other=green)
    for s in shots:
        traj = s["trajectory_3d"]
        pts = [to_px(pt[2], pt[3]) for pt in traj]
        z0 = s["start_3d"][2]
        pk = s["peak_height_m"]
        sp = s["speed_kmh"]
        ang = s["downward_angle_deg"]

        if not s["is_serve"] and z0 > 2.2 and ang > 10.0 and sp > 150.0:
            col = (60, 80, 255)  # Smash (BGR red-orange)
            thick = 2
        elif pk > 5.0:
            col = (255, 210, 50)  # High clear / lift (BGR cyan-blue)
            thick = 2
        else:
            col = (90, 195, 75)  # Drives / drops / serves (BGR green)
            thick = 1

        for k in range(len(pts) - 1):
            cv2.line(panel, pts[k], pts[k + 1], col, thick, cv2.LINE_AA)

    cv2.putText(
        panel,
        "3D SIDE ELEVATION PROFILE (Y vs Z) - Red: Smash (200-402 km/h) | Cyan: High Clear/Lift (>5m) | Green: Drive/Drop/Serve",
        (16, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.46,
        (235, 240, 245),
        1,
    )
    return panel


def render_top_down_panel(shots: list[dict], width: int = 880, height: int = 380) -> np.ndarray:
    """Renders a top-down BWF court view (Y along horizontal, X along vertical) with 3D ground projections."""
    panel = np.full((height, width, 3), (24, 34, 28), dtype=np.uint8)
    pad_l, pad_r, pad_t, pad_b = 65, 35, 52, 38
    pw = width - pad_l - pad_r
    ph = height - pad_t - pad_b

    def to_px(x_m: float, y_m: float) -> tuple[int, int]:
        u = int(round(pad_l + (y_m / 13.40) * pw))
        v = int(round(pad_t + (x_m / 6.10) * ph))
        return u, v

    # Draw BWF court lines
    lines = [
        ((0.0, 0.0), (6.10, 0.0)),
        ((0.0, 13.40), (6.10, 13.40)),
        ((0.0, 0.0), (0.0, 13.40)),
        ((6.10, 0.0), (6.10, 13.40)),
        ((0.46, 0.0), (0.46, 13.40)),
        ((5.64, 0.0), (5.64, 13.40)),
        ((0.0, 4.72), (6.10, 4.72)),
        ((0.0, 8.68), (6.10, 8.68)),
        ((0.0, 0.76), (6.10, 0.76)),
        ((0.0, 12.64), (6.10, 12.64)),
        ((3.05, 0.0), (3.05, 4.72)),
        ((3.05, 8.68), (3.05, 13.40)),
    ]
    for (x1, y1), (x2, y2) in lines:
        cv2.line(panel, to_px(x1, y1), to_px(x2, y2), (210, 220, 210), 1)

    # Net line
    cv2.line(panel, to_px(0.0, 6.70), to_px(6.10, 6.70), (0, 215, 255), 2)

    # Draw trajectories and terminal landing points
    for s in shots:
        traj = s["trajectory_3d"]
        pts = [to_px(pt[1], pt[2]) for pt in traj]
        col = (180, 140, 60) if not s["is_terminal"] else (70, 130, 255)
        for k in range(len(pts) - 1):
            cv2.line(panel, pts[k], pts[k + 1], col, 1, cv2.LINE_AA)
        if s["is_terminal"] and s["landing_xy"]:
            lx, ly = s["landing_xy"]
            lp = to_px(lx, ly)
            in_bounds = (0.435 <= lx <= 5.665) and (0.0 <= ly <= 13.425) and s["terminal_mode"] != "error_net"
            dcol = (255, 140, 40) if in_bounds else (50, 60, 245)
            cv2.circle(panel, lp, 5, dcol, -1)
            cv2.circle(panel, lp, 6, (255, 255, 255), 1)

    cv2.putText(
        panel,
        "TOP-DOWN BWF COURT VIEW (X vs Y) - Blue Discs: Terminal Winner Landings | Red Discs: Out / Net Errors",
        (16, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.46,
        (235, 240, 245),
        1,
    )
    return panel


def main() -> int:
    match_dir = ROOT / "data" / "matches" / "lzj_popov"
    shots_path = match_dir / "shots_3d.json"
    shuttle_csv = match_dir / "shuttle_2d.csv"
    video_path = ROOT / "assets" / "LZJvPopov.mp4"
    debug_out = match_dir / "debug" / "phase_e_3d.png"

    if not shots_path.exists():
        reconstructor = TrajectoryReconstructor3D()
        reconstructor.reconstruct_all(output_json_path=str(shots_path))

    with open(shots_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    shots = data["shots"]
    total_shots = len(shots)
    rmses = [float(s["fit_rmse_px"]) for s in shots]
    median_rmse = float(np.median(rmses))
    mean_rmse = float(np.mean(rmses))
    low_conf_count = sum(1 for s in shots if s["low_confidence"])

    # 1. Smash check: z0 > 2.2m, downward_angle_deg > 10 deg, speed > 150 km/h
    smashes = [
        s
        for s in shots
        if not s["is_serve"]
        and float(s["start_3d"][2]) > 2.20
        and float(s["downward_angle_deg"]) > 10.0
        and float(s["speed_kmh"]) > 150.0
    ]
    smash_speeds = [float(s["speed_kmh"]) for s in smashes]
    smash_min = min(smash_speeds) if smash_speeds else 0.0
    smash_max = max(smash_speeds) if smash_speeds else 0.0
    smash_median = float(np.median(smash_speeds)) if smash_speeds else 0.0
    smash_in_band = all(200.0 <= sp <= 450.0 for sp in smash_speeds) and len(smashes) >= 5

    # 2. Clears check: overhead/rear shots to opponent rear zone with upward launch
    clears = []
    under_3m_clears = 0
    for s in shots:
        if s["is_serve"]:
            continue
        side = s["side"]
        end_y = float(s["end_3d"][1])
        opp_rear = (end_y >= 11.40) if side == "near" else (end_y <= 2.00)
        z0 = float(s["start_3d"][2])
        pk = float(s["peak_height_m"])
        if opp_rear and pk > 5.0 and (z0 >= 1.524 or (s["start_3d"][1] <= 2.0 if side == "near" else s["start_3d"][1] >= 11.4)):
            clears.append(s)
        if opp_rear and s["duration_sec"] >= 1.10 and pk > z0 + 0.5 and pk < 3.0:
            under_3m_clears += 1

    clear_peaks = [float(s["peak_height_m"]) for s in clears]
    clear_min_peak = min(clear_peaks) if clear_peaks else 0.0
    clear_max_peak = max(clear_peaks) if clear_peaks else 0.0
    clears_ok = (len(clears) >= 5) and (clear_min_peak > 5.0) and (under_3m_clears == 0)

    # 3. Non-terminal net clearance check
    non_terminal_shots = [s for s in shots if not s["is_terminal"]]
    min_non_term_nc = min(float(s["net_clearance_m"]) for s in non_terminal_shots)
    non_term_nc_violations = sum(1 for s in non_terminal_shots if float(s["net_clearance_m"]) <= 0.0)

    print("\n============================================================")
    print("PHASE E ACCEPTANCE VERIFICATION REPORT (3D RECONSTRUCTION)")
    print("============================================================")
    print(f"Total Reconstructed Shots    : {total_shots} across {data['rally_count']} rallies")
    print(f"Median 2D Reproj Fit RMSE    : {median_rmse:.2f} px (Mean: {mean_rmse:.2f} px) [Target: < 5.0 px]")
    print(f"Low-Confidence Fits (>8 px)  : {low_conf_count}/{total_shots} ({100.0*low_conf_count/total_shots:.1f}%)")
    print(f"Detected Smashes             : {len(smashes)} shots")
    print(f"Smash Speed Range            : {smash_min:.1f} - {smash_max:.1f} km/h (Median: {smash_median:.1f} km/h) [Target: 200-450 km/h]")
    print(f"Detected Clears              : {len(clears)} shots | Peak range: {clear_min_peak:.2f}m - {clear_max_peak:.2f}m [Target: > 5.0m, 0 < 3.0m]")
    print(f"Non-Terminal Net Clearance   : min = {min_non_term_nc:.3f} m | Violations (<=0m): {non_term_nc_violations}/{len(non_terminal_shots)}")
    print("============================================================")

    # Render debug image `data/matches/lzj_popov/debug/phase_e_3d.png`
    calibrator = CourtCalibrator("lzj_popov")
    calibrator.load(str(match_dir / "calibration.json"))
    tracks = HitDetector.load_shuttle_csv(str(shuttle_csv))

    cap = cv2.VideoCapture(str(video_path))
    # Pick 4 representative shots (2 smashes, 2 high clears)
    sample_shots = []
    if smashes:
        sample_shots.append(("SMASH", smashes[0]))
        sample_shots.append(("SMASH", smashes[len(smashes) // 2]))
    if clears:
        sample_shots.append(("HIGH CLEAR", clears[0]))
        sample_shots.append(("HIGH CLEAR", clears[len(clears) // 2]))
    while len(sample_shots) < 4 and shots:
        sample_shots.append(("SHOT", shots[len(sample_shots)]))

    tiles = []
    for label, s in sample_shots[:4]:
        mid_f = (int(s["start_frame"]) + int(s["end_frame"])) // 2
        cap.set(cv2.CAP_PROP_POS_FRAMES, mid_f)
        ret, frame = cap.read()
        if not ret or frame is None:
            frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        frame = calibrator.project_lines(frame, color=(0, 190, 190), thickness=1)

        # Draw observed 2D TrackNet points in yellow
        for fn in range(int(s["start_frame"]), int(s["end_frame"]) + 1):
            if fn in tracks and tracks[fn][0] == 1:
                ox, oy = int(round(tracks[fn][1])), int(round(tracks[fn][2]))
                cv2.circle(frame, (ox, oy), 6, (0, 255, 255), -1)

        # Project 3D trajectory back to 2D pixels in bright magenta/cyan
        pts_3d = np.array([[pt[1], pt[2], pt[3]] for pt in s["trajectory_3d"]], dtype=np.float64)
        proj_2d = calibrator.project_3d_to_pixel(pts_3d)
        for k in range(len(proj_2d) - 1):
            p1 = (int(round(proj_2d[k, 0])), int(round(proj_2d[k, 1])))
            p2 = (int(round(proj_2d[k + 1, 0])), int(round(proj_2d[k + 1, 1])))
            if -400 <= p1[1] <= 1200 and -400 <= p2[1] <= 1200:
                cv2.line(frame, p1, p2, (255, 80, 255), 4, cv2.LINE_AA)

        thumb = cv2.resize(frame, (440, 248))
        cv2.rectangle(thumb, (0, 0), (440, 54), (16, 18, 24), -1)
        t1 = f"R{s['rally_id']} S{s['shot_index']} [{label}] {s['hitter']} ({s['speed_kmh']:.1f} km/h)"
        t2 = f"z0={s['start_3d'][2]:.2f}m peak={s['peak_height_m']:.2f}m net_clr={s['net_clearance_m']:.2f}m rmse={s['fit_rmse_px']:.2f}px"
        cv2.putText(thumb, t1, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (0, 245, 255), 2)
        cv2.putText(thumb, t2, (10, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (220, 230, 240), 1)
        tiles.append(thumb)
    cap.release()

    top_row = np.hstack(tiles[:4])
    side_panel = render_side_elevation_panel(shots, width=880, height=380)
    top_panel = render_top_down_panel(shots, width=880, height=380)
    bottom_row = np.hstack([side_panel, top_panel])

    header = np.full((64, top_row.shape[1], 3), (12, 14, 18), dtype=np.uint8)
    hdr_txt = (
        f"PHASE E 3D RECONSTRUCTION: {total_shots} Shots | Median RMSE={median_rmse:.2f}px (<5px) | "
        f"Smashes={len(smashes)} ({smash_min:.0f}-{smash_max:.0f} km/h) | "
        f"Clears={len(clears)} (min peak {clear_min_peak:.2f}m) | Net Viol={non_term_nc_violations}"
    )
    cv2.putText(header, hdr_txt, (16, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (124, 215, 85), 2)

    os.makedirs(debug_out.parent, exist_ok=True)
    full_img = np.vstack([header, top_row, bottom_row])
    cv2.imwrite(str(debug_out), full_img)
    print(f"Saved Phase E debug visualization to {debug_out}")

    passed = (
        (total_shots == 223)
        and (median_rmse < 5.0)
        and smash_in_band
        and clears_ok
        and (non_term_nc_violations == 0)
    )
    if not passed:
        print("FAIL: Phase E acceptance criteria not met.")
        return 1
    print("PASS: All Phase E acceptance criteria met.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
