"""
Hawkview Honest Match-Level Shuttle Accuracy Audit (Zero-Fabrication Scorecard)
===============================================================================
Computes transparent, strictly measured shuttle tracking & 3D aerodynamic fit
accuracy metrics across all shots in a match:
  - overall_grade ("A", "B", "C", or "D")
  - overall_score_pct (0-100 derived strictly from measured RMSE, coverage,
    RANSAC inlier ratio, blowup rate, and 3D shot-to-shot continuity)
  - total_shots, grade_counts (A/B/C/D)
  - median_rmse_px, p75_rmse_px, p90_rmse_px
  - blowup_count (fit_rmse_px > 30.0), blowup_rate_pct
  - median_coverage_pct, median_inlier_ratio
  - median_continuity_gap_m, p90_continuity_gap_m
  - calib_reprojection_px, calib_line_rmse_px
  - verified_by
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np


def _infer_shot_grade(
    fit_rmse_px: float,
    track_coverage_pct: Optional[float] = None,
    inlier_ratio: Optional[float] = None,
    sy: float = 1.0,
) -> str:
    cov = 100.0 if track_coverage_pct is None else float(track_coverage_pct)
    inl = 1.0 if inlier_ratio is None else float(inlier_ratio)
    if fit_rmse_px <= 4.5 * sy and cov >= 65.0 and inl >= 0.70:
        return "A"
    if fit_rmse_px <= 8.5 * sy and cov >= 45.0:
        return "B"
    if fit_rmse_px <= 16.0 * sy:
        return "C"
    return "D"


def _extract_calib_metric(calibration: Any, key: str) -> Optional[float]:
    if calibration is None:
        return None
    val = None
    if isinstance(calibration, dict):
        val = calibration.get(key)
    else:
        val = getattr(calibration, key, None)
    if val is None:
        return None
    try:
        fval = float(val)
        if np.isfinite(fval):
            return round(fval, 2)
    except (TypeError, ValueError):
        pass
    return None


def compute_match_accuracy_audit(
    rallies: List[dict],
    calibration: Optional[Any] = None,
    tracks_by_frame: Optional[Dict[int, Tuple[int, float, float]]] = None,
    gemini_audit: Optional[dict] = None,
) -> dict:
    """
    Computes an honest, match-level shuttle tracking & 3D trajectory accuracy scorecard.
    Zero fabricated values: every statistic is computed directly from reconstructed shot
    residuals, RANSAC inliers, TrackNet visibility coverage, and 3D continuity gaps.
    """
    all_shots: List[dict] = []
    rmses: List[float] = []
    covs: List[float] = []
    inliers: List[float] = []
    cont_gaps: List[float] = []
    grade_counts = {"A": 0, "B": 0, "C": 0, "D": 0}

    # Support either list of rally dicts (with "shots") or flat list of shot dicts
    if rallies and isinstance(rallies[0], dict) and "shots" in rallies[0]:
        rally_groups = [r.get("shots") or [] for r in rallies]
    elif rallies:
        rally_groups = [rallies]
    else:
        rally_groups = []

    for shots in rally_groups:
        prev_end_3d = None
        for s in shots:
            if not isinstance(s, dict):
                continue
            all_shots.append(s)

            rmse_val = s.get("fit_rmse_px")
            rmse_f: Optional[float] = None
            if rmse_val is not None:
                try:
                    cand = float(rmse_val)
                    if np.isfinite(cand) and cand >= 0.0:
                        rmse_f = cand
                        rmses.append(cand)
                except (TypeError, ValueError):
                    pass

            cov_val = s.get("track_coverage_pct")
            cov_f: Optional[float] = None
            if cov_val is not None:
                try:
                    cand = float(cov_val)
                    if np.isfinite(cand):
                        cov_f = float(np.clip(cand, 0.0, 100.0))
                        covs.append(cov_f)
                except (TypeError, ValueError):
                    pass
            elif tracks_by_frame is not None and "start_frame" in s and "end_frame" in s:
                try:
                    sf = int(s["start_frame"])
                    ef = int(s["end_frame"])
                    if ef >= sf:
                        vis_n = sum(
                            1
                            for fn in range(sf, ef + 1)
                            if fn in tracks_by_frame and int(tracks_by_frame[fn][0]) == 1
                        )
                        cov_f = round(100.0 * vis_n / max(1, ef - sf + 1), 1)
                        covs.append(cov_f)
                except (TypeError, ValueError):
                    pass

            inl_val = s.get("inlier_ratio")
            inl_f: Optional[float] = None
            if inl_val is not None:
                try:
                    cand = float(inl_val)
                    if np.isfinite(cand):
                        inl_f = float(np.clip(cand, 0.0, 1.0))
                        inliers.append(inl_f)
                except (TypeError, ValueError):
                    pass

            gap_val = s.get("continuity_gap_m")
            if gap_val is not None:
                try:
                    cand = float(gap_val)
                    if np.isfinite(cand) and cand >= 0.0:
                        cont_gaps.append(cand)
                except (TypeError, ValueError):
                    pass
            elif prev_end_3d is not None and s.get("start_3d") is not None:
                try:
                    p_start = np.array(s["start_3d"], dtype=np.float64)
                    p_prev = np.array(prev_end_3d, dtype=np.float64)
                    if p_start.shape == (3,) and p_prev.shape == (3,):
                        gap_calc = float(np.linalg.norm(p_start - p_prev))
                        if np.isfinite(gap_calc):
                            cont_gaps.append(gap_calc)
                except (TypeError, ValueError):
                    pass

            prev_end_3d = s.get("end_3d")

            grade = s.get("accuracy_grade")
            if grade in grade_counts:
                grade_counts[grade] += 1
            elif rmse_f is not None:
                grade_counts[_infer_shot_grade(rmse_f, cov_f, inl_f)] += 1
            else:
                grade_counts["D"] += 1

    total_shots = len(all_shots)
    calib_reproj = _extract_calib_metric(calibration, "reprojection_error_px")
    calib_line_rmse = _extract_calib_metric(calibration, "line_sample_rmse_px")

    gemini_ran = bool(isinstance(gemini_audit, dict) and gemini_audit.get("enabled"))
    verified_by = (
        "Zero-LLM CV + RK4 Physics Audit + Gemini Contact-Sheet Audit"
        if gemini_ran
        else "Zero-LLM CV + RK4 Physics Audit"
    )

    if total_shots == 0 or not rmses:
        return {
            "overall_grade": "D",
            "overall_score_pct": 0.0,
            "total_shots": total_shots,
            "grade_counts": grade_counts,
            "median_rmse_px": None,
            "p75_rmse_px": None,
            "p90_rmse_px": None,
            "blowup_count": 0,
            "blowup_rate_pct": 0.0,
            "median_coverage_pct": None,
            "median_inlier_ratio": None,
            "median_continuity_gap_m": None,
            "p90_continuity_gap_m": None,
            "calib_reprojection_px": calib_reproj,
            "calib_line_rmse_px": calib_line_rmse,
            "verified_by": verified_by,
        }

    rmse_arr = np.array(rmses, dtype=np.float64)
    median_rmse_px = round(float(np.percentile(rmse_arr, 50)), 2)
    p75_rmse_px = round(float(np.percentile(rmse_arr, 75)), 2)
    p90_rmse_px = round(float(np.percentile(rmse_arr, 90)), 2)

    blowup_count = int(np.sum(rmse_arr > 30.0))
    blowup_rate_pct = round(100.0 * blowup_count / max(1, len(rmses)), 1)

    median_coverage_pct = round(float(np.median(covs)), 1) if covs else None
    median_inlier_ratio = round(float(np.median(inliers)), 3) if inliers else None
    median_continuity_gap_m = round(float(np.median(cont_gaps)), 3) if cont_gaps else None
    p90_continuity_gap_m = round(float(np.percentile(cont_gaps, 90)), 3) if cont_gaps else None

    # Overall Grade strictly from measured median RMSE, p90 RMSE, and blowup rate
    if median_rmse_px <= 4.5 and p90_rmse_px <= 10.0 and blowup_rate_pct <= 2.0:
        overall_grade = "A"
    elif median_rmse_px <= 8.5 and p90_rmse_px <= 18.0 and blowup_rate_pct <= 8.0:
        overall_grade = "B"
    elif median_rmse_px <= 16.0 and blowup_rate_pct <= 20.0:
        overall_grade = "C"
    else:
        overall_grade = "D"

    # Transparent 0-100 score strictly weighted from measured physical metrics
    weighted_components: List[Tuple[float, float]] = []

    rmse_score = max(
        0.0,
        min(
            100.0,
            100.0 - 4.0 * max(0.0, median_rmse_px - 2.0) - 1.5 * max(0.0, p90_rmse_px - 8.0),
        ),
    )
    weighted_components.append((0.45, rmse_score))

    blowup_score = max(0.0, min(100.0, 100.0 - 5.0 * blowup_rate_pct))
    weighted_components.append((0.15, blowup_score))

    if median_coverage_pct is not None:
        cov_score = max(0.0, min(100.0, float(median_coverage_pct)))
        weighted_components.append((0.15, cov_score))

    if median_inlier_ratio is not None:
        inlier_score = max(0.0, min(100.0, 100.0 * float(median_inlier_ratio)))
        weighted_components.append((0.125, inlier_score))

    if median_continuity_gap_m is not None:
        cont_score = max(0.0, min(100.0, 100.0 - 35.0 * max(0.0, float(median_continuity_gap_m) - 0.35)))
        weighted_components.append((0.125, cont_score))

    weight_sum = sum(w for w, _ in weighted_components)
    overall_score_pct = round(
        float(np.clip(sum(w * s for w, s in weighted_components) / max(1e-6, weight_sum), 0.0, 100.0)),
        1,
    )

    return {
        "overall_grade": overall_grade,
        "overall_score_pct": overall_score_pct,
        "total_shots": total_shots,
        "grade_counts": grade_counts,
        "median_rmse_px": median_rmse_px,
        "p75_rmse_px": p75_rmse_px,
        "p90_rmse_px": p90_rmse_px,
        "blowup_count": blowup_count,
        "blowup_rate_pct": blowup_rate_pct,
        "median_coverage_pct": median_coverage_pct,
        "median_inlier_ratio": median_inlier_ratio,
        "median_continuity_gap_m": median_continuity_gap_m,
        "p90_continuity_gap_m": p90_continuity_gap_m,
        "calib_reprojection_px": calib_reproj,
        "calib_line_rmse_px": calib_line_rmse,
        "verified_by": verified_by,
    }
