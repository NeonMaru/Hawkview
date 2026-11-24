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
import collections
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import cv2

from engine.colab_worker import compute_job_eta, get_colab_quota, stop_blackwell_session
from engine.court_calib import CourtCalibrator
from engine.pipeline import HawkviewPipeline
from engine.youtube_ingest import (
    YouTubeIngestError,
    download_youtube_video,
    extract_youtube_video_id,
)

# Global dictionary of active/completed analysis jobs keyed by match_id
ANALYSIS_JOBS = {}
YOUTUBE_JOBS = {}
JOBS_LOCK = threading.Lock()
SERVER_START_TIME = time.time()
SERVER_EVENT_LOG = collections.deque(maxlen=150)
UPLOAD_SESSIONS = {}


def log_server_event(
    event_type: str,
    path: str,
    status: int = 200,
    detail: str = "",
    error_trace: str = "",
    duration_ms: float = 0.0,
):
    with JOBS_LOCK:
        SERVER_EVENT_LOG.appendleft({
            "timestamp": time.strftime("%H:%M:%S"),
            "epoch": round(time.time(), 2),
            "type": event_type,
            "path": path,
            "status": int(status),
            "duration_ms": round(float(duration_ms), 1),
            "detail": str(detail or ""),
            "error_trace": str(error_trace or ""),
        })


def sanitize_match_id(raw_name: str, file_size: int = 0, explicit_match_id: str = "") -> str:
    if explicit_match_id:
        exp_clean = re.sub(r"[^a-zA-Z0-9_\-]+", "_", explicit_match_id).strip("_").lower()
        if exp_clean:
            return exp_clean
    base = os.path.splitext(os.path.basename(raw_name or "custom_match"))[0]
    clean = re.sub(r"[^a-zA-Z0-9_\-]+", "_", base).strip("_").lower()
    if not clean:
        clean = "custom_match"
    if ("anton" in clean and ("lzj" in clean or "ljz" in clean or "zii" in clean)) or clean.startswith("ljzvanton"):
        cand = "anders_antonsen_vs_lee_zii_jia___non-stop_action_from_beginning_to_end_-_1080p_66946"
        if os.path.exists(os.path.join("data", "matches", cand, "telemetry.json")):
            return cand
    if "popov" in clean and ("lzj" in clean or "ljz" in clean or "zii" in clean):
        if os.path.exists(os.path.join("data", "matches", "lzj_popov", "telemetry.json")):
            return "lzj_popov"
    if file_size and int(file_size) > 0:
        return f"{clean}_{abs(int(file_size)) % 100000}"
    matches_root = "data/matches"
    if os.path.isdir(matches_root):
        if os.path.exists(os.path.join(matches_root, clean, "telemetry.json")):
            return clean
        clean_norm = re.sub(r"_+", "_", clean)
        for d in sorted(os.listdir(matches_root), reverse=True):
            d_norm = re.sub(r"_+", "_", d.lower())
            if (d.startswith(clean) or d_norm.startswith(clean_norm)) and os.path.exists(os.path.join(matches_root, d, "telemetry.json")):
                return d
    # Deterministic slug when no file_size is given so multi-chunk uploads never split across timestamps
    return clean


_VISION_OCR_READY = False
_OBJC = None
_SEL = None
_CLS = None
_MSG = None
_MSG_OBJ = None
_MSG_BYTES = None
_MSG_INIT_DATA = None
_MSG_PERF = None
_MSG_COUNT = None
_MSG_IDX = None
_MSG_UTF8 = None

BWF_PLAYER_NORMALIZATION = {
    "PUSARLA": "P.V. SINDHU",
    "P.V. SINDHU": "P.V. SINDHU",
    "SINDHU": "P.V. SINDHU",
    "AN S.Y.": "AN S.Y.",
    "AN S.Y": "AN S.Y.",
    "AN S Y": "AN S.Y.",
    "LEE Z.J.": "LZJ",
    "LEE Z.J": "LZJ",
    "LEE ZJ.": "LZJ",
    "LEE ZJ": "LZJ",
    "IWANA / NAKAN": "IWANAGA / NAKANISHI",
    "IWANA/NAKAN": "IWANAGA / NAKANISHI",
    "TAN / THINAAH": "TAN / THINAAH",
    "TAN/THINAAH": "TAN / THINAAH",
    "TAN / THINA": "TAN / THINAAH",
    "TAN/THINA": "TAN / THINAAH",
    "NAKADE / TAKAH": "NAKADE / TAKAHASHI",
    "NAKADE/TAKAH": "NAKADE / TAKAHASHI",
    "CARNA / MARTH": "CARNANDO / MARTHIN",
    "CARNA/MARTH": "CARNANDO / MARTHIN",
    "LOH K.Y.": "LOH K.Y.",
    "LOH K.Y": "LOH K.Y.",
    "LOH KY": "LOH K.Y.",
    "TAI / YAP": "TAI / YAP",
    "TAI/YAP": "TAI / YAP",
}

SCOREBUG_STOPWORDS = {
    "BWF", "HSBC", "HSB", "YONEX", "ETIHAD", "AIRWAYS", "AIRMATS", "BADMINTON4U",
    "WORLD", "TOUR", "FINALS", "SUPER", "1000", "750", "500", "300",
    "PARIS", "FRANCE", "LIVE", "COURT", "GAME", "MATCH", "POINT", "INTERVAL",
    "SERVICE", "SPEED", "KM/H", "KMH", "HIGHLIGHTS", "DAILY", "GET", "APP", "TODAY",
    "LINING", "LI-NING", "RODU", "HONG", "KONG", "CHINA",
    "IND", "JPN", "MAS", "DEN", "KOR", "SGP", "INA", "TPE",
}

FILENAME_TITLE_STOPWORDS = {
    "CONTROL", "AND", "CONFIDENT", "ATTACKING", "PLAY", "HARD", "FOUGHT", "RALLIES",
    "WITH", "RELENTLESS", "RETRIEVAL", "NON", "STOP", "ACTION", "FROM", "BEGINNING",
    "TO", "END", "HIGHLIGHTS", "FINAL", "FINALS", "SEMI", "QUARTER", "ROUND",
    "720P", "1080P", "480P", "4K", "MP4", "MOV", "WEBM", "AN",
}


def infer_player_flag(pid_str: str, name_str: str = "", default_flag: str = "🏸") -> str:
    """Whole-token flag lookup so 'NAKANISHI' is 🇯🇵 and never collides with 'SHI' (🇨🇳)."""
    u = f"{pid_str} {name_str}".upper()
    tokens = set(re.findall(r"[A-Z]+", u))
    if tokens & {
        "IWANAGA", "IWANA", "NAKANISHI", "NAKAN", "MATSUYAMA", "SHIDA",
        "YAMAGUCHI", "NARAOKA", "MOMOTA", "WATANABE", "HIGASHINO",
        "FUKUSHIMA", "HIROTA", "HOKI", "KOBAYASHI", "NISHIMOTO",
        "NAKADE", "TAKAHASHI", "TAKAH",
    }:
        return "🇯🇵"
    if tokens & {"TAN", "THINAAH", "MURALITHARAN", "LZJ", "CHIA", "SOH", "GOH", "IZZUDDIN", "YAP"} or "ZII JIA" in u:
        return "🇲🇾"
    if tokens & {"SINDHU", "PUSARLA", "PURSARLA", "SEN", "PRANNOY", "SATWIK", "RANKIREDDY", "SHETTY", "SRIKANTH"}:
        return "🇮🇳"
    if tokens & {"AN", "SY", "SEO", "BAEK", "KIM", "KANG", "CHAE", "JEONG"} or "AN S" in u or "SE YOUNG" in u:
        return "🇰🇷"
    if tokens & {"ANTONSEN", "AXELSEN", "ASTRUP", "RASMUSSEN", "GEMKE"}:
        return "🇩🇰"
    if tokens & {"POPOV", "LANIER", "GICQUEL", "DELRUE"}:
        return "🇫🇷"
    if tokens & {"KUNLAVUT", "VITIDSARN", "INTANON", "CHOCHUWONG", "DECHAPOL", "SAPSIREE", "TEERARATSAKUL", "TAERATTANACHAI", "PUAVARANUKROH"}:
        return "🇹🇭"
    if tokens & {"SHI", "LIANG", "WANG", "ZHENG", "HUANG", "LIU", "OU", "CHEN", "HE", "ZHOU", "HAN", "GAO", "WU", "FENG", "JIANG", "WEI"}:
        return "🇨🇳"
    if tokens & {"CHOU", "TAI", "LEE"}:
        return "🇹🇼"
    if tokens & {"GINTING", "CHRISTIE", "FAJAR", "ALFIAN", "ARDIANTO", "TUNJUNG", "CARNANDO", "CARNA", "MARTHIN", "MARTH"}:
        return "🇮🇩"
    if tokens & {"LOH", "YEO"}:
        return "🇸🇬"
    return default_flag


def parse_players_from_filename(raw_path_or_name: str) -> tuple:
    """
    Parses BWF Singles or Doubles (2v2) player/pair names from a filename when Vision OCR is unavailable.
    Examples:
      - 'Iwanaga_Nakanishi vs Tan_Muralitharan _ Control...' -> ('IWANAGA / NAKANISHI', 'TAN / MURALITHARAN')
      - 'An Se Young vs Pusarla V. Sindhu _ Hard-fought...' -> ('AN S.Y.', 'P.V. SINDHU')
    """
    raw_s = str(raw_path_or_name or "").strip()
    if not raw_s:
        return ("", "")
    # YouTube titles frequently contain '/' for Doubles pairs (e.g. 'Feng/Huang vs Jiang/Wei');
    # never call os.path.basename() on a title string or it truncates everything before the last '/'!
    if re.search(r"\s+vs\.?\s+", raw_s, flags=re.IGNORECASE) and not re.search(r"\.(mp4|mov|webm|m4v)$", raw_s, flags=re.IGNORECASE):
        base = raw_s
    else:
        base = os.path.splitext(os.path.basename(raw_s))[0]
    if not base:
        return ("", "")

    low = base.lower()
    if "antonsen" in low and ("zii_jia" in low or "lzj" in low or "zii jia" in low):
        return ("LZJ", "ANTONSEN")
    if "lzj" in low and "popov" in low:
        return ("POPOV", "LZJ")
    if ("an_se_young" in low or "an se young" in low) and ("sindhu" in low or "pusarla" in low):
        return ("AN S.Y.", "P.V. SINDHU")
    if "iwanaga" in low and ("tan" in low or "muralitharan" in low or "thinaah" in low):
        return ("IWANAGA / NAKANISHI", "TAN / MURALITHARAN")

    # Strip trailing video title after ' _ ', ' | ', ' - ', or '___'
    head = re.split(r"\s+[_|\-]\s+|___|\s+-\s+\(", base)[0].strip()
    m_vs = re.split(r"\s+vs\.?\s+|_vs_", head, maxsplit=1, flags=re.IGNORECASE)
    if len(m_vs) < 2:
        return ("", "")

    raw_s1, raw_s2 = m_vs[0].strip(), m_vs[1].strip()
    has_spaces = (" " in base)

    def _format_side(raw_s: str, is_side2: bool = False) -> str:
        # If raw filename had spaces around 'vs' and underscores/slashes joining Doubles partners:
        if has_spaces and ("_" in raw_s or "/" in raw_s or "&" in raw_s):
            parts = [p.strip().upper() for p in re.split(r"[_/&]+", raw_s) if p.strip() and not p.strip().isdigit()]
            if len(parts) >= 2:
                return f"{parts[0]} / {parts[1]}"
        tokens = [
            t.upper()
            for t in re.split(r"[^A-Za-z\.]+", raw_s)
            if t and not t.isdigit() and (not is_side2 or t.upper() not in FILENAME_TITLE_STOPWORDS)
        ]
        if not tokens:
            return ""
        joined = " ".join(tokens)
        if "PUSARLA" in tokens or "SINDHU" in tokens:
            return "P.V. SINDHU"
        if tokens[:3] == ["AN", "SE", "YOUNG"] or joined.startswith("AN SE YOUNG"):
            return "AN S.Y."
        if tokens[:3] == ["LEE", "ZII", "JIA"]:
            return "LZJ"
        # If 2 distinct multi-letter surnames without single-letter initials, check if it's a Doubles pair
        if len(tokens) == 2 and all(len(t.replace(".", "")) >= 3 for t in tokens) and ("_" in raw_s or not has_spaces):
            if tokens[0] not in ("ANDERS", "VIKTOR", "KUNLAVUT", "JONATAN", "ANTHONY", "CHRISTO", "TOMA"):
                return f"{tokens[0]} / {tokens[1]}"
        return joined[:22]

    p1 = _format_side(raw_s1, is_side2=False)
    p2 = _format_side(raw_s2, is_side2=True)
    return (p1, p2)


def _init_macos_vision_ocr() -> bool:
    global _VISION_OCR_READY, _OBJC, _SEL, _CLS, _MSG, _MSG_OBJ, _MSG_BYTES, _MSG_INIT_DATA, _MSG_PERF, _MSG_COUNT, _MSG_IDX, _MSG_UTF8
    if _VISION_OCR_READY:
        return True
    if sys.platform != "darwin":
        return False
    try:
        import ctypes
        import ctypes.util
        _OBJC = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
        ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Foundation.framework/Foundation")
        ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Vision.framework/Vision")
        _OBJC.objc_getClass.restype = ctypes.c_void_p
        _OBJC.objc_getClass.argtypes = [ctypes.c_char_p]
        _OBJC.sel_registerName.restype = ctypes.c_void_p
        _OBJC.sel_registerName.argtypes = [ctypes.c_char_p]
        _SEL = lambda n: _OBJC.sel_registerName(n.encode("utf-8"))
        _CLS = lambda n: _OBJC.objc_getClass(n.encode("utf-8"))
        _MSG = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _MSG_OBJ = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _MSG_BYTES = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_ulong)(("objc_msgSend", _OBJC))
        _MSG_INIT_DATA = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _MSG_PERF = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _MSG_COUNT = ctypes.CFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _MSG_IDX = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong)(("objc_msgSend", _OBJC))
        _MSG_UTF8 = ctypes.CFUNCTYPE(ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", _OBJC))
        _VISION_OCR_READY = True
        return True
    except Exception:
        return False


def extract_scorebug_players_from_frame(frame_bgr) -> list:
    """Extracts the 2 player/pair names from the top-left BWF broadcast scorebug using macOS Vision OCR."""
    if frame_bgr is None or not _init_macos_vision_ocr():
        return []
    try:
        h, w = frame_bgr.shape[:2]
        crop = frame_bgr[int(0.015 * h) : int(0.175 * h), int(0.015 * w) : int(0.36 * w)]
        up = cv2.resize(crop, (0, 0), fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        ok, buf = cv2.imencode(".png", up)
        if not ok:
            return []
        png_bytes = buf.tobytes()
        pool = _MSG(_MSG(_CLS("NSAutoreleasePool"), _SEL("alloc")), _SEL("init"))
        try:
            nsdata = _MSG_BYTES(_CLS("NSData"), _SEL("dataWithBytes:length:"), png_bytes, len(png_bytes))
            handler = _MSG_INIT_DATA(
                _MSG(_CLS("VNImageRequestHandler"), _SEL("alloc")),
                _SEL("initWithData:options:"),
                nsdata,
                _MSG(_CLS("NSDictionary"), _SEL("dictionary")),
            )
            req = _MSG(_MSG(_CLS("VNRecognizeTextRequest"), _SEL("alloc")), _SEL("init"))
            _MSG_PERF(handler, _SEL("performRequests:error:"), _MSG_OBJ(_CLS("NSArray"), _SEL("arrayWithObject:"), req), None)
            results = _MSG(req, _SEL("results"))
            cnt = _MSG_COUNT(results, _SEL("count")) if results else 0
            players = []
            for i in range(cnt):
                obs = _MSG_IDX(results, _SEL("objectAtIndex:"), i)
                top_arr = _MSG_IDX(obs, _SEL("topCandidates:"), 1)
                if top_arr and _MSG_COUNT(top_arr, _SEL("count")) > 0:
                    cand = _MSG_IDX(top_arr, _SEL("objectAtIndex:"), 0)
                    c_str = _MSG_UTF8(_MSG(cand, _SEL("string")), _SEL("UTF8String"))
                    if c_str:
                        raw = c_str.decode("utf-8", errors="ignore").strip()
                        clean = re.sub(r"^[^A-Za-z]+|[^A-Za-z\.]+$", "", raw).strip().upper()
                        if len(clean) < 3 or sum(c.isalpha() for c in clean) < 3:
                            continue
                        clean_tokens = set(re.findall(r"[A-Z0-9]+", clean))
                        clean_compact = re.sub(r"[\s\-]+", "", clean)
                        is_stopword = False
                        for sw in SCOREBUG_STOPWORDS:
                            if len(sw) <= 3:
                                if clean == sw or sw in clean_tokens:
                                    is_stopword = True
                                    break
                            else:
                                sw_compact = re.sub(r"[\s\-]+", "", sw)
                                if (
                                    sw in clean_tokens
                                    or sw in clean
                                    or (len(sw_compact) >= 5 and sw_compact in clean_compact)
                                ):
                                    is_stopword = True
                                    break
                        if is_stopword:
                            continue
                        norm = BWF_PLAYER_NORMALIZATION.get(clean, clean)
                        if norm not in players:
                            players.append(norm)
                        if len(players) >= 2 and any("/" in p for p in players):
                            break
                        if len(players) >= 4:
                            break
            if len(players) >= 4 and not any("/" in p for p in players[:4]):
                return [f"{players[0]} / {players[1]}", f"{players[2]} / {players[3]}"]
            return players[:2]
        finally:
            _MSG(pool, _SEL("drain"))
    except Exception:
        return []


def infer_match_context(video_path: str, match_id: str, sample_frame=None, original_filename: str = "") -> dict:
    """
    Infers near/far player names, saved calibration keypoints, and existing telemetry status
    from disk (`data/matches/<match_id>/`), via macOS Vision OCR on the top-left BWF broadcast
    scorebug FIRST, and finally from the video filename (`playerA_vs_playerB`).
    """
    near_player = ""
    far_player = ""
    saved_keypoints = None
    existing_telemetry_ready = False
    existing_rallies_count = 0

    match_dir = os.path.join("data", "matches", match_id)
    tel_path = os.path.join(match_dir, "telemetry.json")
    match_json_path = os.path.join(match_dir, "match.json")
    cal_path = os.path.join(match_dir, "calibration.json")

    if os.path.exists(cal_path):
        try:
            with open(cal_path, "r", encoding="utf-8") as fc:
                cdata = json.load(fc)
                if isinstance(cdata.get("keypoints"), dict):
                    saved_keypoints = cdata["keypoints"]
                elif isinstance(cdata.get("pixel_points"), dict):
                    saved_keypoints = cdata["pixel_points"]
        except Exception:
            pass

    if os.path.exists(tel_path):
        try:
            with open(tel_path, "r", encoding="utf-8") as ft:
                tdata = json.load(ft)
            rallies = tdata.get("rallies") or []
            existing_rallies_count = len(rallies)
            existing_telemetry_ready = existing_rallies_count > 0
            if rallies:
                r0 = rallies[0]
                if r0.get("near_player"):
                    near_player = str(r0["near_player"])
                if r0.get("far_player"):
                    far_player = str(r0["far_player"])
            elif isinstance(tdata.get("players"), dict):
                pkeys = list(tdata["players"].keys())
                if len(pkeys) >= 2:
                    near_player, far_player = pkeys[0], pkeys[1]
        except Exception:
            pass

    if (not near_player or not far_player) and os.path.exists(match_json_path):
        try:
            with open(match_json_path, "r", encoding="utf-8") as fm:
                mdata = json.load(fm)
            p_dict = mdata.get("players") or {}
            pkeys = [k for k in p_dict.keys() if k not in ("POPOV", "LZJ") or "lzj" in (video_path or "").lower()]
            if len(pkeys) >= 2:
                near_player, far_player = pkeys[0], pkeys[1]
        except Exception:
            pass

    if not near_player or not far_player or (near_player == "POPOV" and "popov" not in (video_path or "").lower()):
        fn_check = f"{os.path.basename(video_path or '')} {original_filename or ''}".lower()
        if "antonsen" in fn_check and ("zii_jia" in fn_check or "lzj" in fn_check):
            near_player = "LZJ"
            far_player = "ANTONSEN"
        elif "lzj" in fn_check and "popov" in fn_check:
            near_player = "POPOV"
            far_player = "LZJ"
        else:
            # 1. Run Vision Scorebug OCR FIRST on sample_frame
            if sample_frame is not None:
                ocr_players = extract_scorebug_players_from_frame(sample_frame)
                if len(ocr_players) >= 2:
                    near_player, far_player = ocr_players[0], ocr_players[1]
            # 2. Fallback to filename parser when OCR is unavailable
            if not near_player or not far_player:
                p1, p2 = parse_players_from_filename(original_filename or video_path)
                if p1 and p2:
                    near_player, far_player = p1, p2

    combined_names = f"{near_player} {far_player} {os.path.basename(video_path or '')} {original_filename or ''}".lower()
    is_doubles = any(tok in combined_names for tok in ("/", "&", "doubles", "2v2", "iwanaga", "nakanishi", "muralitharan", "thinaah"))
    return {
        "suggested_near_player": near_player,
        "suggested_far_player": far_player,
        "suggested_match_type": "doubles" if is_doubles else "singles",
        "saved_keypoints": saved_keypoints,
        "existing_telemetry_ready": existing_telemetry_ready,
        "existing_rallies_count": existing_rallies_count,
    }


def probe_video_and_keypoints(
    video_path: str,
    sample_time_sec: float = -1.0,
    match_id: str = "",
    use_saved_calibration: bool = True,
    original_filename: str = "",
) -> dict:
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
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
        ret, frame_bgr = cap.read()
        auto_info = CourtCalibrator.auto_detect_court_keypoints(
            frame_bgr if ret else None, width=width, height=height
        )
    else:
        # Multi-frame replay-proof prober: scan candidate fractions of video duration until
        # finding a clean main-camera rally frame with verified court line coverage and scorebug OCR.
        cand_frames = []
        for frac in (0.20, 0.08, 0.14, 0.30, 0.42, 0.55):
            if duration_sec > 0.0 and fps > 0.0:
                t_cand = frac * duration_sec
                if t_cand < 0.0 or t_cand > duration_sec:
                    continue
                cf = min(max(0, int(round(t_cand * fps))), max(0, total_frames - 1))
            else:
                cf = min(max(0, int(round(frac * max(1, total_frames)))), max(0, total_frames - 1))
            if cf not in cand_frames:
                cand_frames.append(cf)
        if not cand_frames:
            cand_frames = [0]

        best_rank = (-1, -1.0, -999.0)
        target_frame = cand_frames[0]
        ret, frame_bgr = False, None
        auto_info = CourtCalibrator.auto_detect_court_keypoints(None, width=width, height=height)

        for idx_c, cand_f in enumerate(cand_frames):
            cap.set(cv2.CAP_PROP_POS_FRAMES, cand_f)
            r_c, f_c = cap.read()
            if not r_c or f_c is None:
                continue
            c_info = CourtCalibrator.auto_detect_court_keypoints(f_c, width=width, height=height)
            is_ref = bool(c_info.get("auto_refined"))
            seg_cov = float(c_info.get("segment_coverage_pct", 0.0))
            rmse_px = float(c_info.get("line_sample_rmse_px", 99.0))
            ocr_players = extract_scorebug_players_from_frame(f_c) if is_ref else []
            has_ocr = len(ocr_players) >= 2

            if is_ref and seg_cov >= 65.0 and has_ocr:
                tier = 3
            elif is_ref and seg_cov >= 65.0:
                tier = 2
            elif is_ref:
                tier = 1
            else:
                tier = 0

            rank = (tier, seg_cov, -rmse_px)
            if idx_c == 0 or rank > best_rank:
                best_rank = rank
                target_frame = cand_f
                ret, frame_bgr = r_c, f_c
                auto_info = c_info

            # Fast early exit when we hit a high-coverage main-camera frame with valid 2-player OCR
            if is_ref and seg_cov >= 75.0 and has_ocr:
                break

    cap.release()

    frame_b64 = None
    if ret and frame_bgr is not None:
        ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if ok:
            frame_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

    resolved_id = match_id or sanitize_match_id(video_path)
    ctx = infer_match_context(
        video_path,
        resolved_id,
        sample_frame=frame_bgr if ret else None,
        original_filename=original_filename,
    )
    if use_saved_calibration and ctx["saved_keypoints"] and isinstance(auto_info, dict) and not auto_info.get("auto_refined"):
        auto_info["keypoints"] = ctx["saved_keypoints"]
        auto_info["auto_refined"] = True

    return {
        "video_path": video_path,
        "match_id": resolved_id,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "duration_sec": duration_sec,
        "sample_time_sec": round(target_frame / fps, 2) if fps > 0 else 0.0,
        "frame_jpeg_b64": frame_b64,
        "calibration_preview": auto_info,
        "suggested_near_player": ctx["suggested_near_player"],
        "suggested_far_player": ctx["suggested_far_player"],
        "suggested_match_type": ctx["suggested_match_type"],
        "existing_telemetry_ready": ctx["existing_telemetry_ready"],
        "existing_rallies_count": ctx["existing_rallies_count"],
        "colab_quota": get_colab_quota(),
    }


def start_analysis_worker(params: dict) -> str:
    match_id = params.get("match_id") or sanitize_match_id(params.get("video_path", "custom"))
    video_path = params.get("video_path", "assets/LZJvPopov.mp4")
    # If frontend accidentally passed a browser blob: URL, check if the uploaded file already exists in assets/uploads/
    if str(video_path).startswith("blob:"):
        for ext_cand in (".mp4", ".mov", ".webm", ".m4v"):
            cand_disk = os.path.join("assets", "uploads", f"{match_id}{ext_cand}")
            if os.path.exists(cand_disk) and os.path.getsize(cand_disk) > 100_000:
                video_path = cand_disk
                break
    keypoints = params.get("keypoints")
    near_player = params.get("near_player") or {"id": "P1", "name": "Player 1", "country": "NEAR", "dominant_hand": "Right"}
    far_player = params.get("far_player") or {"id": "P2", "name": "Player 2", "country": "FAR", "dominant_hand": "Right"}
    mode = params.get("mode", "auto")
    match_type = params.get("match_type", "auto")
    compute_backend = params.get("compute_backend", "blackwell_g4")
    max_rallies = params.get("max_rallies")
    if max_rallies is not None:
        try:
            max_rallies = int(max_rallies)
            if max_rallies <= 0:
                max_rallies = None
        except Exception:
            max_rallies = None

    vid_dur = 480.0
    try:
        cap_d = cv2.VideoCapture(video_path)
        if cap_d.isOpened():
            fps_d = float(cap_d.get(cv2.CAP_PROP_FPS) or 25.0)
            fc_d = float(cap_d.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if fps_d > 0 and fc_d > 0:
                vid_dur = round(fc_d / fps_d, 1)
        cap_d.release()
    except Exception:
        pass

    now_ts = time.time()
    my_job = {
        "match_id": match_id,
        "video_path": video_path,
        "duration_sec": vid_dur,
        "compute_backend": compute_backend,
        "status": "running",
        "stage": "STAGE 0: Initializing Pipeline",
        "percent": 2.0,
        "message": "Starting court calibration & video stream...",
        "rallies_completed": 0,
        "rallies_total": 0,
        "stop_requested": False,
        "telemetry": None,
        "error": None,
        "started_at": now_ts,
        "updated_at": now_ts,
    }
    with JOBS_LOCK:
        old_job = ANALYSIS_JOBS.get(match_id)
        if old_job and old_job.get("status") == "running":
            old_job["stop_requested"] = True
        ANALYSIS_JOBS[match_id] = my_job

    def on_progress(stage: str, pct: float, teaser: str):
        with JOBS_LOCK:
            if ANALYSIS_JOBS.get(match_id) is my_job:
                my_job["stage"] = stage
                my_job["percent"] = round(float(pct), 1)
                my_job["message"] = teaser
                my_job["updated_at"] = time.time()

    def on_rally_ready(telemetry_contract: dict, r_done: int, r_total: int, msg: str):
        with JOBS_LOCK:
            if ANALYSIS_JOBS.get(match_id) is my_job:
                my_job["telemetry"] = telemetry_contract
                my_job["rallies_completed"] = int(r_done)
                my_job["rallies_total"] = int(r_total)
                my_job["message"] = msg
                if r_total > 0 and r_done > 0:
                    my_job["percent"] = round(min(98.0, 22.0 + 76.0 * (r_done / float(r_total))), 1)
                my_job["updated_at"] = time.time()

    def should_stop() -> bool:
        with JOBS_LOCK:
            return bool(my_job.get("stop_requested", False) or ANALYSIS_JOBS.get(match_id) is not my_job)

    def worker():
        try:
            cached_tel_path = os.path.join("data", "matches", match_id, "telemetry.json")
            cached_csv_path = os.path.join("data", "matches", match_id, "shuttle_2d.csv")
            if os.path.exists(cached_tel_path) and not os.path.exists(cached_csv_path):
                with open(cached_tel_path, "r", encoding="utf-8") as f_ct:
                    final_contract = json.load(f_ct)
            else:
                pipeline = HawkviewPipeline(progress_callback=on_progress)
                final_contract = pipeline.run_progressive_analysis(
                    video_path=video_path,
                    match_target=match_id,
                    keypoints=keypoints,
                    near_player_info=near_player,
                    far_player_info=far_player,
                    mode=mode,
                    match_type=match_type,
                    max_rallies=max_rallies,
                    compute_backend=compute_backend,
                    on_rally_ready=on_rally_ready,
                    should_stop=should_stop,
                )
            with JOBS_LOCK:
                if ANALYSIS_JOBS.get(match_id) is my_job:
                    was_stopped = my_job.get("stop_requested", False)
                    my_job["status"] = "stopped" if was_stopped else "completed"
                    my_job["percent"] = 100.0
                    my_job["telemetry"] = final_contract
                    r_cnt = len(final_contract.get("rallies", []))
                    my_job["rallies_completed"] = r_cnt
                    my_job["rallies_total"] = r_cnt
                    my_job["message"] = (
                        f"Stopped early — keeping {r_cnt} completed rallies in 3D Explorer."
                        if was_stopped
                        else f"Analysis complete! {r_cnt} rallies reconstructed in 3D."
                    )
                    my_job["updated_at"] = time.time()
        except Exception as exc:
            tb_str = traceback.format_exc()
            traceback.print_exc()
            with JOBS_LOCK:
                if ANALYSIS_JOBS.get(match_id) is my_job:
                    my_job["status"] = "error"
                    my_job["error"] = str(exc)
                    my_job["traceback"] = tb_str
                    my_job["message"] = f"Analysis error: {exc}"
                    my_job["updated_at"] = time.time()
            log_server_event(
                "ANALYSIS_ERROR",
                f"/api/analyze-start ({match_id})",
                status=500,
                detail=f"video_path={video_path} -> {exc}",
                error_trace=tb_str,
            )

    log_server_event("ANALYSIS_START", f"/api/analyze-start ({match_id})", status=200, detail=f"video_path={video_path}, backend={compute_backend}")
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
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-File-Name, X-Chunk-Index, X-Total-Chunks, X-File-Size, X-Match-Id, X-Chunk-Offset, X-Chunk-Size",
        )
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/upload-status":
            qs = urllib.parse.parse_qs(parsed.query)
            raw_mid = (qs.get("match_id") or [""])[0]
            raw_fn = urllib.parse.unquote((qs.get("filename") or [""])[0])
            try:
                file_size = int((qs.get("file_size") or ["0"])[0] or 0)
            except Exception:
                file_size = 0
            try:
                chunk_size = max(1, int((qs.get("chunk_size") or ["1048576"])[0] or 1048576))
            except Exception:
                chunk_size = 1048576

            ext = os.path.splitext(raw_fn)[1].lower()
            if ext not in (".mp4", ".mov", ".webm", ".m4v"):
                ext = ".mp4"
            match_id = sanitize_match_id(raw_fn or raw_mid or "uploaded_match.mp4", file_size=file_size, explicit_match_id=raw_mid)
            dest_path = f"assets/uploads/{match_id}{ext}"
            part_path = f"{dest_path}.uploading.part"

            if os.path.exists(dest_path) and (file_size <= 0 or os.path.getsize(dest_path) == file_size):
                try:
                    info = probe_video_and_keypoints(dest_path, match_id=match_id, original_filename=raw_fn)
                    info["original_filename"] = raw_fn or os.path.basename(dest_path)
                    info["already_uploaded"] = True
                    info["chunk_complete"] = True
                    info["resume_chunk_index"] = (file_size + chunk_size - 1) // chunk_size if file_size > 0 else 1
                    self.send_json(info)
                    return
                except Exception:
                    pass

            if os.path.exists(part_path):
                part_sz = os.path.getsize(part_path)
                if file_size > 0 and part_sz > file_size:
                    try:
                        os.remove(part_path)
                    except Exception:
                        pass
                    part_sz = 0
                resume_idx = part_sz // chunk_size
                self.send_json({
                    "already_uploaded": False,
                    "resume_chunk_index": int(resume_idx),
                    "bytes_on_disk": int(part_sz),
                    "match_id": match_id,
                    "video_path": dest_path,
                })
                return

            self.send_json({
                "already_uploaded": False,
                "resume_chunk_index": 0,
                "bytes_on_disk": 0,
                "match_id": match_id,
                "video_path": dest_path,
            })
            return

        if parsed.path == "/api/tunnel-info":
            tun_url = ""
            if os.path.exists("/tmp/hawkview_active_tunnel.txt"):
                try:
                    with open("/tmp/hawkview_active_tunnel.txt", "r", encoding="utf-8") as ft:
                        tun_url = ft.read().strip()
                except Exception:
                    pass
            provider = "cloudflare_edge" if "trycloudflare.com" in tun_url else ("localhost_run" if "lhr.life" in tun_url else "local")
            self.send_json({"status": "online", "tunnel_url": tun_url, "tunnel_provider": provider})
            return

        if parsed.path == "/api/diagnostics":
            tun_url = ""
            if os.path.exists("/tmp/hawkview_active_tunnel.txt"):
                try:
                    with open("/tmp/hawkview_active_tunnel.txt", "r", encoding="utf-8") as ft:
                        tun_url = ft.read().strip()
                except Exception:
                    pass
            provider = "cloudflare_edge" if "trycloudflare.com" in tun_url else ("localhost_run" if "lhr.life" in tun_url else "local")
            videos_on_disk = []
            for folder in ["assets", "assets/uploads"]:
                if os.path.isdir(folder):
                    for fn in sorted(os.listdir(folder)):
                        if fn.lower().endswith((".mp4", ".mov", ".webm", ".m4v")):
                            rel = os.path.join(folder, fn).replace("\\", "/")
                            sz_b = os.path.getsize(rel)
                            videos_on_disk.append({
                                "name": fn,
                                "path": rel,
                                "size_bytes": sz_b,
                                "size_mb": round(sz_b / (1024 * 1024), 2),
                            })
            with JOBS_LOCK:
                jobs_summary = []
                for jid, jb in ANALYSIS_JOBS.items():
                    j_copy = {k: v for k, v in jb.items() if k != "telemetry"}
                    j_copy["elapsed_sec"] = round(time.time() - float(jb.get("started_at", time.time())), 1)
                    j_copy["has_telemetry"] = bool(jb.get("telemetry"))
                    jobs_summary.append(j_copy)
                uploads_summary = []
                for uid, us in UPLOAD_SESSIONS.items():
                    u_copy = dict(us)
                    if u_copy.get("dest_path") and os.path.exists(u_copy["dest_path"]):
                        u_copy["on_disk_bytes"] = os.path.getsize(u_copy["dest_path"])
                    else:
                        u_copy["on_disk_bytes"] = 0
                    uploads_summary.append(u_copy)
                recent_ev = list(SERVER_EVENT_LOG)[:80]

            self.send_json({
                "status": "online",
                "server_time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "uptime_sec": round(time.time() - SERVER_START_TIME, 1),
                "tunnel_url": tun_url,
                "tunnel_provider": provider,
                "colab_quota": get_colab_quota(),
                "upload_sessions": uploads_summary,
                "analysis_jobs": jobs_summary,
                "available_videos": videos_on_disk,
                "recent_events": recent_ev,
            })
            return

        if parsed.path == "/api/colab-quota":
            force = "force=1" in (parsed.query or "")
            quota = get_colab_quota(force_refresh=force)
            active_eta = None
            with JOBS_LOCK:
                for jb in ANALYSIS_JOBS.values():
                    if jb.get("status") == "running":
                        active_eta = compute_job_eta(jb)
                        break
            self.send_json({"colab_quota": quota, "active_eta": active_eta})
            return

        if parsed.path == "/api/matches":
            qs = urllib.parse.parse_qs(parsed.query)
            req_id = (qs.get("match_id") or [""])[0]
            matches_root = os.path.join("data", "matches")
            if req_id:
                tel_p = os.path.join(matches_root, req_id, "telemetry.json")
                if not os.path.exists(tel_p):
                    self.send_json({"error": f"Match telemetry not found: {req_id}"}, status=404)
                    return
                with open(tel_p, "r", encoding="utf-8") as ft:
                    tdata = json.load(ft)
                self.send_json({"match_id": req_id, "telemetry": tdata})
                return

            matches_list = []
            if os.path.isdir(matches_root):
                for m_id in sorted(os.listdir(matches_root)):
                    tel_p = os.path.join(matches_root, m_id, "telemetry.json")
                    if not os.path.exists(tel_p):
                        continue
                    try:
                        with open(tel_p, "r", encoding="utf-8") as ft:
                            tdata = json.load(ft)
                        rallies = tdata.get("rallies") or []
                        if not rallies:
                            continue
                        players = tdata.get("players") or {}
                        p_names = []
                        for pk, pv in players.items():
                            meta = (pv or {}).get("metadata") or {}
                            flag = meta.get("flag") or infer_player_flag(pk, str(meta.get("name") or pk))
                            p_names.append(f"{flag} {meta.get('name') or pk}")
                        vs_str = " vs ".join(p_names) if p_names else m_id
                        shot_cnt = sum(len(r.get("shots") or []) for r in rallies)
                        src = tdata.get("source") or {}
                        mm = tdata.get("match_metadata") or {}
                        comp_warn = (mm.get("compilation_warning") or {}).get("detected", False)
                        matches_list.append({
                            "match_id": m_id,
                            "label": f"{vs_str} ({len(rallies)} rallies · {shot_cnt} shots)",
                            "players_label": vs_str,
                            "tournament": mm.get("tournament", ""),
                            "video_path": src.get("video", ""),
                            "duration_sec": src.get("duration_sec", 0.0),
                            "rallies_count": len(rallies),
                            "shots_count": shot_cnt,
                            "has_side_swap": bool(comp_warn),
                            "updated_at": os.path.getmtime(tel_p),
                        })
                    except Exception:
                        pass
            self.send_json({"matches": matches_list, "colab_quota": get_colab_quota()})
            return

        if parsed.path == "/api/analyze-status":
            qs = urllib.parse.parse_qs(parsed.query)
            match_id = (qs.get("match_id") or [""])[0]
            with JOBS_LOCK:
                job = ANALYSIS_JOBS.get(match_id)
                if not job and match_id:
                    tel_disk = os.path.join("data", "matches", match_id, "telemetry.json")
                    if os.path.exists(tel_disk):
                        try:
                            with open(tel_disk, "r", encoding="utf-8") as f_td:
                                tel_data = json.load(f_td)
                            r_cnt = len(tel_data.get("rallies", []))
                            mtime = os.path.getmtime(tel_disk)
                            job = {
                                "match_id": match_id,
                                "video_path": tel_data.get("source", {}).get("video", ""),
                                "duration_sec": tel_data.get("source", {}).get("duration_sec", 480.0),
                                "compute_backend": tel_data.get("source", {}).get("compute_backend", "blackwell_g4"),
                                "status": "completed",
                                "stage": "COMPLETE: Custom Video 3D Analysis Ready",
                                "percent": 100.0,
                                "message": f"Analysis complete! {r_cnt} rallies reconstructed in 3D.",
                                "rallies_completed": r_cnt,
                                "rallies_total": r_cnt,
                                "stop_requested": False,
                                "telemetry": tel_data,
                                "error": None,
                                "started_at": mtime - 12.0,
                                "updated_at": mtime,
                            }
                            ANALYSIS_JOBS[match_id] = job
                        except Exception:
                            pass
                if not job:
                    self.send_json({"error": f"Unknown match_id: {match_id}"}, status=404)
                    return
                resp = dict(job)
                resp["eta"] = compute_job_eta(resp)
            resp["colab_quota"] = get_colab_quota()
            self.send_json(resp)
            return

        if parsed.path == "/api/import-youtube-status":
            qs = urllib.parse.parse_qs(parsed.query)
            job_id = (qs.get("job_id") or [""])[0]
            with JOBS_LOCK:
                job = YOUTUBE_JOBS.get(job_id)
                if not job:
                    self.send_json({"error": f"Unknown YouTube import job: {job_id}"}, status=404)
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

        if parsed.path == "/api/upload-chunk":
            t0_chunk = time.time()
            length = int(self.headers.get("Content-Length", "0"))
            try:
                raw_filename = urllib.parse.unquote(self.headers.get("X-File-Name", "uploaded_match.mp4"))
                chunk_idx = int(self.headers.get("X-Chunk-Index", "0"))
                total_chunks = int(self.headers.get("X-Total-Chunks", "1"))
                file_size = int(self.headers.get("X-File-Size", "0") or 0)
                chunk_size = max(1, int(self.headers.get("X-Chunk-Size", "1048576") or 1048576))
                explicit_offset = self.headers.get("X-Chunk-Offset")
                offset = int(explicit_offset) if explicit_offset is not None else (chunk_idx * chunk_size)
                explicit_mid = urllib.parse.unquote(self.headers.get("X-Match-Id", ""))
                ext = os.path.splitext(raw_filename)[1].lower()
                if ext not in (".mp4", ".mov", ".webm", ".m4v"):
                    ext = ".mp4"
                match_id = sanitize_match_id(raw_filename, file_size=file_size, explicit_match_id=explicit_mid)
                upload_dir = "assets/uploads"
                os.makedirs(upload_dir, exist_ok=True)
                dest_path = f"{upload_dir}/{match_id}{ext}"
                part_path = f"{dest_path}.uploading.part"

                # Idempotent byte-offset write to .uploading.part so chunk retries/resumes never truncate or duplicate bytes!
                mode = "r+b" if os.path.exists(part_path) else "wb"
                remaining = length
                bufsize = 256 * 1024
                with open(part_path, mode) as f_out:
                    f_out.seek(offset)
                    while remaining > 0:
                        chunk = self.rfile.read(min(remaining, bufsize))
                        if not chunk:
                            break
                        f_out.write(chunk)
                        remaining -= len(chunk)
                    if chunk_idx >= total_chunks - 1 and file_size > 0:
                        f_out.truncate(file_size)

                dur_ms = (time.time() - t0_chunk) * 1000.0
                part_bytes_now = os.path.getsize(part_path) if os.path.exists(part_path) else (offset + length)
                with JOBS_LOCK:
                    sess = UPLOAD_SESSIONS.get(match_id)
                    if not sess:
                        sess = {
                            "match_id": match_id,
                            "filename": raw_filename,
                            "dest_path": dest_path,
                            "total_chunks": total_chunks,
                            "chunks_received": 0,
                            "bytes_received": 0,
                            "total_bytes": file_size,
                            "started_at": t0_chunk,
                            "updated_at": time.time(),
                            "avg_kbps": 0.0,
                            "mb_per_sec": 0.0,
                            "status": "uploading",
                            "error": None,
                        }
                        UPLOAD_SESSIONS[match_id] = sess
                    sess["chunks_received"] = max(int(sess.get("chunks_received", 0)), chunk_idx + 1)
                    sess["bytes_received"] = max(int(sess.get("bytes_received", 0)), part_bytes_now)
                    sess["updated_at"] = time.time()
                    elapsed_u = max(0.05, sess["updated_at"] - sess["started_at"])
                    sess["avg_kbps"] = round((sess["bytes_received"] / 1024.0) / elapsed_u, 1)
                    sess["mb_per_sec"] = round((sess["bytes_received"] / (1024.0 * 1024.0)) / elapsed_u, 2)

                if chunk_idx >= total_chunks - 1:
                    os.replace(part_path, dest_path)
                    info = probe_video_and_keypoints(dest_path, match_id=match_id, original_filename=raw_filename)
                    info["original_filename"] = raw_filename
                    info["chunk_complete"] = True
                    with JOBS_LOCK:
                        if match_id in UPLOAD_SESSIONS:
                            UPLOAD_SESSIONS[match_id]["status"] = "completed"
                    log_server_event(
                        "UPLOAD_COMPLETE",
                        "/api/upload-chunk",
                        status=200,
                        duration_ms=dur_ms,
                        detail=f"{raw_filename} ({chunk_idx + 1}/{total_chunks} chunks, {round(os.path.getsize(dest_path)/(1024*1024), 1)} MB) -> {dest_path}",
                    )
                    self.send_json(info)
                else:
                    if chunk_idx == 0 or (chunk_idx + 1) % 5 == 0:
                        log_server_event(
                            "UPLOAD_CHUNK",
                            "/api/upload-chunk",
                            status=200,
                            duration_ms=dur_ms,
                            detail=f"{raw_filename} chunk {chunk_idx + 1}/{total_chunks} ({sess['mb_per_sec']} MB/s)",
                        )
                    self.send_json({
                        "status": "chunk_received",
                        "chunk_index": chunk_idx,
                        "total_chunks": total_chunks,
                        "video_path": dest_path,
                        "match_id": match_id,
                        "mb_per_sec": sess["mb_per_sec"],
                    })
                return
            except Exception as exc:
                tb_s = traceback.format_exc()
                log_server_event("UPLOAD_ERROR", "/api/upload-chunk", status=500, detail=str(exc), error_trace=tb_s)
                self.send_json({"error": str(exc), "traceback": tb_s}, status=500)
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
                    info = probe_video_and_keypoints(video_path, float(req.get("sample_time_sec", -1.0)), match_id=match_id)
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

                    info = probe_video_and_keypoints(dest_path, match_id=match_id, original_filename=raw_filename)
                    info["original_filename"] = raw_filename
                    self.send_json(info)
                    return
            except Exception as exc:
                self.send_json({"error": str(exc)}, status=500)
                return

        if parsed.path == "/api/import-youtube":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                req = json.loads(raw.decode("utf-8"))
                raw_url = str(req.get("url") or "").strip()
                video_id = extract_youtube_video_id(raw_url)
                if not video_id:
                    log_server_event("YT_INVALID_URL", "/api/import-youtube", status=400, detail=raw_url[:120])
                    self.send_json(
                        {
                            "error": "Invalid YouTube URL. Paste a valid youtube.com/watch?v=..., youtu.be/..., or youtube.com/live/... link.",
                            "error_code": "invalid_youtube_url",
                        },
                        status=400,
                    )
                    return

                cookies_browser = str(req.get("cookies_browser") or "").strip() or None
                force_redownload = bool(req.get("force_redownload", False))
                job_id = f"ytjob_{video_id}_{int(time.time() * 1000) % 100000}"
                match_id = f"yt_{video_id}"
                job_rec = {
                    "job_id": job_id,
                    "video_id": video_id,
                    "match_id": match_id,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "status": "running",
                    "stage": "Connecting to YouTube",
                    "percent": 4.0,
                    "message": f"Preparing 1080p H.264 import for {video_id}...",
                    "error": None,
                    "error_code": None,
                    "probe_info": None,
                    "started_at": time.time(),
                    "updated_at": time.time(),
                }
                with JOBS_LOCK:
                    YOUTUBE_JOBS[job_id] = job_rec

                def _run_yt_import():
                    def _on_prog(stage: str, pct: float, msg: str):
                        with JOBS_LOCK:
                            job_rec["stage"] = stage
                            job_rec["percent"] = round(float(pct), 1)
                            job_rec["message"] = msg
                            job_rec["updated_at"] = time.time()

                    try:
                        dl = download_youtube_video(
                            raw_url,
                            progress_cb=_on_prog,
                            cookies_browser=cookies_browser,
                            force_redownload=force_redownload,
                        )
                        _on_prog(
                            "Auto-Calibrating BWF Court & Scorebug",
                            88.0,
                            f"Probing court lines & players for {dl['title']}...",
                        )
                        probe = probe_video_and_keypoints(
                            dl["video_path"],
                            sample_time_sec=-1.0,
                            match_id=match_id,
                            original_filename=dl["title"],
                        )
                        probe["yt_video_id"] = dl["video_id"]
                        probe["yt_title"] = dl["title"]
                        probe["yt_channel"] = dl["channel"]
                        probe["yt_url"] = dl["canonical_url"]
                        probe["yt_cached"] = bool(dl["cached"])
                        with JOBS_LOCK:
                            job_rec["status"] = "ready"
                            job_rec["stage"] = "Ready for 3D Analysis"
                            job_rec["percent"] = 100.0
                            cal_prev = probe.get("calibration_preview") or {}
                            rmse_s = cal_prev.get("line_sample_rmse_px", "?")
                            job_rec["message"] = (
                                f"✓ {dl['title']} · {probe['width']}×{probe['height']} @ {probe['fps']}fps "
                                f"(Court RMSE {rmse_s}px)"
                            )
                            job_rec["probe_info"] = probe
                            job_rec["updated_at"] = time.time()
                        log_server_event(
                            "YT_IMPORT_READY",
                            "/api/import-youtube",
                            status=200,
                            detail=f"{video_id} ({'cached' if dl['cached'] else 'downloaded'}) -> {dl['video_path']}",
                        )
                    except YouTubeIngestError as yexc:
                        with JOBS_LOCK:
                            job_rec["status"] = "error"
                            job_rec["stage"] = "YouTube Import Blocked"
                            job_rec["percent"] = 100.0
                            job_rec["error"] = str(yexc)
                            job_rec["error_code"] = yexc.error_code
                            job_rec["message"] = str(yexc)
                            job_rec["updated_at"] = time.time()
                        log_server_event(
                            "YT_IMPORT_ERROR",
                            "/api/import-youtube",
                            status=422,
                            detail=f"{video_id} [{yexc.error_code}]: {yexc}",
                        )
                    except Exception as exc_inner:
                        tb_s = traceback.format_exc()
                        with JOBS_LOCK:
                            job_rec["status"] = "error"
                            job_rec["stage"] = "YouTube Import Failed"
                            job_rec["percent"] = 100.0
                            job_rec["error"] = str(exc_inner)
                            job_rec["error_code"] = "youtube_internal_error"
                            job_rec["message"] = str(exc_inner)
                            job_rec["updated_at"] = time.time()
                        log_server_event(
                            "YT_IMPORT_ERROR",
                            "/api/import-youtube",
                            status=500,
                            detail=str(exc_inner),
                            error_trace=tb_s,
                        )

                threading.Thread(target=_run_yt_import, daemon=True).start()
                self.send_json({"status": "started", "job_id": job_id, "video_id": video_id, "match_id": match_id})
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
                info = probe_video_and_keypoints(video_path, sample_time_sec=time_sec, use_saved_calibration=False)
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
                try:
                    from engine.colab_worker import ACTIVE_COLAB_SESSIONS
                    sess_name = ACTIVE_COLAB_SESSIONS.get(match_id)
                    stop_blackwell_session(sess_name)
                except Exception:
                    pass
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
