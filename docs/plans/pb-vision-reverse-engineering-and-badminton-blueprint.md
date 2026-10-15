# PB Vision Reverse-Engineering & Badminton Court System Blueprint (Hawkview)

**Reviewed & Corrected By:** Gemini 4 Argon (High) — Technical Audit of 3.8 Flash Findings  
**Date:** October 14, 2026  
**Target Video & Reference Dataset:** `assets/LZJvPopov.mp4` (1920x1080 @ 25 FPS, 12,461 frames, Arctic Open 2024 QF)

---

## 0. Argon's Critical Review of 3.8 Flash's Findings (What Was Right vs. What Needed Correction)

### ✅ What 3.8 Flash Got Right
1. **The `InpaintNet` Ceiling Bug in [`engine/tracknet.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/tracknet.py#L334-L343) is 100% Real**:
   * In the official `qaz812345/TrackNetV3` implementation (`test.py:generate_inpaint_mask`), gaps where the shuttle leaves the top of the camera frame (`y[i-1] <= th_h` where `th_h = height * 0.05 = 54 px`) are **explicitly excluded from inpainting**.
   * Hawkview's `_apply_inpaintnet()` omitted this ceiling gate and also used a non-overlapping `step=8` loop instead of TrackNetV3's `sliding_step=1` weighted temporal ensemble.
   * Because `InpaintNet` ends with `nn.Sigmoid()` (clamping outputs to $[0, 1]$ inside the frame), forcing it to inpaint out-of-frame high clears caused it to hallucinate points 260 px down onto the court (e.g. frames 797–804 and 827–836 in [`shuttle_2d.csv`](file:///Users/anyasmac/GitHub/Hawkview/data/matches/lzj_popov/shuttle_2d.csv)).
2. **The Frontend (`js/three-viewport.js`) Renders a Fake Sine-Wave Parabola**:
   * Currently, `three-viewport.js` uses `Math.sin(progress * Math.PI) * peakZ` and only animates a single moving shuttlecock with a vanishing 50-point trail rather than persistent 3D shot arcs.

### ⚠️ What 3.8 Flash Missed or Misidentified (Critical Corrections)
1. **Why the UI Currently Shows Fake Data or Blank Dials (The Pipeline Disconnect)**:
   * `engine/pipeline.py` only runs Stage 0 (Decode) and Stage 1 (Calibration) and writes `"rallies": []` to `data/match_telemetry.json`.
   * Meanwhile, `data/build_telemetry_js.py` still bundles the **old hardcoded synthetic JSON** (`data/match_telemetry_lzj_vs_popov.json`) into `js/telemetry-data.js`. None of the real TrackNetV3 detections in `shuttle_2d.csv` are wired into the 3D court yet.
2. **Additional Cause of "Fake Frames" in 2D Tracking — Missing Spatial Outlier Gate**:
   * In [`engine/tracknet.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/tracknet.py#L156-L180), `extract_location_from_heatmap()` takes the largest contour $> 0.5$ anywhere on the $1920 \times 1080$ image with **zero spatial continuity / velocity gating**.
   * When the shuttle leaves the top of the frame or blurs during a smash, false-positive heatmap blobs on white shoes, racket heads, or stadium signage cause 1–2 frame teleports across the screen, which then corrupt `InpaintNet` when it tries to bridge between the ceiling and a player's shoe.
   * **Fix**: Add a 2D kinematic outlier filter (reject isolated 1–3 frame jumps $> 180\text{ px/frame}$) *before* inpainting and 3D fitting.
3. **Why [`engine/aerodynamics.py`](file:///Users/anyasmac/GitHub/Hawkview/engine/aerodynamics.py#L179-L220) (`monomorphic_3d_trajectory_fit`) Is Currently Broken for Badminton**:
   * 3.8 Flash assumed `aerodynamics.py` already fits 3D trajectories to 2D TrackNet rays. **It does not.**
   * Lines 207–218 of `aerodynamics.py` take *only the final pixel* of a shot, intersect its camera ray with the floor $Z = 0$, and solve a boundary-value problem ignoring all intermediate TrackNet pixels!
   * **In badminton, 95% of shots never touch the floor ($Z = 0$)**—they are intercepted in mid-air by the opponent's racket at $Z \in [0.3\text{m}, 3.0\text{m}]$. Intersecting a mid-rally shot's final pixel ray with $Z = 0$ projects the landing point **4 to 6 meters outside the baseline**!
   * **Fix**: Anchor the horizontal start $(X_0, Y_0)$ and end $(X_1, Y_1)$ of each mid-rally shot using the **hitting and receiving players' court floor coordinates** (from ankle keypoints via $H^{-1}$), and optimize $[Z_0, v_{x0}, v_{y0}, v_{z0}]$ via `scipy.optimize.least_squares(loss='soft_l1')` against **all intermediate 2D TrackNet pixels** $(u_i, v_i)$.
4. **Three Visual Misidentifications in Screenshot 1 (`ss1`) Corrected**:
   * **Floor Shadows vs. "Vertical Drop Stems"**: Look closely at `ss1`. PB Vision does **not** draw vertical fence-post stems from the arc to the floor (which creates unreadable clutter when 20+ shots are shown). It draws a **continuous light-grey 2D shadow curve projected flat onto the court floor** $(X(t), Y(t), 0)$ underneath each green 3D arc $(X(t), Y(t), Z(t))$, ending at a grey floor dot!
   * **Bottom-Left Graphic (`ss1`)**: 3.8 Flash called the green/grey/red rectangle at the bottom-left a "Mini Top-Down Court Zone Map". In reality, it is a **Net Clearance Cross-Section** (Green = safe zone above net, Light Grey with white top tape = the Net, Red = ground/bottom fault).
   * **The Green Eyeball Icon (`👁️`)**: In `ss1`, the `👁️` icon is next to `Top Serve: 36 mph 👁️` and `Top Drive: 35 mph 👁️` (not on the percentile bars). Clicking it highlights and plays that specific top-speed shot in the viewport/video player.

---

## 1. Reverse-Engineering PB Vision's Pipeline & Badminton Adaptation

```
[Monocular 1080p Broadcast / Tripod Video]
       │
       ├──► Stage 1: Court Calibration (engine/court_calib.py) [DONE - 1.04 px RMSE]
       │    Solves ground homography H and camera projection P = K[R | t] from
       │    4 court corners (Z=0), 2 net posts (Z=1.55m), and net center (Z=1.524m).
       │
       ├──► Stage 2: Rally Segmentation & Player Pose (engine/segment.py, player_pose.py)
       │    • Court green-ratio + camera cut filter isolates active rally windows.
       │    • RTMPose (body-17) tracks near & far players; ankle midpoints map via H^-1
       │      to true court floor coordinates (X_player, Y_player, 0).
       │
       ├──► Stage 3: Clean 2D Shuttle Tracking (engine/tracknet.py)
       │    • TrackNetV3 8-frame sliding window ensemble -> raw (u, v, vis).
       │    • Spatial Continuity Gate strips 1-3 frame false positives (shoes/logos).
       │    • Ceiling-Gated InpaintNet (only inpaints when y > 54 px on both ends of gap).
       │
       ├──► Stage 4: Hit Detection & Hitter Attribution (engine/hits.py)
       │    • Detects 2D trajectory direction reversals / vertical velocity inflections
       │      coinciding with player wrist proximity (< 120 px) and near/far alternation.
       │
       └──► Stage 5: Physics-Constrained 3D Trajectory Fit (engine/reconstruct3d.py)
            • Anchors horizontal flight plane between Hitter (X0, Y0) and Receiver/Landing (X1, Y1).
            • Optimizes [Z0, vx0, vy0, vz0] under Yonex AS-50 drag ODE (gamma ≈ 0.24 m^-1)
              by minimizing pixel reprojection error against all visible TrackNet points (u_i, v_i).
            • Bridges out-of-frame ceiling clears deterministically via RK4 physics.
```

---

## 2. Exact UI/UX Redesign Blueprint Matching `ss1` and `ss2`

Instead of wrapping the app in a dark Casio watch bezel with decorative hex screws and analog sub-dials, we adopt PB Vision's clean, data-first card layout:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  HAWKVIEW // BWF MATCH ANALYTICS                      [Match: LZJ vs Popov ▼] [Video Sync Player]│
├──────────────────────────┬───────────────────────────────────────────────────────┬───────────────┤
│ [4-Frame Stroke Strip]   │                                                       │ ┌───────────┐ │
│ [f-3] [f-1] [hit] [f+2]  │                                                       │ │ ⬡ 3D Iso  │ │
│                          │                 3D CLEAN COURT VIEWPORT               │ │ ⊞ Top 2D  │ │
│ ◆ Lee Zii Jia (MAS)      │                                                       │ │ ⫾ Side    │ │
│                          │            /─────────────────────────────/            │ │ ⌸ Net-Lvl │ │
│ Shot Accuracy  Shots: 45 │           /       Net (1.55m)           /             │ │ ☲ Baseline│ │
│ [████████████████░░] 96% │          /─────────────┬───────────────/              │ │ ⛶ Fullscr │ │
│                          │         / ╭──────╮     │              /               │ └───────────┘ │
│ Smash         Percentile │        /  │3D Arc│     │             /                │               │
│ Avg: 312 km/h [█████░░░] │       /   •──────•─────┴────────────/                 │               │
│ Top: 410 km/h 👁️    78th │      /     ↖ Gray Floor Shadow Curve                  │               │
│                          │     /─────────────────────────────────/               │               │
│ Drive / Drop  Percentile │                                                       │               │
│ Avg: 168 km/h [████░░░░] ├───────────────────────────────────────────────────────┴───────────────┤
│ Top: 245 km/h 👁️    64th │ [3rd Shots / Rally ▼] [All Shot Types ▼] [↗ Shot Explorer] [Qual: 80%]│
│                          ├───────────────────────────────────┬───────────────────────────────────┤
│ ┌──────────────────────┐ │ Court Coverage                    │ Serves & Returns                  │
│ │  GREEN (Above Net)   │ │ Distance Covered: 623 ft (190 m)  │ Serves In/Out   [██████████] 100% │
│ │──────────────────────│ │       ┌───────────────────┐       │ Returns In/Out  [██████████] 100% │
│ │  GREY (Net Mesh)     │ │       │   KDE Contour     │       │                                   │
│ │══════════════════════│ │       │   Heatmap on      │       │ Depth Zones     (◎) Serve Depth   │
│ └──────────────────────┘ │       │   Half-Court      │       │ [Deep / Med /   (◎) Return Depth  │
│ Net Clearance Profile    │       └───────────────────┘       │  Shallow Map]       Donut Charts  │
└──────────────────────────┴───────────────────────────────────┴───────────────────────────────────┘
```

### 2.1 Top-Left Player & Stroke Card (`ss1`)
1. **4-Frame Action Filmstrip**:
   * 4 sequential frames cropped around the hitter (`[t_hit - 0.12s, t_hit - 0.04s, t_hit, t_hit + 0.08s]`) showing preparation, racket contact, and follow-through.
2. **Player Selector & Shot Accuracy Bar**:
   * Diamond player badge (`L` / `P`), player name, total shots count, and horizontal stacked bar (`In %` green `#16c60c`, `Net %` magenta `#ec4899`, `Out %` red `#ef4444`).
3. **Speed & Percentile Rows (`Smash` and `Drive / Fast Drop`)**:
   * Displays `Average Speed` and `Top Speed` (with `km/h` and `mph` toggle), horizontal percentile bar with marker triangle, and a clickable green **`👁️` icon** next to `Top Speed` that isolates that single fastest shot on the 3D court and jumps the video to it.
4. **Net Clearance Profile Graphic**:
   * Clean visual cross-section of the net: green zone above the white net tape ($Z > 1.524\text{ m}$), light-grey net mesh ($0 < Z \le 1.524\text{ m}$), and red floor fault strip, plotting height dots where filtered shots cross the net plane.

### 2.2 Top-Right 3D Court Viewport & Filter Bar (`ss1`)
1. **Minimalist PB-Vision Court Aesthetics**:
   * Clean white viewport background (`#ffffff`), light warm-grey court surface (`#e2e4e8`), dark charcoal 40mm BWF boundary lines (`#52555a`), translucent grey net with dark vertical net posts and subtle floor shadow around the net (non-volley / front-court kitchen visual reference).
2. **3D Shot Arcs + 2D Floor Shadow Curves**:
   * **3D Arc**: Smooth curve through `shot.path` (`[[x, y, z], ...]`), colored bright green (`#65cf28`) for in-bounds shots, red (`#ef4444`) for out/net errors, and subtle grey when unselected/faded.
   * **Floor Shadow**: For every visible 3D arc, render a matching 2D curve projected flat onto the court floor ($Z = 0.003\text{ m}$) in translucent grey (`#9ca3af`, opacity 0.45) with a small grey start dot, plus a colored landing dot at the end of the 3D arc.
3. **Right-Edge Camera Preset Toolbar (6 Icon Buttons)**:
   * `Isometric 3D` (active green border highlight)
   * `Top-Down 2D` (orthographic overhead)
   * `Side Elevation` (orthographic profile view looking along the net tape — shows net clearance & smash angle)
   * `Net-Level POV` (low elevation looking across the net)
   * `Behind Baseline` (player POV from behind the baseline)
   * `Fullscreen` (bottom-right corner button)
4. **Bottom Filter Bar**:
   * **Sequence / Rally Filter**: `All Shots`, `Serves`, `Returns`, `3rd Shots`, or specific `Rally #1..N`.
   * **Shot Type Filter**: `All Shot Types`, `Smash`, `Drive`, `Drop`, `Clear`, `Lift`, `Net Shot`.
   * **`Shot Explorer` Button**: Opens synced video playback drawer/overlay for the selected shot(s) so clicking any arc on the court plays that exact video moment (`shot.time - 1.0s`).
   * **`Shot Quality` Bar**: Shows computed shot quality score (`0–100%`) based on speed, depth, and line proximity.

### 2.3 Bottom Analytics Cards (`ss2`)
1. **Court Coverage Card**:
   * Shows `Distance Covered: X m (Y ft)`.
   * Top-down half-court diagram with smooth multi-band KDE contour heatmap (soft green $\to$ yellow $\to$ orange $\to$ vibrant pink/magenta core) generated from player ankle trajectories.
2. **Serves & Returns / Shot Depth Card**:
   * `Serves In / Out` & `Returns In / Out` full-width green accuracy bars.
   * `Serve & Return Depth` (or `Rally Landing Depth`):
     * Left: Mini court diagram showing `Deep` (Green), `Medium` (Amber), and `Shallow` (Orange) target zones on the opponent's half, with a sight-cone from the player diamond badge `[L]`.
     * Right: Two clean SVG donut charts (`Serve Depth` and `Return Depth` / `Attack Depth`) with percentage labels inside each ring segment.

---

## 3. Concrete Execution Plan

1. **Step 1 — Fix 2D Tracking & Eliminate "Fake Frames" (`engine/tracknet.py`)**:
   * Add spatial continuity / max-velocity outlier filtering to strip 1–3 frame false positives on shoes/logos.
   * Add the `y > height * 0.05` (`54 px`) ceiling gate to `_apply_inpaintnet()` and use `sliding_step=1` weighted temporal ensembling matching official TrackNetV3.
2. **Step 2 — True Multi-Point 3D ODE Trajectory Reconstruction (`engine/aerodynamics.py` / `reconstruct3d.py`)**:
   * Replace the broken single-last-ray `Z=0` intersection in `monomorphic_3d_trajectory_fit()` with full multi-point `scipy.optimize.least_squares(loss='soft_l1')` fitting against all visible TrackNet `(u_i, v_i)` points between hitter and receiver court positions.
   * Export genuine `path: [[x, y, z], ...]` arrays and player court positions into `data/match_telemetry.json` and `js/telemetry-data.js`.
3. **Step 3 — Redesign Frontend to Match `ss1` & `ss2` (`index.html`, `js/three-viewport.js`, `js/app.js`)**:
   * Replace the Casio Edifice watch cockpit with the clean PB-Vision white/light-grey card layout (`ss1` top Shot Explorer + Player Card, `ss2` bottom Court Coverage KDE + Depth Donuts), while keeping synced video clip playback when clicking any shot arc or `👁️` button.
