#!/usr/bin/env python3
"""
Hawkview High-Performance Range-Supporting HTTP & Live Analysis Server
Supports:
- HTTP 206 Partial Content for instant 1:1 video scrubbing and seeking in HTML5 video players
- POST /api/upload-video: Upload any MP4/MOV/WebM video (broadcast or iPhone/recreational) and probe metadata + initial court keypoints
- POST /api/auto-calibrate: Run white-line sub-pixel court detection at a user-selected timestamp
- POST /api/analyze-start: Launch progressive rally-by-rally 3D analysis in a background worker
- POST /api/analyze-stop: Stop background analysis early while keeping all completed rallies
- GET  /api/analyze-status?match_id=...: Poll live progress and stream newly completed rallies into the 3D UI
"""

import base64
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import cv2

from engine.court_calib import CourtCalibrator
from engine.pipeline import HawkviewPipeline

# Global dictionary of active/completed analysis jobs keyed by match_id
ANALYSIS_JOBS = {}
JOBS_LOCK = threading.Lock()


def sanitize_match_id(raw_name: str) -> str:
    base = os.path.splitext(os.path.basename(raw_name or "custom_match"))[0]
    clean = re.sub(r"[^a-zA-Z0-9_\-]+", "_", base).strip("_").lower()
    if not clean:
        clean = "custom_match"
    return f"{clean}_{int(time.time()) % 100000}"


def probe_video_and_keypoints(video_path: str, sample_time_sec: float = -1.0) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_sec = round(total_frames / fps, 2) if fps > 0 else 0.0

    if sample_time_sec >= 0 and fps > 0:
        target_frame = min(max(0, int(round(sample_time_sec * fps))), max(0, total_frames - 1))
    else:
        target_frame = min(max(0, total_frames // 5), max(0, total_frames - 1))

    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ret, frame_bgr = cap.read()
    cap.release()

    frame_b64 = None
    if ret and frame_bgr is not None:
        ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if ok:
            frame_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

    auto_info = CourtCalibrator.auto_detect_court_keypoints(
        frame_bgr if ret else None, width=width, height=height
    )
    return {
        "video_path": video_path,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "duration_sec": duration_sec,
        "sample_time_sec": round(target_frame / fps, 2) if fps > 0 else 0.0,
        "frame_jpeg_b64": frame_b64,
        "calibration_preview": auto_info,
    }


def start_analysis_worker(params: dict) -> str:
    match_id = params.get("match_id") or sanitize_match_id(params.get("video_path", "custom"))
    video_path = params.get("video_path", "assets/LZJvPopov.mp4")
    keypoints = params.get("keypoints")
    near_player = params.get("near_player") or {"id": "P1", "name": "Player 1", "country": "NEAR", "dominant_hand": "Right"}
    far_player = params.get("far_player") or {"id": "P2", "name": "Player 2", "country": "FAR", "dominant_hand": "Right"}
    mode = params.get("mode", "auto")
    max_rallies = params.get("max_rallies")
    if max_rallies is not None:
        try:
            max_rallies = int(max_rallies)
            if max_rallies <= 0:
                max_rallies = None
        except Exception:
            max_rallies = None

    with JOBS_LOCK:
        ANALYSIS_JOBS[match_id] = {
            "match_id": match_id,
            "video_path": video_path,
            "status": "running",
            "stage": "STAGE 0: Initializing Pipeline",
            "percent": 2.0,
            "message": "Starting court calibration & video stream...",
            "rallies_completed": 0,
            "rallies_total": 0,
            "stop_requested": False,
            "telemetry": None,
            "error": None,
            "updated_at": time.time(),
        }

    def on_progress(stage: str, pct: float, teaser: str):
        with JOBS_LOCK:
            job = ANALYSIS_JOBS.get(match_id)
            if job:
                job["stage"] = stage
                job["percent"] = round(float(pct), 1)
                job["message"] = teaser
                job["updated_at"] = time.time()

    def on_rally_ready(telemetry_contract: dict, r_done: int, r_total: int, msg: str):
        with JOBS_LOCK:
            job = ANALYSIS_JOBS.get(match_id)
            if job:
                job["telemetry"] = telemetry_contract
                job["rallies_completed"] = int(r_done)
                job["rallies_total"] = int(r_total)
                job["message"] = msg
                if r_total > 0 and r_done > 0:
                    job["percent"] = round(min(98.0, 22.0 + 76.0 * (r_done / float(r_total))), 1)
                job["updated_at"] = time.time()

    def should_stop() -> bool:
        with JOBS_LOCK:
            job = ANALYSIS_JOBS.get(match_id)
            return bool(job and job.get("stop_requested", False))

    def worker():
        try:
            pipeline = HawkviewPipeline(progress_callback=on_progress)
            final_contract = pipeline.run_progressive_analysis(
                video_path=video_path,
                match_target=match_id,
                keypoints=keypoints,
                near_player_info=near_player,
                far_player_info=far_player,
                mode=mode,
                max_rallies=max_rallies,
                on_rally_ready=on_rally_ready,
                should_stop=should_stop,
            )
            with JOBS_LOCK:
                job = ANALYSIS_JOBS.get(match_id)
                if job:
                    was_stopped = job.get("stop_requested", False)
                    job["status"] = "stopped" if was_stopped else "completed"
                    job["percent"] = 100.0
                    job["telemetry"] = final_contract
                    r_cnt = len(final_contract.get("rallies", []))
                    job["rallies_completed"] = r_cnt
                    job["message"] = (
                        f"Stopped early — keeping {r_cnt} completed rallies in 3D Explorer."
                        if was_stopped
                        else f"Analysis complete! {r_cnt} rallies reconstructed in 3D."
                    )
                    job["updated_at"] = time.time()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            with JOBS_LOCK:
                job = ANALYSIS_JOBS.get(match_id)
                if job:
                    job["status"] = "error"
                    job["error"] = str(exc)
                    job["message"] = f"Analysis error: {exc}"
                    job["updated_at"] = time.time()

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    return match_id


class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with HTTP 206 Range support and custom MP4 analysis APIs."""

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        f = self.send_head()
        if f:
            f.close()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-File-Name")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/analyze-status":
            qs = urllib.parse.parse_qs(parsed.query)
            match_id = (qs.get("match_id") or [""])[0]
            with JOBS_LOCK:
                job = ANALYSIS_JOBS.get(match_id)
                if not job:
                    self.send_json({"error": f"Unknown match_id: {match_id}"}, status=404)
                    return
                resp = dict(job)
            self.send_json(resp)
            return

        if parsed.path == "/api/available-videos":
            videos = []
            for folder in ["assets", "assets/uploads"]:
                if os.path.isdir(folder):
                    for fn in sorted(os.listdir(folder)):
                        if fn.lower().endswith((".mp4", ".mov", ".webm", ".m4v")):
                            rel = os.path.join(folder, fn).replace("\\", "/")
                            size_mb = round(os.path.getsize(rel) / (1024 * 1024), 1)
                            videos.append({"name": fn, "path": rel, "size_mb": size_mb})
            self.send_json({"videos": videos})
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path.endswith("/corrections.json"):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            target_path = self.translate_path(parsed.path)
            os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
            with open(target_path, "wb") as f:
                f.write(body)
            self.send_json({"status": "saved"})
            return

        if parsed.path == "/api/upload-video":
            ctype = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length", "0"))
            try:
                if "application/json" in ctype:
                    raw = self.rfile.read(length) if length > 0 else b"{}"
                    req = json.loads(raw.decode("utf-8"))
                    video_path = req.get("video_path", "assets/LZJvPopov.mp4")
                    if not os.path.exists(video_path):
                        self.send_json({"error": f"Video not found: {video_path}"}, status=404)
                        return
                    match_id = sanitize_match_id(video_path)
                    info = probe_video_and_keypoints(video_path, float(req.get("sample_time_sec", -1.0)))
                    info["match_id"] = match_id
                    self.send_json(info)
                    return
                else:
                    # Raw binary upload with X-File-Name header
                    raw_filename = urllib.parse.unquote(self.headers.get("X-File-Name", "uploaded_match.mp4"))
                    ext = os.path.splitext(raw_filename)[1].lower()
                    if ext not in (".mp4", ".mov", ".webm", ".m4v"):
                        ext = ".mp4"
                    match_id = sanitize_match_id(raw_filename)
                    upload_dir = "assets/uploads"
                    os.makedirs(upload_dir, exist_ok=True)
                    dest_path = f"{upload_dir}/{match_id}{ext}"

                    remaining = length
                    bufsize = 256 * 1024
                    with open(dest_path, "wb") as f_out:
                        while remaining > 0:
                            chunk = self.rfile.read(min(remaining, bufsize))
                            if not chunk:
                                break
                            f_out.write(chunk)
                            remaining -= len(chunk)

                    info = probe_video_and_keypoints(dest_path)
                    info["match_id"] = match_id
                    info["original_filename"] = raw_filename
                    self.send_json(info)
                    return
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
                return

        if parsed.path == "/api/auto-calibrate":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                req = json.loads(raw.decode("utf-8"))
                video_path = req.get("video_path", "assets/LZJvPopov.mp4")
                time_sec = float(req.get("time_sec", 15.0))
                info = probe_video_and_keypoints(video_path, sample_time_sec=time_sec)
                self.send_json(info)
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
            return

        if parsed.path == "/api/analyze-start":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                req = json.loads(raw.decode("utf-8"))
                match_id = start_analysis_worker(req)
                self.send_json({"status": "started", "match_id": match_id})
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
            return

        if parsed.path == "/api/analyze-stop":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                req = json.loads(raw.decode("utf-8"))
                match_id = req.get("match_id", "")
                with JOBS_LOCK:
                    job = ANALYSIS_JOBS.get(match_id)
                    if job:
                        job["stop_requested"] = True
                self.send_json({"status": "stopping", "match_id": match_id})
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
            return

        self.send_error(404, "Unsupported POST endpoint")

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path)
        path = self.translate_path(parsed.path)
        if os.path.isdir(path):
            return super().send_head()

        ctype = self.guess_type(path)
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        fs = os.fstat(f.fileno())
        total_length = fs.st_size
        range_header = self.headers.get('Range')

        if not range_header or not range_header.startswith('bytes='):
            self.send_response(200)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(total_length))
            self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
            if not ctype.startswith("video/"):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return f

        # Parse Range header
        range_match = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not range_match:
            self.send_error(416, "Requested Range Not Satisfiable")
            f.close()
            return None

        first, last = range_match.groups()
        first = int(first) if first else 0
        last = int(last) if last else total_length - 1

        if first >= total_length or last >= total_length or first > last:
            self.send_error(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{total_length}")
            self.end_headers()
            f.close()
            return None

        length = last - first + 1
        self.send_response(206)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Range", f"bytes {first}-{last}/{total_length}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        f.seek(first)
        self.range_length = length
        return f

    def copyfile(self, source, outputfile):
        if hasattr(self, 'range_length') and self.range_length is not None:
            remaining = self.range_length
            bufsize = 64 * 1024
            try:
                while remaining > 0:
                    chunk = source.read(min(remaining, bufsize))
                    if not chunk:
                        break
                    outputfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            try:
                super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                pass


def run(port=8123):
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, RangeHTTPRequestHandler)
    print(f"[Hawkview Server] Serving with HTTP 206 Byte-Range & Live MP4 Analysis API on http://localhost:{port} ...")
    httpd.serve_forever()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    run(port)
