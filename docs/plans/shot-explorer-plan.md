# Hawkview Shot Explorer — Execution Plan

**Goal:** make Hawkview do for badminton what PB Vision does for pickleball. The
headline feature is the **Shot Explorer**: a 3D court with every shot of a game
(or a filtered subset) drawn as a real arc, its landing point marked, colour-coded
by outcome, viewable from several fixed angles, and clickable to jump the video to
that shot.

Every number on screen must come from the video. Nothing hardcoded.

Target test video: `assets/LZJvPopov.mp4` (1920x1080, 25 fps, 12,461 frames,
~498 s broadcast highlight, LZJ vs Popov, Arctic Open 2024).

---

## 0. Ground rules for the executor

1. **No fabricated data.** Delete the hardcoded rallies, shots, speeds, transitions
   and stats in `engine/pipeline.py` (`_build_sly_payload`, lines ~355-580,
   the fixed `hit_pt`/`land_pt`/`transit_time` at ~206-215, the scripted OCR
   updates at ~147-164), `engine/video_analyzer.py` (`detect_transitions` literal
   list at line 77, `_generate_rally_shots`, the `rally_specs` table and the
   player `stats_summary` blocks in `build_ground_truth_contract`) and
   `data/generate_popov_telemetry.py`. If a stage cannot produce a value, emit
   `null` and show "—" in the UI. Never back-fill with a plausible number.
2. **Honest progress.** Progress callbacks report frames actually processed, the
   measured wall-clock fps, and counts actually found ("31 rallies, 412 shots").
   No "@ 148 FPS equivalent", no "reprojection error: 0.74px" unless computed.
3. **Metadata that the video cannot give** (player names, flags, tournament,
   date) comes from a small hand-written `data/matches/<match_id>/match.json`,
   clearly separate from computed output.
4. Keep the existing UI shell, Casio Edifice styling and video sync. This plan
   adds a view; it does not redesign the app.
5. Each phase ends with its acceptance check passing before the next starts.

---

## 1. Models and libraries (the "decode the video" stack)

| Stage | Use | Why | Licence |
|---|---|---|---|
| Video decode | OpenCV `cv2.VideoCapture` (already used), sequential read, never `CAP_PROP_POS_FRAMES` seeking inside loops | Seeking per frame is slow and inexact on H.264 | Apache-2.0 |
| **Shuttle 2D tracking** | **TrackNetV3** — github.com/qaz812345/TrackNetV3, checkpoints `TrackNet_best.pt` + `InpaintNet_best.pt` (Google Drive zip linked in its README) | Purpose-built for broadcast badminton; InpaintNet fills occlusion gaps; best open option | MIT (code and weights) |
| Player pose | **RTMPose via `rtmlib`** (onnxruntime, body-17 keypoints) | Feet → court position, wrist → hitter attribution. Runs on CPU/CoreML | Apache-2.0 |
| Court calibration | **Manual 4-corner + 2 net-post-top click tool** (one-off per camera setup), refined by white-line fitting with OpenCV | Broadcast camera is static during rallies; a one-time click is far more reliable than any public court-keypoint model. Optional later: Roboflow "badminton-court-detection-corner" or Court R-CNN from the hit-frame repo below | — |
| Hit detection (v1) | Trajectory heuristic: sign change in image-y velocity / sharp direction change of the TrackNet track, confirmed by a player's wrist within ~120 px | Simple, explainable | — |
| Hit detection (v2, optional) | github.com/arthur900530/automated-hit-frame-detection-for-badminton-match-analysis | Learned hit-frame detector if v1 is too noisy | MIT |
| Stroke type (optional, later) | BST — github.com/Va6lue/BST-Badminton-Stroke-type-Transformer (trained on ShuttleSet) | Learned stroke classes instead of rules | MIT |
| 3D trajectory | Re-implement the **MonoTrack** idea (Liu & Wang, CVPRW 2022, arXiv 2204.01899) on top of the existing `engine/aerodynamics.py` drag ODE + `scipy.optimize.least_squares` | No official code release; method is straightforward | — |

**Do not use** YOLO/Ultralytics pose for anything that ships: AGPL-3.0 conflicts
with the paid offline app in `SKILL.md`. Fine for a throwaway experiment only.

Runtime target: Apple Silicon Mac, PyTorch with `mps` device for TrackNetV3
(fall back to CPU). Mobile/CoreML export is out of scope for this plan.

Setup (executor confirms with the user before downloading the checkpoints):

```bash
git clone https://github.com/qaz812345/TrackNetV3 vendor/TrackNetV3
# unzip TrackNetV3_ckpts.zip into vendor/TrackNetV3/ckpts/
python3 -m pip install torch torchvision rtmlib onnxruntime scipy
```

Add `vendor/`, `*.pt`, `*.onnx` to `.gitignore`. Add a `requirements.txt`.

---

## 2. Pipeline phases

New module layout under `engine/` (replace the fake stages, keep class names
where tests import them):

```
engine/
  decode.py          # frame iterator, true counts, fps
  court_calib.py     # load/save calibration, solvePnP, line refinement
  segment.py         # court-view mask + cut detection -> rally windows
  shuttle_track.py   # TrackNetV3 wrapper -> per-frame (x, y, visible, conf)
  pose_track.py      # rtmlib wrapper -> near/far player keypoints per frame
  hits.py            # hit frames + hitter attribution
  reconstruct3d.py   # per-shot 3D fit (MonoTrack-style)
  classify.py        # shot type, outcome, in/out
  pipeline.py        # orchestrates, writes telemetry
```

### Phase A — Decode + court calibration
- `decode.py`: iterate all frames once; record real `frames_processed`,
  `fps`, `duration_sec`. Optional `--stride` for quick runs, logged as such.
- `tools/calibrate.html` (or a mode in the existing app): show a paused frame,
  user clicks the 4 outer doubles corners and the 2 net-post tops. Save to
  `data/matches/<id>/calibration.json` with pixel points, the 3x3 ground
  homography `H`, and the camera pose from `cv2.solvePnP` using the 3D points
  (corners at z=0, post tops at z=1.55 m, posts 0.15 m outside the doubles
  sidelines on the net line). Then fit the visible white lines to refine.
- Store the **reprojection error actually measured** and show it.
- **Accept when:** projecting the full BWF line model back onto 5 random
  in-rally frames lands within 4 px of the painted lines (overlay screenshot
  saved to `data/matches/<id>/debug/calib_*.png`).

### Phase B — Rally segmentation
- Per sampled frame (every 2nd frame is fine): court-green ratio inside the
  calibrated court polygon + histogram-difference cut detection. A rally window
  is a run of main-camera frames ≥ 2 s, trimmed by where the TrackNet track
  starts/stops (Phase C).
- Replays: the broadcast replays use other angles or slow-mo; reject windows
  whose green-ratio pattern or line reprojection error does not match the
  calibrated main camera.
- **Accept when:** on `LZJvPopov.mp4`, detected rally count and start/end
  times match a hand count (executor watches and writes
  `data/matches/<id>/rallies_truth.json` for this test video) within ±0.5 s
  per boundary, ≥ 90 % of rallies found, no replays counted.

### Phase C — Shuttle tracking (TrackNetV3)
- Run TrackNetV3 + InpaintNet only on rally windows (saves most of the video).
  Use its `predict.py` logic in-process, or call it as a subprocess with
  `--video_range` per rally and read the CSV (`Frame, Visibility, X, Y`).
- Rescale coordinates from network input size to 1920x1080.
- Output `data/matches/<id>/shuttle_2d.csv`.
- **Accept when:** overlay video of 3 rallies (TrackNetV3 `--output_video`)
  visually follows the shuttle; visible-frame ratio inside rallies ≥ 80 %.

### Phase D — Players + hits
- rtmlib body-17 on rally frames at 12.5 fps (every 2nd frame). Keep the two
  people whose ankle midpoint maps (via `H`) inside the court or ≤ 1.5 m
  outside; assign near/far by which side of the net (y < 6.7 m) they stand.
  Players swap ends between games; detect from position, never hardcode.
- Hits: candidate frames where the 2D track reverses direction; keep those
  with a player's wrist within ~120 px; hitter = that player. Enforce
  alternation (near/far/near…). First hit of a rally = serve.
- **Accept when:** on 5 hand-checked rallies, ≥ 85 % of hits found within
  ±2 frames, hitter correct ≥ 95 %.

### Phase E — 3D reconstruction per shot
For each shot (hit i → hit i+1, or → end of track):
- Start position: hitter's court (x, y) from ankle midpoint via `H`; height
  z₀ unknown, bounded 0.3–3.4 m.
- Unknowns: z₀ and v₀ (3 components). Simulate with the existing RK4 drag
  model in `engine/aerodynamics.py`; project each simulated point with the
  calibrated camera; minimise pixel reprojection error against the TrackNet
  points with `scipy.optimize.least_squares` (robust loss, e.g. `soft_l1`).
- Landing point = where the fitted path hits z = 0 (or the next hit point
  for non-terminal shots).
- Store per shot: `speed_kmh = |v₀|·3.6`, peak height, net clearance at
  y = 6.7 m, landing (x, y), fitted path sampled at 25 Hz, and
  `fit_rmse_px`. Mark shots with `fit_rmse_px > 8` as low-confidence and draw
  them dashed.
- **Accept when:** median `fit_rmse_px` < 5; smash speeds fall in a physically
  sane 200–450 km/h band; no clears peaking under 3 m; net clearance > 0 for
  every shot that crossed.

### Phase F — Shot classification and outcomes (rules first)
- Serve: first shot. Smash: v₀ downward and > 180 km/h from z₀ > 2 m.
  Clear: peak > 5 m and lands in back 2 m. Lift: hit z₀ < 1 m, peak > 4 m.
  Drop: hit z₀ > 2 m, lands in front 2.5 m. Net shot: both ends within 2 m
  of the net, peak < 2.2 m. Drive: flat (peak − z₀ < 0.6 m) and > 100 km/h.
- Outcome of the last shot: `in` / `out` (landing vs singles lines with a
  0.05 m tolerance) / `net` (path crosses y = 6.7 below net height).
  Combined with who hit it → `winner` or `error`.
- Optional later: swap rules for BST.

### Phase G — Telemetry contract
Extend `match_telemetry.json` (keep existing top-level keys so the current UI
keeps working):

```jsonc
{
  "source": { "video": "assets/LZJvPopov.mp4", "frames_processed": 12461,
              "fps": 25.0, "pipeline_version": "2.0.0",
              "models": { "shuttle": "TrackNetV3", "pose": "rtmlib-rtmpose-m" } },
  "calibration": { "H": [[...]], "K": [[...]], "R": [[...]], "t": [...],
                   "reprojection_error_px": 2.1 },
  "rallies": [{
    "rally_id": 1, "game": 1, "start_sec": 15.4, "end_sec": 19.3,
    "near_player": "POPOV", "far_player": "LZJ",
    "winner": "LZJ", "ended_by": "error|winner|unknown",
    "shots": [{
      "shot_num": 1, "frame": 386, "time": 15.44, "hitter": "POPOV",
      "type": "serve", "speed_kmh": 96.3, "peak_z": 1.71,
      "net_clearance_m": 0.18, "hit": [3.1, 4.6, 1.02], "land": [3.4, 9.1],
      "outcome": "continue|winner|error_out|error_net",
      "path": [[x, y, z], ...],          // 25 Hz samples
      "fit_rmse_px": 3.2, "confidence": "high|low"
    }]
  }],
  "players": { "<id>": { "computed": { "max_smash_kmh": 0, "shots": 0,
                "winners": 0, "errors": 0, "distance_m": 0 } } }
}
```

Player profile fields (name, flag, country, handedness) are merged in from
`match.json`. All `computed` stats are aggregates of the shots above.

---

## 3. Frontend: the Shot Explorer view

This is the most important deliverable (see reference screenshot from PB
Vision: light-grey court, dark lines, grey net panel, arcs from every shot,
dot at each landing, red for errors, view buttons stacked on the right).

Implement in `js/shot-explorer.js` (new) using the existing Three.js setup
(`js/three-viewport.js` already has the court geometry, `courtToWorld()` and
camera presets; reuse them).

1. **Arcs:** one `THREE.Line` (or `Line2` from three/examples for thickness)
   per shot from `shot.path`. Colours:
   - normal shot → green (`#7cc84a`-ish)
   - rally-ending error (out / net) → red
   - winner → the existing Edifice cyan, so winners pop
   - low-confidence fit → same colour, dashed, 40 % opacity
   Draw a small sphere at `land` (and a darker one where an error landed out).
2. **Court style for this view:** flat light-grey surface, thin dark lines,
   semi-transparent grey net panel with posts. Toggle back to the arena look
   with the existing mode button.
3. **View buttons** (vertical stack on the right, as in PB Vision):
   3D perspective · top-down · side (net-on) · behind near baseline · behind
   far baseline · fullscreen. Reuse/extend `this.presets`.
4. **Filters** (top bar chips): player, shot type, outcome, game, rally range,
   min speed. "This rally" vs "whole game" vs "whole match" scope.
5. **Interaction:** hover an arc → tooltip (type, speed, peak, net clearance,
   time). Click → seek the video player (`js/broadcast-player.js`) to
   `shot.time − 1 s` and play; highlight that arc, fade others.
6. **Performance:** a full match is ~1,000 shots × ~30 points; merge arcs per
   colour into one `BufferGeometry` with `LineSegments` when no hover is
   needed; keep per-shot objects only for the filtered set (< 300).
7. Existing dials (smash speedometer, shot counter, coverage) read from the
   new `computed` stats; show "—" when null.

**Accept when:** loading the computed `LZJvPopov` telemetry shows all shots of
game 1 as arcs; filter "LZJ smashes" leaves only steep downward arcs from the
LZJ half; clicking any arc seeks the video to that shot (manually verify 10).

---

## 4. Tests

- Replace `tests/test_physics_engine.py` cases that assert on hardcoded
  values (e.g. 388/412 km/h, fixed rally counts) with:
  - synthetic trajectory test: simulate a shot with known v₀, project with a
    known camera, add 1 px noise, check `reconstruct3d` recovers |v₀| within 5 %;
  - calibration round-trip test (court → pixel → court < 1 cm);
  - classification rule tests on hand-built shots;
  - pipeline smoke test on `assets/sample_rally.mp4` with `--stride 5`
    that asserts `frames_processed` equals the real decoded count and that no
    output value equals a known former hardcoded constant.
- Ground-truth files for `LZJvPopov` (`rallies_truth.json`, a few hand-labelled
  hits) live in `data/matches/lzj_popov/` and are used by an opt-in slow test.

---

## 5. Order of work and handoff

1. Phase A + delete hardcoded data paths (UI shows "—" — that is expected).
2. Phase C on 3 hand-picked rallies (prove TrackNetV3 works end-to-end).
3. Phase B, then D, E, F on the full video.
4. Phase G contract + Shot Explorer frontend.
5. Tests, then regenerate `data/match_telemetry.json` and `js/telemetry-data.js`
   from the real pipeline.

At the end of each phase: run the acceptance check, save debug images under
`data/matches/<id>/debug/`, commit with a message naming the phase, and
report the real measured numbers (rally count, shot count, median fit error,
max smash) — not targets.

## 6. Known risks

- Broadcast highlight edits cut rallies short; some rallies will start mid-
  exchange. Mark `rally.partial = true` rather than inventing missing shots.
- TrackNetV3 was trained on broadcast matches similar to this one, but the
  shuttle is often lost against white lights/ceiling at the top of clears.
  The 3D fit bridges these gaps; check the arcs, not just the 2D track.
- Speeds from monocular 3D are estimates (MonoTrack reports errors in the
  tens of km/h on smashes). Show one decimal at most and label as "est."
