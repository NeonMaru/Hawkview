"""
Hawkview Optional, Fail-Open Surgical Gemini Contact-Sheet Sidecar
==================================================================
Provides ultra-low-token visual verification using the current `google-genai`
Interactions API (`from google import genai`, `client.interactions.create(...)`):
  - Default model: `gemini-3.5-flash-lite` (supports `gemini-4-hydrogen`;
    never uses deprecated `gemini-2.5-*` / `gemini-2.0-*` / `gemini-1.5-*`).
  - Completely fail-open: if `GEMINI_API_KEY` / `GOOGLE_API_KEY` is unset,
    `google-genai` is unavailable, or the network call fails, returns
    `{"enabled": False, "reason": "..."}` in <1ms without raising.
  - Pure offline helper `build_contact_sheet(...)` tiles labeled BGR crops
    into a clean JPEG-ready contact sheet for unit testing & verification.
"""

from __future__ import annotations

import base64
import json
import math
import os
from typing import Dict, List, Optional, Tuple, Union

import cv2
import numpy as np


DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
FALLBACK_MODERN_MODEL = "gemini-4-hydrogen"


def _resolve_model(model: Optional[str]) -> str:
    """Enforces current Gemini models; replaces any deprecated legacy model name."""
    m = str(model or DEFAULT_GEMINI_MODEL).strip()
    lower = m.lower()
    if lower.startswith(("gemini-2.5", "gemini-2.0", "gemini-1.5", "gemini-1.0")):
        return FALLBACK_MODERN_MODEL
    return m or DEFAULT_GEMINI_MODEL


def _get_api_key() -> Optional[str]:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key and key.strip():
        return key.strip()
    return None


def _fit_crop_letterbox(img_bgr: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    """Resizes a BGR image to fit inside (target_w, target_h) preserving aspect ratio."""
    canvas = np.full((target_h, target_w, 3), (18, 22, 30), dtype=np.uint8)
    if img_bgr is None or not isinstance(img_bgr, np.ndarray) or img_bgr.size == 0:
        return canvas
    if img_bgr.ndim == 2:
        img_bgr = cv2.cvtColor(img_bgr, cv2.COLOR_GRAY2BGR)
    h, w = img_bgr.shape[:2]
    if h <= 0 or w <= 0:
        return canvas
    scale = min(float(target_w) / w, float(target_h) / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(img_bgr, (nw, nh), interpolation=interp)
    ox = (target_w - nw) // 2
    oy = (target_h - nh) // 2
    canvas[oy : oy + nh, ox : ox + nw] = resized
    return canvas


def build_contact_sheet(
    labeled_crops: List[Tuple[str, np.ndarray]],
    tile_w: int = 260,
    tile_h: int = 100,
    cols: int = 4,
) -> np.ndarray:
    """
    Pure offline helper that tiles `(label, bgr_crop)` pairs into a single
    crisp labeled contact sheet image (`np.ndarray`, BGR uint8).
    """
    tile_w = max(64, int(tile_w))
    tile_h = max(40, int(tile_h))
    cols = max(1, int(cols))

    if not labeled_crops:
        return np.full((tile_h, tile_w, 3), (18, 22, 30), dtype=np.uint8)

    pad = 4
    header_h = min(22, max(16, tile_h // 5))
    img_h = max(16, tile_h - header_h)
    n_items = len(labeled_crops)
    rows = int(math.ceil(n_items / float(cols)))

    sheet_w = cols * tile_w + (cols + 1) * pad
    sheet_h = rows * tile_h + (rows + 1) * pad
    sheet = np.full((sheet_h, sheet_w, 3), (12, 16, 22), dtype=np.uint8)

    for idx, (label, crop) in enumerate(labeled_crops):
        r = idx // cols
        c = idx % cols
        x0 = pad + c * (tile_w + pad)
        y0 = pad + r * (tile_h + pad)

        # Header strip
        cv2.rectangle(sheet, (x0, y0), (x0 + tile_w - 1, y0 + header_h - 1), (30, 41, 59), -1)
        label_str = str(label)[:28]
        cv2.putText(
            sheet,
            label_str,
            (x0 + 6, y0 + header_h - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            (241, 245, 249),
            1,
            cv2.LINE_AA,
        )

        # Aspect-preserved crop below header
        fitted = _fit_crop_letterbox(crop, tile_w, img_h)
        sheet[y0 + header_h : y0 + tile_h, x0 : x0 + tile_w] = fitted
        cv2.rectangle(sheet, (x0, y0), (x0 + tile_w - 1, y0 + tile_h - 1), (71, 85, 105), 1)

    return sheet


def _encode_jpeg_b64(img_bgr: np.ndarray, max_side: int = 1024, quality: int = 85) -> str:
    h, w = img_bgr.shape[:2]
    if max(h, w) > max_side:
        scale = float(max_side) / max(h, w)
        img_bgr = cv2.resize(
            img_bgr,
            (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )
    ok, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise RuntimeError("Failed to JPEG-encode contact sheet")
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def _call_gemini_json(
    sheet_bgr: np.ndarray,
    prompt: str,
    json_schema: dict,
    model: str = DEFAULT_GEMINI_MODEL,
) -> dict:
    """
    Fail-open wrapper around the current `google-genai` Interactions API.
    Returns `{"enabled": False, "reason": "..."}` in <1ms if no key is set or SDK is missing.
    """
    api_key = _get_api_key()
    if not api_key:
        return {"enabled": False, "reason": "No GEMINI_API_KEY or GOOGLE_API_KEY set"}

    try:
        from google import genai  # type: ignore
    except Exception as exc:
        return {"enabled": False, "reason": f"google-genai SDK unavailable: {exc}"}

    resolved_model = _resolve_model(model)
    try:
        image_b64 = _encode_jpeg_b64(sheet_bgr, max_side=1024, quality=85)
        client = genai.Client(api_key=api_key)
        interaction = client.interactions.create(
            model=resolved_model,
            input=[
                {"type": "text", "text": prompt},
                {
                    "type": "image",
                    "data": image_b64,
                    "mime_type": "image/jpeg",
                },
            ],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": json_schema,
            },
            store=False,
        )
        raw_text = getattr(interaction, "output_text", None) or ""
        if not raw_text.strip():
            return {"enabled": False, "reason": "Empty Gemini response", "model": resolved_model}
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            return {"enabled": True, "model": resolved_model, **parsed}
        return {"enabled": True, "model": resolved_model, "data": parsed}
    except Exception as exc:
        return {"enabled": False, "reason": f"Gemini audit failed: {exc}", "model": resolved_model}


def audit_match_bootstrap(
    frame_bgr: np.ndarray,
    calib_overlay_bgr: Optional[np.ndarray] = None,
    model: str = DEFAULT_GEMINI_MODEL,
) -> dict:
    """
    Sends 1 compact JPEG contact sheet (wide broadcast frame + zoomed top-left scorebug
    + court calibration overlay) to Gemini and returns strict JSON:
      {
        "enabled": True,
        "model": ...,
        "players": [near_player, far_player],
        "flags": [flag1, flag2],
        "match_type": "singles" | "doubles",
        "calib_aligned": bool,
        "calib_issue": str
      }
    Fails open in <1ms if no API key is configured.
    """
    if not _get_api_key():
        return {"enabled": False, "reason": "No GEMINI_API_KEY or GOOGLE_API_KEY set"}
    if frame_bgr is None or not isinstance(frame_bgr, np.ndarray) or frame_bgr.size == 0:
        return {"enabled": False, "reason": "Empty input frame"}

    h, w = frame_bgr.shape[:2]
    sb_w = max(64, int(round(w * 0.38)))
    sb_h = max(40, int(round(h * 0.22)))
    scorebug_zoom = frame_bgr[0:sb_h, 0:sb_w]
    overlay_img = calib_overlay_bgr if (calib_overlay_bgr is not None and calib_overlay_bgr.size > 0) else frame_bgr

    sheet = build_contact_sheet(
        [
            ("WIDE_FRAME", frame_bgr),
            ("SCOREBUG_ZOOM", scorebug_zoom),
            ("CALIB_OVERLAY", overlay_img),
        ],
        tile_w=330,
        tile_h=220,
        cols=3,
    )

    schema = {
        "type": "object",
        "properties": {
            "players": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Two player or doubles-pair labels: [near_court_player, far_court_player].",
            },
            "flags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Two 3-letter country codes or flag emojis matching players.",
            },
            "match_type": {
                "type": "string",
                "enum": ["singles", "doubles"],
            },
            "calib_aligned": {
                "type": "boolean",
                "description": "True if projected white/colored court lines align cleanly with floor lines in CALIB_OVERLAY.",
            },
            "calib_issue": {
                "type": "string",
                "description": "Empty string if aligned, otherwise concise description of misalignment.",
            },
        },
        "required": ["players", "flags", "match_type", "calib_aligned", "calib_issue"],
    }

    prompt = (
        "Inspect this 3-panel badminton match bootstrap contact sheet:\n"
        "1. WIDE_FRAME: full broadcast court frame.\n"
        "2. SCOREBUG_ZOOM: zoomed top-left broadcast scoreboard.\n"
        "3. CALIB_OVERLAY: projected BWF court wireframe overlaid on the court.\n"
        "Return strict JSON identifying [near, far] players, their country codes/flags, "
        "whether the match is singles or doubles, and whether the calibration wireframe is aligned."
    )
    return _call_gemini_json(sheet, prompt, schema, model=model)


def audit_rally_scorebugs(
    scorebug_crops_bgr: List[Tuple[Union[int, str], np.ndarray]],
    model: str = DEFAULT_GEMINI_MODEL,
) -> dict:
    """
    Tiles up to 24 tiny (~240x90) rally start/end scorebug crops into a single
    <=1024x1024 labeled JPEG contact sheet (`R1_START`, `R1_END`, ...) and returns
    strict JSON per-rally score & replay audit:
      {
        "enabled": True,
        "model": ...,
        "rallies": [
          {"rally_id": int, "game": int, "score_a": int, "score_b": int,
           "winner_side": "near"|"far"|"unknown", "is_replay": bool}
        ]
      }
    Fails open in <1ms if no API key is configured.
    """
    if not _get_api_key():
        return {"enabled": False, "reason": "No GEMINI_API_KEY or GOOGLE_API_KEY set"}
    if not scorebug_crops_bgr:
        return {"enabled": False, "reason": "No scorebug crops supplied"}

    labeled: List[Tuple[str, np.ndarray]] = []
    seen_counts: Dict[int, int] = {}
    for key, crop in scorebug_crops_bgr[:24]:
        if isinstance(key, int):
            cnt = seen_counts.get(key, 0)
            seen_counts[key] = cnt + 1
            suffix = "START" if cnt == 0 else ("END" if cnt == 1 else f"F{cnt}")
            label = f"R{key}_{suffix}"
        else:
            label = str(key)
        labeled.append((label, crop))

    sheet = build_contact_sheet(labeled, tile_w=240, tile_h=112, cols=4)

    schema = {
        "type": "object",
        "properties": {
            "rallies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rally_id": {"type": "integer"},
                        "game": {"type": "integer"},
                        "score_a": {"type": "integer"},
                        "score_b": {"type": "integer"},
                        "winner_side": {
                            "type": "string",
                            "enum": ["near", "far", "unknown"],
                        },
                        "is_replay": {"type": "boolean"},
                    },
                    "required": ["rally_id", "game", "score_a", "score_b", "winner_side", "is_replay"],
                },
            }
        },
        "required": ["rallies"],
    }

    prompt = (
        "Read each labeled badminton broadcast scorebug tile (R1_START, R1_END, ...) in this contact sheet. "
        "For each rally_id, return the game number, post-rally score_a and score_b, which side won if "
        "discernible from score increment ('near', 'far', or 'unknown'), and is_replay=true if the tile "
        "shows a replay graphic or missing live scoreboard."
    )
    return _call_gemini_json(sheet, prompt, schema, model=model)
