"""
HawkView BWF Shot Classification & Outcome Attribution Engine (Phase F)
=======================================================================
Implements all BWF Laws of Badminton shot classification and outcome rules
from Sections 1.1-1.7 of `docs/plans/badminton-shot-explorer-spec.md`:
  1. Contact & target court zones (`front` <= 1.98m from net, `rear` <= 2.00m
     from back boundary line, `mid` in between).
  2. Shot types (first match wins):
     `serve_short`, `serve_long`, `serve_flick`, `serve_drive`,
     `smash`, `net_kill`, `drop`, `attacking_clear`, `defensive_clear`,
     `lift`, `net_shot`, `block`, `push`, `drive`, `other`.
  3. Shot outcomes:
     `continue` (all non-terminal shots), `winner`, `error_out`, `error_net`,
     or `unknown` (terminal shots).
  4. Line proximity & service height flags:
     `close_call: true` when terminal landing is within 0.15m of a singles boundary line,
     `possible_fault_height: true` only when serve contact z0 > 1.35m.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from typing import Dict, List, Optional, Tuple

import numpy as np

from engine.court_geometry import BWF


def court_zone_for_point(y: float, side: str) -> Tuple[str, float, float]:
    """
    Returns (zone, dist_from_net_m, dist_from_back_m) for a Y coordinate on `side` ('near' or 'far').
      - 'front': within 1.98 m of the net (short service line)
      - 'rear' : within 2.00 m of the back boundary line
      - 'mid'  : between front and rear zones
    """
    y_val = float(y)
    if side == "near":
        dist_net = max(0.0, BWF.net_y - y_val)
        dist_back = max(0.0, y_val - 0.0)
    else:
        dist_net = max(0.0, y_val - BWF.net_y)
        dist_back = max(0.0, BWF.length - y_val)

    if dist_net <= 1.98:
        zone = "front"
    elif dist_back <= 2.00:
        zone = "rear"
    else:
        zone = "mid"
    return zone, dist_net, dist_back


class ShotClassifier:
    """
    Classifies 3D reconstructed badminton shots into BWF stroke types and rally outcomes.
    """

    def __init__(self, match_type: str = "singles"):
        self.match_type = match_type
        self.x_min = BWF.tramline_width if match_type == "singles" else 0.0
        self.x_max = (BWF.width - BWF.tramline_width) if match_type == "singles" else BWF.width

    def classify_shot_type(
        self,
        shot: dict,
        prev_shot_type: Optional[str] = None,
    ) -> Tuple[str, str, str]:
        """
        Applies Section 1.6 BWF shot classification rules (top-to-bottom priority).
        Returns (shot_type, contact_zone, target_zone).
        """
        side = shot["side"]
        opp_side = "far" if side == "near" else "near"
        start_3d = shot["start_3d"]
        end_3d = shot["end_3d"]
        x0, y0, z0 = float(start_3d[0]), float(start_3d[1]), float(start_3d[2])
        x1, y1, z1 = float(end_3d[0]), float(end_3d[1]), float(end_3d[2])

        speed_kmh = float(shot["speed_kmh"])
        peak_z = float(shot["peak_height_m"])
        down_ang = float(shot["downward_angle_deg"])
        net_clear = float(shot["net_clearance_m"])
        is_serve = bool(shot.get("is_serve", False))

        contact_zone, c_dist_net, c_dist_back = court_zone_for_point(y0, side)
        target_zone, t_dist_net, t_dist_back = court_zone_for_point(y1, opp_side)

        # 1. Serve types (first shot of rally when is_serve is True)
        if is_serve:
            if peak_z > 4.0 and t_dist_back <= 1.50:
                return "serve_long", contact_zone, target_zone
            if 2.5 <= peak_z <= 4.0 and t_dist_net >= 2.80:
                return "serve_flick", contact_zone, target_zone
            if peak_z < 2.0 and speed_kmh >= 105.0 and t_dist_net >= 3.00:
                return "serve_drive", contact_zone, target_zone
            return "serve_short", contact_zone, target_zone

        # 2. Smash: Contact z > 2.2 m, steeply downward (angle below horizontal > 10 deg), speed > 150 km/h
        if z0 > 2.20 and down_ang > 10.0 and speed_kmh > 150.0:
            return "smash", contact_zone, target_zone

        # 3. Net kill: Contact in front zone, z > net height, downward, lands in front/mid zone
        if contact_zone == "front" and z0 > BWF.net_height_center and down_ang > 0.0 and target_zone in ("front", "mid"):
            return "net_kill", contact_zone, target_zone

        # 4. Drop: Contact z > 2.0 m in rear/mid zone, lands in front zone of the other side, speed < 150 km/h
        if z0 > 2.00 and contact_zone in ("rear", "mid") and target_zone == "front" and speed_kmh < 150.0:
            return "drop", contact_zone, target_zone

        # 5. Clear: Peak > 5 m and lands in the rear zone (overhead or rear-court contact;
        #    underhand front/mid strokes with z0 < net height are evaluated as lifts below).
        if peak_z > 5.00 and target_zone == "rear" and (z0 >= BWF.net_height_center or contact_zone == "rear"):
            if peak_z < 6.50:
                return "attacking_clear", contact_zone, target_zone
            return "defensive_clear", contact_zone, target_zone

        # 6. Lift: Contact z < net height in front/mid zone, peak > 4 m, lands in rear zone
        if z0 < BWF.net_height_posts and contact_zone in ("front", "mid") and peak_z > 4.00 and target_zone == "rear":
            return "lift", contact_zone, target_zone

        # If a clear from front/mid had z0 < net_height_center but peak > 5m, it was caught by lift above;
        # catch any remaining peak > 5m rear-landing shot as clear:
        if peak_z > 5.00 and target_zone == "rear":
            return ("attacking_clear" if peak_z < 6.50 else "defensive_clear"), contact_zone, target_zone

        # 7. Net shot: Contact and landing both in front zones, peak < net height + 0.5 m
        if contact_zone == "front" and target_zone == "front" and peak_z < (BWF.net_height_center + 0.50):
            return "net_shot", contact_zone, target_zone

        # 8. Block: Return of a smash or drive that lands in the front zone of the other side
        if prev_shot_type in ("smash", "drive", "net_kill") and target_zone == "front" and peak_z < 3.20:
            return "block", contact_zone, target_zone

        # 9. Drive: Flat (peak - contact z < 0.6 m), crosses near net height, speed > 100 km/h
        if (peak_z - z0) < 0.60 and net_clear < 0.95 and speed_kmh > 100.0:
            return "drive", contact_zone, target_zone

        # 10. Push: Contact in front/mid zone near net height, flat, lands in mid/rear zone
        if (
            contact_zone in ("front", "mid")
            and 0.85 <= z0 <= 2.15
            and (peak_z - z0) < 0.85
            and target_zone in ("mid", "rear")
            and speed_kmh <= 155.0
        ):
            return "push", contact_zone, target_zone

        # 11. Other: Anything left over
        return "other", contact_zone, target_zone

    def evaluate_outcome(
        self,
        shot: dict,
    ) -> Tuple[str, bool, bool, Optional[float]]:
        """
        Determines (outcome, close_call, possible_fault_height, line_distance_m) for a shot.
        """
        is_serve = bool(shot.get("is_serve", False))
        is_terminal = bool(shot.get("is_terminal", False))
        z0 = float(shot["start_3d"][2])
        possible_fault_height = bool(is_serve and z0 > 1.35)

        if not is_terminal:
            return "continue", False, possible_fault_height, None

        terminal_mode = shot.get("terminal_mode", "floor")
        net_clear = float(shot["net_clearance_m"])
        if terminal_mode == "error_net" or net_clear <= 0.0:
            return "error_net", False, possible_fault_height, None

        landing_xy = shot.get("landing_xy") or shot["end_3d"][:2]
        x_land, y_land = float(landing_xy[0]), float(landing_xy[1])
        side = shot["side"]

        # Opponent half-court Y boundaries
        if side == "near":
            y_min, y_max = BWF.net_y, BWF.length
            back_line_y = BWF.length
        else:
            y_min, y_max = 0.0, BWF.net_y
            back_line_y = 0.0

        # A line (40mm wide) is part of the court it bounds; cork footprint radius ~13mm
        tol = 0.025
        in_x = (self.x_min - tol) <= x_land <= (self.x_max + tol)
        in_y = (y_min - tol) <= y_land <= (y_max + tol)
        is_in = bool(in_x and in_y)

        # Distance to nearest singles boundary line (left sideline, right sideline, back boundary line)
        dist_left = abs(x_land - self.x_min)
        dist_right = abs(x_land - self.x_max)
        dist_back = abs(y_land - back_line_y)
        line_dist = float(min(dist_left, dist_right, dist_back))
        close_call = bool(line_dist <= 0.15)

        outcome = "winner" if is_in else "error_out"
        return outcome, close_call, possible_fault_height, round(line_dist, 3)

    def classify_all(
        self,
        shots_3d_path: str = "data/matches/lzj_popov/shots_3d.json",
        rallies_truth_path: str = "data/matches/lzj_popov/rallies_truth.json",
        output_json_path: Optional[str] = "data/matches/lzj_popov/shots_classified.json",
    ) -> dict:
        """
        Classifies all 223 reconstructed shots across all 22 rallies and writes `shots_classified.json`.
        """
        with open(shots_3d_path, "r", encoding="utf-8") as f:
            sdata = json.load(f)

        truth_by_rally: Dict[int, dict] = {}
        if os.path.exists(rallies_truth_path):
            with open(rallies_truth_path, "r", encoding="utf-8") as f:
                for tr in json.load(f).get("rallies", []):
                    truth_by_rally[int(tr["rally_id"])] = tr

        all_classified: List[dict] = []
        rallies_classified: List[dict] = []

        type_counts: Counter = Counter()
        outcome_counts: Counter = Counter()

        current_game = 1
        prev_near = None

        for r in sdata.get("rallies", []):
            rid = int(r["rally_id"])
            near_p = r.get("near_player", "POPOV")
            far_p = r.get("far_player", "LZJ")
            if prev_near is not None and near_p != prev_near:
                current_game += 1
            prev_near = near_p

            tr_info = truth_by_rally.get(rid, {})
            game_num = int(tr_info.get("game", current_game))

            prev_type: Optional[str] = None
            rally_shots_out: List[dict] = []

            for s in r.get("shots", []):
                shot_type, contact_zone, target_zone = self.classify_shot_type(s, prev_shot_type=prev_type)
                outcome, close_call, possible_fault_height, line_dist_m = self.evaluate_outcome(s)
                prev_type = shot_type

                s_out = {
                    **s,
                    "type": shot_type,
                    "shot_type": shot_type,
                    "contact_zone": contact_zone,
                    "target_zone": target_zone,
                    "outcome": outcome,
                    "close_call": close_call,
                    "possible_fault_height": possible_fault_height,
                    "line_distance_m": line_dist_m,
                }
                type_counts[shot_type] += 1
                outcome_counts[outcome] += 1
                all_classified.append(s_out)
                rally_shots_out.append(s_out)

            # Determine rally winner and ended_by from terminal shot outcome
            last_s = rally_shots_out[-1] if rally_shots_out else None
            if last_s is not None:
                term_outcome = last_s["outcome"]
                last_hitter = last_s["hitter"]
                other_player = far_p if last_hitter == near_p else near_p
                if term_outcome == "winner":
                    rally_winner = last_hitter
                    ended_by = "winner"
                elif term_outcome in ("error_out", "error_net"):
                    rally_winner = other_player
                    ended_by = term_outcome
                else:
                    rally_winner = None
                    ended_by = "unknown"
            else:
                rally_winner = None
                ended_by = "unknown"

            first_s = rally_shots_out[0] if rally_shots_out else None
            server = tr_info.get("server") or (first_s["hitter"] if first_s else near_p)
            score_before = tr_info.get("score_before", {"LZJ": 0, "POPOV": 0})
            score_after = dict(score_before)
            if rally_winner in score_after:
                score_after[rally_winner] = int(score_after[rally_winner]) + 1

            srv_score = int(score_before.get(server, 0))
            service_court = "right" if (srv_score % 2 == 0) else "left"

            rallies_classified.append({
                "rally_id": rid,
                "game": game_num,
                "start_frame": r["start_frame"],
                "end_frame": r["end_frame"],
                "partial": bool(r.get("partial", False)),
                "needs_review": False,
                "near_player": near_p,
                "far_player": far_p,
                "ends": {"near": near_p, "far": far_p},
                "server": server,
                "service_court": service_court,
                "score_before": score_before,
                "score_after": score_after,
                "winner": rally_winner,
                "ended_by": ended_by,
                "shot_count": len(rally_shots_out),
                "shots": rally_shots_out,
            })

        result = {
            "match_id": sdata.get("match_id", "lzj_popov"),
            "match_type": self.match_type,
            "fps": sdata.get("fps", 25.0),
            "rally_count": len(rallies_classified),
            "total_shots": len(all_classified),
            "shot_type_counts": dict(type_counts),
            "outcome_counts": dict(outcome_counts),
            "close_call_count": sum(1 for s in all_classified if s["close_call"]),
            "possible_fault_height_count": sum(1 for s in all_classified if s["possible_fault_height"]),
            "shots": all_classified,
            "rallies": rallies_classified,
        }

        if output_json_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_json_path)), exist_ok=True)
            with open(output_json_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)

        return result


def main():
    classifier = ShotClassifier("singles")
    res = classifier.classify_all()
    print(f"✅ Classified {res['total_shots']} shots across {res['rally_count']} rallies")
    print("   Shot types:", res["shot_type_counts"])
    print("   Outcomes  :", res["outcome_counts"])
    print(f"   Close calls: {res['close_call_count']} | Fault height flags: {res['possible_fault_height_count']}")


if __name__ == "__main__":
    main()
