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

    def __init__(self, fps: float = 25.0):
        self.fps = fps

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

        for fn in range(start_frame, end_frame + 1):
            if fn in by_f:
                res[fn] = by_f[fn]
                continue
            if not known_frames:
                res[fn] = {"frame": fn, "near": None, "far": None}
                continue
            # Find surrounding sampled frames within +/- 4 frames
            prev_candidates = [kf for kf in known_frames if kf < fn and (fn - kf) <= 4]
            next_candidates = [kf for kf in known_frames if kf > fn and (kf - fn) <= 4]
            f0 = prev_candidates[-1] if prev_candidates else None
            f1 = next_candidates[0] if next_candidates else None

            if f0 is not None and f1 is not None:
                alpha = (fn - f0) / float(f1 - f0)
                p0, p1 = by_f[f0], by_f[f1]
                res[fn] = {
                    "frame": fn,
                    "near": _interp_player(p0.get("near"), p1.get("near"), alpha),
                    "far": _interp_player(p0.get("far"), p1.get("far"), alpha),
                }
            elif f0 is not None:
                res[fn] = by_f[f0]
            elif f1 is not None:
                res[fn] = by_f[f1]
            else:
                res[fn] = {"frame": fn, "near": None, "far": None}

        return res

    def detect_rally_hits(
        self,
        vis_points: List[Tuple[int, float, float]],
        iposes: Dict[int, dict],
        start_frame: int,
        end_frame: int,
        near_player: str,
        far_player: str,
    ) -> Tuple[List[dict], bool]:
        """
        Detect all hits in a single rally and return (hits_list, is_partial_cut).
        """
        n = len(vis_points)
        if n < 3:
            return [], True

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
                if (sp_in > 1.0 and sp_out > 1.0)
                else 0.0
            )
            fut_idx = min(n - 1, i + 6)
            fut_disp = float(np.hypot(vis_points[fut_idx][1] - x, vis_points[fut_idx][2] - y))

            p = iposes.get(fn, {"near": None, "far": None})
            dn = (
                min(
                    np.hypot(x - p["near"]["wrist_l_px"][0], y - p["near"]["wrist_l_px"][1]),
                    np.hypot(x - p["near"]["wrist_r_px"][0], y - p["near"]["wrist_r_px"][1]),
                )
                if p.get("near")
                else 999.0
            )
            df = (
                min(
                    np.hypot(x - p["far"]["wrist_l_px"][0], y - p["far"]["wrist_l_px"][1]),
                    np.hypot(x - p["far"]["wrist_r_px"][0], y - p["far"]["wrist_r_px"][1]),
                )
                if p.get("far")
                else 999.0
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
            })

        hits = []
        is_partial = True
        # 1. Automatic serve detection: rally starts at service height (y >= 260) AND
        #    accelerates to sp_out >= 12 px/frame within the first 6 visible frames near a wrist.
        if pts[0]["y"] >= 260.0:
            s_best = None
            for p in pts[:6]:
                if p["sp_out"] >= 12.0 and min(p["dn"], p["df"]) <= 140.0:
                    s_best = p
                    break
            if s_best is not None:
                side = "near" if s_best["dn"] < s_best["df"] else "far"
                hits.append({**s_best, "side": side, "is_serve": True})
                is_partial = False

        # 2. Local maxima of dv with direction reversal / impulse + wrist proximity
        for i in range(2, n - 3):
            p = pts[i]
            fn = p["frame"]
            if hits and (fn - hits[0]["frame"]) < 10:
                continue
            if (end_frame - fn) <= 12 and p["fut_disp"] < 90.0:
                continue
            if p["fut_disp"] < 55.0 or p["sp_out"] < 6.0:
                continue
            # Reject mid-air apex of high clears far from both players' wrists
            if p["y"] < 230.0 and p["vy_in"] < -2.0 and p["vy_out"] > 2.0 and min(p["dn"], p["df"]) > 130.0:
                continue

            if p["dv"] < pts[i - 1]["dv"] or p["dv"] < pts[i + 1]["dv"]:
                continue

            dir_change = (
                (p["vy_in"] * p["vy_out"] < 0)
                or (p["vx_in"] * p["vx_out"] < 0)
                or (p["cos_ang"] < 0.65)
                or (p["dv"] >= 18.0)
            )
            if not dir_change or p["dv"] < 12.0:
                continue

            near_ok = (
                (p["dn"] <= 185.0)
                and (p["vy_out"] <= 4.0)
                and (p["dn"] < p["df"] + 15.0)
                and (p["y"] >= 300.0)
            )
            far_passby = (p["vy_in"] < -15.0 and p["vy_out"] < -15.0)
            far_ok = (
                (p["df"] <= 185.0)
                and (p["df"] < p["dn"] + 15.0)
                and (p["y"] <= 510.0)
                and (not far_passby)
            )

            if not near_ok and not far_ok:
                continue
            side = "near" if (near_ok and (not far_ok or p["dn"] <= p["df"])) else "far"
            hits.append({**p, "side": side, "is_serve": False})

        # 3. Deduplicate detections of the same stroke within 10 frames
        dedup = []
        for h in hits:
            if not dedup:
                dedup.append(h)
            elif (h["frame"] - dedup[-1]["frame"]) < 10:
                if not dedup[-1]["is_serve"] and h["dv"] > dedup[-1]["dv"]:
                    dedup[-1] = h
            else:
                dedup.append(h)

        # 4. Enforce strict alternation (near/far/near...):
        #    Bridge long same-side gaps (>= 20 frames) by finding the opposite side's contact.
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
                if gap_f >= 20:
                    cands = [
                        pt
                        for pt in pts
                        if (prev["frame"] + 8) <= pt["frame"] <= (h["frame"] - 8)
                        and (
                            (pt["dn"] <= 185.0 and pt["vy_out"] <= 6.0)
                            if opp_side == "near"
                            else (
                                pt["df"] <= 185.0
                                and pt["y"] <= 510.0
                                and not (pt["vy_in"] < -15.0 and pt["vy_out"] < -15.0)
                            )
                        )
                        and pt["dv"] >= 6.0
                    ]
                    if cands:
                        bridged = max(
                            cands,
                            key=lambda c: c["dv"] / max(30.0, c["dn"] if opp_side == "near" else c["df"]),
                        )
                if bridged is not None:
                    final_hits.append({**bridged, "side": opp_side, "is_serve": False})
                    final_hits.append(h)
                else:
                    if not prev["is_serve"] and h["dv"] > prev["dv"]:
                        final_hits[-1] = h

        # Format output records with hitter court coordinates for Phase E 3D reconstruction
        formatted = []
        for idx, h in enumerate(final_hits, 1):
            fn = int(h["frame"])
            side = h["side"]
            opp_side = "far" if side == "near" else "near"
            player_id = near_player if side == "near" else far_player
            p_frame = iposes.get(fn, {})
            hitter_pose = p_frame.get(side)
            opp_pose = p_frame.get(opp_side)

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
