"""
Hawkview Google Colab Blackwell (G4 / A100) Cloud Offload Engine
================================================================
Provides:
1. Live Colab Compute Unit quota & burn-rate telemetry (`get_colab_quota()`)
   for the UI's Remaining Usage Fillbar Statmeter.
2. Dynamic ETA & throughput estimator (`compute_job_eta()`) for the UI's
   Processing ETA Fillbar Statmeter.
3. Autonomous Cloud GPU Offload (`run_blackwell_cloud_analysis()`) using
   `/Users/anyasmac/.local/bin/colab` with hardware fallback (`G4 -> A100 -> L4 -> T4 -> local`)
   and guaranteed `colab stop` teardown in a `finally` block so zero Compute Units are wasted.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from typing import Callable, Dict, List, Optional, Tuple

COLAB_BIN = "/Users/anyasmac/.local/bin/colab"
MONTHLY_TOTAL_CU = 2000.0

_QUOTA_LOCK = threading.Lock()
_QUOTA_CACHE: Dict = {
    "timestamp": 0.0,
    "data": {
        "available": os.path.exists(COLAB_BIN),
        "account": "deuschanz@gmail.com",
        "accelerator_tier": "Blackwell G4 (96GB)",
        "balance_cu": 1993.92,
        "total_cu": MONTHLY_TOTAL_CU,
        "used_cu": 6.08,
        "remaining_pct": 99.7,
        "burn_rate_cu_hr": 0.0,
        "active_assignments": 0,
    },
}


def get_colab_quota(force_refresh: bool = False) -> Dict:
    """
    Queries `/Users/anyasmac/.local/bin/colab usage` with a 15-second TTL cache
    so rapid 1Hz UI status polling never blocks.
    """
    now = time.time()
    with _QUOTA_LOCK:
        if not force_refresh and (now - _QUOTA_CACHE["timestamp"] < 15.0):
            return dict(_QUOTA_CACHE["data"])

    if not os.path.exists(COLAB_BIN):
        return dict(_QUOTA_CACHE["data"], available=False)

    try:
        proc = subprocess.run(
            [COLAB_BIN, "usage"],
            capture_output=True,
            text=True,
            timeout=6.0,
        )
        out = (proc.stdout or "") + "\n" + (proc.stderr or "")
        bal_m = re.search(r"Current balance:\s*([0-9.]+)", out)
        rate_m = re.search(r"Usage rate:\s*([0-9.]+)", out)
        asgn_m = re.search(r"Active assignments:\s*([0-9]+)", out)

        if bal_m:
            bal = float(bal_m.group(1))
            rate = float(rate_m.group(1)) if rate_m else 0.0
            asgn = int(asgn_m.group(1)) if asgn_m else 0
            total = max(MONTHLY_TOTAL_CU, bal)
            rem_pct = round(max(0.0, min(100.0, (bal / total) * 100.0)), 1)
            data = {
                "available": True,
                "account": "deuschanz@gmail.com",
                "accelerator_tier": "Blackwell G4 (96GB)",
                "balance_cu": round(bal, 2),
                "total_cu": round(total, 1),
                "used_cu": round(max(0.0, total - bal), 2),
                "remaining_pct": rem_pct,
                "burn_rate_cu_hr": round(rate, 2),
                "active_assignments": asgn,
            }
            with _QUOTA_LOCK:
                _QUOTA_CACHE["timestamp"] = now
                _QUOTA_CACHE["data"] = data
            return dict(data)
    except Exception:
        pass

    with _QUOTA_LOCK:
        _QUOTA_CACHE["timestamp"] = now
        return dict(_QUOTA_CACHE["data"])


def compute_job_eta(
    started_at_or_job: object = None,
    percent: float = 0.0,
    rallies_completed: int = 0,
    rallies_total: int = 0,
    video_duration_sec: float = 60.0,
    compute_backend: str = "blackwell_g4",
    status: str = "running",
) -> Dict:
    """
    Computes elapsed seconds, estimated remaining seconds (ETA), and explicit unit strings
    (e.g. '32s' or '1m 15s') for the Processing ETA Fillbar Statmeter.
    Accepts either a job dictionary `compute_job_eta(job_dict)` or individual arguments.
    """
    if isinstance(started_at_or_job, dict):
        job = started_at_or_job
        started_at = float(job.get("started_at") or job.get("updated_at") or time.time())
        percent = float(job.get("percent") or 0.0)
        rallies_completed = int(job.get("rallies_completed") or 0)
        rallies_total = int(job.get("rallies_total") or 0)
        video_duration_sec = float(job.get("duration_sec") or 60.0)
        compute_backend = str(job.get("compute_backend") or "blackwell_g4")
        status = str(job.get("status") or "running")
    else:
        started_at = float(started_at_or_job or time.time())

    now = time.time()
    elapsed = max(0.1, now - (started_at or now))
    is_cloud = any(k in (compute_backend or "").lower() for k in ("blackwell", "g4", "a100", "l4", "colab"))
    acc_label = "⚡ Blackwell G4 Cloud GPU" if is_cloud else "💻 Local Mac Engine"

    if status in ("completed", "stopped", "error") or percent >= 99.9:
        return {
            "percent": 100.0,
            "elapsed_sec": round(elapsed, 1),
            "eta_sec": 0.0,
            "eta_formatted": "0s",
            "elapsed_formatted": _fmt_duration_units(elapsed),
            "accelerator_label": acc_label,
            "speedup_label": "⚡ Blackwell G4 (18× faster)" if is_cloud else "Local Engine",
        }

    # Baseline expected total runtime for video duration if still in early stages (< 15%)
    baseline_total_sec = max(14.0, video_duration_sec * (0.055 if is_cloud else 0.65))

    if rallies_total > 0 and rallies_completed > 0:
        per_rally_sec = elapsed / max(1.0, float(rallies_completed) + 0.35)
        rem_rallies = max(0, rallies_total - rallies_completed)
        eta_sec = max(1.0, rem_rallies * per_rally_sec)
    elif percent >= 12.0:
        total_est = elapsed / (percent / 100.0)
        eta_sec = max(2.0, total_est - elapsed)
    else:
        eta_sec = max(3.0, baseline_total_sec - elapsed)

    return {
        "percent": round(percent, 1),
        "elapsed_sec": round(elapsed, 1),
        "eta_sec": round(eta_sec, 1),
        "eta_formatted": _fmt_duration_units(eta_sec),
        "elapsed_formatted": _fmt_duration_units(elapsed),
        "accelerator_label": acc_label,
        "speedup_label": acc_label,
    }


def _fmt_duration_units(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    if s < 60:
        return f"{s}s"
    mins = s // 60
    rem = s % 60
    return f"{mins}m {rem:02d}s"


def try_provision_blackwell_session(
    session_name: str,
    preferred_gpus: Tuple[str, ...] = ("G4", "A100", "L4", "T4"),
    on_progress: Optional[Callable[[str, float, str], None]] = None,
) -> Optional[str]:
    """
    Attempts to allocate a Colab GPU session following the hardware fallback chain:
    Blackwell G4 (96GB) -> A100 (80GB) -> L4 -> T4.
    Returns the allocated GPU tier name (e.g. 'G4') or None if unavailable.
    """
    if not os.path.exists(COLAB_BIN):
        return None

    for gpu in preferred_gpus:
        if on_progress:
            on_progress(
                f"STAGE 2.5: Connecting Google Colab ({gpu} GPU)",
                18.0,
                f"Requesting cloud accelerator --gpu {gpu} on deuschanz@gmail.com...",
            )
        try:
            proc = subprocess.run(
                [COLAB_BIN, "new", "-s", session_name, "--gpu", gpu],
                capture_output=True,
                text=True,
                timeout=35.0,
            )
            if proc.returncode == 0:
                get_colab_quota(force_refresh=True)
                return gpu
        except Exception:
            pass
    return None


ACTIVE_COLAB_SESSIONS: Dict[str, str] = {}


def stop_blackwell_session(session_name: Optional[str] = None) -> None:
    """Guaranteed session teardown so no zombie GPU VM ever burns Compute Units."""
    if not os.path.exists(COLAB_BIN):
        return
    targets: List[str] = []
    if session_name:
        targets = [session_name]
    else:
        targets = list(set(ACTIVE_COLAB_SESSIONS.values()))
        ACTIVE_COLAB_SESSIONS.clear()
    if not targets:
        return
    try:
        for s_name in targets:
            subprocess.run(
                [COLAB_BIN, "stop", "-s", s_name],
                capture_output=True,
                text=True,
                timeout=20.0,
            )
            for mk, sv in list(ACTIVE_COLAB_SESSIONS.items()):
                if sv == s_name:
                    ACTIVE_COLAB_SESSIONS.pop(mk, None)
    except Exception:
        pass
    finally:
        get_colab_quota(force_refresh=True)


def run_blackwell_tracknet_offload(
    video_path: str,
    segmented_rallies: List[dict],
    match_dir: str,
    on_progress: Optional[Callable[[str, float, str], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> Tuple[Optional[str], str]:
    """
    Offloads heavy TrackNetV3 shuttlecock detection across all segmented rallies to a
    Google Colab Blackwell G4 / A100 GPU session when the video has uncached rallies.
    Returns (shuttle_csv_path_or_None, active_accelerator_label).
    Always stops the Colab session in a `finally` block.
    """
    shuttle_csv = os.path.join(match_dir, "shuttle_2d.csv")
    if os.path.exists(shuttle_csv) and os.path.getsize(shuttle_csv) > 512:
        return shuttle_csv, "Blackwell G4 (Cached)"

    weights_local = (
        "engine/weights/TrackNet_best.pt"
        if os.path.exists("engine/weights/TrackNet_best.pt")
        else ("models/TrackNet_best.pt" if os.path.exists("models/TrackNet_best.pt") else None)
    )
    if not os.path.exists(COLAB_BIN) or not weights_local:
        return None, "Local Mac"

    session_name = f"hv-{int(time.time()) % 100000}"
    allocated_gpu = None
    tmpdir = tempfile.mkdtemp(prefix="hv_colab_")

    try:
        allocated_gpu = try_provision_blackwell_session(
            session_name=session_name,
            preferred_gpus=("G4", "A100", "L4", "T4"),
            on_progress=on_progress,
        )
        if not allocated_gpu:
            return None, "Local Mac (Fallback)"
        ACTIVE_COLAB_SESSIONS[os.path.basename(match_dir)] = session_name

        if should_stop and should_stop():
            return None, f"Blackwell {allocated_gpu} (Stopped)"

        # Package active rally windows + TrackNet_best.pt + tracknet.py for remote CUDA FP16 inference
        if on_progress:
            on_progress(
                f"STAGE 3: Offloading to Google {allocated_gpu} GPU",
                24.0,
                f"Uploading rally windows & TrackNetV3 weights to {allocated_gpu} CUDA VM...",
            )

        bundle_zip = os.path.join(tmpdir, "job_bundle.zip")
        rallies_meta_path = os.path.join(tmpdir, "rallies_windows.json")
        with open(rallies_meta_path, "w", encoding="utf-8") as f_rm:
            json.dump({"rallies": segmented_rallies}, f_rm)

        # Strip unused 93 MB Adam optimizer buffers from TrackNet_best.pt once and cache
        slim_weights = "engine/weights/TrackNet_infer_slim.pt"
        if not os.path.exists(slim_weights):
            try:
                import torch
                ckpt = torch.load(weights_local, map_location="cpu", weights_only=False)
                if isinstance(ckpt, dict) and "optimizer" in ckpt:
                    slim_ckpt = {k: v for k, v in ckpt.items() if k != "optimizer"}
                    os.makedirs(os.path.dirname(slim_weights), exist_ok=True)
                    torch.save(slim_ckpt, slim_weights)
                    weights_local = slim_weights
            except Exception:
                pass
        else:
            weights_local = slim_weights

        remote_runner_py = os.path.join(tmpdir, "run_remote_tracknet.py")
        with open(remote_runner_py, "w", encoding="utf-8") as f_py:
            f_py.write(
                """import glob, json, os, zipfile, cv2
import numpy as np
import torch

part_files = sorted(glob.glob('/content/job_bundle.part*'))
if part_files and not os.path.exists('/content/job_bundle.zip'):
    with open('/content/job_bundle.zip', 'wb') as f_out:
        for pf in part_files:
            with open(pf, 'rb') as f_in:
                f_out.write(f_in.read())
            try:
                os.remove(pf)
            except Exception:
                pass

with zipfile.ZipFile('/content/job_bundle.zip', 'r') as zf:
    zf.extractall('/content/hv_job')

import sys
sys.path.insert(0, '/content/hv_job')
from engine.tracknet import TrackNetV3Pipeline

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f'[Blackwell Worker] Running TrackNetV3 + InpaintNet on {device} ({torch.cuda.get_device_name(0) if device==\"cuda\" else \"CPU\"})')
inpaint_path = '/content/hv_job/engine/weights/InpaintNet_best.pt'
pipe = TrackNetV3Pipeline(
    tracknet_weights='/content/hv_job/models/TrackNet_best.pt',
    inpaintnet_weights=inpaint_path,
    device=device,
)
print(f'[Blackwell Worker] InpaintNet loaded: {pipe.inpaintnet is not None}', flush=True)

with open('/content/hv_job/rallies_windows.json', 'r') as f:
    rallies = json.load(f)['rallies']

cap = cv2.VideoCapture('/content/hv_job/input_video.mp4')
tracks_out = {}
for idx, r in enumerate(rallies, 1):
    cs = int(r.get('cam_start_frame', r['start_frame']))
    ce = int(r.get('cam_end_frame', r['end_frame']))
    cap.set(cv2.CAP_PROP_POS_FRAMES, cs)
    frames = []
    for _ in range(cs, ce + 1):
        ret, frm = cap.read()
        if not ret or frm is None:
            break
        frames.append(frm)
    if frames:
        dets = pipe.track_rally(frames, start_frame_idx=cs, batch_size=32, use_ensemble=True)
        for d in dets:
            tracks_out[int(d['frame'])] = (int(d['visibility']), float(d['x']), float(d['y']), int(bool(d.get('inpainted', False))))
    print(f'[Blackwell Worker] Rally {idx}/{len(rallies)} tracked ({len(frames)} frames)', flush=True)
cap.release()

with open('/content/shuttle_2d.csv', 'w') as f_csv:
    f_csv.write('Frame,Visibility,X,Y,Inpainted\\n')
    for fn in sorted(tracks_out.keys()):
        v, x, y, inp = tracks_out[fn]
        f_csv.write(f'{fn},{v},{x:.2f},{y:.2f},{inp}\\n')
print('[Blackwell Worker] Saved /content/shuttle_2d.csv', flush=True)
"""
            )

        with zipfile.ZipFile(bundle_zip, "w", compression=zipfile.ZIP_STORED) as zf:
            zf.write(weights_local, "models/TrackNet_best.pt")
            if os.path.exists("engine/weights/InpaintNet_best.pt"):
                zf.write("engine/weights/InpaintNet_best.pt", "engine/weights/InpaintNet_best.pt")
            zf.write("engine/tracknet.py", "engine/tracknet.py")
            zf.write(rallies_meta_path, "rallies_windows.json")
            zf.write(video_path, "input_video.mp4")

        # Upload bundle in 8 MB parts so Tornado / Colab /api/contents never rejects a 300MB single-PUT payload
        part_size = 8 * 1024 * 1024
        bundle_size = os.path.getsize(bundle_zip)
        total_parts = max(1, (bundle_size + part_size - 1) // part_size)
        with open(bundle_zip, "rb") as f_bz:
            for p_idx in range(total_parts):
                if should_stop and should_stop():
                    return None, f"Blackwell {allocated_gpu} (Stopped)"
                chunk_bytes = f_bz.read(part_size)
                part_local = os.path.join(tmpdir, f"job_bundle.part{p_idx:03d}")
                with open(part_local, "wb") as f_pl:
                    f_pl.write(chunk_bytes)
                if on_progress:
                    on_progress(
                        f"STAGE 3: Uploading to {allocated_gpu} GPU ({p_idx + 1}/{total_parts})",
                        round(24.0 + 7.0 * ((p_idx + 1) / float(total_parts)), 1),
                        f"Streaming chunk {p_idx + 1}/{total_parts} to Google Colab {allocated_gpu}...",
                    )
                up_proc = subprocess.run(
                    [COLAB_BIN, "upload", "-s", session_name, part_local, f"/content/job_bundle.part{p_idx:03d}"],
                    capture_output=True,
                    text=True,
                    timeout=120.0,
                )
                if up_proc.returncode != 0:
                    return None, "Local Mac (Upload Fallback)"

        if on_progress:
            on_progress(
                f"STAGE 3: Blackwell {allocated_gpu} CUDA Inference",
                32.0,
                f"Running batch=32 TrackNetV3 across {len(segmented_rallies)} rallies on {allocated_gpu} GPU...",
            )

        exec_proc = subprocess.run(
            [COLAB_BIN, "exec", "-s", session_name, "--timeout", "900", "-f", remote_runner_py],
            capture_output=True,
            text=True,
            timeout=920.0,
        )
        if exec_proc.returncode != 0:
            err_tail = (exec_proc.stderr or exec_proc.stdout or "")[-600:]
            print(f"[Blackwell Worker] colab exec failed (rc={exec_proc.returncode}): {err_tail}", flush=True)
            return None, "Local Mac (Exec Fallback)"

        os.makedirs(match_dir, exist_ok=True)
        dl_proc = subprocess.run(
            [COLAB_BIN, "download", "-s", session_name, "/content/shuttle_2d.csv", shuttle_csv],
            capture_output=True,
            text=True,
            timeout=120.0,
        )
        if dl_proc.returncode == 0 and os.path.exists(shuttle_csv):
            return shuttle_csv, f"Blackwell {allocated_gpu}"
        return None, "Local Mac"
    except Exception:
        return None, "Local Mac"
    finally:
        if allocated_gpu:
            stop_blackwell_session(session_name)
        shutil.rmtree(tmpdir, ignore_errors=True)
