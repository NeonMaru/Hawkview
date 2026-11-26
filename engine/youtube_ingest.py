"""
Hawkview YouTube URL Ingestion Module (engine/youtube_ingest.py)
================================================================
Validates YouTube URLs, reuses locally cached 1080p H.264 MP4s when present,
and downloads fresh BWF videos via `yt-dlp --js-runtimes node` with real-time
progress callbacks and explicit anti-bot / auth-gate error classification.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import urllib.parse
from typing import Callable, Dict, Optional, Tuple


YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "music.youtube.com",
}
DOWNLOAD_PCT_RE = re.compile(
    r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?(\S+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?"
)


class YouTubeIngestError(RuntimeError):
    """Structured error raised during YouTube URL validation or download."""

    def __init__(self, message: str, error_code: str = "youtube_download_failed"):
        super().__init__(message)
        self.error_code = error_code


def extract_youtube_video_id(raw_url: str) -> Optional[str]:
    """
    Strictly validates a YouTube URL and returns its canonical 11-char video ID.
    Rejects non-YouTube hosts, non-http(s) schemes, and shell metacharacters.
    """
    if not raw_url or not isinstance(raw_url, str):
        return None
    s = raw_url.strip()
    if not s or len(s) > 512:
        return None
    if any(ch in s for ch in ("\n", "\r", "\x00", ";", "|", "`", "$", " ")):
        return None

    parsed = urllib.parse.urlparse(s)
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_YOUTUBE_HOSTS:
        return None

    vid = None
    path_parts = [p for p in (parsed.path or "").split("/") if p]

    if host in ("youtu.be", "www.youtu.be"):
        if path_parts:
            vid = path_parts[0]
    else:
        if parsed.path == "/watch":
            qs = urllib.parse.parse_qs(parsed.query)
            vid = (qs.get("v") or [None])[0]
        elif len(path_parts) >= 2 and path_parts[0] in ("shorts", "live", "embed", "v"):
            vid = path_parts[1]

    if vid and YOUTUBE_ID_RE.match(vid):
        return vid
    return None


def _load_sibling_info_json(mp4_path: str) -> dict:
    stem, _ = os.path.splitext(mp4_path)
    for cand in (f"{stem}.info.json",):
        if os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def find_cached_youtube_video(video_id: str) -> Tuple[Optional[str], dict]:
    """
    Checks whether `video_id` is already downloaded in `assets/uploads/` or
    `assets/stress_test/`. Returns `(relative_mp4_path, info_json_dict)`.
    """
    if not video_id or not YOUTUBE_ID_RE.match(video_id):
        return None, {}

    candidates = [
        f"assets/uploads/yt_{video_id}.mp4",
        f"assets/stress_test/{video_id}.mp4",
    ]
    candidates.extend(sorted(glob.glob(f"assets/uploads/yt_{video_id}_*.mp4")))

    for path in candidates:
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            rel = path.replace("\\", "/")
            info = _load_sibling_info_json(rel)
            return rel, info
    return None, {}


def _find_ytdlp_bin() -> str:
    found = shutil.which("yt-dlp")
    if found:
        return found
    for fallback in (
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/yt-dlp",
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
    ):
        if os.path.exists(fallback):
            return fallback
    raise YouTubeIngestError(
        "yt-dlp is not installed on the local Hawkview server. Install with `pip install -U yt-dlp`.",
        error_code="ytdlp_missing",
    )


def _resolve_cookie_args(
    cookies_file: Optional[str] = None,
    cookies_browser: Optional[str] = None,
) -> list:
    """
    Returns documented yt-dlp cookie arguments ONLY if explicitly provided
    via argument, environment variable, or a local `cookies.txt` file.
    """
    cfile = cookies_file or os.environ.get("HAWKVIEW_YTDLP_COOKIES_FILE") or ""
    if not cfile and os.path.exists("cookies.txt") and os.path.getsize("cookies.txt") > 32:
        cfile = "cookies.txt"
    if cfile and os.path.exists(cfile):
        return ["--cookies", cfile]

    cbrowser = (cookies_browser or os.environ.get("HAWKVIEW_YTDLP_COOKIES_BROWSER") or "").strip().lower()
    if cbrowser in ("chrome", "chromium", "safari", "firefox", "brave", "edge", "opera", "vivaldi"):
        return ["--cookies-from-browser", cbrowser]

    return []


def download_youtube_video(
    raw_url: str,
    progress_cb: Optional[Callable[[str, float, str], None]] = None,
    cookies_file: Optional[str] = None,
    cookies_browser: Optional[str] = None,
    force_redownload: bool = False,
) -> Dict:
    """
    Validates `raw_url`, checks local cache, and downloads best <=1080p H.264 MP4
    via `yt-dlp --js-runtimes node` into `assets/uploads/yt_<video_id>.mp4`.
    """
    video_id = extract_youtube_video_id(raw_url)
    if not video_id:
        raise YouTubeIngestError(
            "Invalid YouTube URL. Paste a valid youtube.com/watch?v=..., youtu.be/..., or youtube.com/live/... link.",
            error_code="invalid_youtube_url",
        )

    canonical_url = f"https://www.youtube.com/watch?v={video_id}"

    if not force_redownload:
        cached_path, cached_info = find_cached_youtube_video(video_id)
        if cached_path:
            title = str(cached_info.get("title") or f"YouTube {video_id}")
            channel = str(cached_info.get("channel") or cached_info.get("uploader") or "")
            if progress_cb:
                progress_cb("Using Cached 1080p MP4", 82.0, f"Found local cache for {title}")
            return {
                "video_id": video_id,
                "canonical_url": canonical_url,
                "video_path": cached_path,
                "title": title,
                "channel": channel,
                "cached": True,
            }

    ytdlp_bin = _find_ytdlp_bin()
    os.makedirs("assets/uploads", exist_ok=True)
    out_mp4 = f"assets/uploads/yt_{video_id}.mp4"
    out_template = f"assets/uploads/yt_{video_id}.%(ext)s"

    def _run_ytdlp_attempt(extra_args: list, fmt_str: str, use_cookies: bool = True) -> Tuple[int, list]:
        cmd = [
            ytdlp_bin,
            "--no-playlist",
            "--no-update",
            "--newline",
            "--progress",
            "--write-info-json",
        ]
        if shutil.which("deno"):
            cmd.extend(["--js-runtimes", "deno", "--remote-components", "ejs:github"])
        elif shutil.which("node"):
            cmd.extend(["--js-runtimes", "node", "--remote-components", "ejs:github"])
        if use_cookies:
            cmd.extend(_resolve_cookie_args(cookies_file=cookies_file, cookies_browser=cookies_browser))
        cmd.extend(extra_args)
        cmd.extend([
            "-f",
            fmt_str,
            "--merge-output-format",
            "mp4",
            "-o",
            out_template,
            canonical_url,
        ])

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        lines = []
        phase_idx = 0
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            lines.append(line)
            if len(lines) > 50:
                lines.pop(0)
            if line.startswith(("WARNING:", "ERROR:")):
                print(f"[yt-dlp] {line}", flush=True)

            if "[download] Destination:" in line:
                phase_idx += 1
                if progress_cb:
                    stream_label = "audio track" if phase_idx >= 2 else "1080p video"
                    progress_cb("Downloading from YouTube", 12.0 if phase_idx == 1 else 72.0, f"Streaming {stream_label}...")
                continue

            m = DOWNLOAD_PCT_RE.search(line)
            if m and progress_cb:
                pct_val = float(m.group(1))
                size_str = m.group(2) or ""
                speed_str = m.group(3) or ""
                eta_str = m.group(4) or ""
                overall_pct = (10.0 + 0.60 * pct_val) if phase_idx <= 1 else (70.0 + 0.10 * pct_val)
                parts = [f"{pct_val:.1f}% of {size_str}"]
                if speed_str:
                    parts.append(speed_str)
                if eta_str:
                    parts.append(f"ETA {eta_str}")
                progress_cb("Downloading 1080p MP4", min(80.0, overall_pct), " · ".join(parts))
                continue

            if "[Merger]" in line and progress_cb:
                progress_cb("Merging H.264 + Audio", 82.0, "Muxing MP4 container with ffmpeg...")

        return proc.wait(), lines

    if progress_cb:
        progress_cb("Connecting to YouTube", 6.0, f"Fetching 1080p stream for {video_id}...")

    primary_fmt = (
        "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/"
        "bestvideo[height<=1080]+bestaudio/"
        "bestvideo[height<=1080]/best[height<=1080]/best"
    )
    has_cookies = bool(_resolve_cookie_args(cookies_file=cookies_file, cookies_browser=cookies_browser))
    rc, recent_lines = _run_ytdlp_attempt([], primary_fmt, use_cookies=has_cookies)

    # Fallback 1: If cookies were rotated/expired or web client failed, retry COOKIE-FREE via android_vr/ios/tv_embedded
    if rc != 0 or not os.path.exists(out_mp4) or os.path.getsize(out_mp4) < 50_000:
        if progress_cb:
            progress_cb("Retrying YouTube Stream", 9.0, "Switching to cookie-free mobile/TV YouTube client...")
        rc, recent_lines = _run_ytdlp_attempt(
            ["--extractor-args", "youtube:player_client=android_vr,ios,tv_embedded"],
            "bestvideo[vcodec^=avc1][height<=1080]/bestvideo[height<=1080]/best[height<=1080]/best",
            use_cookies=False,
        )

    # Fallback 2: Broad client fallback (tv, mweb, web) without cookies
    if rc != 0 or not os.path.exists(out_mp4) or os.path.getsize(out_mp4) < 50_000:
        if progress_cb:
            progress_cb("Retrying YouTube Stream (Alt)", 11.0, "Trying secondary YouTube player client...")
        rc, recent_lines = _run_ytdlp_attempt(
            ["--extractor-args", "youtube:player_client=tv,mweb,web"],
            "bestvideo[height<=1080]/best[height<=1080]/best",
            use_cookies=False,
        )

    joined_tail = "\n".join(recent_lines[-15:])

    if rc != 0 or not os.path.exists(out_mp4) or os.path.getsize(out_mp4) < 50_000:
        lower_tail = joined_tail.lower()
        if "sign in to confirm" in lower_tail or "not a bot" in lower_tail or "cookies-from-browser" in lower_tail:
            raise YouTubeIngestError(
                "YouTube session cookies expired on the cloud runner (YouTube rotated the browser session). "
                "Refresh YOUTUBE_COOKIES_B64 from a fresh closed Chrome Incognito window.",
                error_code="youtube_auth_required",
            )
        if "private video" in lower_tail or "video unavailable" in lower_tail:
            raise YouTubeIngestError(
                f"YouTube video {video_id} is private or unavailable.",
                error_code="youtube_unavailable",
            )
        err_summary = recent_lines[-1] if recent_lines else f"yt-dlp exited with code {rc}"
        raise YouTubeIngestError(f"YouTube download failed: {err_summary}", error_code="youtube_download_failed")

    info = _load_sibling_info_json(out_mp4)
    title = str(info.get("title") or f"YouTube {video_id}")
    channel = str(info.get("channel") or info.get("uploader") or "")
    return {
        "video_id": video_id,
        "canonical_url": canonical_url,
        "video_path": out_mp4,
        "title": title,
        "channel": channel,
        "cached": False,
    }
