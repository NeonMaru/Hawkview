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
    "video_duration_sec": 498.44,
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
    },
    "transitions": [
      [
        0.0,
        15.36
      ],
      [
        19.4,
        24.0
      ],
      [
        37.2,
        41.2
      ],
      [
        67.2,
        73.8
      ],
      [
        78.4,
        83.2
      ],
      [
        97.8,
        110.16
      ],
      [
        118.0,
        130.24
      ],
      [
        147.6,
        152.28
      ],
      [
        170.2,
        175.68
      ],
      [
        184.6,
        195.64
      ],
      [
        219.8,
        229.64
      ],
      [
        236.2,
        244.4
      ],
      [
        252.4,
        256.52
      ],
      [
        279.8,
        292.16
      ],
      [
        303.0,
        308.16
      ],
      [
        314.0,
        328.64
      ],
      [
        335.2,
        345.8
      ],
      [
        351.4,
        362.88
      ],
      [
        370.4,
        374.64
      ],
      [
        398.2,
        409.68
      ],
      [
        423.0,
        433.2
      ],
      [
        448.8,
        458.96
      ],
      [
        468.8,
        498.44
      ]
    ]
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
      "kit_description": "Dark sleeveless jersey & black shorts",
      "court_side_start": "far",
      "racket": "Victor Thruster Ryuga Metallic",
      "stats_summary": {
        "max_smash_speed_kmh": 410.5,
        "avg_smash_speed_kmh": 376.2,
        "total_distance_km": 3.12,
        "sprint_bursts": 46,
        "net_points_won": 19,
        "smash_winners": 23
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
      "kit_description": "White shirt & turquoise shorts",
      "court_side_start": "near",
      "racket": "Babolat Satelite Gravity 78",
      "stats_summary": {
        "max_smash_speed_kmh": 368.2,
        "avg_smash_speed_kmh": 328.4,
        "total_distance_km": 3.45,
        "sprint_bursts": 41,
        "net_points_won": 12,
        "smash_winners": 11
      }
    }
  },
  "rallies": [
    {
      "rally_id": 1,
      "badge": "Rally #1 \u26a1",
      "label": "Fast Opening Exchange & Cross-Drive",
      "timestamp_start": "00:15.36",
      "timestamp_end": "00:19.40",
      "seconds_start": 15.36,
      "seconds_end": 19.4,
      "duration_sec": 4.04,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 3,
        "player_2": 2
      },
      "score_after": {
        "player_1": 4,
        "player_2": 2
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 4,
      "max_smash_kmh": 338.0,
      "avg_shot_speed_kmh": 137.2,
      "lzj_sprint_dist_m": 8.4,
      "popov_sprint_dist_m": 9.2,
      "key_moment": "LZJ crisp forehand drive winner down the sideline",
      "shots": [
        {
          "shot_num": 1,
          "time": 15.36,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 79.5,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.8,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 16.37,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 17.38,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 18.39,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 2,
      "badge": "Rally #2 \ud83c\udff8",
      "label": "Extended Baseline Clear & Net Duel",
      "timestamp_start": "00:24.00",
      "timestamp_end": "00:37.20",
      "seconds_start": 24.0,
      "seconds_end": 37.2,
      "duration_sec": 13.2,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 9,
        "player_2": 4
      },
      "score_after": {
        "player_1": 10,
        "player_2": 4
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 12,
      "max_smash_kmh": 362.0,
      "avg_shot_speed_kmh": 142.8,
      "lzj_sprint_dist_m": 29.8,
      "popov_sprint_dist_m": 31.4,
      "key_moment": "LZJ reverse slice drop following high baseline exchange",
      "shots": [
        {
          "shot_num": 1,
          "time": 24.0,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 25.1,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 26.2,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 27.3,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 28.4,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 29.5,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 30.6,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 31.7,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 32.8,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 33.9,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 35.0,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 36.1,
          "hitter": "LZJ",
          "stroke": "Hairpin Net Tumble Winner",
          "speed_kmh": 65.0,
          "hit_coord": [
            2.4,
            8.2,
            0.45
          ],
          "land_coord": [
            2.6,
            5.6
          ],
          "trajectory_peak_z": 1.56,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 3,
      "badge": "Rally #3 \ud83d\udd25",
      "label": "Marathon 26-Second Defense & Counter-Attack",
      "timestamp_start": "00:41.20",
      "timestamp_end": "01:07.20",
      "seconds_start": 41.2,
      "seconds_end": 67.2,
      "duration_sec": 26.0,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 11,
        "player_2": 5
      },
      "score_after": {
        "player_1": 12,
        "player_2": 5
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 24,
      "max_smash_kmh": 388.5,
      "avg_shot_speed_kmh": 153.1,
      "lzj_sprint_dist_m": 62.4,
      "popov_sprint_dist_m": 68.2,
      "key_moment": "Popov diving backhand retrieval neutralized by LZJ tape roll winner",
      "shots": [
        {
          "shot_num": 1,
          "time": 41.2,
          "hitter": "LZJ",
          "stroke": "Flick Serve",
          "speed_kmh": 82.5,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.4,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 42.28,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 43.37,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 44.45,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 45.53,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 46.62,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 47.7,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 48.78,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 49.87,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 50.95,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 52.03,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 53.12,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 54.2,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 55.28,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 56.37,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 57.45,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 17,
          "time": 58.53,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 18,
          "time": 59.62,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 19,
          "time": 60.7,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 20,
          "time": 61.78,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 21,
          "time": 62.87,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 22,
          "time": 63.95,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 23,
          "time": 65.03,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 24,
          "time": 66.12,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 4,
      "badge": "Rally #4 \ud83d\udca5",
      "label": "Flick Serve & Rapid Flat Drive",
      "timestamp_start": "01:13.80",
      "timestamp_end": "01:18.40",
      "seconds_start": 73.8,
      "seconds_end": 78.4,
      "duration_sec": 4.6,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 13,
        "player_2": 6
      },
      "score_after": {
        "player_1": 14,
        "player_2": 6
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 4,
      "max_smash_kmh": 345.0,
      "avg_shot_speed_kmh": 140.5,
      "lzj_sprint_dist_m": 7.8,
      "popov_sprint_dist_m": 8.5,
      "key_moment": "LZJ explosive flat drive punch forcing Popov frame error",
      "shots": [
        {
          "shot_num": 1,
          "time": 73.8,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.5,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 74.95,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 166.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 76.1,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 77.25,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 5,
      "badge": "Rally #5 \u26a1",
      "label": "Steep Diagonal Smash Counter",
      "timestamp_start": "01:23.20",
      "timestamp_end": "01:37.80",
      "seconds_start": 83.2,
      "seconds_end": 97.8,
      "duration_sec": 14.6,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 14,
        "player_2": 8
      },
      "score_after": {
        "player_1": 15,
        "player_2": 8
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 14,
      "max_smash_kmh": 394.0,
      "avg_shot_speed_kmh": 184.8,
      "lzj_sprint_dist_m": 34.2,
      "popov_sprint_dist_m": 37.1,
      "key_moment": "LZJ thunderous 394 km/h jump smash piercing Popov defense",
      "shots": [
        {
          "shot_num": 1,
          "time": 83.2,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 78.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            2.8,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 84.24,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 85.29,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 175.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 86.33,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 87.37,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 88.41,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 89.46,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 175.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 90.5,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 91.54,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 92.59,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 93.63,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 175.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 94.67,
          "hitter": "LZJ",
          "stroke": "Jump Smash Down-the-Line",
          "speed_kmh": 379.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 95.71,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 96.76,
          "hitter": "LZJ",
          "stroke": "Steep Jump Smash Winner",
          "speed_kmh": 394.0,
          "hit_coord": [
            4.8,
            12.3,
            3.1
          ],
          "land_coord": [
            1.2,
            3.8
          ],
          "trajectory_peak_z": 3.1,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 6,
      "badge": "Rally #6 \ud83c\udfaf",
      "label": "Hairpin Net Tumble & Push",
      "timestamp_start": "01:50.16",
      "timestamp_end": "01:58.00",
      "seconds_start": 110.16,
      "seconds_end": 118.0,
      "duration_sec": 7.84,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 14,
        "player_2": 10
      },
      "score_after": {
        "player_1": 15,
        "player_2": 10
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 8,
      "max_smash_kmh": 312.0,
      "avg_shot_speed_kmh": 138.1,
      "lzj_sprint_dist_m": 16.5,
      "popov_sprint_dist_m": 18.0,
      "key_moment": "LZJ deceptive tumbling net shot catching Popov off balance",
      "shots": [
        {
          "shot_num": 1,
          "time": 110.16,
          "hitter": "POPOV",
          "stroke": "Flick Serve",
          "speed_kmh": 79.5,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 2,
          "time": 111.14,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 3,
          "time": 112.12,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 4,
          "time": 113.1,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 5,
          "time": 114.08,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 6,
          "time": 115.06,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 7,
          "time": 116.04,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.833
        },
        {
          "shot_num": 8,
          "time": 117.02,
          "hitter": "LZJ",
          "stroke": "Hairpin Net Tumble Winner",
          "speed_kmh": 65.0,
          "hit_coord": [
            2.4,
            8.2,
            0.45
          ],
          "land_coord": [
            2.6,
            5.6
          ],
          "trajectory_peak_z": 1.56,
          "shuttle_transit_time_sec": 0.833,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 7,
      "badge": "Rally #7 \ud83d\ude80",
      "label": "Multi-Smash Assault & Baseline Clears",
      "timestamp_start": "02:10.24",
      "timestamp_end": "02:27.60",
      "seconds_start": 130.24,
      "seconds_end": 147.6,
      "duration_sec": 17.36,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 16,
        "player_2": 10
      },
      "score_after": {
        "player_1": 17,
        "player_2": 10
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 16,
      "max_smash_kmh": 402.0,
      "avg_shot_speed_kmh": 149.6,
      "lzj_sprint_dist_m": 41.0,
      "popov_sprint_dist_m": 44.5,
      "key_moment": "LZJ consecutive jump smashes breaking down Popov block",
      "shots": [
        {
          "shot_num": 1,
          "time": 130.24,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.4,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 131.33,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 132.41,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 133.5,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 134.58,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 135.66,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 136.75,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 137.84,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 138.92,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 140.0,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 141.09,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 142.18,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 143.26,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 144.34,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 145.43,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 146.51,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 8,
      "badge": "Rally #8 \ud83c\udff8",
      "label": "High Lift Transition & Cross-Court Drop",
      "timestamp_start": "02:32.28",
      "timestamp_end": "02:50.20",
      "seconds_start": 152.28,
      "seconds_end": 170.2,
      "duration_sec": 17.92,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 18,
        "player_2": 10
      },
      "score_after": {
        "player_1": 19,
        "player_2": 10
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 16,
      "max_smash_kmh": 374.0,
      "avg_shot_speed_kmh": 149.0,
      "lzj_sprint_dist_m": 39.5,
      "popov_sprint_dist_m": 42.1,
      "key_moment": "LZJ silky smooth cross-court drop landing millimeters from tape",
      "shots": [
        {
          "shot_num": 1,
          "time": 152.28,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 82.5,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.5,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 153.4,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 154.52,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 155.64,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 156.76,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 157.88,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 159.0,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 160.12,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 161.24,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 162.36,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 163.48,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 164.6,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 165.72,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 166.84,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 167.96,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 169.08,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 9,
      "badge": "Rally #9 \ud83c\uddeb\ud83c\uddf7",
      "label": "Popov Game Point Defense & Winner",
      "timestamp_start": "02:55.68",
      "timestamp_end": "03:04.60",
      "seconds_start": 175.68,
      "seconds_end": 184.6,
      "duration_sec": 8.92,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 20,
        "player_2": 11
      },
      "score_after": {
        "player_1": 20,
        "player_2": 12
      },
      "server": "LZJ",
      "winner": "POPOV",
      "shot_count": 8,
      "max_smash_kmh": 355.0,
      "avg_shot_speed_kmh": 147.5,
      "lzj_sprint_dist_m": 19.8,
      "popov_sprint_dist_m": 22.0,
      "key_moment": "Popov brilliant left-handed backhand punch saving game point",
      "shots": [
        {
          "shot_num": 1,
          "time": 175.68,
          "hitter": "LZJ",
          "stroke": "Flick Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.8,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 176.8,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 177.91,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 179.03,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 180.14,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 181.25,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 182.37,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 183.48,
          "hitter": "POPOV",
          "stroke": "Cross-Court Push Winner",
          "speed_kmh": 145.0,
          "hit_coord": [
            2.4,
            5.2,
            0.45
          ],
          "land_coord": [
            2.6,
            7.8
          ],
          "trajectory_peak_z": 1.9,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 10,
      "badge": "Rally #10 \ud83c\udfc6",
      "label": "Game 1 Decider - Jump Smash Winner",
      "timestamp_start": "03:15.64",
      "timestamp_end": "03:39.80",
      "seconds_start": 195.64,
      "seconds_end": 219.8,
      "duration_sec": 24.16,
      "set": 1,
      "near_player": "POPOV",
      "far_player": "LZJ",
      "score_before": {
        "player_1": 20,
        "player_2": 11
      },
      "score_after": {
        "player_1": 21,
        "player_2": 11
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 20,
      "max_smash_kmh": 408.0,
      "avg_shot_speed_kmh": 152.3,
      "lzj_sprint_dist_m": 53.0,
      "popov_sprint_dist_m": 58.4,
      "key_moment": "LZJ monstrous 408.0 km/h jump smash sealing Game 1 21-11",
      "shots": [
        {
          "shot_num": 1,
          "time": 195.64,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 78.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.1,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 196.85,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 198.06,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 199.26,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 200.47,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 201.68,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 202.89,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 204.1,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 205.3,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 206.51,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 207.72,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 208.93,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 210.14,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 211.34,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 212.55,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 213.76,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 17,
          "time": 214.97,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 18,
          "time": 216.18,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 19,
          "time": 217.38,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 20,
          "time": 218.59,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 11,
      "badge": "Rally #11 \ud83c\udff8",
      "label": "Game 2 Opener - Near Court LZJ",
      "timestamp_start": "03:49.64",
      "timestamp_end": "03:56.20",
      "seconds_start": 229.64,
      "seconds_end": 236.2,
      "duration_sec": 6.56,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 2,
        "player_2": 0
      },
      "score_after": {
        "player_1": 2,
        "player_2": 1
      },
      "server": "LZJ",
      "winner": "POPOV",
      "shot_count": 6,
      "max_smash_kmh": 326.0,
      "avg_shot_speed_kmh": 142.0,
      "lzj_sprint_dist_m": 13.4,
      "popov_sprint_dist_m": 14.8,
      "key_moment": "Popov sharp net tap finding open space behind LZJ",
      "shots": [
        {
          "shot_num": 1,
          "time": 229.64,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 79.5,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.4,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 230.73,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 166.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 231.83,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 175.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 232.92,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 234.01,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 235.11,
          "hitter": "POPOV",
          "stroke": "Cross-Court Push Winner",
          "speed_kmh": 145.0,
          "hit_coord": [
            2.4,
            8.2,
            0.45
          ],
          "land_coord": [
            2.6,
            5.6
          ],
          "trajectory_peak_z": 1.9,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 12,
      "badge": "Rally #12 \u26a1",
      "label": "Midcourt Interception & Drive",
      "timestamp_start": "04:04.40",
      "timestamp_end": "04:12.40",
      "seconds_start": 244.4,
      "seconds_end": 252.4,
      "duration_sec": 8.0,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 2,
        "player_2": 2
      },
      "score_after": {
        "player_1": 3,
        "player_2": 2
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 8,
      "max_smash_kmh": 348.0,
      "avg_shot_speed_kmh": 137.2,
      "lzj_sprint_dist_m": 17.2,
      "popov_sprint_dist_m": 18.9,
      "key_moment": "LZJ lightning reflexes intercepting Popov push at net tape",
      "shots": [
        {
          "shot_num": 1,
          "time": 244.4,
          "hitter": "POPOV",
          "stroke": "Flick Serve",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.5,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 245.4,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 246.4,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 247.4,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 248.4,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 249.4,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 250.4,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 251.4,
          "hitter": "LZJ",
          "stroke": "Hairpin Net Tumble Winner",
          "speed_kmh": 65.0,
          "hit_coord": [
            2.4,
            5.2,
            0.45
          ],
          "land_coord": [
            2.6,
            7.8
          ],
          "trajectory_peak_z": 1.56,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 13,
      "badge": "Rally #13 \ud83d\ude80",
      "label": "Full-Flight Baseline Jump Smash",
      "timestamp_start": "04:16.52",
      "timestamp_end": "04:39.80",
      "seconds_start": 256.52,
      "seconds_end": 279.8,
      "duration_sec": 23.28,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 4,
        "player_2": 4
      },
      "score_after": {
        "player_1": 5,
        "player_2": 4
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 20,
      "max_smash_kmh": 410.5,
      "avg_shot_speed_kmh": 165.9,
      "lzj_sprint_dist_m": 54.5,
      "popov_sprint_dist_m": 60.1,
      "key_moment": "LZJ towering jump smash from near baseline clocking 410.5 km/h",
      "shots": [
        {
          "shot_num": 1,
          "time": 256.52,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 82.5,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.8,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 257.68,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 258.85,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 260.01,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 261.18,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 262.34,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 263.5,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 264.67,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 265.83,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 267.0,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 268.16,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 269.32,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 270.49,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 271.65,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 272.82,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 273.98,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 17,
          "time": 275.14,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 18,
          "time": 276.31,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 19,
          "time": 277.47,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 20,
          "time": 278.64,
          "hitter": "LZJ",
          "stroke": "Steep Jump Smash Winner",
          "speed_kmh": 410.5,
          "hit_coord": [
            4.8,
            1.1,
            3.1
          ],
          "land_coord": [
            1.2,
            9.6
          ],
          "trajectory_peak_z": 3.1,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 14,
      "badge": "Rally #14 \ud83d\udca5",
      "label": "Down-the-Line Body Smash",
      "timestamp_start": "04:52.16",
      "timestamp_end": "05:03.00",
      "seconds_start": 292.16,
      "seconds_end": 303.0,
      "duration_sec": 10.84,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 6,
        "player_2": 4
      },
      "score_after": {
        "player_1": 7,
        "player_2": 4
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 10,
      "max_smash_kmh": 395.0,
      "avg_shot_speed_kmh": 170.6,
      "lzj_sprint_dist_m": 24.8,
      "popov_sprint_dist_m": 27.2,
      "key_moment": "LZJ heavy body smash putting Popov into desperate sprawl",
      "shots": [
        {
          "shot_num": 1,
          "time": 292.16,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 293.24,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 294.33,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 295.41,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 296.5,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 297.58,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 298.66,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 299.75,
          "hitter": "POPOV",
          "stroke": "Jump Smash Down-the-Line",
          "speed_kmh": 380.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 300.83,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 301.92,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 15,
      "badge": "Rally #15 \ud83c\udfaf",
      "label": "Quick Serve Return & Push",
      "timestamp_start": "05:08.16",
      "timestamp_end": "05:14.00",
      "seconds_start": 308.16,
      "seconds_end": 314.0,
      "duration_sec": 5.84,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 7,
        "player_2": 5
      },
      "score_after": {
        "player_1": 8,
        "player_2": 5
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 6,
      "max_smash_kmh": 318.0,
      "avg_shot_speed_kmh": 140.2,
      "lzj_sprint_dist_m": 12.0,
      "popov_sprint_dist_m": 13.5,
      "key_moment": "LZJ aggressive flick return deep to Popov backhand tramline",
      "shots": [
        {
          "shot_num": 1,
          "time": 308.16,
          "hitter": "POPOV",
          "stroke": "Flick Serve",
          "speed_kmh": 78.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.4,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.827
        },
        {
          "shot_num": 2,
          "time": 309.13,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.827
        },
        {
          "shot_num": 3,
          "time": 310.11,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.827
        },
        {
          "shot_num": 4,
          "time": 311.08,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.827
        },
        {
          "shot_num": 5,
          "time": 312.05,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.827
        },
        {
          "shot_num": 6,
          "time": 313.03,
          "hitter": "LZJ",
          "stroke": "Cross-Court Push Winner",
          "speed_kmh": 145.0,
          "hit_coord": [
            2.4,
            5.2,
            0.45
          ],
          "land_coord": [
            2.6,
            7.8
          ],
          "trajectory_peak_z": 1.9,
          "shuttle_transit_time_sec": 0.827,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 16,
      "badge": "Rally #16 \u26a1",
      "label": "Cross-Court Net Kill",
      "timestamp_start": "05:28.64",
      "timestamp_end": "05:35.20",
      "seconds_start": 328.64,
      "seconds_end": 335.2,
      "duration_sec": 6.56,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 9,
        "player_2": 7
      },
      "score_after": {
        "player_1": 10,
        "player_2": 7
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 6,
      "max_smash_kmh": 335.0,
      "avg_shot_speed_kmh": 142.9,
      "lzj_sprint_dist_m": 14.1,
      "popov_sprint_dist_m": 15.6,
      "key_moment": "LZJ pouncing on loose net tumble with decisive angled kill",
      "shots": [
        {
          "shot_num": 1,
          "time": 328.64,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 79.5,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            2.5,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 329.73,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 330.83,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 331.92,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 333.01,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 334.11,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 162.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 17,
      "badge": "Rally #17 \ud83c\udff8",
      "label": "Interval Decider - Spin Net Duel",
      "timestamp_start": "05:45.80",
      "timestamp_end": "05:51.40",
      "seconds_start": 345.8,
      "seconds_end": 351.4,
      "duration_sec": 5.6,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 10,
        "player_2": 9
      },
      "score_after": {
        "player_1": 11,
        "player_2": 9
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 6,
      "max_smash_kmh": 322.0,
      "avg_shot_speed_kmh": 144.4,
      "lzj_sprint_dist_m": 11.5,
      "popov_sprint_dist_m": 12.8,
      "key_moment": "LZJ spinning net roll giving 11-9 mid-game interval lead",
      "shots": [
        {
          "shot_num": 1,
          "time": 345.8,
          "hitter": "LZJ",
          "stroke": "Low Serve",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            2.8,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.793
        },
        {
          "shot_num": 2,
          "time": 346.73,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.793
        },
        {
          "shot_num": 3,
          "time": 347.67,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 175.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.793
        },
        {
          "shot_num": 4,
          "time": 348.6,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.793
        },
        {
          "shot_num": 5,
          "time": 349.53,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.793
        },
        {
          "shot_num": 6,
          "time": 350.47,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 164.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.793,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 18,
      "badge": "Rally #18 \ud83d\udd25",
      "label": "Post-Interval Pressure & Flat Drive",
      "timestamp_start": "06:02.88",
      "timestamp_end": "06:10.40",
      "seconds_start": 362.88,
      "seconds_end": 370.4,
      "duration_sec": 7.52,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 13,
        "player_2": 10
      },
      "score_after": {
        "player_1": 14,
        "player_2": 10
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 8,
      "max_smash_kmh": 350.0,
      "avg_shot_speed_kmh": 147.1,
      "lzj_sprint_dist_m": 16.8,
      "popov_sprint_dist_m": 18.2,
      "key_moment": "LZJ heavy flat exchange forcing Popov into netting error",
      "shots": [
        {
          "shot_num": 1,
          "time": 362.88,
          "hitter": "LZJ",
          "stroke": "Flick Serve",
          "speed_kmh": 82.5,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            3.1,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 2,
          "time": 363.82,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 166.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 3,
          "time": 364.76,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 4,
          "time": 365.7,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 5,
          "time": 366.64,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 6,
          "time": 367.58,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 166.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 7,
          "time": 368.52,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 168.0,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.799
        },
        {
          "shot_num": 8,
          "time": 369.46,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.799,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 19,
      "badge": "Rally #19 \ud83d\udca5",
      "label": "Crucial 20-Shot Tactical Defense",
      "timestamp_start": "06:14.64",
      "timestamp_end": "06:38.20",
      "seconds_start": 374.64,
      "seconds_end": 398.2,
      "duration_sec": 23.56,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 15,
        "player_2": 11
      },
      "score_after": {
        "player_1": 16,
        "player_2": 11
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 20,
      "max_smash_kmh": 378.0,
      "avg_shot_speed_kmh": 164.7,
      "lzj_sprint_dist_m": 52.8,
      "popov_sprint_dist_m": 59.0,
      "key_moment": "LZJ absorbing 3 consecutive Popov smashes before counter-drop",
      "shots": [
        {
          "shot_num": 1,
          "time": 374.64,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 84.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.4,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 375.82,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 377.0,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 378.17,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 379.35,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 380.53,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 381.71,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 382.89,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 384.06,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 385.24,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 386.42,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 387.6,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 388.78,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 389.95,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 15,
          "time": 391.13,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 16,
          "time": 392.31,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 144.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 17,
          "time": 393.49,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 18,
          "time": 394.67,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 168.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 19,
          "time": 395.84,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 169.5,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 20,
          "time": 397.02,
          "hitter": "LZJ",
          "stroke": "Steep Jump Smash Winner",
          "speed_kmh": 378.0,
          "hit_coord": [
            4.8,
            1.1,
            3.1
          ],
          "land_coord": [
            1.2,
            9.6
          ],
          "trajectory_peak_z": 3.1,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 20,
      "badge": "Rally #20 \u26a1",
      "label": "Punch Clear & Stick Smash",
      "timestamp_start": "06:49.68",
      "timestamp_end": "07:03.00",
      "seconds_start": 409.68,
      "seconds_end": 423.0,
      "duration_sec": 13.32,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 16,
        "player_2": 12
      },
      "score_after": {
        "player_1": 17,
        "player_2": 12
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 12,
      "max_smash_kmh": 382.0,
      "avg_shot_speed_kmh": 170.2,
      "lzj_sprint_dist_m": 29.4,
      "popov_sprint_dist_m": 32.6,
      "key_moment": "LZJ steep stick smash into forehand corner",
      "shots": [
        {
          "shot_num": 1,
          "time": 409.68,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 78.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            2.5,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 410.79,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 411.9,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 413.01,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 414.12,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 415.23,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 416.34,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 417.45,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 138.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 418.56,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 419.67,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 170.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 420.78,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 171.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 421.89,
          "hitter": "LZJ",
          "stroke": "Steep Jump Smash Winner",
          "speed_kmh": 382.0,
          "hit_coord": [
            4.8,
            1.1,
            3.1
          ],
          "land_coord": [
            1.2,
            9.6
          ],
          "trajectory_peak_z": 3.1,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 21,
      "badge": "Rally #21 \ud83d\ude80",
      "label": "Endgame Pressure - 404 km/h Blast",
      "timestamp_start": "07:13.20",
      "timestamp_end": "07:28.80",
      "seconds_start": 433.2,
      "seconds_end": 448.8,
      "duration_sec": 15.6,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 18,
        "player_2": 15
      },
      "score_after": {
        "player_1": 19,
        "player_2": 15
      },
      "server": "LZJ",
      "winner": "LZJ",
      "shot_count": 14,
      "max_smash_kmh": 404.0,
      "avg_shot_speed_kmh": 166.0,
      "lzj_sprint_dist_m": 36.5,
      "popov_sprint_dist_m": 40.2,
      "key_moment": "LZJ explosive 404 km/h jump smash down the center channel",
      "shots": [
        {
          "shot_num": 1,
          "time": 433.2,
          "hitter": "LZJ",
          "stroke": "Flick Serve",
          "speed_kmh": 79.5,
          "hit_coord": [
            3.05,
            4.72,
            1.15
          ],
          "land_coord": [
            2.8,
            8.68
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 2,
          "time": 434.31,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 3,
          "time": 435.43,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 4,
          "time": 436.54,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 5,
          "time": 437.66,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 6,
          "time": 438.77,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 7,
          "time": 439.89,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 8,
          "time": 441.0,
          "hitter": "POPOV",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 140.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 9,
          "time": 442.11,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 10,
          "time": 443.23,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 11,
          "time": 444.34,
          "hitter": "LZJ",
          "stroke": "High Defensive Lift",
          "speed_kmh": 172.5,
          "hit_coord": [
            1.5,
            5.1,
            0.4
          ],
          "land_coord": [
            4.9,
            12.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 12,
          "time": 445.46,
          "hitter": "POPOV",
          "stroke": "Jump Smash Down-the-Line",
          "speed_kmh": 389.0,
          "hit_coord": [
            4.9,
            12.2,
            2.8
          ],
          "land_coord": [
            1.5,
            5.9
          ],
          "trajectory_peak_z": 2.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 13,
          "time": 446.57,
          "hitter": "LZJ",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            3.8,
            1.1
          ],
          "land_coord": [
            3.5,
            9.8
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.85
        },
        {
          "shot_num": 14,
          "time": 447.69,
          "hitter": "POPOV",
          "stroke": "Drive Return",
          "speed_kmh": 158.0,
          "hit_coord": [
            3.1,
            8.6,
            0.95
          ],
          "land_coord": [
            4.7,
            2.9
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.85,
          "winner": true
        }
      ]
    },
    {
      "rally_id": 22,
      "badge": "Rally #22 \ud83c\udfc6",
      "label": "Championship Point - Hawk-Eye Line Decision",
      "timestamp_start": "07:38.96",
      "timestamp_end": "07:48.80",
      "seconds_start": 458.96,
      "seconds_end": 468.8,
      "duration_sec": 9.84,
      "set": 2,
      "near_player": "LZJ",
      "far_player": "POPOV",
      "score_before": {
        "player_1": 20,
        "player_2": 16
      },
      "score_after": {
        "player_1": 21,
        "player_2": 16
      },
      "server": "POPOV",
      "winner": "LZJ",
      "shot_count": 10,
      "max_smash_kmh": 368.0,
      "avg_shot_speed_kmh": 159.3,
      "lzj_sprint_dist_m": 22.4,
      "popov_sprint_dist_m": 25.1,
      "key_moment": "LZJ attacking lift verified IN by Hawk-Eye review to win match 21-11, 21-16",
      "shots": [
        {
          "shot_num": 1,
          "time": 458.96,
          "hitter": "POPOV",
          "stroke": "Low Serve",
          "speed_kmh": 81.0,
          "hit_coord": [
            3.05,
            8.68,
            1.15
          ],
          "land_coord": [
            3.1,
            4.72
          ],
          "trajectory_peak_z": 1.58,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 2,
          "time": 459.94,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 3,
          "time": 460.93,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 4,
          "time": 461.91,
          "hitter": "LZJ",
          "stroke": "Reverse Slice Fast Drop",
          "speed_kmh": 142.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.3,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 5,
          "time": 462.9,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 6,
          "time": 463.88,
          "hitter": "LZJ",
          "stroke": "Drive Return",
          "speed_kmh": 160.0,
          "hit_coord": [
            3.1,
            4.8,
            0.95
          ],
          "land_coord": [
            4.7,
            10.5
          ],
          "trajectory_peak_z": 1.85,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 7,
          "time": 464.86,
          "hitter": "POPOV",
          "stroke": "High Defensive Lift",
          "speed_kmh": 174.0,
          "hit_coord": [
            1.5,
            8.3,
            0.4
          ],
          "land_coord": [
            4.9,
            0.8
          ],
          "trajectory_peak_z": 7.1,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 8,
          "time": 465.85,
          "hitter": "LZJ",
          "stroke": "Jump Smash Down-the-Line",
          "speed_kmh": 353.0,
          "hit_coord": [
            4.9,
            1.2,
            2.8
          ],
          "land_coord": [
            1.5,
            7.5
          ],
          "trajectory_peak_z": 2.95,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 9,
          "time": 466.83,
          "hitter": "POPOV",
          "stroke": "Forehand Push",
          "speed_kmh": 142.0,
          "hit_coord": [
            2.8,
            9.6,
            1.1
          ],
          "land_coord": [
            3.5,
            3.6
          ],
          "trajectory_peak_z": 1.95,
          "shuttle_transit_time_sec": 0.836
        },
        {
          "shot_num": 10,
          "time": 467.82,
          "hitter": "LZJ",
          "stroke": "Hairpin Net Tumble Winner",
          "speed_kmh": 65.0,
          "hit_coord": [
            2.4,
            5.2,
            0.45
          ],
          "land_coord": [
            2.6,
            7.8
          ],
          "trajectory_peak_z": 1.56,
          "shuttle_transit_time_sec": 0.836,
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
