---
name: Hawkview Shuttle Tracking, 3D Physics & Zero-Shot Glitch Diagnosis
description: Technical architecture of Hawkview's 7-stage computer vision and 3D aerodynamic trajectory pipeline, plus root-cause diagnosis and remediation blueprint for the ~30% zero-shot shuttle tracking glitches on uncalibrated/new BWF clips.
---

# Hawkview: 7-Stage CV/3D Physics Engine & Zero-Shot Shuttle Glitch Handoff

## 1. The 7-Stage Backend Pipeline (`engine/`)

All backend modules live in `/Users/anyasmac/GitHub/Hawkview/engine/` and are orchestrated by [`engine/pipeline.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/pipeline.py) and [`server.py`](file:///Users/anyasmac/GitHub/Hawkview/server.py):

| Stage | Module | Role & Key Methods |
| :--- | :--- | :--- |
| **Phase A** | [`engine/court_calib.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/court_calib.py) | `CourtCalibrator`: Solves ground homography $H$ (4 court corners) and 6-DoF camera intrinsics/extrinsics $(f_x = f_y = f, c_x = W/2, c_y = H/2, \mathbf{r}, \mathbf{t})$ via joint Levenberg-Marquardt over the 4 corners (`z=0`) + 2 net posts (`z=1.55 m`) + net center (`z=1.524 m`). Dynamic resolution support (`image_width`, `image_height`) and `auto_detect_court_keypoints()`. |
| **Phase B** | [`engine/segment.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/segment.py) | `RallySegmenter`: Supports `"broadcast"` mode (green/court-hue ratio + multi-camera cut detection), `"recreational"` mode (`_segment_continuous_tripod_windows()` using smoothed court motion energy for continuous tripod recordings with no cuts), and `"auto"` mode. |
| **Phase C** | [`engine/tracknet.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/tracknet.py) | `TrackNetV3Pipeline`: Runs real PyTorch `TrackNetV3` (`engine/weights/tracknet_v3.pt`, 9-channel 3-frame input at `288×512`) on MPS (Apple Silicon) / CUDA / CPU. **Never uses synthetic `InpaintNet` interpolation**. Outputs raw `[Frame, Visibility, X, Y, Confidence]` detections. |
| **Phase D** | [`engine/pose_track.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/pose_track.py) & [`engine/hits.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/hits.py) | `PoseTracker`: Runs `yolov8n-pose.pt` at 12.5 Hz inside each rally, splitting players strictly by projected court $y < 6.70\text{ m}$ (`near_player`) vs $y \ge 6.70\text{ m}$ (`far_player`). `HitDetector`: Detects racket contacts from 2D shuttle velocity reversals ($\Delta v_y$, acceleration spikes) gated by proximity to player wrist/racket keypoints (with `fallback_kinematic_hits()` in `engine/pipeline.py` when pose confidence is low). |
| **Phase E** | [`engine/aerodynamics.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/aerodynamics.py) & [`engine/reconstruct3d.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/reconstruct3d.py) | `ShuttlecockAerodynamics`: Integrates 3D ballistic ODE with air drag $\mathbf{a} = [0, 0, -g] - k_d \|\mathbf{v}\| \mathbf{v}$ ($k_d \approx 0.215\text{ m}^{-1}$, terminal velocity $v_t \approx 6.8\text{ m/s}$) via RK4. `TrajectoryReconstructor3D`: Fits 6-parameter initial state $(x_0, y_0, z_0, v_{x0}, v_{y0}, v_{z0})$ per shot (`hit i -> hit i+1`) against visible 2D TrackNet pixels using `scipy.optimize.least_squares(loss="soft_l1")` + player ankle priors + net clearance prior. |
| **Phase F** | [`engine/classify.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/classify.py) | `ShotClassifier`: Classifies each reconstructed 3D shot into BWF stroke types (`smash`, `net_kill`, `drop`, `attacking_clear`, `defensive_clear`, `lift`, `net_shot`, `push`, `drive`, `block`, `serve_short`, `serve_flick`, `serve_drive`, `serve_long`) and outcomes (`continue`, `winner`, `error_out`, `error_net`, `close_call`). |
| **Phase G** | [`engine/pipeline.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/pipeline.py) | `HawkviewPipeline.run_progressive_analysis()`: Streams completed rallies one-by-one into `telemetry.json`, `data/match_telemetry.json`, and `/api/analyze-status` so the frontend updates live after every rally. |

---

## 2. Root-Cause Diagnosis: Why ~30% of Shuttle Trajectories Glitch on New BWF Clips (Zero-Shot Without LLM Aid)

When loading a **new, unseen BWF clip** via `Load MP4` without manual/LLM ground-truth curation, roughly **70% of shots reconstruct cleanly**, while **~30% exhibit visible glitches** (phantom mid-air zig-zags, flat/sunken clears, two shots merged into one slow loop, or trajectories snapping toward a player's shoe/court line).

Below are the **4 exact technical root causes** in the current codebase and where the next agent must focus:

### Root Cause 1: Static White-Pixel False Positives in `TrackNetV3` (`engine/tracknet.py`)
- **What happens**: During fast smashes/drives (when the real shuttle is heavily motion-blurred or exits the top of the frame on a high clear), `TrackNetV3`'s heatmap peak (`conf >= 0.5`) frequently locks onto **stationary white spots**:
  - White court line T-junctions or net tape highlights
  - Players' white shoes, socks, wristbands, or racket head reflections
  - Stadium advertisement LED flashes or BWF broadcast scorebug corners
- **Where in code**: [`engine/tracknet.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/tracknet.py#L60-L135) takes the global `np.unravel_index(np.argmax(prob_map), ...)` across the entire `288×512` frame independently for each frame, with **no static background mask** and **no spatial/kinematic continuity gate**.
- **How to fix**:
  1. **Per-Rally Median Background Suppression**: Compute the pixel-wise median image of the rally (or track stationary heatmap peaks that fire at the exact same `(u, v)` within `< 3 px` for `> 6` frames) and zero out those static regions in `prob_map` before taking `argmax`.
  2. **Scorebug / Overlay Masking**: Mask out the BWF scorebug ROI (top-left `[0:120, 0:500]` and bottom broadcast banner) and any pixels outside the expanded court frustum before heatmap peak extraction.
  3. **Multi-Peak Extraction + Viterbi / Kalman Linking**: Instead of extracting only 1 greedy `argmax` per frame, extract top-$K$ ($K=3$) local maxima above `conf >= 0.35` and run a lightweight **Viterbi / Kalman constant-acceleration linker** across the rally to reject single-frame teleports (`> 140 px/frame`) onto shoes or lines.

### Root Cause 2: Missed or Spurious Hit Boundaries Merging/Splitting Shots (`engine/hits.py` & `engine/pipeline.py`)
- **What happens**: `TrajectoryReconstructor3D` assumes each interval `[hit_i, hit_{i+1}]` is a **single continuous ballistic flight**.
  - **Missed Hit (Under-segmentation)**: If a fast flat drive or block reverses direction while `TrackNetV3` drops 3–4 frames around contact, `HitDetector` (`engine/hits.py`) misses the reversal. Two opposite-direction shots (`Near -> Far` and `Far -> Near`) get fused into one `[hit_i, hit_{i+1}]` window! The 3D ODE solver then tries to fit a single parabolic arc to a V-shaped back-and-forth track, producing a stalled mid-court glitch.
  - **Spurious Hit (Over-segmentation)**: Conversely, when `TrackNetV3` briefly jumps to a player's white shoe and back to the shuttle, `vy_px` flips sign twice and triggers a fake hit mid-flight.
- **Where in code**: [`engine/hits.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/hits.py#L70-L240) and `fallback_kinematic_hits()` in [`engine/pipeline.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/pipeline.py#L53-L145).
- **How to fix**:
  1. **Strict Alternation & Net-Crossing Enforcement**: In badminton singles/doubles, legal mid-rally shots **must alternate sides** (`near -> far -> near -> far`) and **must cross the net (`y = 6.70 m`)**.
  2. **Residual-Driven Shot Splitting (RANSAC Split)**: If `TrajectoryReconstructor3D.reconstruct_shot()` yields a high reprojection error (`fit_rmse_px > 12 px`) AND the 2D `y_px(t)` trajectory exhibits an internal local extremum (direction reversal across the net), automatically **split the interval at the apex/reversal frame** into two alternating shots (`near -> far` + `far -> near`) and re-fit both!

### Root Cause 3: Outlier Contamination in `TrajectoryReconstructor3D` (`engine/reconstruct3d.py`)
- **What happens**: Even when hit boundaries are correct, if 25–40% of the 2D points inside `[start_frame, end_frame]` are outliers (e.g. TrackNet locked onto the net tape while the shuttle was high in the air on a clear), `scipy.optimize.least_squares(loss="soft_l1")` gets dragged down into a local minimum near the net.
- **Where in code**: [`engine/reconstruct3d.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/reconstruct3d.py#L140-L360).
- **How to fix**:
  1. **2-Pass RANSAC / Iterative Outlier Rejection before Final RK4 Fit**:
     - Pass 1: Fit a smooth 2D monotonic-X spline $u(t), v(t)$ (since horizontal court travel $x(t)$ and depth travel $y(t)$ within a single shot are strictly monotonic from hitter to receiver!). Reject any 2D TrackNet detections that violate monotonic progression from hitter side to receiver side or deviate `> 35 px` from the smooth curve.
     - Pass 2: Run the 3D aerodynamic RK4 least-squares solver **only on the inlier 2D points**.

### Root Cause 4: Broadcast Camera Cut & Slow-Mo Replay Bleed (`engine/segment.py`)
- **What happens**: Different BWF broadcasts use different court mat colors (green vs BWF World Tour Finals red, Paris 2024 blue/purple, grey) and cut to close-ups of players immediately after the shuttle touches the floor. If the rally end timestamp includes 1–2 seconds of close-up camera frames, `TrackNetV3` and `PoseTracker` run on a close-up face shot and hallucinate a wild terminal shot.
- **Where in code**: [`engine/segment.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/segment.py#L64-L215).
- **How to fix**:
  1. **Calibration-Template Court Line Verification (`is_wide_court_frame`)**: Since the user (or auto-calibrator) has already defined the 4 court corners and BWF court lines on the wide camera angle in `CourtCalibrator`, check the **edge/brightness correlation along the calibrated court line pixels** on every frame (at 5 Hz). The exact moment the broadcast cuts away from the wide camera, the white court lines disappear and the rally segment should terminate immediately on that frame!

---

## 3. Verification & Test Suite Commands
- **Run Unit & Smoke Tests**:
  ```bash
  python3 -m unittest tests/test_physics_engine.py -v
  ```
- **Verify Phase E (3D Reconstruction RMSE & Elevation Profiles)**:
  ```bash
  python3 tools/verify_phase_e.py
  ```
- **Verify Phase F (Shot Classification & Outcomes)**:
  ```bash
  python3 tools/verify_phase_f.py
  ```
- **Restart Local Dev Server (`http://localhost:8123`)**:
  ```bash
  python3 -u server.py 8123
  ```
