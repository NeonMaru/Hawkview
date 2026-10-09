# 🏸 Hawkview: Badminton Analytics & Sports Vision Cockpit

> **Casio Edifice Sports Chronograph Flat Design Language** paired with **Real Three.js 3D Court Vision** and **On-Device Edge Computer Vision Telemetry** for high-octane BWF match analysis.

---

## ⌚ 1. Flat Technical Instrument Design System

Hawkview pairs the technical precision of the **Casio Edifice High-Performance Chronograph Series** with a modern flat, sharp instrument aesthetic:

* **Dark Flat Surfaces**: `#05070a` base, `#0a0e14` chassis, and `#0f1722` control surfaces with crisp 1px borders (`#1e293b`).
* **Zero Pillow Bevels & Puffy Gradients**: All skeuomorphic bulging gradients and pillow bevels removed in favor of clean technical instrument controls with high-contrast hover and active feedback.
* **Subtle Flat Carbon Weave**: Micro-weave technical texture on dials and chassis maintaining tactile chronograph heritage.
* **Dual Negative LCD Displays**:
  * **Scorebug**: Recessed dark matrix display with glowing ice-blue (`#00f0ff`) and orange (`#ff5722`) digital readouts (`MAS LEE Z.J. 08 - 08 SU L.Y. TPE`).
  * **Rally Stopwatch Timer**: 1/100 sec emerald green (`#00e5a3`) digital timer (`00:19.10`), match split indicator (`05:25`), and live shot cadence (`1.42 shot/s`).
* **Tactile Flat Pusher Buttons**:
  * `START/STOP` (Toggle telemetry playback & live watch tick)
  * `LAP/SPLIT` (Advance to next rally bookmark)
  * `MODE` (Cycle Full Chronograph, Court Heatmap Focus, and Radar Speed Focus)
  * `ANALYZE CLIP (ANE)` (Open the multi-stage ingestion modal)
* **Functional Sub-Dials (60FPS Canvas)**:
  1. **Smash Speedometer (0 - 500 km/h)**: Precision needle and redline indicator locked to Lee Zii Jia's **412 km/h nuclear smash**.
  2. **Rally Shot Counter (0 - 60 Shots)**: Precision dual-hand mechanical register.
  3. **Sprint & Court Coverage Meter**: Dual-arc meter displaying cumulative distance covered (km) and court burst sprint velocity.

---

## 🌐 2. Real Three.js 3D Court Viewer with Free Tilt / Orbit

The left viewport features a fully interactive 3D WebGL engine built with **Three.js (r128)** and **OrbitControls**:

* **Free 3D Navigation**: Click and drag with left mouse button to rotate and tilt around the court; scroll wheel to zoom; right-click to pan.
* **5 Camera Presets**:
  * `[BWF Broadcast View]` — Elevated camera behind near baseline matching the official Arctic Open TV broadcast angle.
  * `[Behind Server / LZJ]` — Immersive low-angle perspective behind Lee Zii Jia.
  * `[Side Angle]` — Side-court profile showing net clearance and smash trajectory.
  * `[Bird's-Eye Top Down]` — True 90° tactical overhead bird's-eye view.
  * `[Reset Orbit]` — Smoothly returns the camera to the default broadcast view.
* **Regulation BWF Court Dimensions**:
  * Total Length: 13.40 meters
  * Doubles Width: 6.10 meters
  * Singles Width: 5.18 meters (0.46m tramlines)
  * Net Height: 1.55 meters at posts (placed 0.15m outside doubles lines), 1.524 meters in center
  * Short Service Line: 1.98 meters from net
  * Doubles Long Service Line: 0.76 meters inside back baselines
  * Court Lines: White regulation 40mm thickness
* **Ballistic 3D Shuttlecock & Aerodynamic Trail**:
  * Modeled cork base and 16-feather skirt oriented along velocity vector.
  * Glowing supersonic vapor trail: Ice-blue during normal exchanges, switching to blazing redline (`#ff2a55`) on smashes exceeding 380 km/h.
  * Altitude-dependent ground shadow.
* **3D Animated Player Models**:
  * Lee Zii Jia (`🇲🇾 MAS`, Cyan jersey, Victor racket) & Su Li Yang (`🇹🇼 TPE`, Orange jersey, Yonex racket).
  * Animated stroke movement and jump smash elevation (LZJ leaps 0.85m into the air for the 412 km/h smash).

---

## 📐 3. Synchronized 2D BWF Court Canvas

* **Strict Regulation Aspect Ratio**: Aspect ratio is locked to 13.40m : 6.10m with uniform scaling and zero distortion on any display.
* **Live Telemetry & Heatmap**:
  * Real-time footstep trails for both players.
  * Kernel Density Estimation (KDE) court coverage heatmap toggle.
  * Metric coordinate hover inspector (`X: 3.05m | Y: 1.80m [LZJ HALF]`).

---

## ⚡ 4. The "Is This Shit Lagging?" Multi-Stage Progress Bar

An interactive modal simulating on-device Neural Engine video ingestion on an iPhone 15 / Apple Neural Engine (ANE) with **$0.00 / month server overhead**:

1. **Stage 1: Court Line Calibration & Homography (0-15%)** — CourtKeyNet identifies 4 corners + 2 net posts, solving ground homography $H$ with error $< 0.82\text{px}$.
2. **Stage 2: Rally Segmentation & Scorebug OCR (15-30%)** — PaddleOCR isolates the BWF scorebug and discards 62% downtime/replays.
3. **Stage 3: Shuttlecock & Player Pose Tracking (30-85%)** — TrackNetV3 (9-channel concatenated input) + YOLO11-Pose with a live frame ticker (`18,420 / 28,800 frames @ 148 FPS`).
4. **Stage 4: 3D Aerodynamic Speed & Heatmap Synthesis (85-100%)** — MonoTrack solves aerodynamic drag ODEs to eliminate 2D ground projection error and resolve true 3D smash velocity.
5. **Real-time Teaser Ticker**: Live alerts highlighting discoveries (e.g., *"⚡ Detected 412 km/h smash by Lee Zii Jia at 05:28!"*).

---

## 🚀 5. Quick Start & Execution

Serve the application locally with any web server:

```bash
# Using Python 3:
python3 -m http.server 3000

# Or using Node.js:
npx serve . -p 3000
```

Open `http://localhost:3000` in any modern web browser.

### Keyboard Shortcuts
* `SPACE`: Start / Stop match telemetry playback
* `1` - `5`: Jump between Rally Bookmarks (Rally 12, LZJ 412km/h, Rally 21, Rally 34 Marathon, Rally 45 Match Point)
* `C`: Cycle 3D Camera Presets (Broadcast -> Server -> Side -> Top)
* `Left / Right Arrow`: Step backward / forward shot-by-shot
* `M`: Cycle display mode
* `H`: Toggle 2D court heatmap overlay
* `A`: Open the on-device ANE ingestion modal
