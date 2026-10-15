---
name: Hawkview Badminton Analytics & Sports Vision Protocol
description: Master architectural vision, Casio Edifice sports chronograph design system, on-device mobile AI pipeline, and 3D physics specifications for the Hawkview badminton match analytics platform.
---

# Hawkview: Badminton Analytics & Sports Vision Protocol

## 🏸 1. Core Vision & Business Thesis

* **The "Mamak Stall" Philosophy**: Badminton is a community sport. Friends, amateur players, and fans debrief matches over drinks at a mamak stall or cafe. They want quick, digestible, high-impact numbers:
  * *"Did you see that smash? How fast was that?"* (e.g. 412 km/h vs 320 km/h)
  * *"Why did LZJ win that set? Look at the court coverage!"* (e.g. pinned opponent to the backhand line 65% of the time).
  * Point-by-point score progression (e.g. 4-5 ➔ 5-5 ➔ 6-5) linked to exact video moments.
* **The "You Own It" Offline Business Model**:
  * **Zero Server Overhead ($0.00 / month)**: No cloud GPU servers to rent, no AWS bills, no subscription churn.
  * **One-Off Purchase**: The user buys the app once (e.g., $19.99 / RM 89). Upgrades can be major paid versions (V2/V3).
  * **On-Device Edge Computing**: The user's phone (iPhone 15 or Snapdragon 8 Android) performs the computer vision locally using dedicated hardware NPUs (Apple Neural Engine / Qualcomm Hexagon).
  * **Instant Shareable Telemetry**: Only the lightweight 1MB `match_telemetry.json` is exported/shared, allowing instant web replay on any browser without moving gigabytes of video.

---

## ⌚ 2. Design System: Casio Edifice Sports Chronograph

The visual language of Hawkview is inspired directly by the **Casio Edifice High-Performance Sports Chronograph** series (featuring dual-time analog-digital motors, carbon weave dials, tachymeter bezels, and precision split-second telemetry):

### 2.1 Core Materials & Palette
* **Base Plate / Dial**: Deep Carbon Fiber Weave (`#090a0d` to `#11141c`) with subtle 45° diagonal texture.
* **Chassis & Bezel**: Brushed Titanium / Gunmetal Steel (`#1e232d` border, `#2a3241` metallic highlights, `#3a4559` chamfered bevels).
* **Tachymeter Outer Ring**: High-contrast numbered scale markings (`60, 65, 70 ... 400, 500`) for instantaneous velocity reading.
* **Negative LCD Digital Displays**: Inverted black LCD screens (`#05080c` recessed background) with crisp turquoise / ice-blue (`#00f0ff` / `#38bdf8`) or amber/lime dot-matrix / 7-segment digital readouts for Scorebug, Timers, and Frame counters.
* **Luminescent Accent Colors**:
  * **Primary Speed / Electric Accent**: Electric Ice Blue (`#00f0ff` / `#38bdf8`) or Circuit Teal (`#00e5a3`).
  * **Smash / High-Intensity Needle**: Racing Red / Fluorescent Orange (`#ff2e5b` / `#ff5722`).
  * **Court Green**: Yonex Official Court Mat Emerald (`#0f766e` / `#10b981`).

### 2.2 Mechanical Telemetry Components
1. **Chronograph Sub-Dials**:
   * **Smash Speedometer**: Radial gauge with metallic needle and color-coded zones (Green: <200 km/h, Yellow: 200–320 km/h, Redline: >350 km/h).
   * **Rally Shot Counter**: Dual-hand 60-shot mechanical register.
   * **Fatigue / Sprint Intensity Gauge**: Micro-dial showing physical exertion and court sprint pace.
2. **Knurled Pusher Buttons**:
   * Industrial tactile buttons (`START/STOP`, `LAP/SPLIT`, `RESET`, `ANALYZE`) with cross-hatched knurled metal borders and active mechanical click states.
3. **Multi-Stage "Anti-Lag" Progress Bar**:
   * Designed like a stopwatch countdown complication.
   * Includes live FPS meter, current stage name, frame counter ticker (e.g. `14,210 / 28,800`), and live telemetry teasers (*"⚡ 398 km/h smash discovered at 04:12"*).

---

## 🔬 3. Computer Vision & Physics Architecture

### 3.1 The 5-Stage Pipeline
```
[Video Clip: 1080p60 / 720p60]
       │
       ├──► Stage 1: Court Calibration & Homography (CourtKeyNet + OpenCV)
       │    - Identifies 4 outer corners + net posts.
       │    - Solves 3x3 ground homography H and 3x4 camera projection matrix P = K[R | t].
       │
       ├──► Stage 2: Rally Segmentation & Scoreboard OCR (PaddleOCR / MobileNetV3)
       │    - Camera view filter discards close-ups and slow-mo replays.
       │    - Crops BWF scorebug ROI, reads player names & scores (e.g. 4-5 ➔ 5-5).
       │    - Enforces monotonic +1 score transition rule.
       │
       ├──► Stage 3: Shuttlecock 2D Tracking (TrackNetV3 / TrackNetV4)
       │    - 3-frame concatenated input (9 channels @ 640x360).
       │    - Predicts Gaussian probability heatmaps.
       │
       ├──► Stage 4: Physics-Constrained 3D Monocular Trajectory (MonoTrack)
       │    - Resolves 2D pixel to 3D ballistic coordinates (X, Y, Z).
       │    - Aerodynamic drag ODE: m * d^2X/dt^2 = m*g - 0.5 * rho * Cd * A * ||v|| * v.
       │    - Yields true initial smash velocity (eliminates 2D ground projection error).
       │
       └──► Stage 5: Player Pose & Court Heatmap (YOLO11-pose + ByteTrack)
            - 17 keypoints at 15 FPS; ankle midpoint projected to metric court (13.4m x 6.1m).
            - Net-side bounding rule guarantees zero player ID swaps.
```

---

## 📱 4. On-Device Mobile Execution Profile

* **Apple iOS (iPhone 15 / 15 Pro / 16)**:
  * 16-core Apple Neural Engine (ANE) via CoreML (`.mlpackage`).
  * Dedicated hardware H.264/HEVC decoding via `AVAssetReader` to `CVPixelBuffer`.
  * TrackNetV3 inference: ~3.5ms per 3-frame bundle (200+ FPS).
* **Android (Snapdragon 8 Gen 2/3/4)**:
  * Qualcomm Hexagon NPU via ONNX Runtime with Qualcomm QNN Execution Provider or NNAPI.
* **Compute Optimization**:
  * Active Rally Gating skips downtime (saving 65% of frames).
  * Decoupled rates: Shuttle @ 60 FPS, Player Pose @ 15 FPS.
  * Turnaround: An 8-minute BWF highlight clip digests in ~2–3 minutes on device.

---

## 📊 5. Output Telemetry Data Contract

The pipeline emits a self-contained `match_telemetry.json` (~800KB to 1.5MB) containing:
* Match metadata & player assignments.
* 3x3 homography matrix and court dimensions.
* Rallies list with start/end timestamps, start/end scores, winning player.
* Shot-by-shot sequence: timestamp, hitter ID, stroke type (smash, drop, clear, drive, net kill), 3D hit coordinate, 2D landing coordinate, initial velocity (km/h), and 3D trajectory points.
* Cumulative distance covered and 2D court coverage KDE matrices.
