#!/usr/bin/env python3
"""
Hawkview 5-Video Diverse BWF Accuracy Stress-Test & Visual Proof Runner
=======================================================================
Tests the upgraded end-to-end pipeline across 5 diverse 1080p BWF videos
(Men's Singles, Women's Doubles, Men's Doubles across Hong Kong Open & Paris French Open):
  1. PBnLlTploGQ       - Women's Doubles (Hong Kong Open, 1080p)
  2. a2T0DXYvrtM       - Men's Singles   (Hong Kong Open, 1080p)
  3. Zi_CheuJ5Mc       - Men's Singles   (Hong Kong Open, 1080p)
  4. hiUDiIaQjxA       - Men's Doubles   (Hong Kong Open, 1080p)
  5. iwanaga_tan_7384  - Women's Doubles (French Open Paris, 1080p)

Stages:
  1. prep    : Local court calibration + rally segmentation (6 substantive rallies >= 3.5s each)
               + pack rally frames into compact 1024x576 H.264 MP4s (2x TrackNet resolution).
  2. colab   : Single Google Colab GPU session (L4 -> A100 -> G4 -> T4) running upgraded
               TrackNetV3Pipeline (Multi-Peak Viterbi + fixed contour scoring + fixed InpaintNet
               + CUDA FP16 autocast + sliding_step=1), rescales 2D coords to 1920x1080, downloads
               CSVs, and GUARANTEES `colab stop` + `colab sessions` verification in `finally`.
  3. analyze : Local PoseTracker + calibrated HitDetector + TrajectoryReconstructor3D (with
               Residual Split-Refit) + ShotClassifier + compute_match_accuracy_audit +
               zero-trust 3D->2D reprojection audit against raw shuttle_2d.csv.
  4. proof   : Render 2x2 visual proof grids (`data/stress_test/proofs/{vid}_3d_proof.png`)
               showing Smash, Clear/Lift, Drive/Drop, and Worst-RMSE shot per video.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from collections import Counter
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import server
from engine.accuracy_audit import compute_match_accuracy_audit
from engine.classify import ShotClassifier
from engine.court_calib import CourtCalibrator
from engine.court_geometry import BWF
from engine.hits import HitDetector
from engine.pipeline import fallback_kinematic_hits
from engine.pose_track import PoseTracker
from engine.reconstruct3d import TrajectoryReconstructor3D
from engine.segment import RallySegmenter

COLAB_BIN = "/Users/anyasmac/.local/bin/colab"
PACK_W = 1024
PACK_H = 576
OUT_ROOT = os.path.join(PROJECT_ROOT, "data", "stress_test")
PROOFS_DIR = os.path.join(OUT_ROOT, "proofs")

VIDEOS = [
    {
        "vid": "PBnLlTploGQ",
        "path": os.path.join(PROJECT_ROOT, "assets/stress_test/PBnLlTploGQ.mp4"),
        "label": "Nakade/Takahashi vs Tan/Muralitharan (WD, HK Open)",
        "match_type": "doubles",
        "near_default": "NAKADE / TAKAHASHI",
        "far_default": "TAN / MURALITHARAN",
    },
    {
        "vid": "a2T0DXYvrtM",
        "path": os.path.join(PROJECT_ROOT, "assets/stress_test/a2T0DXYvrtM.mp4"),
        "label": "Antonsen vs Lakshya Sen (MS, HK Open)",
        "match_type": "singles",
        "near_default": "ANTONSEN",
        "far_default": "LAKSHYA SEN",
    },
    {
        "vid": "Zi_CheuJ5Mc",
        "path": os.path.join(PROJECT_ROOT, "assets/stress_test/Zi_CheuJ5Mc.mp4"),
        "label": "Loh Kean Yew vs Lakshya Sen (MS, HK Open)",
        "match_type": "singles",
        "near_default": "LOH K.Y.",
        "far_default": "LAKSHYA SEN",
    },
    {
        "vid": "hiUDiIaQjxA",
        "path": os.path.join(PROJECT_ROOT, "assets/stress_test/hiUDiIaQjxA.mp4"),
        "label": "Tai/Yap vs Carnando/Marthin (MD, HK Open)",
        "match_type": "doubles",
        "near_default": "TAI / YAP",
        "far_default": "CARNANDO / MARTHIN",
    },
    {
        "vid": "iwanaga_tan_7384",
        "path": os.path.join(
            PROJECT_ROOT,
            "assets/uploads/iwanaga_nakanishi_vs_tan_muralitharan___control_and_confident_attacking_play_-_1080p_7384.mp4",
        ),
        "label": "Iwanaga/Nakanishi vs Tan/Muralitharan (WD, French Open)",
        "match_type": "doubles",
        "near_default": "IWANAGA / NAKANISHI",
        "far_default": "TAN / MURALITHARAN",
    },
]


def load_shuttle_csv_full(csv_path: str) -> Tuple[Dict[int, Tuple[int, float, float]], Dict[int, bool]]:
    tracks: Dict[int, Tuple[int, float, float]] = {}
    inpainted: Dict[int, bool] = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            fn = int(row.get("Frame") or row.get("frame"))
            vis = int(row.get("Visibility") or row.get("visible"))
            x = float(row.get("X") or row.get("x_px"))
            y = float(row.get("Y") or row.get("y_px"))
            inp = bool(int(row.get("Inpainted") or row.get("inpainted") or 0))
            tracks[fn] = (vis, x, y)
            inpainted[fn] = inp
    return tracks, inpainted


def pack_rally_windows_to_mp4(
    video_path: str,
    selected_rallies: List[dict],
    out_mp4: str,
    fps: float,
    pack_w: int = PACK_W,
    pack_h: int = PACK_H,
) -> List[dict]:
    """
    Extracts exact frames [cam_start_frame, cam_end_frame] of selected rallies, resizes cleanly
    to 1024x576 (exact 2x TrackNet 512x288), and encodes to compact H.264 MP4 via ffmpeg.
    Returns manifest entries mapping packed_start..packed_start+count-1 to orig_start_frame.
    """
    os.makedirs(os.path.dirname(os.path.abspath(out_mp4)), exist_ok=True)
    ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{pack_w}x{pack_h}",
        "-r", f"{fps:.3f}",
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_mp4,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        proc.kill()
        raise RuntimeError(f"Failed to open {video_path}")

    rally_manifest = []
    packed_cursor = 0
    try:
        for r in selected_rallies:
            cs = int(r.get("cam_start_frame", r["start_frame"]))
            ce = int(r.get("cam_end_frame", r["end_frame"]))
            cap.set(cv2.CAP_PROP_POS_FRAMES, cs)
            n_written = 0
            for _ in range(cs, ce + 1):
                ret, frm = cap.read()
                if not ret or frm is None:
                    break
                resized = cv2.resize(frm, (pack_w, pack_h), interpolation=cv2.INTER_AREA)
                proc.stdin.write(resized.tobytes())
                n_written += 1
            rally_manifest.append({
                "rally_id": int(r["rally_id"]),
                "orig_start_frame": cs,
                "orig_end_frame": cs + n_written - 1,
                "packed_start": packed_cursor,
                "packed_count": n_written,
            })
            packed_cursor += n_written
    finally:
        cap.release()
        if proc.stdin:
            proc.stdin.close()
        stderr_out = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"ffmpeg failed (rc={rc}): {stderr_out[-400:]}")

    return rally_manifest


def stage_prep(video_specs: List[dict], max_rallies: int = 6, min_dur_sec: float = 3.5) -> dict:
    """Stage 1: Local calibration + rally segmentation + 1024x576 rally-window packing."""
    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest = {
        "packed_w": PACK_W,
        "packed_h": PACK_H,
        "videos": {},
    }

    for spec in video_specs:
        vid = spec["vid"]
        vpath = spec["path"]
        vdir = os.path.join(OUT_ROOT, vid)
        os.makedirs(vdir, exist_ok=True)
        print(f"\n[PREP] === {vid} ({spec['label']}) ===", flush=True)
        t0 = time.time()

        probe = server.probe_video_and_keypoints(
            vpath,
            match_id=f"stress_{vid}",
            use_saved_calibration=False,
        )
        w = int(probe["width"])
        h = int(probe["height"])
        fps = float(probe["fps"])
        cal_prev = probe["calibration_preview"]
        kps = cal_prev["keypoints"]

        cal = CourtCalibrator(f"stress_{vid}", image_width=w, image_height=h)
        cal.set_keypoints({k: (float(v[0]), float(v[1])) for k, v in kps.items()}, image_width=w, image_height=h)

        # Refine on the exact probed main-camera frame to persist exact line_sample_rmse_px
        sample_f = int(round(float(probe.get("sample_time_sec", 0.0)) * fps))
        cap_s = cv2.VideoCapture(vpath)
        cap_s.set(cv2.CAP_PROP_POS_FRAMES, sample_f)
        ret_s, frame_s = cap_s.read()
        cap_s.release()
        if ret_s and frame_s is not None:
            cal.refine_with_white_lines(frame_s, search_radius_px=max(6, int(round(8 * w / 1920.0))))
        if cal.line_sample_rmse_px <= 0.0 and cal_prev.get("line_sample_rmse_px"):
            cal.line_sample_rmse_px = float(cal_prev["line_sample_rmse_px"])

        calib_path = os.path.join(vdir, "calibration.json")
        cal.save_calibration(calib_path)
        print(
            f"[PREP] {vid}: calib reproj={cal.reprojection_error_px:.2f}px, "
            f"line_rmse={cal.line_sample_rmse_px:.2f}px, "
            f"seg_cov={cal_prev.get('segment_coverage_pct')}%, "
            f"auto_refined={cal_prev.get('auto_refined')}, "
            f"sample_t={probe.get('sample_time_sec')}s",
            flush=True,
        )

        seg_path = os.path.join(vdir, "rallies_segment.json")
        segmenter = RallySegmenter(video_path=vpath, match_id=f"stress_{vid}", calibration_path=calib_path)
        seg_data = segmenter.segment_video(stride=3, mode="auto", output_json_path=seg_path)
        all_rallies = seg_data.get("rallies", [])

        # Select first `max_rallies` substantive rallies (>= min_dur_sec)
        substantive = []
        for r in all_rallies:
            cs = int(r.get("cam_start_frame", r["start_frame"]))
            ce = int(r.get("cam_end_frame", r["end_frame"]))
            dur = (ce - cs + 1) / max(1.0, fps)
            if dur >= min_dur_sec:
                substantive.append(r)
            if len(substantive) >= max_rallies:
                break
        if len(substantive) < max_rallies:
            chosen_ids = {int(r["rally_id"]) for r in substantive}
            extras = sorted(
                [r for r in all_rallies if int(r["rally_id"]) not in chosen_ids],
                key=lambda x: -(int(x.get("cam_end_frame", x["end_frame"])) - int(x.get("cam_start_frame", x["start_frame"]))),
            )
            substantive.extend(extras[: max_rallies - len(substantive)])
            substantive.sort(key=lambda x: int(x["start_frame"]))

        selected_path = os.path.join(vdir, "rallies_selected.json")
        with open(selected_path, "w", encoding="utf-8") as fs:
            json.dump(
                {
                    "vid": vid,
                    "video_path": vpath,
                    "width": w,
                    "height": h,
                    "fps": fps,
                    "match_type": spec["match_type"],
                    "near_player": probe.get("suggested_near_player") or spec["near_default"],
                    "far_player": probe.get("suggested_far_player") or spec["far_default"],
                    "calibration_preview": {
                        k: v for k, v in cal_prev.items() if k != "keypoints"
                    },
                    "total_segmented": len(all_rallies),
                    "rallies": substantive,
                },
                fs,
                indent=2,
            )

        packed_mp4 = os.path.join(vdir, "packed_rallies_576p.mp4")
        rally_entries = pack_rally_windows_to_mp4(vpath, substantive, packed_mp4, fps=fps)
        total_packed_frames = sum(e["packed_count"] for e in rally_entries)
        mp4_mb = os.path.getsize(packed_mp4) / (1024.0 * 1024.0)

        manifest["videos"][vid] = {
            "orig_w": w,
            "orig_h": h,
            "fps": fps,
            "packed_mp4": f"videos/{vid}.mp4",
            "local_packed_mp4": packed_mp4,
            "total_frames": total_packed_frames,
            "rallies": rally_entries,
        }
        print(
            f"[PREP] {vid}: {len(all_rallies)} segmented -> selected {len(substantive)} rallies "
            f"({total_packed_frames} frames, {mp4_mb:.2f} MB) in {time.time() - t0:.1f}s",
            flush=True,
        )

    manifest_path = os.path.join(OUT_ROOT, "colab_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fm:
        json.dump(manifest, fm, indent=2)
    print(f"\n[PREP] Saved manifest -> {manifest_path}", flush=True)
    return manifest


def _stop_and_verify_colab(session_name: str) -> None:
    print(f"\n[COLAB] Stopping session '{session_name}'...", flush=True)
    try:
        stop_proc = subprocess.run(
            [COLAB_BIN, "stop", "-s", session_name],
            capture_output=True,
            text=True,
            timeout=30.0,
        )
        print(f"[COLAB] stop rc={stop_proc.returncode}: {(stop_proc.stdout or stop_proc.stderr or '').strip()}", flush=True)
    except Exception as exc:
        print(f"[COLAB] stop exception: {exc}", flush=True)

    # Verify zero active sessions remain
    try:
        sess_proc = subprocess.run(
            [COLAB_BIN, "sessions"],
            capture_output=True,
            text=True,
            timeout=20.0,
        )
        out = ((sess_proc.stdout or "") + "\n" + (sess_proc.stderr or "")).strip()
        print(f"[COLAB] sessions verification:\n{out}", flush=True)
    except Exception as exc:
        print(f"[COLAB] sessions check exception: {exc}", flush=True)


def stage_colab(manifest_path: Optional[str] = None) -> None:
    """Stage 2: Single Google Colab GPU session running upgraded TrackNetV3 across all 30 rallies."""
    manifest_path = manifest_path or os.path.join(OUT_ROOT, "colab_manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as fm:
        manifest = json.load(fm)

    session_name = "hv-stress"
    allocated_gpu = None
    tmpdir = tempfile.mkdtemp(prefix="hv_stress_colab_")

    try:
        # 1. Build compact bundle zip
        bundle_zip = os.path.join(tmpdir, "stress_bundle.zip")
        slim_weights = os.path.join(PROJECT_ROOT, "engine/weights/TrackNet_infer_slim.pt")
        inpaint_weights = os.path.join(PROJECT_ROOT, "engine/weights/InpaintNet_best.pt")
        tracknet_py = os.path.join(PROJECT_ROOT, "engine/tracknet.py")
        if not os.path.exists(slim_weights):
            raise FileNotFoundError(f"Missing {slim_weights}")

        remote_manifest = {
            "packed_w": manifest["packed_w"],
            "packed_h": manifest["packed_h"],
            "videos": {
                vid: {
                    "orig_w": vinfo["orig_w"],
                    "orig_h": vinfo["orig_h"],
                    "fps": vinfo["fps"],
                    "packed_mp4": vinfo["packed_mp4"],
                    "rallies": vinfo["rallies"],
                }
                for vid, vinfo in manifest["videos"].items()
            },
        }
        remote_manifest_path = os.path.join(tmpdir, "manifest.json")
        with open(remote_manifest_path, "w", encoding="utf-8") as f_rm:
            json.dump(remote_manifest, f_rm, indent=2)

        with zipfile.ZipFile(bundle_zip, "w", compression=zipfile.ZIP_STORED) as zf:
            zf.write(tracknet_py, "engine/tracknet.py")
            zf.write(slim_weights, "engine/weights/TrackNet_infer_slim.pt")
            if os.path.exists(inpaint_weights):
                zf.write(inpaint_weights, "engine/weights/InpaintNet_best.pt")
            zf.write(remote_manifest_path, "manifest.json")
            for vid, vinfo in manifest["videos"].items():
                zf.write(vinfo["local_packed_mp4"], vinfo["packed_mp4"])

        bundle_mb = os.path.getsize(bundle_zip) / (1024.0 * 1024.0)
        print(f"\n[COLAB] Packed bundle: {bundle_mb:.2f} MB", flush=True)

        # 2. Check if session already exists; otherwise allocate ONE Colab session (L4 -> A100 -> G4 -> T4)
        sess_chk = subprocess.run([COLAB_BIN, "sessions"], capture_output=True, text=True, timeout=20.0)
        if f"[{session_name}]" in ((sess_chk.stdout or "") + (sess_chk.stderr or "")):
            allocated_gpu = "EXISTING"
            print(f"[COLAB] Reusing active session '{session_name}'", flush=True)
        else:
            for gpu in ("L4", "A100", "G4", "T4"):
                print(f"[COLAB] Requesting session '{session_name}' with --gpu {gpu}...", flush=True)
                proc = subprocess.run(
                    [COLAB_BIN, "new", "-s", session_name, "--gpu", gpu],
                    capture_output=True,
                    text=True,
                    timeout=90.0,
                )
                if proc.returncode == 0:
                    allocated_gpu = gpu
                    print(f"[COLAB] Allocated GPU: {gpu}\n{(proc.stdout or '').strip()}", flush=True)
                    break
                else:
                    err_txt = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
                    print(f"[COLAB] {gpu} unavailable (rc={proc.returncode}): {err_txt[-400:]}", flush=True)

        if not allocated_gpu:
            raise RuntimeError("Could not allocate any Colab GPU session (L4/A100/G4/T4)")

        # 3. Upload bundle in <= 8 MB chunks
        part_size = 8 * 1024 * 1024
        bundle_size = os.path.getsize(bundle_zip)
        total_parts = max(1, (bundle_size + part_size - 1) // part_size)
        with open(bundle_zip, "rb") as f_bz:
            for p_idx in range(total_parts):
                chunk = f_bz.read(part_size)
                part_local = os.path.join(tmpdir, f"stress_bundle.part{p_idx:03d}")
                with open(part_local, "wb") as f_p:
                    f_p.write(chunk)
                print(f"[COLAB] Uploading chunk {p_idx + 1}/{total_parts} ({len(chunk) / 1e6:.2f} MB)...", flush=True)
                up = subprocess.run(
                    [COLAB_BIN, "upload", "-s", session_name, part_local, f"/content/stress_bundle.part{p_idx:03d}"],
                    capture_output=True,
                    text=True,
                    timeout=180.0,
                )
                if up.returncode != 0:
                    raise RuntimeError(f"Upload failed on part {p_idx}: {up.stderr or up.stdout}")

        # 4. Write remote TrackNetV3 stress runner
        remote_script = os.path.join(tmpdir, "remote_stress_tracknet.py")
        with open(remote_script, "w", encoding="utf-8") as f_rs:
            f_rs.write(
                """import glob, json, os, sys, time, zipfile
import cv2
import numpy as np
import torch

t_start = time.time()
part_files = sorted(glob.glob('/content/stress_bundle.part*'))
assert part_files, 'No stress_bundle.part* files found!'
with open('/content/stress_bundle.zip', 'wb') as f_out:
    for pf in part_files:
        with open(pf, 'rb') as f_in:
            f_out.write(f_in.read())
        os.remove(pf)

work_dir = '/content/hv_stress'
os.makedirs(work_dir, exist_ok=True)
with zipfile.ZipFile('/content/stress_bundle.zip', 'r') as zf:
    zf.extractall(work_dir)

sys.path.insert(0, work_dir)
from engine.tracknet import TrackNetV3Pipeline

device = 'cuda' if torch.cuda.is_available() else 'cpu'
gpu_name = torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU'
print(f'[REMOTE] Device: {device} ({gpu_name})', flush=True)

pipe = TrackNetV3Pipeline(
    tracknet_weights=os.path.join(work_dir, 'engine/weights/TrackNet_infer_slim.pt'),
    inpaintnet_weights=os.path.join(work_dir, 'engine/weights/InpaintNet_best.pt'),
    device=device,
)
print(f'[REMOTE] TrackNet loaded | InpaintNet loaded: {pipe.inpaintnet is not None}', flush=True)

with open(os.path.join(work_dir, 'manifest.json'), 'r') as fm:
    manifest = json.load(fm)

packed_w = float(manifest['packed_w'])
packed_h = float(manifest['packed_h'])
out_dir = '/content/stress_csvs'
os.makedirs(out_dir, exist_ok=True)

total_frames_all = 0
for vid, vinfo in manifest['videos'].items():
    t_v = time.time()
    orig_w = float(vinfo['orig_w'])
    orig_h = float(vinfo['orig_h'])
    sx = orig_w / packed_w
    sy = orig_h / packed_h

    mp4_path = os.path.join(work_dir, vinfo['packed_mp4'])
    cap = cv2.VideoCapture(mp4_path)
    all_frames = []
    while True:
        ret, frm = cap.read()
        if not ret or frm is None:
            break
        all_frames.append(frm)
    cap.release()

    tracks_out = {}
    vis_cnt = 0
    inp_cnt = 0
    tot_cnt = 0
    for r_idx, r in enumerate(vinfo['rallies'], 1):
        ps = int(r['packed_start'])
        pc = int(r['packed_count'])
        orig_sf = int(r['orig_start_frame'])
        r_frames = all_frames[ps : ps + pc]
        if not r_frames:
            continue
        dets = pipe.track_rally(r_frames, start_frame_idx=orig_sf, batch_size=32, use_ensemble=True)
        for d in dets:
            fn = int(d['frame'])
            vis = int(d['visibility'])
            inp = int(bool(d.get('inpainted', False)))
            x_full = float(d['x']) * sx if vis == 1 else 0.0
            y_full = float(d['y']) * sy if vis == 1 else 0.0
            tracks_out[fn] = (vis, x_full, y_full, inp)
            tot_cnt += 1
            if vis == 1:
                vis_cnt += 1
            if inp == 1:
                inp_cnt += 1
        total_frames_all += len(r_frames)

    csv_path = os.path.join(out_dir, f'{vid}_shuttle_2d.csv')
    with open(csv_path, 'w') as f_csv:
        f_csv.write('Frame,Visibility,X,Y,Inpainted\\n')
        for fn in sorted(tracks_out.keys()):
            v, x, y, inp = tracks_out[fn]
            f_csv.write(f'{fn},{v},{x:.2f},{y:.2f},{inp}\\n')
    print(
        f'[REMOTE] {vid}: {len(vinfo[\"rallies\"])} rallies, {tot_cnt} frames | '
        f'vis={vis_cnt} ({100.0*vis_cnt/max(1,tot_cnt):.1f}%), inpainted={inp_cnt} | '
        f'elapsed={time.time()-t_v:.1f}s',
        flush=True,
    )

zip_out = '/content/stress_csvs.zip'
with zipfile.ZipFile(zip_out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for p in sorted(glob.glob(os.path.join(out_dir, '*.csv'))):
        zf.write(p, os.path.basename(p))
print(f'[REMOTE] DONE: {total_frames_all} frames across {len(manifest[\"videos\"])} videos in {time.time()-t_start:.1f}s -> {zip_out}', flush=True)
"""
            )

        print(f"[COLAB] Executing TrackNetV3 across all 30 rallies on {allocated_gpu}...", flush=True)
        exec_proc = subprocess.run(
            [COLAB_BIN, "exec", "-s", session_name, "--timeout", "900", "-f", remote_script],
            capture_output=True,
            text=True,
            timeout=930.0,
        )
        print(exec_proc.stdout or "", flush=True)
        if exec_proc.stderr:
            print("[COLAB STDERR]", exec_proc.stderr[-800:], flush=True)
        if exec_proc.returncode != 0:
            raise RuntimeError(f"colab exec failed (rc={exec_proc.returncode})")

        # 5. Download CSV zip & unpack
        dl_zip = os.path.join(tmpdir, "stress_csvs.zip")
        dl_proc = subprocess.run(
            [COLAB_BIN, "download", "-s", session_name, "/content/stress_csvs.zip", dl_zip],
            capture_output=True,
            text=True,
            timeout=120.0,
        )
        if dl_proc.returncode != 0 or not os.path.exists(dl_zip):
            raise RuntimeError(f"Download failed: {dl_proc.stderr or dl_proc.stdout}")

        with zipfile.ZipFile(dl_zip, "r") as zf:
            for vid in manifest["videos"].keys():
                member = f"{vid}_shuttle_2d.csv"
                dst = os.path.join(OUT_ROOT, vid, "shuttle_2d.csv")
                with zf.open(member) as src_f, open(dst, "wb") as dst_f:
                    dst_f.write(src_f.read())
                print(f"[COLAB] Saved {dst} ({os.path.getsize(dst):,} bytes)", flush=True)
    finally:
        if allocated_gpu:
            _stop_and_verify_colab(session_name)
        shutil.rmtree(tmpdir, ignore_errors=True)


def compute_tracknet_quality_metrics(
    rallies_trimmed: List[Tuple[int, int]],
    tracks: Dict[int, Tuple[int, float, float]],
    inpainted: Dict[int, bool],
    image_height: int = 1080,
) -> dict:
    """Measures raw TrackNet visibility, inpaint %, stationary-lock %, and interior frame gaps."""
    sy = max(0.35, float(image_height) / 1080.0)
    total_frames = 0
    vis_frames = 0
    inpainted_frames = 0
    stationary_frames = 0
    gaps_ge5 = 0
    max_gap = 0

    for sf, ef in rallies_trimmed:
        if ef < sf:
            continue
        r_len = ef - sf + 1
        total_frames += r_len
        vis_list = []
        for fn in range(sf, ef + 1):
            t = tracks.get(fn)
            if t and t[0] == 1:
                vis_frames += 1
                if inpainted.get(fn, False):
                    inpainted_frames += 1
                vis_list.append((fn, t[1], t[2]))

        # Interior gaps >= 5 frames between consecutive visible detections
        for i in range(1, len(vis_list)):
            gap = vis_list[i][0] - vis_list[i - 1][0] - 1
            if gap > max_gap:
                max_gap = gap
            if gap >= 5:
                gaps_ge5 += 1

        # Stationary lock check: >= 5 consecutive visible frames within <= 4.5*sy px mid-rally
        run_start = 0
        while run_start < len(vis_list):
            run_end = run_start
            bx0 = bx1 = vis_list[run_start][1]
            by0 = by1 = vis_list[run_start][2]
            while run_end + 1 < len(vis_list):
                if vis_list[run_end + 1][0] - vis_list[run_end][0] > 2:
                    break
                nx, ny = vis_list[run_end + 1][1], vis_list[run_end + 1][2]
                nbx0, nbx1 = min(bx0, nx), max(bx1, nx)
                nby0, nby1 = min(by0, ny), max(by1, ny)
                if math.hypot(nbx1 - nbx0, nby1 - nby0) <= 4.5 * sy:
                    bx0, bx1, by0, by1 = nbx0, nbx1, nby0, nby1
                    run_end += 1
                else:
                    break
            run_len = run_end - run_start + 1
            if run_len >= 5 and (vis_list[run_start][0] - sf) > 15 and (ef - vis_list[run_end][0]) > 12:
                stationary_frames += run_len
            run_start = run_end + 1

    return {
        "active_frames": total_frames,
        "vis_frames": vis_frames,
        "visibility_pct": round(100.0 * vis_frames / max(1, total_frames), 1),
        "inpainted_frames": inpainted_frames,
        "inpainted_pct_of_vis": round(100.0 * inpainted_frames / max(1, vis_frames), 1),
        "inpainted_pct_of_all": round(100.0 * inpainted_frames / max(1, total_frames), 1),
        "stationary_lock_frames": stationary_frames,
        "stationary_lock_pct": round(100.0 * stationary_frames / max(1, vis_frames), 2),
        "broken_gaps_ge5": gaps_ge5,
        "max_gap_frames": max_gap,
    }


def compute_zero_trust_shot_rmse(
    shot: dict,
    cal: CourtCalibrator,
    tracks: Dict[int, Tuple[int, float, float]],
    fps: float,
) -> Tuple[Optional[float], int]:
    """
    Independently reprojects exported `trajectory_3d` onto raw `shuttle_2d.csv` detections
    across [start_frame, end_frame] and returns (rmse_px, matched_points).
    Zero trust in self-reported `fit_rmse_px`!
    """
    traj = shot.get("trajectory_3d") or []
    if len(traj) < 2:
        return None, 0
    sf = int(shot["start_frame"])
    ef = int(shot["end_frame"])
    t_arr = np.array([float(p[0]) for p in traj], dtype=np.float64)
    xyz_arr = np.array([[float(p[1]), float(p[2]), float(p[3])] for p in traj], dtype=np.float64)

    errs = []
    for fn in range(sf, ef + 1):
        tr = tracks.get(fn)
        if not tr or tr[0] != 1:
            continue
        t_rel = (fn - sf) / max(1.0, float(fps))
        if t_rel < t_arr[0] - 1e-4 or t_rel > t_arr[-1] + 0.5 / max(1.0, float(fps)):
            continue
        tc = float(np.clip(t_rel, t_arr[0], t_arr[-1]))
        x3 = float(np.interp(tc, t_arr, xyz_arr[:, 0]))
        y3 = float(np.interp(tc, t_arr, xyz_arr[:, 1]))
        z3 = float(np.interp(tc, t_arr, xyz_arr[:, 2]))
        proj = cal.project_3d_to_pixel(np.array([[x3, y3, z3]], dtype=np.float64))[0]
        err = float(math.hypot(float(proj[0]) - float(tr[1]), float(proj[1]) - float(tr[2])))
        if np.isfinite(err):
            errs.append(err)

    if not errs:
        return None, 0
    return round(float(np.sqrt(np.mean(np.square(errs)))), 2), len(errs)


def stage_analyze(video_specs: List[dict], reuse_poses: bool = False) -> dict:
    """Stage 3: Local Pose (or cached poses_2d.json) + HitDetector + Reconstruct3D + ShotClassifier + Zero-Trust Audit."""
    summary_all = {}

    for spec in video_specs:
        vid = spec["vid"]
        vdir = os.path.join(OUT_ROOT, vid)
        calib_path = os.path.join(vdir, "calibration.json")
        selected_path = os.path.join(vdir, "rallies_selected.json")
        csv_path = os.path.join(vdir, "shuttle_2d.csv")

        if not (os.path.exists(calib_path) and os.path.exists(selected_path) and os.path.exists(csv_path)):
            print(f"[ANALYZE] Skipping {vid} (missing prep/colab artifacts)", flush=True)
            continue

        print(f"\n[ANALYZE] === {vid} ({spec['label']}) ===", flush=True)
        t0 = time.time()

        with open(selected_path, "r", encoding="utf-8") as fs:
            sel = json.load(fs)
        vpath = sel["video_path"]
        w = int(sel["width"])
        h = int(sel["height"])
        fps = float(sel["fps"])
        mt = str(sel["match_type"])
        near_id = str(sel.get("near_player") or spec["near_default"])
        far_id = str(sel.get("far_player") or spec["far_default"])
        rallies_sel = sel["rallies"]

        cal = CourtCalibrator(f"stress_{vid}", image_width=w, image_height=h)
        cal.load_calibration(calib_path)

        tracks, inpainted_map = load_shuttle_csv_full(csv_path)

        cached_poses: Dict[str, dict] = {}
        poses_path = os.path.join(vdir, "poses_2d.json")
        if reuse_poses and os.path.exists(poses_path):
            try:
                with open(poses_path, "r", encoding="utf-8") as fp_in:
                    cached_poses = json.load(fp_in).get("rallies") or {}
            except Exception:
                cached_poses = {}

        pose_tracker = None if (reuse_poses and cached_poses) else PoseTracker(calibrator=cal, mode="balanced", stride=2)
        hit_detector = HitDetector(fps=fps, image_width=w, image_height=h, calibrator=cal)
        reconstructor = TrajectoryReconstructor3D(calibrator=cal, fps=fps)
        classifier = ShotClassifier(match_type=mt)

        cap = None if (reuse_poses and cached_poses) else cv2.VideoCapture(vpath)
        poses_by_rally: Dict[str, dict] = {}
        rallies_payload: List[dict] = []
        rallies_trimmed_bounds: List[Tuple[int, int]] = []
        all_shots: List[dict] = []
        zt_rmses: List[float] = []
        global_shot_id = 1
        slowmo_skipped = 0
        fallback_hit_rallies = 0
        split_refit_shots = 0

        for r_idx, r_win in enumerate(rallies_sel, 1):
            rid = int(r_win["rally_id"])
            cs = int(r_win.get("cam_start_frame", r_win["start_frame"]))
            ce = int(r_win.get("cam_end_frame", r_win["end_frame"]))

            tracks_dict_for_trim = {
                fn: {"frame": fn, "visibility": tracks[fn][0], "x": tracks[fn][1], "y": tracks[fn][2]}
                for fn in range(cs, ce + 1)
                if fn in tracks
            }
            if RallySegmenter.is_slowmo_replay(cs, ce, tracks_dict_for_trim, fps=fps, image_height=h):
                slowmo_skipped += 1
                print(f"  [R{rid}] Skipped as slow-mo replay ({cs}-{ce})", flush=True)
                continue

            sf, ef, is_partial_trim = RallySegmenter.trim_window_with_tracknet(
                cs, ce, tracks_dict_for_trim, image_height=h
            )
            rallies_trimmed_bounds.append((sf, ef))

            if reuse_poses and str(rid) in cached_poses:
                r_pose_info = cached_poses[str(rid)]
            else:
                if pose_tracker is None:
                    pose_tracker = PoseTracker(calibrator=cal, mode="balanced", stride=2)
                if cap is None:
                    cap = cv2.VideoCapture(vpath)
                # Decode trimmed frames for PoseTracker
                frames_bgr = []
                cap.set(cv2.CAP_PROP_POS_FRAMES, sf)
                for _ in range(sf, ef + 1):
                    ret_f, f_bgr = cap.read()
                    if not ret_f or f_bgr is None:
                        break
                    frames_bgr.append(f_bgr)

                r_pose_info = pose_tracker.track_single_rally_frames(
                    rally_id=rid,
                    frames_bgr=frames_bgr,
                    frames_start_idx=sf,
                    active_start_frame=sf,
                    active_end_frame=ef,
                    near_player_id=near_id,
                    far_player_id=far_id,
                )
            poses_by_rally[str(rid)] = r_pose_info
            iposes = hit_detector.interpolate_rally_poses(r_pose_info.get("frames", []), sf, ef)

            vis_pts = [
                (fn, tracks[fn][1], tracks[fn][2])
                for fn in range(sf, ef + 1)
                if fn in tracks and tracks[fn][0] == 1
            ]
            hits, is_partial_hit = hit_detector.detect_rally_hits(
                vis_pts, iposes, sf, ef, near_id, far_id, match_type=mt
            )
            if len(hits) == 0 and len(vis_pts) >= 5:
                hits = fallback_kinematic_hits(vis_pts, iposes, cal, near_id, far_id, fps=fps)
                fallback_hit_rallies += 1

            rally_3d_shots, global_shot_id = reconstructor.reconstruct_rally_shots(
                rally_id=rid,
                hits=hits,
                rally_end_frame=ef,
                tracks=tracks,
                global_shot_id_start=global_shot_id,
                iposes=iposes,
                near_player=near_id,
                far_player=far_id,
            )
            if len(rally_3d_shots) > len(hits):
                split_refit_shots += (len(rally_3d_shots) - len(hits))

            prev_type = None
            rally_shots_cls = []
            for shot_rec in rally_3d_shots:
                shot_type, contact_zone, target_zone = classifier.classify_shot_type(shot_rec, prev_shot_type=prev_type)
                outcome, close_call, possible_fault_height, line_dist_m = classifier.evaluate_outcome(shot_rec)
                prev_type = shot_type

                zt_rmse, zt_n = compute_zero_trust_shot_rmse(shot_rec, cal, tracks, fps=fps)
                if zt_rmse is not None:
                    zt_rmses.append(zt_rmse)

                s_cls = {
                    **shot_rec,
                    "type": shot_type,
                    "shot_type": shot_type,
                    "contact_zone": contact_zone,
                    "target_zone": target_zone,
                    "outcome": outcome,
                    "close_call": close_call,
                    "possible_fault_height": possible_fault_height,
                    "line_distance_m": line_dist_m,
                    "zt_rmse_px": zt_rmse,
                    "zt_matched_pts": zt_n,
                }
                rally_shots_cls.append(s_cls)
                all_shots.append(s_cls)

            rallies_payload.append({
                "rally_id": rid,
                "start_frame": sf,
                "end_frame": ef,
                "start_sec": round(sf / fps, 2),
                "end_sec": round(ef / fps, 2),
                "duration_sec": round((ef - sf + 1) / fps, 2),
                "partial": bool(is_partial_trim or is_partial_hit),
                "near_player": near_id,
                "far_player": far_id,
                "detected_doubles_pose": bool(r_pose_info.get("detected_doubles", False)),
                "shot_count": len(rally_shots_cls),
                "shots": rally_shots_cls,
            })
            print(
                f"  [R{rid}] frames {sf}-{ef} ({(ef-sf+1)/fps:.1f}s) | vis={len(vis_pts)}/{ef-sf+1} | "
                f"hits={len(hits)} -> shots={len(rally_shots_cls)} | "
                f"med_fit_rmse={np.median([s['fit_rmse_px'] for s in rally_shots_cls]) if rally_shots_cls else -1:.2f}px",
                flush=True,
            )

        if cap is not None:
            cap.release()

        # Save poses_2d.json (skip rewriting unchanged cache if reusing poses)
        if not (reuse_poses and cached_poses and len(cached_poses) >= len(poses_by_rally)):
            with open(poses_path, "w", encoding="utf-8") as fp:
                json.dump({"match_id": f"stress_{vid}", "rallies": poses_by_rally}, fp)

        calib_payload = {
            "H": cal.H_court_to_pixel.tolist() if cal.H_court_to_pixel is not None else None,
            "K": cal.K.tolist() if cal.K is not None else None,
            "R": cal.R.tolist() if cal.R is not None else None,
            "t": cal.tvec.tolist() if cal.tvec is not None else None,
            "reprojection_error_px": cal.reprojection_error_px,
            "line_sample_rmse_px": cal.line_sample_rmse_px,
        }
        accuracy_audit = compute_match_accuracy_audit(
            rallies_payload,
            calibration=calib_payload,
            tracks_by_frame=tracks,
        )
        tn_quality = compute_tracknet_quality_metrics(rallies_trimmed_bounds, tracks, inpainted_map, image_height=h)

        zt_arr = np.array(zt_rmses, dtype=np.float64) if zt_rmses else np.array([], dtype=np.float64)
        zt_stats = {
            "count": int(len(zt_arr)),
            "median_rmse_px": round(float(np.percentile(zt_arr, 50)), 2) if len(zt_arr) else None,
            "p75_rmse_px": round(float(np.percentile(zt_arr, 75)), 2) if len(zt_arr) else None,
            "p90_rmse_px": round(float(np.percentile(zt_arr, 90)), 2) if len(zt_arr) else None,
            "max_rmse_px": round(float(np.max(zt_arr)), 2) if len(zt_arr) else None,
            "blowup_gt30_count": int(np.sum(zt_arr > 30.0)) if len(zt_arr) else 0,
            "blowup_gt30_pct": round(100.0 * float(np.sum(zt_arr > 30.0)) / max(1, len(zt_arr)), 1) if len(zt_arr) else 0.0,
        }

        error_net_near = sum(1 for s in all_shots if s.get("outcome") == "error_net" and s.get("side") == "near")
        error_net_far = sum(1 for s in all_shots if s.get("outcome") == "error_net" and s.get("side") == "far")
        error_out_cnt = sum(1 for s in all_shots if s.get("outcome") == "error_out")
        winner_cnt = sum(1 for s in all_shots if s.get("outcome") == "winner")
        shot_types = dict(Counter(s.get("type", "other") for s in all_shots))
        speeds = [float(s["speed_kmh"]) for s in all_shots if s.get("speed_kmh") is not None]
        smash_speeds = [float(s["speed_kmh"]) for s in all_shots if s.get("type") == "smash"]

        video_summary = {
            "vid": vid,
            "label": spec["label"],
            "match_type": mt,
            "rallies_analyzed": len(rallies_payload),
            "slowmo_skipped": slowmo_skipped,
            "fallback_hit_rallies": fallback_hit_rallies,
            "split_refit_added_shots": split_refit_shots,
            "calibration": {
                "reproj_px": round(cal.reprojection_error_px, 2),
                "line_rmse_px": round(cal.line_sample_rmse_px, 2),
                "segment_coverage_pct": sel.get("calibration_preview", {}).get("segment_coverage_pct"),
            },
            "tracknet_quality": tn_quality,
            "accuracy_audit": accuracy_audit,
            "zero_trust_3d_2d": zt_stats,
            "outcomes": {
                "error_net_near": error_net_near,
                "error_net_far": error_net_far,
                "error_out": error_out_cnt,
                "winner": winner_cnt,
            },
            "shot_types": shot_types,
            "speed_stats": {
                "p50_kmh": round(float(np.percentile(speeds, 50)), 1) if speeds else None,
                "p90_kmh": round(float(np.percentile(speeds, 90)), 1) if speeds else None,
                "max_kmh": round(float(np.max(speeds)), 1) if speeds else None,
                "max_smash_kmh": round(float(np.max(smash_speeds)), 1) if smash_speeds else None,
                "smash_count": len(smash_speeds),
            },
            "elapsed_sec": round(time.time() - t0, 1),
        }
        summary_all[vid] = video_summary

        telemetry_out = {
            "source": {"video": vpath, "width": w, "height": h, "fps": fps},
            "match_metadata": {
                "match_id": f"stress_{vid}",
                "match_type": mt,
                "near_player": near_id,
                "far_player": far_id,
            },
            "calibration": calib_payload,
            "accuracy_audit": accuracy_audit,
            "zero_trust_3d_2d": zt_stats,
            "tracknet_quality": tn_quality,
            "rallies": rallies_payload,
        }
        tel_path = os.path.join(vdir, "telemetry.json")
        with open(tel_path, "w", encoding="utf-8") as ft:
            json.dump(telemetry_out, ft, indent=2)

        print(
            f"[ANALYZE] {vid} DONE in {video_summary['elapsed_sec']}s | "
            f"Grade {accuracy_audit['overall_grade']} ({accuracy_audit['overall_score_pct']}%) | "
            f"FitMed={accuracy_audit['median_rmse_px']}px P90={accuracy_audit['p90_rmse_px']}px | "
            f"ZTMed={zt_stats['median_rmse_px']}px ZTP90={zt_stats['p90_rmse_px']}px | "
            f"Grades={accuracy_audit['grade_counts']} | "
            f"NetErr(N/F)={error_net_near}/{error_net_far}",
            flush=True,
        )

    summary_path = os.path.join(OUT_ROOT, "summary.json")
    with open(summary_path, "w", encoding="utf-8") as fs:
        json.dump(summary_all, fs, indent=2)
    print(f"\n[ANALYZE] Saved master summary -> {summary_path}", flush=True)
    return summary_all


def _draw_court_wireframe(canvas: np.ndarray, cal: CourtCalibrator) -> None:
    """Draws subtle BWF court ground lines & net tape to visually verify calibration."""
    if cal.H_court_to_pixel is None:
        return
    segs = [
        ((0.0, 0.0), (BWF.width, 0.0)),
        ((0.0, 0.76), (BWF.width, 0.76)),
        ((0.0, 4.72), (BWF.width, 4.72)),
        ((0.0, 8.68), (BWF.width, 8.68)),
        ((0.0, 12.64), (BWF.width, 12.64)),
        ((0.0, 13.40), (BWF.width, 13.40)),
        ((0.0, 0.0), (0.0, 13.40)),
        ((0.46, 0.0), (0.46, 13.40)),
        ((3.05, 0.0), (3.05, 4.72)),
        ((3.05, 8.68), (3.05, 13.40)),
        ((BWF.width - 0.46, 0.0), (BWF.width - 0.46, 13.40)),
        ((BWF.width, 0.0), (BWF.width, 13.40)),
    ]
    overlay = canvas.copy()
    for p1, p2 in segs:
        u1, v1 = cal.court_to_pixel(p1[0], p1[1])
        u2, v2 = cal.court_to_pixel(p2[0], p2[1])
        cv2.line(overlay, (int(round(u1)), int(round(v1))), (int(round(u2)), int(round(v2))), (220, 220, 120), 1, cv2.LINE_AA)
    # Net tape top
    try:
        net_3d = np.array([[0.0, 6.70, 1.55], [3.05, 6.70, 1.524], [6.10, 6.70, 1.55]], dtype=np.float64)
        np2d = cal.project_3d_to_pixel(net_3d)
        pts = np.round(np2d).astype(np.int32)
        cv2.polylines(overlay, [pts], False, (100, 240, 255), 2, cv2.LINE_AA)
    except Exception:
        pass
    cv2.addWeighted(overlay, 0.35, canvas, 0.65, 0.0, canvas)


def _select_4_proof_shots(all_shots: List[dict]) -> List[Tuple[str, dict]]:
    """
    Picks 4 representative shots across distinct rallies whenever possible:
      1. Smash (highest speed with >= 4 pts)
      2. Clear / Lift (highest peak_height_m)
      3. Drive / Drop / Net (mid-rally, preferring distinct rally)
      4. Worst-RMSE shot (strictly honest — never hide glitches!)
    """
    if not all_shots:
        return []

    chosen: List[Tuple[str, dict]] = []
    used_ids = set()
    used_rallies = set()

    def _pick(tag: str, candidates: List[dict], key_fn, prefer_new_rally: bool = True):
        cands = [s for s in candidates if s["shot_id"] not in used_ids]
        if not cands:
            return
        if prefer_new_rally:
            new_r = [s for s in cands if s["rally_id"] not in used_rallies]
            if new_r:
                cands = new_r
        best = max(cands, key=key_fn)
        chosen.append((tag, best))
        used_ids.add(best["shot_id"])
        used_rallies.add(best["rally_id"])

    # 4th slot reserved for worst-RMSE shot FIRST so we don't accidentally hide it
    worst = max(
        all_shots,
        key=lambda s: float(s.get("zt_rmse_px") if s.get("zt_rmse_px") is not None else s.get("fit_rmse_px", 0.0)),
    )
    worst_id = worst["shot_id"]

    non_worst = [s for s in all_shots if s["shot_id"] != worst_id]
    # 1. Smash
    smashes = [s for s in non_worst if s.get("type") == "smash" and (s["end_frame"] - s["start_frame"]) >= 4]
    if not smashes:
        smashes = [s for s in non_worst if s.get("type") in ("smash", "drive")]
    _pick("SMASH", smashes or non_worst, key_fn=lambda s: float(s.get("speed_kmh", 0.0)))

    # 2. Clear / Lift
    clears = [s for s in non_worst if s.get("type") in ("clear", "lift", "lob")]
    _pick("CLEAR/LIFT", clears or non_worst, key_fn=lambda s: float(s.get("peak_height_m", 0.0)))

    # 3. Drive / Drop / Net
    drives = [s for s in non_worst if s.get("type") in ("drive", "drop", "net", "push")]
    _pick("DRIVE/DROP", drives or non_worst, key_fn=lambda s: (float(s.get("track_coverage_pct") or 0.0), -float(s.get("fit_rmse_px", 99.0))))

    # 4. Worst-RMSE shot
    chosen.append(("WORST-RMSE", worst))
    return chosen[:4]


def render_shot_panel(
    cap: cv2.VideoCapture,
    cal: CourtCalibrator,
    tracks: Dict[int, Tuple[int, float, float]],
    inpainted: Dict[int, bool],
    tag: str,
    shot: dict,
    panel_w: int = 960,
    panel_h: int = 540,
) -> np.ndarray:
    sf = int(shot["start_frame"])
    ef = int(shot["end_frame"])
    mid_f = (sf + ef) // 2
    cap.set(cv2.CAP_PROP_POS_FRAMES, mid_f)
    ret, frame = cap.read()
    if not ret or frame is None:
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    canvas = frame.copy()
    _draw_court_wireframe(canvas, cal)

    # 1. Plot raw TrackNet (Magenta) & InpaintNet (Orange) detections across [sf, ef]
    raw_pts = []
    for fn in range(sf, ef + 1):
        tr = tracks.get(fn)
        if not tr or tr[0] != 1:
            continue
        pt = (int(round(tr[1])), int(round(tr[2])))
        is_inp = inpainted.get(fn, False)
        raw_pts.append((pt, is_inp))

    # Connect raw 2D detections with faint dashed/thin line
    for i in range(1, len(raw_pts)):
        cv2.line(canvas, raw_pts[i - 1][0], raw_pts[i][0], (200, 100, 200), 1, cv2.LINE_AA)

    for pt, is_inp in raw_pts:
        if is_inp:
            cv2.circle(canvas, pt, 10, (0, 165, 255), 3, cv2.LINE_AA)   # Orange = InpaintNet
            cv2.circle(canvas, pt, 3, (255, 255, 255), -1, cv2.LINE_AA)
        else:
            cv2.circle(canvas, pt, 9, (255, 0, 255), 3, cv2.LINE_AA)    # Magenta = TrackNet + Viterbi
            cv2.circle(canvas, pt, 3, (255, 255, 255), -1, cv2.LINE_AA)

    # 2. Plot reprojected 3D RK4 trajectory (Bright Green/Cyan curve)
    traj = shot.get("trajectory_3d") or []
    if len(traj) >= 2:
        pts3d = np.array([[p[1], p[2], p[3]] for p in traj], dtype=np.float64)
        proj2d = cal.project_3d_to_pixel(pts3d)
        pts_i = []
        for u, v in proj2d:
            if np.isfinite(u) and np.isfinite(v) and -200 <= u <= 2200 and -200 <= v <= 1400:
                pts_i.append((int(round(u)), int(round(v))))
        if len(pts_i) >= 2:
            cv2.polylines(canvas, [np.array(pts_i, dtype=np.int32)], False, (0, 255, 140), 4, cv2.LINE_AA)
            cv2.polylines(canvas, [np.array(pts_i, dtype=np.int32)], False, (255, 255, 0), 2, cv2.LINE_AA)
            # Start (yellow square) & End (red cross/circle)
            cv2.circle(canvas, pts_i[0], 11, (0, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, pts_i[0], 11, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.circle(canvas, pts_i[-1], 11, (0, 40, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, pts_i[-1], 11, (255, 255, 255), 2, cv2.LINE_AA)

    # 3. Top translucent telemetry banner
    banner_h = 84
    sub = canvas[0:banner_h, :]
    dark = np.zeros_like(sub)
    cv2.addWeighted(dark, 0.72, sub, 0.28, 0.0, sub)

    grade = shot.get("accuracy_grade", "?")
    g_color = {
        "A": (80, 255, 120),
        "B": (80, 230, 255),
        "C": (0, 180, 255),
        "D": (60, 70, 255),
    }.get(grade, (255, 255, 255))

    fit_rmse = float(shot.get("fit_rmse_px", 0.0))
    zt_rmse = shot.get("zt_rmse_px")
    zt_str = f"{zt_rmse:.1f}px" if zt_rmse is not None else "n/a"
    cov = float(shot.get("track_coverage_pct") or 0.0)
    inl = float(shot.get("inlier_ratio") or 0.0) * 100.0
    spd = float(shot.get("speed_kmh") or 0.0)
    stype = str(shot.get("type", "other")).upper()
    outc = str(shot.get("outcome", "in_play"))
    side = str(shot.get("side", "?")).upper()
    rid = int(shot.get("rally_id", 0))
    sidx = int(shot.get("shot_index", 0))

    line1 = f"[{tag}] R{rid} S{sidx} ({side}) | {stype} {spd:.0f} km/h | Grade {grade} | {outc}"
    line2 = f"FitRMSE: {fit_rmse:.1f}px | ZeroTrust3D->2D: {zt_str} | Cov: {cov:.0f}% | Inliers: {inl:.0f}% | F:{sf}-{ef}"
    cv2.putText(canvas, line1, (22, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.95, g_color, 2, cv2.LINE_AA)
    cv2.putText(canvas, line2, (22, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.80, (240, 245, 250), 2, cv2.LINE_AA)

    # Bottom-left compact legend
    leg_y = canvas.shape[0] - 24
    cv2.rectangle(canvas, (14, leg_y - 26), (760, leg_y + 12), (10, 14, 20), -1)
    cv2.circle(canvas, (34, leg_y - 7), 7, (255, 0, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, "TrackNet+Viterbi", (48, leg_y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 180, 255), 2, cv2.LINE_AA)
    cv2.circle(canvas, (248, leg_y - 7), 7, (0, 165, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, "InpaintNet", (262, leg_y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (120, 210, 255), 2, cv2.LINE_AA)
    cv2.line(canvas, (392, leg_y - 7), (428, leg_y - 7), (0, 255, 180), 4, cv2.LINE_AA)
    cv2.putText(canvas, "3D RK4 Reproj (Yel=Start Red=End)", (438, leg_y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (160, 255, 200), 2, cv2.LINE_AA)

    return cv2.resize(canvas, (panel_w, panel_h), interpolation=cv2.INTER_AREA)


def stage_proof(video_specs: List[dict]) -> None:
    """Stage 4: Render 2x2 visual proof grids per video."""
    os.makedirs(PROOFS_DIR, exist_ok=True)
    for spec in video_specs:
        vid = spec["vid"]
        vdir = os.path.join(OUT_ROOT, vid)
        tel_path = os.path.join(vdir, "telemetry.json")
        calib_path = os.path.join(vdir, "calibration.json")
        csv_path = os.path.join(vdir, "shuttle_2d.csv")
        if not (os.path.exists(tel_path) and os.path.exists(calib_path) and os.path.exists(csv_path)):
            continue

        with open(tel_path, "r", encoding="utf-8") as ft:
            tel = json.load(ft)
        vpath = tel["source"]["video"]
        w = int(tel["source"]["width"])
        h = int(tel["source"]["height"])

        cal = CourtCalibrator(f"stress_{vid}", image_width=w, image_height=h)
        cal.load_calibration(calib_path)
        tracks, inpainted_map = load_shuttle_csv_full(csv_path)

        all_shots = [s for r in tel.get("rallies", []) for s in r.get("shots", [])]
        selected = _select_4_proof_shots(all_shots)

        cap = cv2.VideoCapture(vpath)
        panels = []
        for tag, s in selected:
            panels.append(render_shot_panel(cap, cal, tracks, inpainted_map, tag, s))
        cap.release()

        while len(panels) < 4:
            panels.append(np.zeros((540, 960, 3), dtype=np.uint8))

        top = np.hstack([panels[0], panels[1]])
        bot = np.hstack([panels[2], panels[3]])
        grid = np.vstack([top, bot])

        # Thin white divider cross
        cv2.line(grid, (960, 0), (960, 1080), (240, 240, 240), 2)
        cv2.line(grid, (0, 540), (1920, 540), (240, 240, 240), 2)

        out_png = os.path.join(PROOFS_DIR, f"{vid}_3d_proof.png")
        cv2.imwrite(out_png, grid)
        print(f"[PROOF] Saved {out_png} ({os.path.getsize(out_png) / 1024:.0f} KB)", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Hawkview 5-Video Colab Stress-Test & Visual Proof Runner")
    parser.add_argument("--stage", choices=["all", "prep", "colab", "analyze", "proof"], default="all")
    parser.add_argument("--skip-tracknet", action="store_true", help="Reuse cached calibration, shuttle_2d.csv, and poses_2d.json; run analyze + proof only")
    parser.add_argument("--reuse-poses", action="store_true", help="Reuse cached poses_2d.json during analyze stage")
    parser.add_argument("--max-rallies", type=int, default=6)
    parser.add_argument("--min-dur", type=float, default=3.5)
    parser.add_argument("--videos", type=str, default="", help="Comma-separated vid filter")
    args = parser.parse_args()

    specs = VIDEOS
    if args.videos.strip():
        wanted = {v.strip() for v in args.videos.split(",") if v.strip()}
        specs = [s for s in VIDEOS if s["vid"] in wanted]

    if args.skip_tracknet:
        stage_analyze(specs, reuse_poses=True)
        stage_proof(specs)
        return

    if args.stage in ("all", "prep"):
        stage_prep(specs, max_rallies=args.max_rallies, min_dur_sec=args.min_dur)
    if args.stage in ("all", "colab"):
        stage_colab()
    if args.stage in ("all", "analyze"):
        stage_analyze(specs, reuse_poses=bool(args.reuse_poses))
    if args.stage in ("all", "proof"):
        stage_proof(specs)


if __name__ == "__main__":
    main()
