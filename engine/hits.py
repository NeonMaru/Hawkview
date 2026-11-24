"""
HawkView Hit Detector & Hitter Attribution (Phase D)
====================================================
Detects racket-shuttle contacts from 2D TrackNet trajectories + rtmlib 12.5 fps player poses:
  1. Interpolates 12.5 fps near/far player poses to 25 fps.
  2. Automatically distinguishes live serves from mid-rally broadcast cuts.
  3. Finds local velocity-impulse maxima (dv) where trajectory reverses direction or
     experiences a sharp impulse within racket reach of a player's wrist.
  4. Rejects mid-air clear apexes, pass-by silhouettes, and post-rally floor bounces.
  5. Enforces strict near/far alternation (bridging soft blocks/drops in long same-side gaps).
"""

from __future__ import annotations

import csv
import json
import os
from typing import Dict, List, Optional, Tuple

import numpy as np


class HitDetector:
    """
    Detects hit frames and attributes each hit to the near or far player.
    """

    def __init__(self, fps: float = 25.0, image_width: int = 1920, image_height: int = 1080, calibrator=None):
        self.fps = fps
        self.image_width = int(image_width or 1920)
        self.image_height = int(image_height or 1080)
        self.calibrator = calibrator

    def _compute_calibrated_y_bounds(self, sy: float, calibrator=None) -> Tuple[float, float, float, float]:
        """
        Computes camera-angle-independent vertical image bounds (near_y_min, far_y_max, v_net_top, serve_y_min)
        by projecting the 3D court & net geometry through `calibrator`.
        Eliminates hardcoded 1080p LZJ-camera pixel gates (y <= 510*sy) that broke on Paris 2024 and other angles.
        """
        cal = calibrator or self.calibrator
        if cal is not None and getattr(cal, "K", None) is not None and getattr(cal, "rvec", None) is not None:
            try:
                pts_3d = np.array([
                    [3.05, 6.70, 0.0],    # Net ground center
                    [3.05, 6.70, 1.55],   # Net tape center
                    [3.05, 0.0, 3.20],    # Near baseline overhead smash height
                    [3.05, 13.40, 2.80],  # Far baseline overhead height
                ], dtype=np.float64)
                proj = cal.project_3d_to_pixel(pts_3d)
                v_net_ground = float(proj[0, 1])
                v_net_top = float(proj[1, 1])
                v_near_overhead = float(proj[2, 1])
                near_y_min = max(110.0 * sy, min(300.0 * sy, v_near_overhead - 35.0 * sy))
                # Far court low net hits sit near v_net_ground; allow +35*sy px margin below net base
                far_y_max = max(510.0 * sy, v_net_ground + 35.0 * sy)
                serve_y_min = max(160.0 * sy, v_net_top - 35.0 * sy)
                return near_y_min, far_y_max, v_net_top, serve_y_min
            except Exception:
                pass
        return 240.0 * sy, 610.0 * sy, 400.0 * sy, 280.0 * sy

    @staticmethod
    def load_shuttle_csv(csv_path: str) -> Dict[int, Tuple[int, float, float]]:
        tracks: Dict[int, Tuple[int, float, float]] = {}
        with open(csv_path, "r") as f:
            for row in csv.DictReader(f):
                fn = int(row.get("Frame") or row.get("frame"))
                vis = int(row.get("Visibility") or row.get("visible"))
                x = float(row.get("X") or row.get("x_px"))
                y = float(row.get("Y") or row.get("y_px"))
                tracks[fn] = (vis, x, y)
        return tracks

    @staticmethod
    def interpolate_rally_poses(
        rally_frames: List[dict],
        start_frame: int,
        end_frame: int,
    ) -> Dict[int, dict]:
        """
        Interpolate stride=2 (12.5 fps) pose samples to every frame in [start_frame, end_frame].
        """
        by_f = {int(p["frame"]): p for p in rally_frames}
        known_frames = sorted(by_f.keys())
        res: Dict[int, dict] = {}

        def _interp_player(p0: Optional[dict], p1: Optional[dict], alpha: float) -> Optional[dict]:
            if p0 is None and p1 is None:
                return None
            if p0 is None:
                return p1
            if p1 is None:
                return p0
            out = {}
            for k in ("court_x", "court_y", "conf"):
                if k in p0 and k in p1:
                    out[k] = (1.0 - alpha) * float(p0[k]) + alpha * float(p1[k])
            for k in ("ankle_px", "ankle_l_px", "ankle_r_px", "wrist_l_px", "wrist_r_px"):
                if k in p0 and k in p1 and p0[k] and p1[k]:
                    out[k] = [
                        (1.0 - alpha) * float(p0[k][0]) + alpha * float(p1[k][0]),
                        (1.0 - alpha) * float(p0[k][1]) + alpha * float(p1[k][1]),
                    ]
            return out

        def _interp_partner_list(list0: Optional[List[dict]], list1: Optional[List[dict]], alpha: float) -> List[dict]:
            l0 = list0 or []
            l1 = list1 or []
            if not l0 and not l1:
                return []
            if not l0:
                return l1
            if not l1:
                return l0
            if len(l0) == 1 and len(l1) == 1:
                ip = _interp_player(l0[0], l1[0], alpha)
                return [ip] if ip else []
            # Pair partners by nearest court position between frames f0 and f1
            out_list: List[dict] = []
            used_j = set()
            for p_a in l0:
                best_j = None
                best_d = 999.0
                for j, p_b in enumerate(l1):
                    if j in used_j:
                        continue
                    d = float(np.hypot(
                        float(p_a.get("court_x", 3.05)) - float(p_b.get("court_x", 3.05)),
                        float(p_a.get("court_y", 2.5)) - float(p_b.get("court_y", 2.5)),
                    ))
                    if d < best_d:
                        best_d = d
                        best_j = j
                if best_j is not None and best_d <= 2.8:
                    used_j.add(best_j)
                    ip = _interp_player(p_a, l1[best_j], alpha)
                    if ip:
                        out_list.append(ip)
                else:
                    out_list.append(p_a)
            for j, p_b in enumerate(l1):
                if j not in used_j and len(out_list) < 2:
                    out_list.append(p_b)
            return out_list[:2]

        for fn in range(start_frame, end_frame + 1):
            if fn in by_f:
                raw_f = by_f[fn]
                n_p = raw_f.get("near")
                f_p = raw_f.get("far")
                n_list = raw_f.get("near_players") or (n_p.get("partners", [n_p]) if isinstance(n_p, dict) else [])
                f_list = raw_f.get("far_players") or (f_p.get("partners", [f_p]) if isinstance(f_p, dict) else [])
                res[fn] = {
                    **raw_f,
                    "near_players": n_list,
                    "far_players": f_list,
                }
                continue
            if not known_frames:
                res[fn] = {"frame": fn, "near": None, "far": None, "near_players": [], "far_players": []}
                continue
            # Find surrounding sampled frames within +/- 4 frames (fallback +/- 14 frames on pose dropout)
            prev_candidates = [kf for kf in known_frames if kf < fn and (fn - kf) <= 4]
            if not prev_candidates:
                prev_candidates = [kf for kf in known_frames if kf < fn and (fn - kf) <= 14]
            next_candidates = [kf for kf in known_frames if kf > fn and (kf - fn) <= 4]
            if not next_candidates:
                next_candidates = [kf for kf in known_frames if kf > fn and (kf - fn) <= 14]
            f0 = prev_candidates[-1] if prev_candidates else None
            f1 = next_candidates[0] if next_candidates else None

            if f0 is not None and f1 is not None:
                alpha = (fn - f0) / float(f1 - f0)
                p0, p1 = by_f[f0], by_f[f1]
                n0_list = p0.get("near_players") or ([p0["near"]] if p0.get("near") else [])
                n1_list = p1.get("near_players") or ([p1["near"]] if p1.get("near") else [])
                f0_list = p0.get("far_players") or ([p0["far"]] if p0.get("far") else [])
                f1_list = p1.get("far_players") or ([p1["far"]] if p1.get("far") else [])
                res[fn] = {
                    "frame": fn,
                    "near": _interp_player(p0.get("near"), p1.get("near"), alpha),
                    "far": _interp_player(p0.get("far"), p1.get("far"), alpha),
                    "near_players": _interp_partner_list(n0_list, n1_list, alpha),
                    "far_players": _interp_partner_list(f0_list, f1_list, alpha),
                }
            elif f0 is not None:
                res[fn] = by_f[f0]
            elif f1 is not None:
                res[fn] = by_f[f1]
            else:
                res[fn] = {"frame": fn, "near": None, "far": None, "near_players": [], "far_players": []}

        return res

    @staticmethod
    def _closest_partner_to_shuttle(
        players: List[dict],
        fallback_single: Optional[dict],
        x: float,
        y: float,
    ) -> Tuple[float, Optional[dict]]:
        """
        Evaluates wrist-to-shuttle distance across all tracked players on a half-court
        (1 in Singles, up to 2 partners in Doubles) and returns (min_wrist_dist_px, hitting_partner_pose).
        """
        cands = list(players) if players else ([fallback_single] if fallback_single else [])
        best_dist = 999.0
        best_pose = fallback_single
        for cand in cands:
            if not cand or "wrist_l_px" not in cand or "wrist_r_px" not in cand:
                continue
            d = float(min(
                np.hypot(x - cand["wrist_l_px"][0], y - cand["wrist_l_px"][1]),
                np.hypot(x - cand["wrist_r_px"][0], y - cand["wrist_r_px"][1]),
            ))
            if d < best_dist:
                best_dist = d
                best_pose = cand
        return best_dist, best_pose

    @staticmethod
    def _refine_hit_frame_dt1(
        pts: List[dict],
        hit_idx: int,
        sy: float,
        side: Optional[str] = None,
        min_frame: Optional[int] = None,
        max_frame: Optional[int] = None,
    ) -> int:
        """
        Refines a dt=2 smoothed hit index within +/-3 visible points to the exact frame k
        that maximizes the dt=1 turning impulse weighted by wrist proximity, eliminating
        2-4 frame post-hit / pre-hit turnaround hooks.
        """
        n = len(pts)
        if n < 3 or hit_idx <= 0 or hit_idx >= n - 1:
            return hit_idx

        best_k = hit_idx
        best_score = -1.0
        lo = max(1, hit_idx - 3)
        hi = min(n - 2, hit_idx + 3)
        for k in range(lo, hi + 1):
            pk = pts[k]
            fk = int(pk["frame"])
            if min_frame is not None and fk < min_frame:
                continue
            if max_frame is not None and fk > max_frame:
                continue
            p_prev = pts[k - 1]
            p_next = pts[k + 1]
            dt1 = max(1, fk - int(p_prev["frame"]))
            dt2 = max(1, int(p_next["frame"]) - fk)
            if dt1 > 4 or dt2 > 4:
                continue

            vx1 = (float(pk["x"]) - float(p_prev["x"])) / dt1
            vy1 = (float(pk["y"]) - float(p_prev["y"])) / dt1
            vx2 = (float(p_next["x"]) - float(pk["x"])) / dt2
            vy2 = (float(p_next["y"]) - float(pk["y"])) / dt2
            dv_1 = float(np.hypot(vx2 - vx1, vy2 - vy1))

            if side == "near":
                d_w = float(pk["dn"])
            elif side == "far":
                d_w = float(pk["df"])
            else:
                d_w = float(min(pk["dn"], pk["df"]))
            wrist_weight = 1.0 / (1.0 + max(0.0, d_w - 55.0 * sy) / (210.0 * sy))
            score = dv_1 * wrist_weight
            if score > best_score:
                best_score = score
                best_k = k

        return best_k

    def _projected_net_ground_y(self, sy: float, calibrator=None) -> float:
        """Projects the BWF net floor center (y=6.70, z=0) to image row v."""
        cal = calibrator or self.calibrator
        if cal is not None and getattr(cal, "K", None) is not None and getattr(cal, "rvec", None) is not None:
            try:
                proj = cal.project_3d_to_pixel(np.array([[3.05, 6.70, 0.0]], dtype=np.float64))
                return float(proj[0, 1])
            except Exception:
                pass
        return 575.0 * sy

    def detect_rally_hits(
        self,
        vis_points: List[Tuple[int, float, float]],
        iposes: Dict[int, dict],
        start_frame: int,
        end_frame: int,
        near_player: str,
        far_player: str,
        match_type: str = "singles",
        image_width: Optional[int] = None,
        image_height: Optional[int] = None,
        calibrator=None,
    ) -> Tuple[List[dict], bool]:
        """
        Detect all hits in a single rally (Singles 1v1 or Doubles 2v2) and return (hits_list, is_partial_cut).
        Resolution- and camera-angle-independent: uses calibrated 3D court/net projections when available
        and scales spatial/velocity thresholds by `sy = eff_h / 1080.0`.
        """
        n = len(vis_points)
        if n < 3:
            return [], True

        eff_h = int(image_height or self.image_height or 1080)
        sy = max(0.35, float(eff_h) / 1080.0)
        near_y_min, far_y_max, v_net_top, serve_y_min = self._compute_calibrated_y_bounds(sy, calibrator=calibrator)
        v_net_ground = self._projected_net_ground_y(sy, calibrator=calibrator)

        is_doubles = (str(match_type).lower() == "doubles")
        min_hit_gap = 5 if is_doubles else 10
        bridge_gap = 12 if is_doubles else 20
        bridge_pad = 5 if is_doubles else 8

        pts = []
        for i, (fn, x, y) in enumerate(vis_points):
            vx_in, vy_in = 0.0, 0.0
            vx_out, vy_out = 0.0, 0.0
            if i >= 2 and (fn - vis_points[i - 2][0]) <= 4:
                dt1 = fn - vis_points[i - 2][0]
                vx_in = (x - vis_points[i - 2][1]) / dt1
                vy_in = (y - vis_points[i - 2][2]) / dt1
            elif i >= 1 and (fn - vis_points[i - 1][0]) <= 3:
                dt1 = fn - vis_points[i - 1][0]
                vx_in = (x - vis_points[i - 1][1]) / dt1
                vy_in = (y - vis_points[i - 1][2]) / dt1

            if i + 2 < n and (vis_points[i + 2][0] - fn) <= 4:
                dt2 = vis_points[i + 2][0] - fn
                vx_out = (vis_points[i + 2][1] - x) / dt2
                vy_out = (vis_points[i + 2][2] - y) / dt2
            elif i + 1 < n and (vis_points[i + 1][0] - fn) <= 3:
                dt2 = vis_points[i + 1][0] - fn
                vx_out = (vis_points[i + 1][1] - x) / dt2
                vy_out = (vis_points[i + 1][2] - y) / dt2

            dv = float(np.hypot(vx_out - vx_in, vy_out - vy_in))
            sp_in = float(np.hypot(vx_in, vy_in))
            sp_out = float(np.hypot(vx_out, vy_out))
            cos_ang = (
                float((vx_in * vx_out + vy_in * vy_out) / (sp_in * sp_out + 1e-6))
                if (sp_in > 1.0 * sy and sp_out > 1.0 * sy)
                else 0.0
            )
            fut_idx = min(n - 1, i + 6)
            fut_disp = float(np.hypot(vis_points[fut_idx][1] - x, vis_points[fut_idx][2] - y))

            p = iposes.get(fn, {"near": None, "far": None, "near_players": [], "far_players": []})
            dn, near_best_pose = self._closest_partner_to_shuttle(
                p.get("near_players") or [], p.get("near"), x, y
            )
            df, far_best_pose = self._closest_partner_to_shuttle(
                p.get("far_players") or [], p.get("far"), x, y
            )

            pts.append({
                "i": i,
                "frame": fn,
                "x": x,
                "y": y,
                "vx_in": vx_in,
                "vy_in": vy_in,
                "vx_out": vx_out,
                "vy_out": vy_out,
                "dv": dv,
                "sp_in": sp_in,
                "sp_out": sp_out,
                "cos_ang": cos_ang,
                "fut_disp": fut_disp,
                "dn": float(dn),
                "df": float(df),
                "near_pose": near_best_pose,
                "far_pose": far_best_pose,
            })

        hits = []
        is_partial = True
        # 1. Automatic serve detection: rally starts at service height (y >= serve_y_min) AND
        #    accelerates to sp_out >= 12 * sy px/frame within the first 6 visible frames near a wrist.
        if pts[0]["y"] >= serve_y_min:
            s_best = None
            for p in pts[:6]:
                if p["sp_out"] >= 12.0 * sy and min(p["dn"], p["df"]) <= 145.0 * sy:
                    cand_side = "near" if p["dn"] < p["df"] else "far"
                    # Guard against mid-rally camera cut at frame 0 where shuttle is already descending steeply from overhead
                    if cand_side == "far" and p["i"] == 0 and p["vy_out"] >= 4.5 * sy and p["y"] < v_net_top - 5.0 * sy:
                        break
                    s_best = p
                    break
            if s_best is not None:
                side = "near" if s_best["dn"] < s_best["df"] else "far"
                # Snap serve forward past any pre-serve shuttle drop (vy_in > 2*sy -> upward launch)
                s_idx = int(s_best["i"])
                best_srv_k = s_idx
                best_srv_dv1 = 0.0
                for k in range(max(1, s_idx), min(n - 2, s_idx + 6)):
                    pk = pts[k]
                    d_w = pk["dn"] if side == "near" else pk["df"]
                    if d_w > 175.0 * sy:
                        continue
                    dt1 = max(1, int(pk["frame"]) - int(pts[k - 1]["frame"]))
                    dt2 = max(1, int(pts[k + 1]["frame"]) - int(pk["frame"]))
                    if dt1 > 3 or dt2 > 3:
                        continue
                    vx1 = (pk["x"] - pts[k - 1]["x"]) / dt1
                    vy1 = (pk["y"] - pts[k - 1]["y"]) / dt1
                    vx2 = (pts[k + 1]["x"] - pk["x"]) / dt2
                    vy2 = (pts[k + 1]["y"] - pk["y"]) / dt2
                    dv1 = float(np.hypot(vx2 - vx1, vy2 - vy1))
                    if (vy1 > 1.5 * sy and vy2 < -4.0 * sy) or (dv1 >= 22.0 * sy and (vy1 * vy2 < 0 or vx1 * vx2 < 0)):
                        if dv1 > best_srv_dv1:
                            best_srv_dv1 = dv1
                            best_srv_k = k
                if best_srv_k != s_idx:
                    s_best = pts[best_srv_k]
                hits.append({**s_best, "side": side, "is_serve": True})
                is_partial = False

        # 2. Local maxima of dv with direction reversal / impulse + wrist proximity
        for i in range(2, n - 3):
            p = pts[i]
            fn = p["frame"]
            if hits and (fn - hits[0]["frame"]) < min_hit_gap:
                continue
            if (end_frame - fn) <= 12 and p["fut_disp"] < 85.0 * sy:
                continue
            in_doubles_net_zone = (
                is_doubles
                and (v_net_top - 55.0 * sy) <= p["y"] <= (v_net_ground + 40.0 * sy)
                and min(p["dn"], p["df"]) <= 170.0 * sy
            )
            min_fut_disp = 34.0 * sy if in_doubles_net_zone else 52.0 * sy
            if p["fut_disp"] < min_fut_disp or p["sp_out"] < (4.5 * sy if in_doubles_net_zone else 5.5 * sy):
                continue
            # Reject mid-air apex of high clears far from both players' wrists
            if p["y"] < min(230.0 * sy, v_net_top - 110.0 * sy) and p["vy_in"] < -2.0 * sy and p["vy_out"] > 2.0 * sy and min(p["dn"], p["df"]) > 130.0 * sy:
                continue

            if p["dv"] < pts[i - 1]["dv"] or p["dv"] < pts[i + 1]["dv"]:
                continue

            dir_change = (
                (p["vy_in"] * p["vy_out"] < 0)
                or (p["vx_in"] * p["vx_out"] < 0)
                or (p["cos_ang"] < 0.65)
                or (p["dv"] >= 18.0 * sy)
            )
            doubles_net_hit = (
                in_doubles_net_zone
                and ((p["vy_in"] * p["vy_out"] < 0) or (p["cos_ang"] < 0.45))
                and p["dv"] >= 8.5 * sy
            )
            if not doubles_net_hit and (not dir_change or p["dv"] < 11.0 * sy):
                continue

            # Allow steep near-court net kills & downward jump smashes (vy_out > 0 toward far floor)
            near_steep_attack = (
                p["dn"] <= 145.0 * sy
                and p["y"] <= v_net_top + 65.0 * sy
                and p["vy_out"] <= 28.0 * sy
                and p["dv"] >= 15.0 * sy
            )
            near_ok = (
                (p["dn"] <= 185.0 * sy)
                and (p["vy_out"] <= 6.0 * sy or near_steep_attack)
                and (p["dn"] < p["df"] + 15.0 * sy)
                and (p["y"] >= near_y_min)
            )
            far_passby = (p["vy_in"] < -15.0 * sy and p["vy_out"] < -15.0 * sy)
            far_ok = (
                (p["df"] <= 185.0 * sy)
                and (p["df"] < p["dn"] + 15.0 * sy)
                and (p["y"] <= far_y_max)
                and (not far_passby)
            )

            if not near_ok and not far_ok:
                continue
            side = "near" if (near_ok and (not far_ok or p["dn"] <= p["df"])) else "far"
            # Refine each Step-2 dt=2 peak to exact dt=1 turning impulse BEFORE deduplication
            k_ref = self._refine_hit_frame_dt1(pts, i, sy, side=side)
            p_ref = pts[k_ref]
            if hits and (p_ref["frame"] - hits[0]["frame"]) < min_hit_gap:
                continue
            hits.append({**p_ref, "side": side, "is_serve": False})

        # 3. Deduplicate detections of the same stroke within min_hit_gap frames
        hits.sort(key=lambda h: (int(h["frame"]), 0 if h.get("is_serve") else 1))
        dedup = []
        for h in hits:
            if not dedup:
                dedup.append(h)
            elif (h["frame"] - dedup[-1]["frame"]) < min_hit_gap:
                if not dedup[-1]["is_serve"] and h["dv"] > dedup[-1]["dv"]:
                    dedup[-1] = h
            else:
                dedup.append(h)

        # 4. Enforce strict alternation (near/far/near...):
        #    Bridge long same-side gaps (>= bridge_gap frames) by finding the opposite side's contact.
        final_hits = []
        for h in dedup:
            if not final_hits:
                final_hits.append(h)
                continue
            prev = final_hits[-1]
            if h["side"] != prev["side"]:
                final_hits.append(h)
            else:
                gap_f = h["frame"] - prev["frame"]
                opp_side = "far" if prev["side"] == "near" else "near"
                bridged = None
                if gap_f >= bridge_gap:
                    cands = [
                        pt
                        for pt in pts
                        if (prev["frame"] + bridge_pad) <= pt["frame"] <= (h["frame"] - bridge_pad)
                        and (
                            (pt["dn"] <= 190.0 * sy and (pt["vy_out"] <= 8.0 * sy or (pt["y"] <= v_net_top + 65.0 * sy and pt["dv"] >= 14.0 * sy)))
                            if opp_side == "near"
                            else (
                                pt["df"] <= 190.0 * sy
                                and pt["y"] <= far_y_max
                                and not (pt["vy_in"] < -15.0 * sy and pt["vy_out"] < -15.0 * sy)
                            )
                        )
                        and pt["dv"] >= 5.5 * sy
                    ]
                    if cands:
                        bridged = max(
                            cands,
                            key=lambda c: c["dv"] / max(30.0 * sy, c["dn"] if opp_side == "near" else c["df"]),
                        )
                    elif gap_f >= (24 if is_doubles else 34):
                        # Kinematic turnaround fallback when pose wrist was occluded across a long gap
                        turn_cands = [
                            pt
                            for pt in pts
                            if (prev["frame"] + bridge_pad + 2) <= pt["frame"] <= (h["frame"] - bridge_pad - 2)
                            and (
                                (pt["y"] >= near_y_min and pt["vy_out"] <= 4.0 * sy)
                                if opp_side == "near"
                                else (pt["y"] <= far_y_max and pt["vy_out"] >= -2.0 * sy)
                            )
                            and pt["dv"] >= 7.5 * sy
                        ]
                        if turn_cands:
                            bridged = max(turn_cands, key=lambda c: c["dv"])
                if bridged is not None:
                    final_hits.append({**bridged, "side": opp_side, "is_serve": False})
                    final_hits.append(h)
                else:
                    if not prev["is_serve"] and h["dv"] > prev["dv"]:
                        final_hits[-1] = h

        # Ensure opening stroke of a rally starting near service height is tagged as is_serve,
        # ONLY if the trajectory itself started at service height (pts[0]["y"] >= serve_y_min).
        if final_hits and not final_hits[0].get("is_serve", False) and pts[0]["y"] >= serve_y_min:
            f0_hit = final_hits[0]
            if (
                (f0_hit["frame"] - start_frame) <= 30
                and (f0_hit["frame"] - pts[0]["frame"]) <= 8
                and serve_y_min <= f0_hit["y"] <= (840.0 * sy)
                and not (f0_hit["side"] == "far" and f0_hit["i"] == 0 and f0_hit["vy_out"] >= 4.5 * sy and f0_hit["y"] < v_net_top - 5.0 * sy)
            ):
                f0_hit["is_serve"] = True
                is_partial = False

        # 5. dt=1 Peak-Curvature Hit Refinement for all non-serve hits (eliminates 2-4 frame turnaround hooks)
        if final_hits:
            refined_hits = []
            for h_idx, h in enumerate(final_hits):
                if h.get("is_serve", False) or "i" not in h:
                    refined_hits.append(h)
                    continue
                min_f = (int(refined_hits[-1]["frame"]) + min_hit_gap) if refined_hits else None
                max_f = (int(final_hits[h_idx + 1]["frame"]) - min_hit_gap) if (h_idx + 1) < len(final_hits) else None
                k_best = self._refine_hit_frame_dt1(
                    pts,
                    int(h["i"]),
                    sy,
                    side=h["side"],
                    min_frame=min_f,
                    max_frame=max_f,
                )
                if k_best != int(h["i"]):
                    refined_hits.append({**pts[k_best], "side": h["side"], "is_serve": False})
                else:
                    refined_hits.append(h)
            final_hits = refined_hits

        # Format output records with hitter court coordinates for Phase E 3D reconstruction
        formatted = []
        for idx, h in enumerate(final_hits, 1):
            fn = int(h["frame"])
            side = h["side"]
            opp_side = "far" if side == "near" else "near"
            player_id = near_player if side == "near" else far_player
            p_frame = iposes.get(fn, {})
            # In Doubles (2v2), use the specific partner on `side` whose wrist struck the shuttle!
            hitter_pose = h.get("near_pose" if side == "near" else "far_pose") or p_frame.get(side)
            opp_pose = h.get("far_pose" if side == "near" else "near_pose") or p_frame.get(opp_side)

            if hitter_pose:
                h_xy = [round(float(hitter_pose["court_x"]), 3), round(float(hitter_pose["court_y"]), 3)]
                ankles = [hitter_pose.get("ankle_l_px"), hitter_pose.get("ankle_r_px")]
            else:
                h_xy = [3.05, 2.50 if side == "near" else 10.90]
                ankles = [None, None]

            if opp_pose:
                o_xy = [round(float(opp_pose["court_x"]), 3), round(float(opp_pose["court_y"]), 3)]
            else:
                o_xy = [3.05, 10.90 if side == "near" else 2.50]

            near_plist = p_frame.get("near_players") or ([p_frame["near"]] if p_frame.get("near") else [])
            far_plist = p_frame.get("far_players") or ([p_frame["far"]] if p_frame.get("far") else [])
            near_players_xy = [
                [round(float(pl["court_x"]), 3), round(float(pl["court_y"]), 3)]
                for pl in near_plist[:2]
                if pl and "court_x" in pl and "court_y" in pl
            ]
            far_players_xy = [
                [round(float(pl["court_x"]), 3), round(float(pl["court_y"]), 3)]
                for pl in far_plist[:2]
                if pl and "court_x" in pl and "court_y" in pl
            ]
            if not near_players_xy:
                near_players_xy = [h_xy if side == "near" else o_xy]
            if not far_players_xy:
                far_players_xy = [h_xy if side == "far" else o_xy]

            w_dist = h["dn"] if side == "near" else h["df"]
            formatted.append({
                "hit_index": idx,
                "frame": fn,
                "time_sec": round(fn / self.fps, 3),
                "side": side,
                "player": player_id,
                "is_serve": bool(h["is_serve"]),
                "shuttle_px": [round(float(h["x"]), 1), round(float(h["y"]), 1)],
                "wrist_dist_px": round(float(w_dist), 1),
                "dv_px": round(float(h["dv"]), 1),
                "hitter_court_xy": h_xy,
                "opponent_court_xy": o_xy,
                "near_players_xy": near_players_xy,
                "far_players_xy": far_players_xy,
                "hitter_ankles_px": ankles,
            })

        return formatted, is_partial

    def detect_all_rallies(
        self,
        shuttle_csv_path: str,
        poses_by_rally: Dict[str, dict],
        rallies_segment: List[dict],
        output_json_path: Optional[str] = None,
    ) -> List[dict]:
        tracks = self.load_shuttle_csv(shuttle_csv_path)
        all_rally_hits = []

        for r in rallies_segment:
            rid = int(r["rally_id"])
            rid_key = str(rid)
            sf = int(r["start_frame"])
            ef = int(r["end_frame"])
            r_pose_info = poses_by_rally.get(rid_key, {})
            near_player = r_pose_info.get("near_player", "POPOV")
            far_player = r_pose_info.get("far_player", "LZJ")
            r_frames = r_pose_info.get("frames", [])

            iposes = self.interpolate_rally_poses(r_frames, sf, ef)
            vis = [
                (fn, tracks[fn][1], tracks[fn][2])
                for fn in range(sf, ef + 1)
                if fn in tracks and tracks[fn][0] == 1
            ]
            hits, is_partial = self.detect_rally_hits(vis, iposes, sf, ef, near_player, far_player)

            all_rally_hits.append({
                "rally_id": rid,
                "start_frame": sf,
                "end_frame": ef,
                "partial": is_partial,
                "near_player": near_player,
                "far_player": far_player,
                "hit_count": len(hits),
                "hits": hits,
            })

        if output_json_path:
            os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
            total_hits = sum(r["hit_count"] for r in all_rally_hits)
            with open(output_json_path, "w") as f:
                json.dump(
                    {
                        "fps": self.fps,
                        "rally_count": len(all_rally_hits),
                        "total_hits": total_hits,
                        "rallies": all_rally_hits,
                    },
                    f,
                    indent=2,
                )

        return all_rally_hits
