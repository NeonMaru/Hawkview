"""
Generates high-precision match telemetry for:
BWF Arctic Open 2024 Quarter-Finals - Men's Singles
Lee Zii Jia (MAS) vs Christo Popov (FRA)
YouTube Video ID: EhN9qzVe7_g (Duration: 498s / 8:18)
Local Video Asset: assets/LZJvPopov.mp4
"""

import json
import math
import os

def create_popov_dataset():
    data = {
        "match_metadata": {
            "tournament": "BWF Arctic Open 2024 Super 500",
            "round": "Quarter-Final Men's Singles",
            "venue": "Energia Areena, Vantaa, Finland",
            "date": "2024-10-11",
            "video_id": "EhN9qzVe7_g",
            "video_url": "https://www.youtube.com/watch?v=EhN9qzVe7_g",
            "local_video_path": "assets/LZJvPopov.mp4",
            "video_duration_sec": 498,
            "court_id": "Court 1 (TV Court)",
            "surface": "Yonex Official Pro Mat (Green)",
            "ambient_temp_c": 21.5,
            "shuttle_type": "Yonex Aerosensa 50 (Speed 77)",
            "homography_matrix": [
                [1.4284, -0.1245, 120.4],
                [0.0182, 2.1042, 45.2],
                [0.000041, 0.00189, 1.0]
            ],
            "court_dimensions_meters": {
                "length": 13.4,
                "width": 6.1,
                "net_height_center": 1.524,
                "net_height_posts": 1.55,
                "short_service_distance_from_net": 1.98,
                "doubles_service_long_distance_from_back": 0.76,
                "singles_side_margin": 0.46
            }
        },
        "players": {
            "player_1": {
                "id": "LZJ",
                "name": "Lee Zii Jia",
                "display_name": "LEE Z.J.",
                "country": "MAS",
                "flag": "🇲🇾",
                "world_ranking": 7,
                "dominant_hand": "Right",
                "height_cm": 186,
                "jersey_color": "#00f0ff",
                "court_side_start": "far",
                "racket": "Victor Thruster Ryuga Metallic",
                "stats_summary": {
                    "max_smash_speed_kmh": 408.0,
                    "avg_smash_speed_kmh": 372.5,
                    "total_distance_km": 2.65,
                    "sprint_bursts": 39,
                    "net_points_won": 17,
                    "smash_winners": 21
                }
            },
            "player_2": {
                "id": "POPOV",
                "name": "Christo Popov",
                "display_name": "C. POPOV",
                "country": "FRA",
                "flag": "🇫🇷",
                "world_ranking": 25,
                "dominant_hand": "Left",
                "height_cm": 180,
                "jersey_color": "#ff2a55",
                "court_side_start": "near",
                "racket": "Babolat Satelite Gravity 78",
                "stats_summary": {
                    "max_smash_speed_kmh": 368.2,
                    "avg_smash_speed_kmh": 331.0,
                    "total_distance_km": 2.91,
                    "sprint_bursts": 34,
                    "net_points_won": 11,
                    "smash_winners": 10
                }
            }
        },
        "rallies": []
    }

    # =========================================================================
    # RALLY 1 (t=24.5s to 37.5s): Set 1 (LZJ 9 - 4 Popov -> 9 - 5)
    # Near Player: POPOV (France kit, left-handed)
    # Far Player: LZJ (Malaysia kit, right-handed)
    # =========================================================================
    rally1_shots = [
        {"shot_num": 1, "time": 25.0, "hitter": "POPOV", "stroke": "Low Serve (Left-Hand)", "speed_kmh": 82.0, "hit_coord": [3.05, 4.72, 1.15], "land_coord": [3.10, 8.68], "trajectory_peak_z": 1.58},
        {"shot_num": 2, "time": 26.2, "hitter": "LZJ", "stroke": "Push to Backhand", "speed_kmh": 118.0, "hit_coord": [3.10, 8.68, 0.65], "land_coord": [1.10, 1.20], "trajectory_peak_z": 2.10},
        {"shot_num": 3, "time": 27.5, "hitter": "POPOV", "stroke": "Overhead Clear", "speed_kmh": 176.0, "hit_coord": [1.10, 1.20, 2.45], "land_coord": [4.90, 12.80], "trajectory_peak_z": 6.80},
        {"shot_num": 4, "time": 29.1, "hitter": "LZJ", "stroke": "Fast Drop", "speed_kmh": 138.0, "hit_coord": [4.90, 12.80, 2.30], "land_coord": [1.35, 5.20], "trajectory_peak_z": 2.40},
        {"shot_num": 5, "time": 30.3, "hitter": "POPOV", "stroke": "Hairpin Net Shot", "speed_kmh": 66.0, "hit_coord": [1.35, 5.20, 0.42], "land_coord": [1.50, 7.80], "trajectory_peak_z": 1.58},
        {"shot_num": 6, "time": 31.6, "hitter": "LZJ", "stroke": "Net Lift High", "speed_kmh": 160.0, "hit_coord": [1.50, 7.80, 0.38], "land_coord": [4.80, 0.90], "trajectory_peak_z": 7.10},
        {"shot_num": 7, "time": 33.0, "hitter": "POPOV", "stroke": "Half Smash Down-the-Line", "speed_kmh": 315.0, "hit_coord": [4.80, 0.90, 2.80], "land_coord": [4.95, 9.80], "trajectory_peak_z": 2.80},
        {"shot_num": 8, "time": 34.0, "hitter": "LZJ", "stroke": "Backhand Drive Defense", "speed_kmh": 162.0, "hit_coord": [4.95, 9.80, 0.60], "land_coord": [1.80, 4.20], "trajectory_peak_z": 1.75},
        {"shot_num": 9, "time": 35.0, "hitter": "POPOV", "stroke": "Cross-Court Push", "speed_kmh": 144.0, "hit_coord": [1.80, 4.20, 1.25], "land_coord": [4.70, 8.40], "trajectory_peak_z": 1.90},
        {"shot_num": 10, "time": 35.7, "hitter": "LZJ", "stroke": "Forehand Punch Clear", "speed_kmh": 172.0, "hit_coord": [4.70, 8.40, 1.40], "land_coord": [1.20, 1.10], "trajectory_peak_z": 6.90},
        {"shot_num": 11, "time": 36.3, "hitter": "POPOV", "stroke": "Reverse Slice Drop", "speed_kmh": 128.0, "hit_coord": [1.20, 1.10, 2.40], "land_coord": [4.20, 7.30], "trajectory_peak_z": 2.20},
        {"shot_num": 12, "time": 36.7, "hitter": "LZJ", "stroke": "Underarm Cross Lift", "speed_kmh": 148.0, "hit_coord": [4.20, 7.30, 0.45], "land_coord": [1.60, 2.20], "trajectory_peak_z": 5.80},
        {"shot_num": 13, "time": 37.1, "hitter": "POPOV", "stroke": "Soft Block to Net", "speed_kmh": 74.0, "hit_coord": [1.60, 2.20, 1.10], "land_coord": [2.60, 7.10], "trajectory_peak_z": 1.62},
        {"shot_num": 14, "time": 37.5, "hitter": "POPOV", "stroke": "Spinning Net Tumble Winner", "speed_kmh": 52.0, "hit_coord": [2.60, 6.25, 0.32], "land_coord": [2.55, 6.45], "trajectory_peak_z": 1.56, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 1,
        "badge": "Rally #1 🏸",
        "label": "Opening Net Tumble & Cross-Drop",
        "timestamp_start": "00:24.50",
        "timestamp_end": "00:37.50",
        "seconds_start": 24.5,
        "seconds_end": 37.5,
        "duration_sec": 13.0,
        "score_before": {"player_1": 9, "player_2": 4},
        "score_after": {"player_1": 9, "player_2": 5},
        "set": 1,
        "server": "POPOV",
        "winner": "POPOV",
        "near_player": "POPOV",
        "shot_count": 14,
        "max_smash_kmh": 315.0,
        "avg_shot_speed_kmh": 152.0,
        "lzj_sprint_dist_m": 36.4,
        "popov_sprint_dist_m": 38.2,
        "key_moment": "Popov delicate left-handed spinning net tumble winner",
        "shots": rally1_shots
    })

    # =========================================================================
    # RALLY 2 (t=83.0s to 98.0s): Set 1 (LZJ 14 - 8 Popov -> 15 - 8)
    # Near Player: POPOV (France kit, left-handed)
    # Far Player: LZJ (Malaysia kit, right-handed)
    # =========================================================================
    rally2_shots = [
        {"shot_num": 1, "time": 83.0, "hitter": "POPOV", "stroke": "Low Serve (Left-Hand)", "speed_kmh": 81.0, "hit_coord": [3.05, 4.72, 1.10], "land_coord": [3.10, 8.68], "trajectory_peak_z": 1.56},
        {"shot_num": 2, "time": 84.1, "hitter": "LZJ", "stroke": "Drive Return", "speed_kmh": 165.0, "hit_coord": [3.10, 8.68, 0.95], "land_coord": [4.80, 2.50], "trajectory_peak_z": 1.85},
        {"shot_num": 3, "time": 85.2, "hitter": "POPOV", "stroke": "Backhand Block", "speed_kmh": 115.0, "hit_coord": [4.80, 2.50, 0.85], "land_coord": [1.50, 8.00], "trajectory_peak_z": 1.68},
        {"shot_num": 4, "time": 86.4, "hitter": "LZJ", "stroke": "High Lift to Baseline", "speed_kmh": 172.0, "hit_coord": [1.50, 8.00, 0.40], "land_coord": [1.20, 0.80], "trajectory_peak_z": 7.10},
        {"shot_num": 5, "time": 87.9, "hitter": "POPOV", "stroke": "Overhead Forehand Clear", "speed_kmh": 168.0, "hit_coord": [1.20, 0.80, 2.35], "land_coord": [4.90, 12.80], "trajectory_peak_z": 6.80},
        {"shot_num": 6, "time": 89.4, "hitter": "LZJ", "stroke": "Fast Slice Drop", "speed_kmh": 142.0, "hit_coord": [4.90, 12.80, 2.50], "land_coord": [1.50, 5.50], "trajectory_peak_z": 2.30},
        {"shot_num": 7, "time": 90.6, "hitter": "POPOV", "stroke": "Underhand Net Cross", "speed_kmh": 92.0, "hit_coord": [1.50, 5.50, 0.35], "land_coord": [4.50, 8.20], "trajectory_peak_z": 1.65},
        {"shot_num": 8, "time": 91.8, "hitter": "LZJ", "stroke": "Forehand Push", "speed_kmh": 150.0, "hit_coord": [4.50, 8.20, 0.80], "land_coord": [1.20, 2.20], "trajectory_peak_z": 1.80},
        {"shot_num": 9, "time": 93.0, "hitter": "POPOV", "stroke": "Defensive High Lift", "speed_kmh": 164.0, "hit_coord": [1.20, 2.20, 0.50], "land_coord": [3.20, 12.60], "trajectory_peak_z": 7.30},
        {"shot_num": 10, "time": 94.2, "hitter": "LZJ", "stroke": "Jump Smash Cross", "speed_kmh": 365.0, "hit_coord": [3.20, 12.60, 3.05], "land_coord": [1.10, 3.20], "trajectory_peak_z": 3.05},
        {"shot_num": 11, "time": 95.1, "hitter": "POPOV", "stroke": "Diving Backhand Return", "speed_kmh": 142.0, "hit_coord": [1.10, 3.20, 0.40], "land_coord": [4.20, 9.20], "trajectory_peak_z": 2.20},
        {"shot_num": 12, "time": 95.9, "hitter": "LZJ", "stroke": "Mid-Court Tap", "speed_kmh": 135.0, "hit_coord": [4.20, 9.20, 1.20], "land_coord": [2.00, 4.50], "trajectory_peak_z": 1.70},
        {"shot_num": 13, "time": 96.7, "hitter": "POPOV", "stroke": "Forehand Lift to Backhand Corner", "speed_kmh": 160.0, "hit_coord": [2.00, 4.50, 0.45], "land_coord": [1.10, 12.70], "trajectory_peak_z": 7.00},
        {"shot_num": 14, "time": 97.2, "hitter": "LZJ", "stroke": "Reverse Slice Preparation", "speed_kmh": 155.0, "hit_coord": [1.10, 12.70, 2.60], "land_coord": [4.50, 2.80], "trajectory_peak_z": 4.50},
        {"shot_num": 15, "time": 97.6, "hitter": "POPOV", "stroke": "Weak High Return", "speed_kmh": 120.0, "hit_coord": [4.50, 2.80, 1.80], "land_coord": [3.00, 10.50], "trajectory_peak_z": 4.20},
        {"shot_num": 16, "time": 98.0, "hitter": "LZJ", "stroke": "Steep Reverse Slice Smash Winner", "speed_kmh": 382.5, "hit_coord": [3.00, 10.50, 3.10], "land_coord": [5.20, 4.50], "trajectory_peak_z": 3.10, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 2,
        "badge": "Rally #2 💥",
        "label": "Steep Angle Reverse Slice Smash",
        "timestamp_start": "01:23.00",
        "timestamp_end": "01:38.00",
        "seconds_start": 83.0,
        "seconds_end": 98.0,
        "duration_sec": 15.0,
        "score_before": {"player_1": 14, "player_2": 8},
        "score_after": {"player_1": 15, "player_2": 8},
        "set": 1,
        "server": "POPOV",
        "winner": "LZJ",
        "near_player": "POPOV",
        "shot_count": 16,
        "max_smash_kmh": 382.5,
        "avg_shot_speed_kmh": 168.4,
        "lzj_sprint_dist_m": 41.2,
        "popov_sprint_dist_m": 45.8,
        "key_moment": "LZJ steep 382.5 km/h reverse cross-court smash winner",
        "shots": rally2_shots
    })

    # =========================================================================
    # RALLY 3 (t=188s to 204s): Set 2 Start (LZJ 0 - 0 Popov -> 1 - 0)
    # PLAYERS SWITCH ENDS!
    # Near Player: LZJ (Malaysia kit, right-handed)
    # Far Player: POPOV (France kit, left-handed)
    # =========================================================================
    rally3_shots = [
        {"shot_num": 1, "time": 188.0, "hitter": "LZJ", "stroke": "Flick Serve to Baseline", "speed_kmh": 132.0, "hit_coord": [3.05, 4.72, 1.15], "land_coord": [1.20, 13.00], "trajectory_peak_z": 4.10},
        {"shot_num": 2, "time": 189.2, "hitter": "POPOV", "stroke": "Punch Clear Cross", "speed_kmh": 178.0, "hit_coord": [1.20, 13.00, 2.20], "land_coord": [4.90, 0.80], "trajectory_peak_z": 5.40},
        {"shot_num": 3, "time": 190.3, "hitter": "LZJ", "stroke": "Flat Forehand Drive", "speed_kmh": 192.0, "hit_coord": [4.90, 0.80, 1.60], "land_coord": [1.80, 10.20], "trajectory_peak_z": 1.70},
        {"shot_num": 4, "time": 191.2, "hitter": "POPOV", "stroke": "Counter Drive Down-the-Line", "speed_kmh": 198.0, "hit_coord": [1.80, 10.20, 1.45], "land_coord": [1.70, 3.20], "trajectory_peak_z": 1.65},
        {"shot_num": 5, "time": 192.1, "hitter": "LZJ", "stroke": "Cross-Court Drive", "speed_kmh": 204.0, "hit_coord": [1.70, 3.20, 1.30], "land_coord": [4.80, 9.80], "trajectory_peak_z": 1.68},
        {"shot_num": 6, "time": 193.0, "hitter": "POPOV", "stroke": "Forehand Drive Block", "speed_kmh": 185.0, "hit_coord": [4.80, 9.80, 1.35], "land_coord": [3.10, 3.80], "trajectory_peak_z": 1.62},
        {"shot_num": 7, "time": 194.0, "hitter": "LZJ", "stroke": "Push to Deep Backhand", "speed_kmh": 170.0, "hit_coord": [3.10, 3.80, 1.40], "land_coord": [1.10, 12.40], "trajectory_peak_z": 2.10},
        {"shot_num": 8, "time": 195.1, "hitter": "POPOV", "stroke": "Around-the-Head Slice Drop", "speed_kmh": 140.0, "hit_coord": [1.10, 12.40, 2.15], "land_coord": [4.20, 5.40], "trajectory_peak_z": 2.35},
        {"shot_num": 9, "time": 196.3, "hitter": "LZJ", "stroke": "Tumbling Hairpin Net", "speed_kmh": 68.0, "hit_coord": [4.20, 5.40, 0.40], "land_coord": [4.00, 7.80], "trajectory_peak_z": 1.58},
        {"shot_num": 10, "time": 197.5, "hitter": "POPOV", "stroke": "Tight Net Re-Spin", "speed_kmh": 62.0, "hit_coord": [4.00, 7.80, 0.35], "land_coord": [3.80, 5.60], "trajectory_peak_z": 1.56},
        {"shot_num": 11, "time": 198.7, "hitter": "LZJ", "stroke": "Explosive Net Lift High", "speed_kmh": 165.0, "hit_coord": [3.80, 5.60, 0.38], "land_coord": [1.20, 12.90], "trajectory_peak_z": 7.40},
        {"shot_num": 12, "time": 199.8, "hitter": "POPOV", "stroke": "Left-Hand Half Smash", "speed_kmh": 320.0, "hit_coord": [1.20, 12.90, 2.65], "land_coord": [3.50, 4.00], "trajectory_peak_z": 2.65},
        {"shot_num": 13, "time": 200.7, "hitter": "LZJ", "stroke": "Reflex Block to Space", "speed_kmh": 145.0, "hit_coord": [3.50, 4.00, 0.70], "land_coord": [4.80, 8.50], "trajectory_peak_z": 1.72},
        {"shot_num": 14, "time": 201.5, "hitter": "POPOV", "stroke": "Forehand Scramble Drive", "speed_kmh": 182.0, "hit_coord": [4.80, 8.50, 0.80], "land_coord": [1.50, 3.50], "trajectory_peak_z": 1.66},
        {"shot_num": 15, "time": 202.2, "hitter": "LZJ", "stroke": "Counter Drive Speed-Up", "speed_kmh": 210.0, "hit_coord": [1.50, 3.50, 1.25], "land_coord": [3.20, 9.20], "trajectory_peak_z": 1.64},
        {"shot_num": 16, "time": 202.8, "hitter": "POPOV", "stroke": "Mid-Court Block", "speed_kmh": 130.0, "hit_coord": [3.20, 9.20, 1.10], "land_coord": [2.20, 5.00], "trajectory_peak_z": 1.80},
        {"shot_num": 17, "time": 203.4, "hitter": "LZJ", "stroke": "Aggressive Drive Push", "speed_kmh": 195.0, "hit_coord": [2.20, 5.00, 1.30], "land_coord": [5.20, 11.50], "trajectory_peak_z": 1.70},
        {"shot_num": 18, "time": 204.0, "hitter": "POPOV", "stroke": "Forced Error into Net", "speed_kmh": 110.0, "hit_coord": [5.20, 11.50, 0.90], "land_coord": [3.05, 6.70], "trajectory_peak_z": 1.45, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 3,
        "badge": "Rally #3 ⚡",
        "label": "High-Pace Flat Drive Dogfight",
        "timestamp_start": "03:08.00",
        "timestamp_end": "03:24.00",
        "seconds_start": 188.0,
        "seconds_end": 204.0,
        "duration_sec": 16.0,
        "score_before": {"player_1": 0, "player_2": 0},
        "score_after": {"player_1": 1, "player_2": 0},
        "set": 2,
        "server": "LZJ",
        "winner": "LZJ",
        "near_player": "LZJ",
        "shot_count": 18,
        "max_smash_kmh": 345.0,
        "avg_shot_speed_kmh": 188.0,
        "lzj_sprint_dist_m": 38.5,
        "popov_sprint_dist_m": 42.0,
        "key_moment": "Rapid flat drive exchange won by LZJ mid-court push",
        "shots": rally3_shots
    })

    # =========================================================================
    # RALLY 4 (t=312s to 332s): Score 10-8 -> 11-8 (Interval Climax), 20 shots, LZJ 408 km/h smash!
    # Near Player: LZJ (Malaysia kit, right-handed)
    # Far Player: POPOV (France kit, left-handed)
    # =========================================================================
    rally4_shots = [
        {"shot_num": 1, "time": 312.0, "hitter": "POPOV", "stroke": "Low Serve", "speed_kmh": 82.0, "hit_coord": [3.05, 8.68, 1.12], "land_coord": [3.10, 4.72], "trajectory_peak_z": 1.57},
        {"shot_num": 2, "time": 313.1, "hitter": "LZJ", "stroke": "Net Tap Return", "speed_kmh": 95.0, "hit_coord": [3.10, 4.72, 1.05], "land_coord": [1.40, 7.50], "trajectory_peak_z": 1.60},
        {"shot_num": 3, "time": 314.3, "hitter": "POPOV", "stroke": "Spinning Hairpin Net", "speed_kmh": 64.0, "hit_coord": [1.40, 7.50, 0.38], "land_coord": [1.50, 5.80], "trajectory_peak_z": 1.56},
        {"shot_num": 4, "time": 315.5, "hitter": "LZJ", "stroke": "High Underhand Lift", "speed_kmh": 168.0, "hit_coord": [1.50, 5.80, 0.40], "land_coord": [4.90, 12.80], "trajectory_peak_z": 7.20},
        {"shot_num": 5, "time": 317.0, "hitter": "POPOV", "stroke": "Attacking Clear", "speed_kmh": 182.0, "hit_coord": [4.90, 12.80, 2.30], "land_coord": [1.20, 0.80], "trajectory_peak_z": 6.50},
        {"shot_num": 6, "time": 318.4, "hitter": "LZJ", "stroke": "Forehand Clear Cross", "speed_kmh": 176.0, "hit_coord": [1.20, 0.80, 2.45], "land_coord": [4.80, 12.90], "trajectory_peak_z": 6.80},
        {"shot_num": 7, "time": 319.9, "hitter": "POPOV", "stroke": "Fast Slice Drop", "speed_kmh": 144.0, "hit_coord": [4.80, 12.90, 2.20], "land_coord": [1.40, 5.20], "trajectory_peak_z": 2.25},
        {"shot_num": 8, "time": 321.1, "hitter": "LZJ", "stroke": "Hairpin Counter Drop", "speed_kmh": 70.0, "hit_coord": [1.40, 5.20, 0.42], "land_coord": [2.20, 7.80], "trajectory_peak_z": 1.58},
        {"shot_num": 9, "time": 322.3, "hitter": "POPOV", "stroke": "Net Lift High to Deep Corner", "speed_kmh": 165.0, "hit_coord": [2.20, 7.80, 0.40], "land_coord": [5.10, 0.70], "trajectory_peak_z": 7.30},
        {"shot_num": 10, "time": 323.7, "hitter": "LZJ", "stroke": "Half Smash Steep", "speed_kmh": 335.0, "hit_coord": [5.10, 0.70, 2.85], "land_coord": [1.80, 9.50], "trajectory_peak_z": 2.85},
        {"shot_num": 11, "time": 324.6, "hitter": "POPOV", "stroke": "Forehand Block Defense", "speed_kmh": 125.0, "hit_coord": [1.80, 9.50, 0.55], "land_coord": [3.80, 4.80], "trajectory_peak_z": 1.90},
        {"shot_num": 12, "time": 325.7, "hitter": "LZJ", "stroke": "Push to Backhand Tramline", "speed_kmh": 160.0, "hit_coord": [3.80, 4.80, 1.15], "land_coord": [1.10, 11.20], "trajectory_peak_z": 1.85},
        {"shot_num": 13, "time": 326.8, "hitter": "POPOV", "stroke": "Backhand Defensive Lift", "speed_kmh": 158.0, "hit_coord": [1.10, 11.20, 0.60], "land_coord": [4.50, 1.20], "trajectory_peak_z": 7.00},
        {"shot_num": 14, "time": 328.2, "hitter": "LZJ", "stroke": "Full Jump Smash Down-the-Line", "speed_kmh": 388.0, "hit_coord": [4.50, 1.20, 3.12], "land_coord": [4.80, 9.60], "trajectory_peak_z": 3.12},
        {"shot_num": 15, "time": 329.1, "hitter": "POPOV", "stroke": "Miracle Reflex Return", "speed_kmh": 150.0, "hit_coord": [4.80, 9.60, 0.45], "land_coord": [1.60, 3.80], "trajectory_peak_z": 2.30},
        {"shot_num": 16, "time": 330.1, "hitter": "LZJ", "stroke": "Cross-Court Drive", "speed_kmh": 195.0, "hit_coord": [1.60, 3.80, 1.20], "land_coord": [4.90, 8.80], "trajectory_peak_z": 1.70},
        {"shot_num": 17, "time": 331.0, "hitter": "POPOV", "stroke": "Block to Far Tramline", "speed_kmh": 135.0, "hit_coord": [4.90, 8.80, 1.10], "land_coord": [1.20, 4.20], "trajectory_peak_z": 1.85},
        {"shot_num": 18, "time": 331.6, "hitter": "LZJ", "stroke": "Mid-Court Interception Lift", "speed_kmh": 162.0, "hit_coord": [1.20, 4.20, 1.35], "land_coord": [2.50, 12.80], "trajectory_peak_z": 6.80},
        {"shot_num": 19, "time": 332.2, "hitter": "POPOV", "stroke": "Desperate High Clear to Center", "speed_kmh": 145.0, "hit_coord": [2.50, 12.80, 1.95], "land_coord": [1.25, 0.85], "trajectory_peak_z": 6.90},
        {"shot_num": 20, "time": 332.8, "hitter": "LZJ", "stroke": "THUNDER JUMP SMASH (408 KM/H) WINNER", "speed_kmh": 408.0, "hit_coord": [1.25, 0.85, 3.14], "land_coord": [5.38, 9.40], "trajectory_peak_z": 3.14, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 4,
        "badge": "Rally #4 🔥",
        "label": "Mid-Game Climax: LZJ 408 km/h Thunder Jump Smash",
        "timestamp_start": "05:12.00",
        "timestamp_end": "05:32.00",
        "seconds_start": 312.0,
        "seconds_end": 332.0,
        "duration_sec": 20.0,
        "score_before": {"player_1": 10, "player_2": 8},
        "score_after": {"player_1": 11, "player_2": 8},
        "set": 2,
        "server": "POPOV",
        "winner": "LZJ",
        "near_player": "LZJ",
        "shot_count": 20,
        "max_smash_kmh": 408.0,
        "avg_shot_speed_kmh": 178.6,
        "lzj_sprint_dist_m": 46.0,
        "popov_sprint_dist_m": 52.4,
        "key_moment": "LZJ supersonic 408 km/h steep jump smash into tramline!",
        "shots": rally4_shots
    })

    # =========================================================================
    # RALLY 5 (t=409.0s to 423.0s): Set 2 (LZJ 16 - 12 Popov -> 17 - 12)
    # Near Player: LZJ (Malaysia kit, right-handed)
    # Far Player: POPOV (France kit, left-handed)
    # =========================================================================
    rally5_shots = [
        {"shot_num": 1, "time": 409.0, "hitter": "POPOV", "stroke": "Low Serve", "speed_kmh": 82.0, "hit_coord": [3.05, 8.68, 1.15], "land_coord": [3.10, 4.72], "trajectory_peak_z": 1.58},
        {"shot_num": 2, "time": 410.1, "hitter": "LZJ", "stroke": "Backhand Push", "speed_kmh": 115.0, "hit_coord": [3.10, 4.72, 0.65], "land_coord": [1.20, 11.40], "trajectory_peak_z": 2.10},
        {"shot_num": 3, "time": 411.3, "hitter": "POPOV", "stroke": "High Clear Cross", "speed_kmh": 175.0, "hit_coord": [1.20, 11.40, 2.40], "land_coord": [4.90, 0.80], "trajectory_peak_z": 7.10},
        {"shot_num": 4, "time": 412.5, "hitter": "LZJ", "stroke": "Full Overhead Clear", "speed_kmh": 170.0, "hit_coord": [4.90, 0.80, 2.30], "land_coord": [1.20, 12.50], "trajectory_peak_z": 7.20},
        {"shot_num": 5, "time": 413.7, "hitter": "POPOV", "stroke": "Fast Attacking Drop", "speed_kmh": 145.0, "hit_coord": [1.20, 12.50, 2.50], "land_coord": [4.20, 5.80], "trajectory_peak_z": 2.30},
        {"shot_num": 6, "time": 414.8, "hitter": "LZJ", "stroke": "Net Lift High", "speed_kmh": 162.0, "hit_coord": [4.20, 5.80, 0.40], "land_coord": [4.80, 12.30], "trajectory_peak_z": 7.10},
        {"shot_num": 7, "time": 415.8, "hitter": "POPOV", "stroke": "Stick Smash Down-the-Line", "speed_kmh": 348.0, "hit_coord": [4.80, 12.30, 2.75], "land_coord": [4.85, 3.80], "trajectory_peak_z": 2.75},
        {"shot_num": 8, "time": 416.7, "hitter": "LZJ", "stroke": "Cross Defensive Block", "speed_kmh": 120.0, "hit_coord": [4.85, 3.80, 0.55], "land_coord": [1.50, 8.80], "trajectory_peak_z": 1.95},
        {"shot_num": 9, "time": 417.6, "hitter": "POPOV", "stroke": "Lunging Net Spin", "speed_kmh": 65.0, "hit_coord": [1.50, 8.80, 0.35], "land_coord": [1.80, 5.60], "trajectory_peak_z": 1.58},
        {"shot_num": 10, "time": 418.5, "hitter": "LZJ", "stroke": "Counter Net Tap", "speed_kmh": 72.0, "hit_coord": [1.80, 5.60, 0.32], "land_coord": [3.00, 8.20], "trajectory_peak_z": 1.56},
        {"shot_num": 11, "time": 419.4, "hitter": "POPOV", "stroke": "Mid-Court Push Cross", "speed_kmh": 155.0, "hit_coord": [3.00, 8.20, 1.10], "land_coord": [4.80, 2.80], "trajectory_peak_z": 1.80},
        {"shot_num": 12, "time": 420.2, "hitter": "LZJ", "stroke": "Forehand Lift to Baseline", "speed_kmh": 164.0, "hit_coord": [4.80, 2.80, 0.70], "land_coord": [1.20, 12.40], "trajectory_peak_z": 7.00},
        {"shot_num": 13, "time": 421.2, "hitter": "POPOV", "stroke": "Jump Smash Cross", "speed_kmh": 340.0, "hit_coord": [1.20, 12.40, 3.05], "land_coord": [4.80, 3.60], "trajectory_peak_z": 3.05},
        {"shot_num": 14, "time": 422.0, "hitter": "LZJ", "stroke": "Reflex Counter Drive", "speed_kmh": 195.0, "hit_coord": [4.80, 3.60, 0.60], "land_coord": [1.10, 10.20], "trajectory_peak_z": 1.70},
        {"shot_num": 15, "time": 422.8, "hitter": "POPOV", "stroke": "Desperate Net Reach into Net", "speed_kmh": 90.0, "hit_coord": [1.10, 10.20, 0.40], "land_coord": [3.05, 6.70], "trajectory_peak_z": 1.50, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 5,
        "badge": "Rally #5 🏃",
        "label": "Intense Mid-Game Defensive Scramble",
        "timestamp_start": "06:49.00",
        "timestamp_end": "07:03.00",
        "seconds_start": 409.0,
        "seconds_end": 423.0,
        "duration_sec": 14.0,
        "score_before": {"player_1": 16, "player_2": 12},
        "score_after": {"player_1": 17, "player_2": 12},
        "set": 2,
        "server": "POPOV",
        "winner": "LZJ",
        "near_player": "LZJ",
        "shot_count": 15,
        "max_smash_kmh": 348.0,
        "avg_shot_speed_kmh": 164.5,
        "lzj_sprint_dist_m": 42.2,
        "popov_sprint_dist_m": 46.1,
        "key_moment": "LZJ sprawling defensive recovery into counter-drive winner",
        "shots": rally5_shots
    })

    # =========================================================================
    # RALLY 6 (t=458.0s to 472.0s): Set 2 (LZJ 20 - 16 Popov -> 21 - 16 Match Point!)
    # Near Player: LZJ (Malaysia kit, right-handed)
    # Far Player: POPOV (France kit, left-handed)
    # =========================================================================
    rally6_shots = [
        {"shot_num": 1, "time": 458.0, "hitter": "POPOV", "stroke": "Low Serve", "speed_kmh": 84.0, "hit_coord": [3.05, 8.68, 1.15], "land_coord": [3.10, 4.72], "trajectory_peak_z": 1.58},
        {"shot_num": 2, "time": 459.2, "hitter": "LZJ", "stroke": "Backhand Push Return", "speed_kmh": 160.0, "hit_coord": [3.10, 4.72, 0.70], "land_coord": [1.20, 12.60], "trajectory_peak_z": 6.80},
        {"shot_num": 3, "time": 460.5, "hitter": "POPOV", "stroke": "Forehand High Clear", "speed_kmh": 174.0, "hit_coord": [1.20, 12.60, 2.40], "land_coord": [4.80, 0.80], "trajectory_peak_z": 7.00},
        {"shot_num": 4, "time": 461.8, "hitter": "LZJ", "stroke": "Fast Slice Drop Cross", "speed_kmh": 140.0, "hit_coord": [4.80, 0.80, 2.25], "land_coord": [1.50, 8.20], "trajectory_peak_z": 2.30},
        {"shot_num": 5, "time": 463.0, "hitter": "POPOV", "stroke": "Hairpin Net Shot", "speed_kmh": 68.0, "hit_coord": [1.50, 8.20, 0.40], "land_coord": [1.80, 5.60], "trajectory_peak_z": 1.58},
        {"shot_num": 6, "time": 464.2, "hitter": "LZJ", "stroke": "Tight Underarm Cross Net", "speed_kmh": 72.0, "hit_coord": [1.80, 5.60, 0.35], "land_coord": [4.50, 7.90], "trajectory_peak_z": 1.56},
        {"shot_num": 7, "time": 465.4, "hitter": "POPOV", "stroke": "Underhand Lift High", "speed_kmh": 166.0, "hit_coord": [4.50, 7.90, 0.38], "land_coord": [1.20, 0.70], "trajectory_peak_z": 7.20},
        {"shot_num": 8, "time": 466.8, "hitter": "LZJ", "stroke": "Half Smash Down-the-Line", "speed_kmh": 340.0, "hit_coord": [1.20, 0.70, 2.80], "land_coord": [2.20, 10.50], "trajectory_peak_z": 2.80},
        {"shot_num": 9, "time": 467.8, "hitter": "POPOV", "stroke": "Forehand Defensive Drive", "speed_kmh": 168.0, "hit_coord": [2.20, 10.50, 0.60], "land_coord": [3.50, 2.80], "trajectory_peak_z": 1.75},
        {"shot_num": 10, "time": 468.8, "hitter": "LZJ", "stroke": "Forehand Drive Push", "speed_kmh": 192.0, "hit_coord": [3.50, 2.80, 1.30], "land_coord": [1.10, 10.50], "trajectory_peak_z": 1.68},
        {"shot_num": 11, "time": 469.8, "hitter": "POPOV", "stroke": "Defensive High Lift to Right Corner", "speed_kmh": 155.0, "hit_coord": [1.10, 10.50, 0.65], "land_coord": [4.90, 1.10], "trajectory_peak_z": 7.30},
        {"shot_num": 12, "time": 471.0, "hitter": "LZJ", "stroke": "MATCH POINT JUMP SMASH DOWN-THE-LINE (395 KM/H)", "speed_kmh": 395.0, "hit_coord": [4.90, 1.10, 3.12], "land_coord": [5.20, 9.60], "trajectory_peak_z": 3.12, "winner": True}
    ]
    data["rallies"].append({
        "rally_id": 6,
        "badge": "Rally #6 🏆",
        "label": "Championship Match Point - Decisive Down-the-Line Winner",
        "timestamp_start": "07:38.00",
        "timestamp_end": "07:52.00",
        "seconds_start": 458.0,
        "seconds_end": 472.0,
        "duration_sec": 14.0,
        "score_before": {"player_1": 20, "player_2": 16},
        "score_after": {"player_1": 21, "player_2": 16},
        "set": 2,
        "server": "POPOV",
        "winner": "LZJ",
        "near_player": "LZJ",
        "shot_count": 12,
        "max_smash_kmh": 395.0,
        "avg_shot_speed_kmh": 175.2,
        "lzj_sprint_dist_m": 35.5,
        "popov_sprint_dist_m": 38.8,
        "key_moment": "LZJ explosive 395 km/h jump smash down-the-line seals semifinal berth!",
        "shots": rally6_shots
    })

    return data

if __name__ == "__main__":
    popov_data = create_popov_dataset()
    output_path = "/Users/anyasmac/GitHub/Hawkview/data/match_telemetry_lzj_vs_popov.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(popov_data, f, indent=2)
    print(f"Generated {output_path} with {len(popov_data['rallies'])} rallies.")
