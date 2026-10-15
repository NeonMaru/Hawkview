"""
Phase C Verification Script — TrackNetV3 Shuttlecock Tracking on 3 Rallies
Outputs:
- data/matches/<id>/shuttle_2d.csv
- data/matches/<id>/debug/tracknet_probe.mp4 (and rally diagnostic videos)
- data/matches/<id>/debug/tracknet_strip_*.png (5-frame verification strips inspected via view_file)
"""

import os
import csv
import cv2
import numpy as np
import torch

from engine.tracknet import TrackNetV3Pipeline


def verify_phase_c(
    video_path: str = "assets/LZJvPopov.mp4",
    match_id: str = "lzj_popov"
):
    print("=================================================================")
    print("🏸 HAWKVIEW PHASE C ACCEPTANCE CHECK: TRACKNETV3 INFERENCE")
    print("=================================================================")

    debug_dir = f"data/matches/{match_id}/debug"
    os.makedirs(debug_dir, exist_ok=True)

    # 3 Hand-picked active rallies from Arctic Open LZJ v Popov
    rally_windows = [
        {"rally_id": 1, "start": 740, "end": 950},    # 211 frames (~8.4s)
        {"rally_id": 2, "start": 1180, "end": 1700},  # 521 frames (~20.8s)
        {"rally_id": 3, "start": 2070, "end": 2460},  # 391 frames (~15.6s)
    ]

    print(f"\n[1/3] Initializing TrackNetV3 + InpaintNet on PyTorch device...")
    pipeline = TrackNetV3Pipeline()
    print(f"  • Active Device: {pipeline.device}")
    print(f"  • TrackNet: engine/weights/TrackNet_best.pt (LOADED)")
    print(f"  • InpaintNet: engine/weights/InpaintNet_best.pt (LOADED)")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    all_detections = []
    rally_metrics = []

    print(f"\n[2/3] Running TrackNetV3 on 3 Selected Rallies...")
    for r_idx, r in enumerate(rally_windows):
        start_f = r["start"]
        end_f = r["end"]
        count = end_f - start_f + 1

        print(f"\n  ▶ Processing Rally {r['rally_id']}: frames {start_f} to {end_f} ({count} frames)...")
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)
        frames = []
        for _ in range(count):
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)

        # Run inference
        detections = pipeline.track_rally(frames, start_frame_idx=start_f, use_ensemble=True)
        all_detections.extend(detections)

        # Metrics
        vis_indices = [i for i, d in enumerate(detections) if d["visibility"] == 1]
        vis_count = len(vis_indices)
        inpaint_count = sum(1 for d in detections if d.get("inpainted", False))
        dropped_count = getattr(pipeline, "last_dropped_count", 0)
        dropped_frames = getattr(pipeline, "last_dropped_frames", [])
        vis_ratio = (vis_count / float(len(detections))) * 100.0 if detections else 0.0

        # Active rally span [first_vis .. last_vis] (excluding pre-serve / post-rally dead padding)
        if vis_indices:
            active_frames = vis_indices[-1] - vis_indices[0] + 1
            active_ratio = (vis_count / float(active_frames)) * 100.0
            active_span = (detections[vis_indices[0]]["frame"], detections[vis_indices[-1]]["frame"])
        else:
            active_frames = len(detections)
            active_ratio = 0.0
            active_span = (start_f, end_f)

        # Max consecutive visible jump in this rally
        max_jump = 0.0
        for i in range(1, len(detections)):
            if detections[i - 1]["visibility"] and detections[i]["visibility"]:
                d = float(np.hypot(
                    detections[i]["x"] - detections[i - 1]["x"],
                    detections[i]["y"] - detections[i - 1]["y"]
                ))
                if d > max_jump:
                    max_jump = d

        rally_metrics.append({
            "rally_id": r["rally_id"],
            "frames": len(detections),
            "active_frames": active_frames,
            "active_span": active_span,
            "visible": vis_count,
            "inpainted": inpaint_count,
            "dropped": dropped_count,
            "dropped_frames": dropped_frames,
            "max_jump_px": max_jump,
            "ratio": vis_ratio,
            "active_ratio": active_ratio,
        })

        print(f"    • Full Window Visible Frames: {vis_count}/{len(detections)} ({vis_ratio:.1f}%)")
        print(f"    • Active Rally [{active_span[0]}..{active_span[1]}] Visible: {vis_count}/{active_frames} ({active_ratio:.1f}%)")
        print(f"    • Raw Outliers Dropped (Speed Gate >250px): {dropped_count} (frames: {dropped_frames})")
        print(f"    • Inpainted Gap Frames: {inpaint_count}")
        print(f"    • Max Consecutive Jump: {max_jump:.1f} px")

        # Render overlay video
        out_video = f"{debug_dir}/tracknet_probe_rally{r['rally_id']}.mp4"
        pipeline.render_diagnostic_video(frames, detections, out_video)
        print(f"    • Saved Diagnostic Video: {out_video}")

        # If Rally 1, also save the main probe video name required by Section 5
        if r["rally_id"] == 1:
            main_probe = f"{debug_dir}/tracknet_probe.mp4"
            pipeline.render_diagnostic_video(frames, detections, main_probe)
            print(f"    • Saved Primary Probe Video: {main_probe}")

        # Generate diagnostic 5-frame verification strip image around a high-motion segment
        # Find 5 consecutive frames with high movement
        strip_start = 50
        for i in range(10, len(detections) - 10):
            if detections[i]["visibility"] and detections[i+1]["visibility"]:
                dx = detections[i+1]["x"] - detections[i]["x"]
                dy = detections[i+1]["y"] - detections[i]["y"]
                if (dx**2 + dy**2) > 400: # Fast moving shuttle
                    strip_start = i
                    break

        strip_frames = []
        for s_i in range(strip_start, min(strip_start + 5, len(frames))):
            sf = frames[s_i].copy()
            det = detections[s_i]
            if det["visibility"]:
                pt = (int(round(det["x"])), int(round(det["y"])))
                cv2.circle(sf, pt, 10, (255, 0, 255), 3) # Magenta ring
                cv2.circle(sf, pt, 4, (255, 255, 255), -1) # White center
                # Zoom into shuttle area (200x200 crop)
                cx, cy = pt
                x1, x2 = max(0, cx - 100), min(1920, cx + 100)
                y1, y2 = max(0, cy - 100), min(1080, cy + 100)
                crop = sf[y1:y2, x1:x2]
                if crop.size > 0:
                    crop_big = cv2.resize(crop, (240, 240))
                    cv2.putText(crop_big, f"F:{det['frame']}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                    strip_frames.append(crop_big)

        if strip_frames:
            strip_img = np.hstack(strip_frames)
            strip_path = f"{debug_dir}/tracknet_strip_rally{r['rally_id']}.png"
            cv2.imwrite(strip_path, strip_img)
            print(f"    • Saved 5-Frame High-Motion Verification Strip: {strip_path}")

    cap.release()

    # Step 3: Save shuttle_2d.csv
    csv_path = f"data/matches/{match_id}/shuttle_2d.csv"
    print(f"\n[3/3] Exporting 2D Trajectory to {csv_path}...")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Frame", "Visibility", "X", "Y", "Inpainted"])
        for d in all_detections:
            writer.writerow([
                d["frame"],
                d["visibility"],
                round(d["x"], 2),
                round(d["y"], 2),
                1 if d.get("inpainted", False) else 0
            ])
    print(f"  • Written {len(all_detections)} rows to {csv_path}")

    # Acceptance check
    total_frames = sum(m["frames"] for m in rally_metrics)
    total_active_frames = sum(m["active_frames"] for m in rally_metrics)
    total_visible = sum(m["visible"] for m in rally_metrics)
    total_dropped = sum(m["dropped"] for m in rally_metrics)
    overall_max_jump = max((m["max_jump_px"] for m in rally_metrics), default=0.0)
    combined_window_ratio = (total_visible / float(total_frames)) * 100.0 if total_frames else 0.0
    combined_active_ratio = (total_visible / float(total_active_frames)) * 100.0 if total_active_frames else 0.0

    print("\n-----------------------------------------------------------------")
    print("📊 PHASE C ACCEPTANCE EVALUATION:")
    for m in rally_metrics:
        print(
            f"  • Rally {m['rally_id']}: window {m['visible']}/{m['frames']} ({m['ratio']:.1f}%), "
            f"active [{m['active_span'][0]}..{m['active_span'][1]}] {m['visible']}/{m['active_frames']} ({m['active_ratio']:.1f}%), "
            f"{m['inpainted']} inpainted, {m['dropped']} raw dropped, "
            f"max jump = {m['max_jump_px']:.1f} px"
        )
    print(f"  • Combined 3-Rally Window Visibility Ratio: {combined_window_ratio:.1f}% ({total_visible}/{total_frames})")
    print(f"  • Combined 3-Rally Active Visibility Ratio: {combined_active_ratio:.1f}% ({total_visible}/{total_active_frames}, threshold >= 80.0%)")
    print(f"  • Total Raw Detections Dropped: {total_dropped}")
    print(f"  • Max Consecutive Visible Jump: {overall_max_jump:.1f} px (threshold <= 200.0 px)")

    passed = (combined_active_ratio >= 80.0) and (overall_max_jump <= 200.0)
    if passed:
        print("  • Result: ✅ ACCEPTANCE CHECK PASSED")
    else:
        print("  • Result: ❌ ACCEPTANCE CHECK FAILED")
    print("-----------------------------------------------------------------\n")

    return {
        "total_frames": total_frames,
        "total_active_frames": total_active_frames,
        "total_visible": total_visible,
        "total_dropped": total_dropped,
        "max_jump_px": overall_max_jump,
        "window_visibility_ratio": combined_window_ratio,
        "visibility_ratio": combined_active_ratio,
        "passed": passed
    }


if __name__ == "__main__":
    verify_phase_c()
