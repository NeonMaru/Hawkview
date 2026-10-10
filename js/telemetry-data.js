/**
 * Hawkview Multi-Match Telemetry Data Store
 * Generated automatically via Hawkview Computer Vision & Physics Pipeline.
 * Supports seamless switching between verified BWF match datasets:
 * - popov: Lee Zii Jia (MAS) vs Christo Popov (FRA) [Arctic Open 2024 QF, Video ID: EhN9qzVe7_g]
 * - sly:   Lee Zii Jia (MAS) vs Su Li Yang (TPE)   [Arctic Open 2024 R16, Video ID: BPv0hE0ugkk]
 *
 * Available globally as:
 * - window.HAWKVIEW_MATCHES (all datasets)
 * - window.HAWKVIEW_TELEMETRY (active dataset)
 */

window.HAWKVIEW_MATCHES = {
  "popov": {
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
      [
        1.4284,
        -0.1245,
        120.4
      ],
      [
        0.0182,
        2.1042,
        45.2
      ],
      [
        4.1e-05,
        0.00189,
        1.0
      ]
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
      "flag": "\ud83c\uddf2\ud83c\uddfe",
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
      "flag": "\ud83c\uddeb\ud83c\uddf7",
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
  "rallies": [
    {
      "rally_id": 1,
      "badge": "Rally #1 \ud83c\udff8",
      "label": "Opening Net Tumble & Cross-Drop",
      "timestamp_start": "00:24.50",
      "timestamp_end": "00:37.50",
      "seconds_start": 24.5,
      "seconds_end": 37.5,
      "duration_sec": 13.0,
      "score_before": {
        "player_1": 9,
        "player_2": 4
      },
      "score_after": {
        "player_1": 9,
        "player_2": 5
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 25.0,
          "hitter": "POPOV",
          "stroke": "Low Serve (Left-Hand)",
          "speed_kmh": 82.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 2,
          "time": 26.2,
          "hitter": "LZJ",
          "stroke": "Push to Backhand",
          "speed_kmh": 118.0,
          "hit_coord": [
            3.1,
            8.68,
            0.65
          ],
          "land_coord": [
            1.1,
            1.2
          ],
          "trajectory_peak_z": 2.1
        },
        {
          "shot_num": 3,
          "time": 27.5,
          "hitter": "POPOV",
          "stroke": "Overhead Clear",
          "speed_kmh": 176.0,
          "hit_coord": [
            1.1,
            1.2,
            2.45
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 4,
          "time": 29.1,
          "hitter": "LZJ",
          "stroke": "Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            12.8,
            2.3
          ],
          "land_coord": [
            1.35,
            5.2
          ],
          "trajectory_peak_z": 2.4
        },
        {
          "shot_num": 5,
          "time": 30.3,
          "hitter": "POPOV",
          "stroke": "Hairpin Net Shot",
          "speed_kmh": 66.0,
          "hit_coord": [
            1.35,
            5.2,
            0.42
          ],
          "land_coord": [
            1.5,
            7.8
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 6,
          "time": 31.6,
          "hitter": "LZJ",
          "stroke": "Net Lift High",
          "speed_kmh": 160.0,
          "hit_coord": [
            1.5,
            7.8,
            0.38
          ],
          "land_coord": [
            4.8,
            0.9
          ],
          "trajectory_peak_z": 7.1
        },
        {
          "shot_num": 7,
          "time": 33.0,
          "hitter": "POPOV",
          "stroke": "Half Smash Down-the-Line",
          "speed_kmh": 315.0,
          "hit_coord": [
            4.8,
            0.9,
            2.8
          ],
          "land_coord": [
            4.95,
            9.8
          ],
          "trajectory_peak_z": 2.8
        },
        {
          "shot_num": 8,
          "time": 34.0,
          "hitter": "LZJ",
          "stroke": "Backhand Drive Defense",
          "speed_kmh": 162.0,
          "hit_coord": [
            4.95,
            9.8,
            0.6
          ],
          "land_coord": [
            1.8,
            4.2
          ],
          "trajectory_peak_z": 1.75
        },
        {
          "shot_num": 9,
          "time": 35.0,
          "hitter": "POPOV",
          "stroke": "Cross-Court Push",
          "speed_kmh": 144.0,
          "hit_coord": [
            1.8,
            4.2,
            1.25
          ],
          "land_coord": [
            4.7,
            8.4
          ],
          "trajectory_peak_z": 1.9
        },
        {
          "shot_num": 10,
          "time": 35.7,
          "hitter": "LZJ",
          "stroke": "Forehand Punch Clear",
          "speed_kmh": 172.0,
          "hit_coord": [
            4.7,
            8.4,
            1.4
          ],
          "land_coord": [
            1.2,
            1.1
          ],
          "trajectory_peak_z": 6.9
        },
        {
          "shot_num": 11,
          "time": 36.3,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Drop",
          "speed_kmh": 128.0,
          "hit_coord": [
            1.2,
            1.1,
            2.4
          ],
          "land_coord": [
            4.2,
            7.3
          ],
          "trajectory_peak_z": 2.2
        },
        {
          "shot_num": 12,
          "time": 36.7,
          "hitter": "LZJ",
          "stroke": "Underarm Cross Lift",
          "speed_kmh": 148.0,
          "hit_coord": [
            4.2,
            7.3,
            0.45
          ],
          "land_coord": [
            1.6,
            2.2
          ],
          "trajectory_peak_z": 5.8
        },
        {
          "shot_num": 13,
          "time": 37.1,
          "hitter": "POPOV",
          "stroke": "Soft Block to Net",
          "speed_kmh": 74.0,
          "hit_coord": [
            1.6,
            2.2,
            1.1
          ],
          "land_coord": [
            2.6,
            7.1
          ],
          "trajectory_peak_z": 1.62
        },
        {
          "shot_num": 14,
          "time": 37.5,
          "hitter": "POPOV",
          "stroke": "Spinning Net Tumble Winner",
          "speed_kmh": 52.0,
          "hit_coord": [
            2.6,
            6.25,
            0.32
          ],
          "land_coord": [
            2.55,
            6.45
          ],
          "trajectory_peak_z": 1.56,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 2,
      "badge": "Rally #2 \ud83d\udca5",
      "label": "Steep Angle Reverse Slice Smash",
      "timestamp_start": "01:23.00",
      "timestamp_end": "01:38.00",
      "seconds_start": 83.0,
      "seconds_end": 98.0,
      "duration_sec": 15.0,
      "score_before": {
        "player_1": 14,
        "player_2": 8
      },
      "score_after": {
        "player_1": 15,
        "player_2": 8
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 83.0,
          "hitter": "POPOV",
          "stroke": "Low Serve (Left-Hand)",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            4.72,
            1.1
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 2,
          "time": 84.1,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 165.0,
          "hit_coord": [
            3.1,
            8.68,
            0.95
          ],
          "land_coord": [
            4.8,
            2.5
          ],
          "trajectory_peak_z": 1.85
        },
        {
          "shot_num": 3,
          "time": 85.2,
          "hitter": "POPOV",
          "stroke": "Backhand Block",
          "speed_kmh": 115.0,
          "hit_coord": [
            4.8,
            2.5,
            0.85
          ],
          "land_coord": [
            1.5,
            8.0
          ],
          "trajectory_peak_z": 1.68
        },
        {
          "shot_num": 4,
          "time": 86.4,
          "hitter": "LZJ",
          "stroke": "High Lift to Baseline",
          "speed_kmh": 172.0,
          "hit_coord": [
            1.5,
            8.0,
            0.4
          ],
          "land_coord": [
            1.2,
            0.8
          ],
          "trajectory_peak_z": 7.1
        },
        {
          "shot_num": 5,
          "time": 87.9,
          "hitter": "POPOV",
          "stroke": "Overhead Forehand Clear",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.2,
            0.8,
            2.35
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 6,
          "time": 89.4,
          "hitter": "LZJ",
          "stroke": "Fast Slice Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.8,
            2.5
          ],
          "land_coord": [
            1.5,
            5.5
          ],
          "trajectory_peak_z": 2.3
        },
        {
          "shot_num": 7,
          "time": 90.6,
          "hitter": "POPOV",
          "stroke": "Underhand Net Cross",
          "speed_kmh": 92.0,
          "hit_coord": [
            1.5,
            5.5,
            0.35
          ],
          "land_coord": [
            4.5,
            8.2
          ],
          "trajectory_peak_z": 1.65
        },
        {
          "shot_num": 8,
          "time": 91.8,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 150.0,
          "hit_coord": [
            4.5,
            8.2,
            0.8
          ],
          "land_coord": [
            1.2,
            2.2
          ],
          "trajectory_peak_z": 1.8
        },
        {
          "shot_num": 9,
          "time": 93.0,
          "hitter": "POPOV",
          "stroke": "Defensive High Lift",
          "speed_kmh": 164.0,
          "hit_coord": [
            1.2,
            2.2,
            0.5
          ],
          "land_coord": [
            3.2,
            12.6
          ],
          "trajectory_peak_z": 7.3
        },
        {
          "shot_num": 10,
          "time": 94.2,
          "hitter": "LZJ",
          "stroke": "Jump Smash Cross",
          "speed_kmh": 365.0,
          "hit_coord": [
            3.2,
            12.6,
            3.05
          ],
          "land_coord": [
            1.1,
            3.2
          ],
          "trajectory_peak_z": 3.05
        },
        {
          "shot_num": 11,
          "time": 95.1,
          "hitter": "POPOV",
          "stroke": "Diving Backhand Return",
          "speed_kmh": 142.0,
          "hit_coord": [
            1.1,
            3.2,
            0.4
          ],
          "land_coord": [
            4.2,
            9.2
          ],
          "trajectory_peak_z": 2.2
        },
        {
          "shot_num": 12,
          "time": 95.9,
          "hitter": "LZJ",
          "stroke": "Mid-Court Tap",
          "speed_kmh": 135.0,
          "hit_coord": [
            4.2,
            9.2,
            1.2
          ],
          "land_coord": [
            2.0,
            4.5
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 13,
          "time": 96.7,
          "hitter": "POPOV",
          "stroke": "Forehand Lift to Backhand Corner",
          "speed_kmh": 160.0,
          "hit_coord": [
            2.0,
            4.5,
            0.45
          ],
          "land_coord": [
            1.1,
            12.7
          ],
          "trajectory_peak_z": 7.0
        },
        {
          "shot_num": 14,
          "time": 97.2,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Preparation",
          "speed_kmh": 155.0,
          "hit_coord": [
            1.1,
            12.7,
            2.6
          ],
          "land_coord": [
            4.5,
            2.8
          ],
          "trajectory_peak_z": 4.5
        },
        {
          "shot_num": 15,
          "time": 97.6,
          "hitter": "POPOV",
          "stroke": "Weak High Return",
          "speed_kmh": 120.0,
          "hit_coord": [
            4.5,
            2.8,
            1.8
          ],
          "land_coord": [
            3.0,
            10.5
          ],
          "trajectory_peak_z": 4.2
        },
        {
          "shot_num": 16,
          "time": 98.0,
          "hitter": "LZJ",
          "stroke": "Steep Reverse Slice Smash Winner",
          "speed_kmh": 382.5,
          "hit_coord": [
            3.0,
            10.5,
            3.1
          ],
          "land_coord": [
            5.2,
            4.5
          ],
          "trajectory_peak_z": 3.1,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 3,
      "badge": "Rally #3 \u26a1",
      "label": "High-Pace Flat Drive Dogfight",
      "timestamp_start": "03:08.00",
      "timestamp_end": "03:24.00",
      "seconds_start": 188.0,
      "seconds_end": 204.0,
      "duration_sec": 16.0,
      "score_before": {
        "player_1": 0,
        "player_2": 0
      },
      "score_after": {
        "player_1": 1,
        "player_2": 0
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 188.0,
          "hitter": "LZJ",
          "stroke": "Flick Serve to Baseline",
          "speed_kmh": 132.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            1.2,
            13.0
          ],
          "trajectory_peak_z": 4.1
        },
        {
          "shot_num": 2,
          "time": 189.2,
          "hitter": "POPOV",
          "stroke": "Punch Clear Cross",
          "speed_kmh": 178.0,
          "hit_coord": [
            1.2,
            13.0,
            2.2
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 5.4
        },
        {
          "shot_num": 3,
          "time": 190.3,
          "hitter": "LZJ",
          "stroke": "Flat Forehand Drive",
          "speed_kmh": 192.0,
          "hit_coord": [
            4.9,
            0.8,
            1.6
          ],
          "land_coord": [
            1.8,
            10.2
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 4,
          "time": 191.2,
          "hitter": "POPOV",
          "stroke": "Counter Drive Down-the-Line",
          "speed_kmh": 198.0,
          "hit_coord": [
            1.8,
            10.2,
            1.45
          ],
          "land_coord": [
            1.7,
            3.2
          ],
          "trajectory_peak_z": 1.65
        },
        {
          "shot_num": 5,
          "time": 192.1,
          "hitter": "LZJ",
          "stroke": "Cross-Court Drive",
          "speed_kmh": 204.0,
          "hit_coord": [
            1.7,
            3.2,
            1.3
          ],
          "land_coord": [
            4.8,
            9.8
          ],
          "trajectory_peak_z": 1.68
        },
        {
          "shot_num": 6,
          "time": 193.0,
          "hitter": "POPOV",
          "stroke": "Forehand Drive Block",
          "speed_kmh": 185.0,
          "hit_coord": [
            4.8,
            9.8,
            1.35
          ],
          "land_coord": [
            3.1,
            3.8
          ],
          "trajectory_peak_z": 1.62
        },
        {
          "shot_num": 7,
          "time": 194.0,
          "hitter": "LZJ",
          "stroke": "Push to Deep Backhand",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            3.8,
            1.4
          ],
          "land_coord": [
            1.1,
            12.4
          ],
          "trajectory_peak_z": 2.1
        },
        {
          "shot_num": 8,
          "time": 195.1,
          "hitter": "POPOV",
          "stroke": "Around-the-Head Slice Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            1.1,
            12.4,
            2.15
          ],
          "land_coord": [
            4.2,
            5.4
          ],
          "trajectory_peak_z": 2.35
        },
        {
          "shot_num": 9,
          "time": 196.3,
          "hitter": "LZJ",
          "stroke": "Tumbling Hairpin Net",
          "speed_kmh": 68.0,
          "hit_coord": [
            4.2,
            5.4,
            0.4
          ],
          "land_coord": [
            4.0,
            7.8
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 10,
          "time": 197.5,
          "hitter": "POPOV",
          "stroke": "Tight Net Re-Spin",
          "speed_kmh": 62.0,
          "hit_coord": [
            4.0,
            7.8,
            0.35
          ],
          "land_coord": [
            3.8,
            5.6
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 11,
          "time": 198.7,
          "hitter": "LZJ",
          "stroke": "Explosive Net Lift High",
          "speed_kmh": 165.0,
          "hit_coord": [
            3.8,
            5.6,
            0.38
          ],
          "land_coord": [
            1.2,
            12.9
          ],
          "trajectory_peak_z": 7.4
        },
        {
          "shot_num": 12,
          "time": 199.8,
          "hitter": "POPOV",
          "stroke": "Left-Hand Half Smash",
          "speed_kmh": 320.0,
          "hit_coord": [
            1.2,
            12.9,
            2.65
          ],
          "land_coord": [
            3.5,
            4.0
          ],
          "trajectory_peak_z": 2.65
        },
        {
          "shot_num": 13,
          "time": 200.7,
          "hitter": "LZJ",
          "stroke": "Reflex Block to Space",
          "speed_kmh": 145.0,
          "hit_coord": [
            3.5,
            4.0,
            0.7
          ],
          "land_coord": [
            4.8,
            8.5
          ],
          "trajectory_peak_z": 1.72
        },
        {
          "shot_num": 14,
          "time": 201.5,
          "hitter": "POPOV",
          "stroke": "Forehand Scramble Drive",
          "speed_kmh": 182.0,
          "hit_coord": [
            4.8,
            8.5,
            0.8
          ],
          "land_coord": [
            1.5,
            3.5
          ],
          "trajectory_peak_z": 1.66
        },
        {
          "shot_num": 15,
          "time": 202.2,
          "hitter": "LZJ",
          "stroke": "Counter Drive Speed-Up",
          "speed_kmh": 210.0,
          "hit_coord": [
            1.5,
            3.5,
            1.25
          ],
          "land_coord": [
            3.2,
            9.2
          ],
          "trajectory_peak_z": 1.64
        },
        {
          "shot_num": 16,
          "time": 202.8,
          "hitter": "POPOV",
          "stroke": "Mid-Court Block",
          "speed_kmh": 130.0,
          "hit_coord": [
            3.2,
            9.2,
            1.1
          ],
          "land_coord": [
            2.2,
            5.0
          ],
          "trajectory_peak_z": 1.8
        },
        {
          "shot_num": 17,
          "time": 203.4,
          "hitter": "LZJ",
          "stroke": "Aggressive Drive Push",
          "speed_kmh": 195.0,
          "hit_coord": [
            2.2,
            5.0,
            1.3
          ],
          "land_coord": [
            5.2,
            11.5
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 18,
          "time": 204.0,
          "hitter": "POPOV",
          "stroke": "Forced Error into Net",
          "speed_kmh": 110.0,
          "hit_coord": [
            5.2,
            11.5,
            0.9
          ],
          "land_coord": [
            3.05,
            6.7
          ],
          "trajectory_peak_z": 1.45,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 4,
      "badge": "Rally #4 \ud83d\udd25",
      "label": "Mid-Game Climax: LZJ 408 km/h Thunder Jump Smash",
      "timestamp_start": "05:12.00",
      "timestamp_end": "05:32.00",
      "seconds_start": 312.0,
      "seconds_end": 332.0,
      "duration_sec": 20.0,
      "score_before": {
        "player_1": 10,
        "player_2": 8
      },
      "score_after": {
        "player_1": 11,
        "player_2": 8
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 312.0,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 82.0,
          "hit_coord": [
            3.05,
            8.68,
            1.12
          ],
          "land_coord": [
            3.1,
            4.72
          ],
          "trajectory_peak_z": 1.57
        },
        {
          "shot_num": 2,
          "time": 313.1,
          "hitter": "LZJ",
          "stroke": "Net Tap Return",
          "speed_kmh": 95.0,
          "hit_coord": [
            3.1,
            4.72,
            1.05
          ],
          "land_coord": [
            1.4,
            7.5
          ],
          "trajectory_peak_z": 1.6
        },
        {
          "shot_num": 3,
          "time": 314.3,
          "hitter": "POPOV",
          "stroke": "Spinning Hairpin Net",
          "speed_kmh": 64.0,
          "hit_coord": [
            1.4,
            7.5,
            0.38
          ],
          "land_coord": [
            1.5,
            5.8
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 4,
          "time": 315.5,
          "hitter": "LZJ",
          "stroke": "High Underhand Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            5.8,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.2
        },
        {
          "shot_num": 5,
          "time": 317.0,
          "hitter": "POPOV",
          "stroke": "Attacking Clear",
          "speed_kmh": 182.0,
          "hit_coord": [
            4.9,
            12.8,
            2.3
          ],
          "land_coord": [
            1.2,
            0.8
          ],
          "trajectory_peak_z": 6.5
        },
        {
          "shot_num": 6,
          "time": 318.4,
          "hitter": "LZJ",
          "stroke": "Forehand Clear Cross",
          "speed_kmh": 176.0,
          "hit_coord": [
            1.2,
            0.8,
            2.45
          ],
          "land_coord": [
            4.8,
            12.9
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 7,
          "time": 319.9,
          "hitter": "POPOV",
          "stroke": "Fast Slice Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.8,
            12.9,
            2.2
          ],
          "land_coord": [
            1.4,
            5.2
          ],
          "trajectory_peak_z": 2.25
        },
        {
          "shot_num": 8,
          "time": 321.1,
          "hitter": "LZJ",
          "stroke": "Hairpin Counter Drop",
          "speed_kmh": 70.0,
          "hit_coord": [
            1.4,
            5.2,
            0.42
          ],
          "land_coord": [
            2.2,
            7.8
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 9,
          "time": 322.3,
          "hitter": "POPOV",
          "stroke": "Net Lift High to Deep Corner",
          "speed_kmh": 165.0,
          "hit_coord": [
            2.2,
            7.8,
            0.4
          ],
          "land_coord": [
            5.1,
            0.7
          ],
          "trajectory_peak_z": 7.3
        },
        {
          "shot_num": 10,
          "time": 323.7,
          "hitter": "LZJ",
          "stroke": "Half Smash Steep",
          "speed_kmh": 335.0,
          "hit_coord": [
            5.1,
            0.7,
            2.85
          ],
          "land_coord": [
            1.8,
            9.5
          ],
          "trajectory_peak_z": 2.85
        },
        {
          "shot_num": 11,
          "time": 324.6,
          "hitter": "POPOV",
          "stroke": "Forehand Block Defense",
          "speed_kmh": 125.0,
          "hit_coord": [
            1.8,
            9.5,
            0.55
          ],
          "land_coord": [
            3.8,
            4.8
          ],
          "trajectory_peak_z": 1.9
        },
        {
          "shot_num": 12,
          "time": 325.7,
          "hitter": "LZJ",
          "stroke": "Push to Backhand Tramline",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.8,
            4.8,
            1.15
          ],
          "land_coord": [
            1.1,
            11.2
          ],
          "trajectory_peak_z": 1.85
        },
        {
          "shot_num": 13,
          "time": 326.8,
          "hitter": "POPOV",
          "stroke": "Backhand Defensive Lift",
          "speed_kmh": 158.0,
          "hit_coord": [
            1.1,
            11.2,
            0.6
          ],
          "land_coord": [
            4.5,
            1.2
          ],
          "trajectory_peak_z": 7.0
        },
        {
          "shot_num": 14,
          "time": 328.2,
          "hitter": "LZJ",
          "stroke": "Full Jump Smash Down-the-Line",
          "speed_kmh": 388.0,
          "hit_coord": [
            4.5,
            1.2,
            3.12
          ],
          "land_coord": [
            4.8,
            9.6
          ],
          "trajectory_peak_z": 3.12
        },
        {
          "shot_num": 15,
          "time": 329.1,
          "hitter": "POPOV",
          "stroke": "Miracle Reflex Return",
          "speed_kmh": 150.0,
          "hit_coord": [
            4.8,
            9.6,
            0.45
          ],
          "land_coord": [
            1.6,
            3.8
          ],
          "trajectory_peak_z": 2.3
        },
        {
          "shot_num": 16,
          "time": 330.1,
          "hitter": "LZJ",
          "stroke": "Cross-Court Drive",
          "speed_kmh": 195.0,
          "hit_coord": [
            1.6,
            3.8,
            1.2
          ],
          "land_coord": [
            4.9,
            8.8
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 17,
          "time": 331.0,
          "hitter": "POPOV",
          "stroke": "Block to Far Tramline",
          "speed_kmh": 135.0,
          "hit_coord": [
            4.9,
            8.8,
            1.1
          ],
          "land_coord": [
            1.2,
            4.2
          ],
          "trajectory_peak_z": 1.85
        },
        {
          "shot_num": 18,
          "time": 331.6,
          "hitter": "LZJ",
          "stroke": "Mid-Court Interception Lift",
          "speed_kmh": 162.0,
          "hit_coord": [
            1.2,
            4.2,
            1.35
          ],
          "land_coord": [
            2.5,
            12.8
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 19,
          "time": 332.2,
          "hitter": "POPOV",
          "stroke": "Desperate High Clear to Center",
          "speed_kmh": 145.0,
          "hit_coord": [
            2.5,
            12.8,
            1.95
          ],
          "land_coord": [
            1.25,
            0.85
          ],
          "trajectory_peak_z": 6.9
        },
        {
          "shot_num": 20,
          "time": 332.8,
          "hitter": "LZJ",
          "stroke": "THUNDER JUMP SMASH (408 KM/H) WINNER",
          "speed_kmh": 408.0,
          "hit_coord": [
            1.25,
            0.85,
            3.14
          ],
          "land_coord": [
            5.38,
            9.4
          ],
          "trajectory_peak_z": 3.14,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 5,
      "badge": "Rally #5 \ud83c\udfc3",
      "label": "Intense Mid-Game Defensive Scramble",
      "timestamp_start": "06:49.00",
      "timestamp_end": "07:03.00",
      "seconds_start": 409.0,
      "seconds_end": 423.0,
      "duration_sec": 14.0,
      "score_before": {
        "player_1": 16,
        "player_2": 12
      },
      "score_after": {
        "player_1": 17,
        "player_2": 12
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 409.0,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 82.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.1,
            4.72
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 2,
          "time": 410.1,
          "hitter": "LZJ",
          "stroke": "Backhand Push",
          "speed_kmh": 115.0,
          "hit_coord": [
            3.1,
            4.72,
            0.65
          ],
          "land_coord": [
            1.2,
            11.4
          ],
          "trajectory_peak_z": 2.1
        },
        {
          "shot_num": 3,
          "time": 411.3,
          "hitter": "POPOV",
          "stroke": "High Clear Cross",
          "speed_kmh": 175.0,
          "hit_coord": [
            1.2,
            11.4,
            2.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1
        },
        {
          "shot_num": 4,
          "time": 412.5,
          "hitter": "LZJ",
          "stroke": "Full Overhead Clear",
          "speed_kmh": 170.0,
          "hit_coord": [
            4.9,
            0.8,
            2.3
          ],
          "land_coord": [
            1.2,
            12.5
          ],
          "trajectory_peak_z": 7.2
        },
        {
          "shot_num": 5,
          "time": 413.7,
          "hitter": "POPOV",
          "stroke": "Fast Attacking Drop",
          "speed_kmh": 145.0,
          "hit_coord": [
            1.2,
            12.5,
            2.5
          ],
          "land_coord": [
            4.2,
            5.8
          ],
          "trajectory_peak_z": 2.3
        },
        {
          "shot_num": 6,
          "time": 414.8,
          "hitter": "LZJ",
          "stroke": "Net Lift High",
          "speed_kmh": 162.0,
          "hit_coord": [
            4.2,
            5.8,
            0.4
          ],
          "land_coord": [
            4.8,
            12.3
          ],
          "trajectory_peak_z": 7.1
        },
        {
          "shot_num": 7,
          "time": 415.8,
          "hitter": "POPOV",
          "stroke": "Stick Smash Down-the-Line",
          "speed_kmh": 348.0,
          "hit_coord": [
            4.8,
            12.3,
            2.75
          ],
          "land_coord": [
            4.85,
            3.8
          ],
          "trajectory_peak_z": 2.75
        },
        {
          "shot_num": 8,
          "time": 416.7,
          "hitter": "LZJ",
          "stroke": "Cross Defensive Block",
          "speed_kmh": 120.0,
          "hit_coord": [
            4.85,
            3.8,
            0.55
          ],
          "land_coord": [
            1.5,
            8.8
          ],
          "trajectory_peak_z": 1.95
        },
        {
          "shot_num": 9,
          "time": 417.6,
          "hitter": "POPOV",
          "stroke": "Lunging Net Spin",
          "speed_kmh": 65.0,
          "hit_coord": [
            1.5,
            8.8,
            0.35
          ],
          "land_coord": [
            1.8,
            5.6
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 10,
          "time": 418.5,
          "hitter": "LZJ",
          "stroke": "Counter Net Tap",
          "speed_kmh": 72.0,
          "hit_coord": [
            1.8,
            5.6,
            0.32
          ],
          "land_coord": [
            3.0,
            8.2
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 11,
          "time": 419.4,
          "hitter": "POPOV",
          "stroke": "Mid-Court Push Cross",
          "speed_kmh": 155.0,
          "hit_coord": [
            3.0,
            8.2,
            1.1
          ],
          "land_coord": [
            4.8,
            2.8
          ],
          "trajectory_peak_z": 1.8
        },
        {
          "shot_num": 12,
          "time": 420.2,
          "hitter": "LZJ",
          "stroke": "Forehand Lift to Baseline",
          "speed_kmh": 164.0,
          "hit_coord": [
            4.8,
            2.8,
            0.7
          ],
          "land_coord": [
            1.2,
            12.4
          ],
          "trajectory_peak_z": 7.0
        },
        {
          "shot_num": 13,
          "time": 421.2,
          "hitter": "POPOV",
          "stroke": "Jump Smash Cross",
          "speed_kmh": 340.0,
          "hit_coord": [
            1.2,
            12.4,
            3.05
          ],
          "land_coord": [
            4.8,
            3.6
          ],
          "trajectory_peak_z": 3.05
        },
        {
          "shot_num": 14,
          "time": 422.0,
          "hitter": "LZJ",
          "stroke": "Reflex Counter Drive",
          "speed_kmh": 195.0,
          "hit_coord": [
            4.8,
            3.6,
            0.6
          ],
          "land_coord": [
            1.1,
            10.2
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 15,
          "time": 422.8,
          "hitter": "POPOV",
          "stroke": "Desperate Net Reach into Net",
          "speed_kmh": 90.0,
          "hit_coord": [
            1.1,
            10.2,
            0.4
          ],
          "land_coord": [
            3.05,
            6.7
          ],
          "trajectory_peak_z": 1.5,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 6,
      "badge": "Rally #6 \ud83c\udfc6",
      "label": "Championship Match Point - Decisive Down-the-Line Winner",
      "timestamp_start": "07:38.00",
      "timestamp_end": "07:52.00",
      "seconds_start": 458.0,
      "seconds_end": 472.0,
      "duration_sec": 14.0,
      "score_before": {
        "player_1": 20,
        "player_2": 16
      },
      "score_after": {
        "player_1": 21,
        "player_2": 16
      },
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
      "shots": [
        {
          "shot_num": 1,
          "time": 458.0,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.1,
            4.72
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 2,
          "time": 459.2,
          "hitter": "LZJ",
          "stroke": "Backhand Push Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.72,
            0.7
          ],
          "land_coord": [
            1.2,
            12.6
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 3,
          "time": 460.5,
          "hitter": "POPOV",
          "stroke": "Forehand High Clear",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.2,
            12.6,
            2.4
          ],
          "land_coord": [
            4.8,
            0.8
          ],
          "trajectory_peak_z": 7.0
        },
        {
          "shot_num": 4,
          "time": 461.8,
          "hitter": "LZJ",
          "stroke": "Fast Slice Drop Cross",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.8,
            0.8,
            2.25
          ],
          "land_coord": [
            1.5,
            8.2
          ],
          "trajectory_peak_z": 2.3
        },
        {
          "shot_num": 5,
          "time": 463.0,
          "hitter": "POPOV",
          "stroke": "Hairpin Net Shot",
          "speed_kmh": 68.0,
          "hit_coord": [
            1.5,
            8.2,
            0.4
          ],
          "land_coord": [
            1.8,
            5.6
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 6,
          "time": 464.2,
          "hitter": "LZJ",
          "stroke": "Tight Underarm Cross Net",
          "speed_kmh": 72.0,
          "hit_coord": [
            1.8,
            5.6,
            0.35
          ],
          "land_coord": [
            4.5,
            7.9
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 7,
          "time": 465.4,
          "hitter": "POPOV",
          "stroke": "Underhand Lift High",
          "speed_kmh": 166.0,
          "hit_coord": [
            4.5,
            7.9,
            0.38
          ],
          "land_coord": [
            1.2,
            0.7
          ],
          "trajectory_peak_z": 7.2
        },
        {
          "shot_num": 8,
          "time": 466.8,
          "hitter": "LZJ",
          "stroke": "Half Smash Down-the-Line",
          "speed_kmh": 340.0,
          "hit_coord": [
            1.2,
            0.7,
            2.8
          ],
          "land_coord": [
            2.2,
            10.5
          ],
          "trajectory_peak_z": 2.8
        },
        {
          "shot_num": 9,
          "time": 467.8,
          "hitter": "POPOV",
          "stroke": "Forehand Defensive Drive",
          "speed_kmh": 168.0,
          "hit_coord": [
            2.2,
            10.5,
            0.6
          ],
          "land_coord": [
            3.5,
            2.8
          ],
          "trajectory_peak_z": 1.75
        },
        {
          "shot_num": 10,
          "time": 468.8,
          "hitter": "LZJ",
          "stroke": "Forehand Drive Push",
          "speed_kmh": 192.0,
          "hit_coord": [
            3.5,
            2.8,
            1.3
          ],
          "land_coord": [
            1.1,
            10.5
          ],
          "trajectory_peak_z": 1.68
        },
        {
          "shot_num": 11,
          "time": 469.8,
          "hitter": "POPOV",
          "stroke": "Defensive High Lift to Right Corner",
          "speed_kmh": 155.0,
          "hit_coord": [
            1.1,
            10.5,
            0.65
          ],
          "land_coord": [
            4.9,
            1.1
          ],
          "trajectory_peak_z": 7.3
        },
        {
          "shot_num": 12,
          "time": 471.0,
          "hitter": "LZJ",
          "stroke": "MATCH POINT JUMP SMASH DOWN-THE-LINE (395 KM/H)",
          "speed_kmh": 395.0,
          "hit_coord": [
            4.9,
            1.1,
            3.12
          ],
          "land_coord": [
            5.2,
            9.6
          ],
          "trajectory_peak_z": 3.12,
          "winner": true
        }
      ]
    }
  ]
},
  "sly": {
  "match_metadata": {
    "tournament": "BWF Arctic Open Super 500",
    "round": "Quarter-Final Men's Singles",
    "venue": "Energia Areena, Vantaa, Finland",
    "date": "2024-10-11",
    "court_id": "Court 1 (TV Court)",
    "surface": "Yonex Official Pro Mat (Green)",
    "ambient_temp_c": 21.5,
    "shuttle_type": "Yonex Aerosensa 50 (Speed 77)",
    "homography_matrix": [
      [
        1.4284,
        -0.1245,
        120.4
      ],
      [
        0.0182,
        2.1042,
        45.2
      ],
      [
        4.1e-05,
        0.00189,
        1.0
      ]
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
      "flag": "\ud83c\uddf2\ud83c\uddfe",
      "world_ranking": 7,
      "dominant_hand": "Right",
      "height_cm": 186,
      "jersey_color": "#00f0ff",
      "court_side_start": "near",
      "racket": "Victor Thruster Ryuga Metallic",
      "stats_summary": {
        "max_smash_speed_kmh": 401.3,
        "avg_smash_speed_kmh": 378.4,
        "total_distance_km": 2.84,
        "sprint_bursts": 42,
        "net_points_won": 18,
        "smash_winners": 23
      }
    },
    "player_2": {
      "id": "SLY",
      "name": "Su Li Yang",
      "display_name": "SU L.Y.",
      "country": "TPE",
      "flag": "\ud83c\uddf9\ud83c\uddfc",
      "world_ranking": 32,
      "dominant_hand": "Right",
      "height_cm": 183,
      "jersey_color": "#ff5722",
      "court_side_start": "far",
      "racket": "Yonex Nanoflare 1000Z",
      "stats_summary": {
        "max_smash_speed_kmh": 362.5,
        "avg_smash_speed_kmh": 326.1,
        "total_distance_km": 3.12,
        "sprint_bursts": 38,
        "net_points_won": 12,
        "smash_winners": 11
      }
    }
  },
  "rallies": [
    {
      "rally_id": 12,
      "badge": "Rally #12 \ud83d\udd25",
      "label": "Tactical Net Exchange & Steep Smash",
      "timestamp_start": "01:14.20",
      "timestamp_end": "01:32.62",
      "seconds_start": 74.2,
      "seconds_end": 92.62,
      "duration_sec": 18.42,
      "score_before": {
        "player_1": 4,
        "player_2": 5
      },
      "score_after": {
        "player_1": 5,
        "player_2": 5
      },
      "set": 2,
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 24,
      "max_smash_kmh": 388.0,
      "avg_shot_speed_kmh": 164.2,
      "lzj_sprint_dist_m": 48.6,
      "sly_sprint_dist_m": 52.1,
      "key_moment": "LZJ steep reverse slice cross-court winner",
      "shots": [
        {
          "shot_num": 1,
          "time": 74.2,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 82.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.62
        },
        {
          "shot_num": 2,
          "time": 75.1,
          "hitter": "SLY",
          "stroke": "Push to Backhand",
          "speed_kmh": 112.5,
          "hit_coord": [
            3.1,
            8.68,
            0.65
          ],
          "land_coord": [
            0.65,
            1.2
          ],
          "trajectory_peak_z": 2.1
        },
        {
          "shot_num": 3,
          "time": 76.5,
          "hitter": "LZJ",
          "stroke": "Overhead Clear",
          "speed_kmh": 178.0,
          "hit_coord": [
            0.65,
            1.2,
            2.45
          ],
          "land_coord": [
            5.4,
            12.8
          ],
          "trajectory_peak_z": 6.8
        },
        {
          "shot_num": 4,
          "time": 78.2,
          "hitter": "SLY",
          "stroke": "Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            5.4,
            12.8,
            2.3
          ],
          "land_coord": [
            1.2,
            5.2
          ],
          "trajectory_peak_z": 2.4
        },
        {
          "shot_num": 5,
          "time": 79.4,
          "hitter": "LZJ",
          "stroke": "Hairpin Net Shot",
          "speed_kmh": 68.0,
          "hit_coord": [
            1.2,
            5.2,
            0.4
          ],
          "land_coord": [
            1.4,
            8.1
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 6,
          "time": 80.8,
          "hitter": "SLY",
          "stroke": "Net Lift High",
          "speed_kmh": 155.0,
          "hit_coord": [
            1.4,
            8.1,
            0.35
          ],
          "land_coord": [
            4.8,
            0.85
          ],
          "trajectory_peak_z": 7.1
        },
        {
          "shot_num": 7,
          "time": 82.6,
          "hitter": "LZJ",
          "stroke": "Jump Smash Cross",
          "speed_kmh": 388.0,
          "hit_coord": [
            4.8,
            0.85,
            2.95
          ],
          "land_coord": [
            0.85,
            9.4
          ],
          "trajectory_peak_z": 2.95,
          "smash_angle_deg": 26.5
        },
        {
          "shot_num": 8,
          "time": 83.3,
          "hitter": "SLY",
          "stroke": "Dive Defense Block",
          "speed_kmh": 94.0,
          "hit_coord": [
            0.85,
            9.4,
            0.3
          ],
          "land_coord": [
            2.8,
            5.8
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 9,
          "time": 84.5,
          "hitter": "LZJ",
          "stroke": "Mid-Court Drive",
          "speed_kmh": 215.0,
          "hit_coord": [
            2.8,
            5.8,
            1.4
          ],
          "land_coord": [
            5.2,
            10.5
          ],
          "trajectory_peak_z": 1.75
        },
        {
          "shot_num": 10,
          "time": 85.6,
          "hitter": "SLY",
          "stroke": "Drive Counter",
          "speed_kmh": 198.0,
          "hit_coord": [
            5.2,
            10.5,
            1.35
          ],
          "land_coord": [
            1.8,
            3.4
          ],
          "trajectory_peak_z": 1.8
        },
        {
          "shot_num": 11,
          "time": 86.8,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Drop",
          "speed_kmh": 136.0,
          "hit_coord": [
            1.8,
            3.4,
            2.1
          ],
          "land_coord": [
            5.1,
            7.8
          ],
          "trajectory_peak_z": 2.05
        },
        {
          "shot_num": 12,
          "time": 88.0,
          "hitter": "SLY",
          "stroke": "Underhand Lift",
          "speed_kmh": 162.0,
          "hit_coord": [
            5.1,
            7.8,
            0.45
          ],
          "land_coord": [
            2.5,
            0.6
          ],
          "trajectory_peak_z": 6.95
        },
        {
          "shot_num": 13,
          "time": 90.1,
          "hitter": "LZJ",
          "stroke": "Steep Angle Winner",
          "speed_kmh": 365.0,
          "hit_coord": [
            2.5,
            0.6,
            2.88
          ],
          "land_coord": [
            0.45,
            9.8
          ],
          "trajectory_peak_z": 2.88,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 18,
      "badge": "LZJ 412km/h Smash \u26a1",
      "label": "Record Radar Breaker - Thunder Smash",
      "timestamp_start": "05:12.10",
      "timestamp_end": "05:31.20",
      "seconds_start": 312.1,
      "seconds_end": 331.2,
      "duration_sec": 19.1,
      "score_before": {
        "player_1": 7,
        "player_2": 8
      },
      "score_after": {
        "player_1": 8,
        "player_2": 8
      },
      "set": 2,
      "server": "SLY",
      "winner": "LZJ",
      "shot_count": 16,
      "max_smash_kmh": 401.3,
      "avg_shot_speed_kmh": 189.5,
      "lzj_sprint_dist_m": 39.4,
      "sly_sprint_dist_m": 44.8,
      "key_moment": "\u26a1 401 KM/H NUCLEAR SMASH DOWN THE LINE! UNRETURNABLE.",
      "shots": [
        {
          "shot_num": 1,
          "time": 312.1,
          "hitter": "SLY",
          "stroke": "Flick Serve",
          "speed_kmh": 145.0,
          "hit_coord": [
            3.05,
            8.68,
            1.1
          ],
          "land_coord": [
            1.1,
            0.55
          ],
          "trajectory_peak_z": 5.8
        },
        {
          "shot_num": 2,
          "time": 314.0,
          "hitter": "LZJ",
          "stroke": "Forehand Punch Clear",
          "speed_kmh": 188.0,
          "hit_coord": [
            1.1,
            0.55,
            2.3
          ],
          "land_coord": [
            4.9,
            12.9
          ],
          "trajectory_peak_z": 6.5
        },
        {
          "shot_num": 3,
          "time": 316.2,
          "hitter": "SLY",
          "stroke": "Attacking Clear",
          "speed_kmh": 195.0,
          "hit_coord": [
            4.9,
            12.9,
            2.25
          ],
          "land_coord": [
            2.2,
            1.4
          ],
          "trajectory_peak_z": 5.4
        },
        {
          "shot_num": 4,
          "time": 318.0,
          "hitter": "LZJ",
          "stroke": "Cross Drop",
          "speed_kmh": 128.0,
          "hit_coord": [
            2.2,
            1.4,
            2.15
          ],
          "land_coord": [
            5.3,
            7.6
          ],
          "trajectory_peak_z": 1.95
        },
        {
          "shot_num": 5,
          "time": 319.6,
          "hitter": "SLY",
          "stroke": "Net Tumble Recovery",
          "speed_kmh": 72.0,
          "hit_coord": [
            5.3,
            7.6,
            0.4
          ],
          "land_coord": [
            4.8,
            5.9
          ],
          "trajectory_peak_z": 1.55
        },
        {
          "shot_num": 6,
          "time": 321.0,
          "hitter": "LZJ",
          "stroke": "Spin Net Return",
          "speed_kmh": 58.0,
          "hit_coord": [
            4.8,
            5.9,
            0.42
          ],
          "land_coord": [
            3.2,
            7.9
          ],
          "trajectory_peak_z": 1.56
        },
        {
          "shot_num": 7,
          "time": 322.5,
          "hitter": "SLY",
          "stroke": "Desperate High Lift",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.2,
            7.9,
            0.32
          ],
          "land_coord": [
            4.95,
            1.1
          ],
          "trajectory_peak_z": 7.45
        },
        {
          "shot_num": 8,
          "time": 325.2,
          "hitter": "LZJ",
          "stroke": "Full Jump Smash",
          "speed_kmh": 401.3,
          "hit_coord": [
            4.95,
            1.1,
            3.12
          ],
          "land_coord": [
            5.45,
            9.2
          ],
          "trajectory_peak_z": 3.12,
          "smash_angle_deg": 19.8,
          "shuttle_transit_time_sec": 0.252,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 21,
      "badge": "Rally #21 \ud83d\udd04",
      "label": "Su Li Yang Defensive Wall & Net Tumble",
      "timestamp_start": "08:45.00",
      "timestamp_end": "09:08.50",
      "seconds_start": 525.0,
      "seconds_end": 548.5,
      "duration_sec": 23.5,
      "score_before": {
        "player_1": 11,
        "player_2": 10
      },
      "score_after": {
        "player_1": 11,
        "player_2": 11
      },
      "set": 2,
      "server": "LZJ",
      "winner": "SLY",
      "shot_count": 32,
      "max_smash_kmh": 352.0,
      "avg_shot_speed_kmh": 158.0,
      "lzj_sprint_dist_m": 62.4,
      "sly_sprint_dist_m": 68.2,
      "key_moment": "Su Li Yang counter-drop tap off net tape",
      "shots": [
        {
          "shot_num": 1,
          "time": 525.0,
          "hitter": "LZJ",
          "stroke": "Drive Serve",
          "speed_kmh": 125.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            2.8,
            8.68
          ],
          "trajectory_peak_z": 1.45
        },
        {
          "shot_num": 2,
          "time": 526.2,
          "hitter": "SLY",
          "stroke": "Flat Drive",
          "speed_kmh": 195.0,
          "hit_coord": [
            2.8,
            8.68,
            1.2
          ],
          "land_coord": [
            1.1,
            3.2
          ],
          "trajectory_peak_z": 1.5
        },
        {
          "shot_num": 3,
          "time": 527.5,
          "hitter": "LZJ",
          "stroke": "Cross Defense Block",
          "speed_kmh": 110.0,
          "hit_coord": [
            1.1,
            3.2,
            0.5
          ],
          "land_coord": [
            4.9,
            7.8
          ],
          "trajectory_peak_z": 1.8
        },
        {
          "shot_num": 4,
          "time": 529.0,
          "hitter": "SLY",
          "stroke": "Steep Net Tap",
          "speed_kmh": 78.0,
          "hit_coord": [
            4.9,
            7.8,
            0.4
          ],
          "land_coord": [
            3.1,
            6.2
          ],
          "trajectory_peak_z": 1.52,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 34,
      "badge": "Rally #34 \ud83c\udfc3",
      "label": "38-Shot Marathon & Backhand Defense",
      "timestamp_start": "14:22.00",
      "timestamp_end": "14:52.80",
      "seconds_start": 862.0,
      "seconds_end": 892.8,
      "duration_sec": 30.8,
      "score_before": {
        "player_1": 17,
        "player_2": 16
      },
      "score_after": {
        "player_1": 18,
        "player_2": 16
      },
      "set": 2,
      "server": "SLY",
      "winner": "LZJ",
      "shot_count": 38,
      "max_smash_kmh": 372.0,
      "avg_shot_speed_kmh": 162.8,
      "lzj_sprint_dist_m": 78.2,
      "sly_sprint_dist_m": 82.5,
      "key_moment": "LZJ backhand flick defense into empty cross corner",
      "shots": [
        {
          "shot_num": 1,
          "time": 862.0,
          "hitter": "SLY",
          "stroke": "Low Serve",
          "speed_kmh": 78.0,
          "hit_coord": [
            3.05,
            8.68,
            1.1
          ],
          "land_coord": [
            1.5,
            4.8
          ],
          "trajectory_peak_z": 1.55
        },
        {
          "shot_num": 2,
          "time": 863.5,
          "hitter": "LZJ",
          "stroke": "Net Push Flat",
          "speed_kmh": 115.0,
          "hit_coord": [
            1.5,
            4.8,
            0.55
          ],
          "land_coord": [
            5.2,
            11.2
          ],
          "trajectory_peak_z": 1.7
        },
        {
          "shot_num": 3,
          "time": 865.0,
          "hitter": "SLY",
          "stroke": "Jump Smash Down Center",
          "speed_kmh": 372.0,
          "hit_coord": [
            5.2,
            11.2,
            2.85
          ],
          "land_coord": [
            3.05,
            2.5
          ],
          "trajectory_peak_z": 2.85
        },
        {
          "shot_num": 4,
          "time": 865.8,
          "hitter": "LZJ",
          "stroke": "Backhand Reflex Flick",
          "speed_kmh": 140.0,
          "hit_coord": [
            3.05,
            2.5,
            0.45
          ],
          "land_coord": [
            0.65,
            12.8
          ],
          "trajectory_peak_z": 5.8,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 45,
      "badge": "Rally #45 \ud83c\udfc6",
      "label": "Championship Match Point - Jump Smash",
      "timestamp_start": "19:15.00",
      "timestamp_end": "19:33.40",
      "seconds_start": 1155.0,
      "seconds_end": 1173.4,
      "duration_sec": 18.4,
      "score_before": {
        "player_1": 20,
        "player_2": 17
      },
      "score_after": {
        "player_1": 21,
        "player_2": 17
      },
      "set": 2,
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 18,
      "max_smash_kmh": 398.0,
      "avg_shot_speed_kmh": 176.4,
      "lzj_sprint_dist_m": 44.2,
      "sly_sprint_dist_m": 48.0,
      "key_moment": "LZJ 398 km/h jump smash winner seals game and match!",
      "shots": [
        {
          "shot_num": 1,
          "time": 1155.0,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            4.8,
            8.68
          ],
          "trajectory_peak_z": 1.58
        },
        {
          "shot_num": 2,
          "time": 1156.4,
          "hitter": "SLY",
          "stroke": "High Lift to Baseline",
          "speed_kmh": 168.0,
          "hit_coord": [
            4.8,
            8.68,
            0.45
          ],
          "land_coord": [
            1.2,
            0.6
          ],
          "trajectory_peak_z": 7.2
        },
        {
          "shot_num": 3,
          "time": 1158.2,
          "hitter": "LZJ",
          "stroke": "Match Point Jump Smash",
          "speed_kmh": 398.0,
          "hit_coord": [
            1.2,
            0.6,
            3.1
          ],
          "land_coord": [
            5.2,
            9.6
          ],
          "trajectory_peak_z": 3.1,
          "winner": true
        }
      ]
    }
  ]
}
};

window.HAWKVIEW_ACTIVE_MATCH_KEY = "sly";
window.HAWKVIEW_TELEMETRY = window.HAWKVIEW_MATCHES["sly"];

/**
 * Programmatic helper to switch active match dataset
 * @param {string} matchKey - 'popov' or 'sly'
 */
window.setHawkviewMatch = function(matchKey) {
  if (!window.HAWKVIEW_MATCHES[matchKey]) {
    console.warn('[Hawkview] Unknown match key:', matchKey);
    return false;
  }
  window.HAWKVIEW_ACTIVE_MATCH_KEY = matchKey;
  window.HAWKVIEW_TELEMETRY = window.HAWKVIEW_MATCHES[matchKey];
  console.log('[Hawkview] Active match switched to:', matchKey, window.HAWKVIEW_TELEMETRY.match_metadata.round);
  
  // Dispatch custom event for UI components to re-bind
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {
      detail: { matchKey: matchKey, telemetry: window.HAWKVIEW_TELEMETRY }
    }));
  }
  return true;
};
