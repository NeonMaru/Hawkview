# 🏸 Hawkview: Badminton Analytics & Sports Vision Cockpit

> **Casio Edifice Sports Chronograph Design Language** paired with **On-Device Edge Computer Vision Telemetry** for high-octane BWF match analysis.

---

## ⌚ 1. Casio Edifice Design System Overview

Hawkview Phase 1 transforms raw badminton video into a high-performance sports watch instrument inspired directly by the **Casio Edifice High-Performance Chronograph Series**:

* **Base Dial**: Deep Carbon Fiber Weave (`#090a0d` to `#11141c`) featuring a 45° sports micro-weave pattern.
* **Chassis & Bezel**: Brushed Titanium / Gunmetal Steel with chamfered bevels, hexagonal socket screws, and a high-contrast **Tachymètre Base 1000** outer ring.
* **Dual Negative LCD Displays**:
  * **Scorebug**: Inverted dark matrix display with glowing turquoise/ice-blue (`#00f0ff`) and orange (`#ff5722`) 7-segment digital scores (`MAS LEE Z.J. 08 - 08 SU L.Y. TPE`).
  * **Rally Stopwatch Timer**: 1/100 sec emerald green (`#00e5a3`) digital timer (`00:19.10`), match split indicator (`05:25`), and live shot cadence (`1.42 shot/s`).
* **Tactile Knurled Pusher Buttons**:
  * `START/STOP` (Toggle telemetry playback & live watch tick)
  * `LAP/SPLIT` (Advance to next rally bookmark)
  * `MODE` (Cycle Cockpit, Court Heatmap Focus, and Radar Speed Focus)
  * `ANALYZE CLIP (ANE)` (Open the multi-stage ingestion modal)
* **Functional Sub-Dials (60FPS Canvas)**:
  1. **Smash Speedometer (0 - 500 km/h)**: Color-coded zones (Green, Amber, Redline >350 km/h) with a metallic needle and redline indicator locked to Lee Zii Jia's **412 km/h nuclear smash**.
  2. **Rally Shot Counter (0 - 60 Shots)**: Precision dual-hand mechanical register.
  3. **Sprint & Court Coverage Meter**: Dual-arc meter displaying distance covered (km) and court burst sprint velocity.

---

## ⚡ 2. The "Is This Shit Lagging?" Multi-Stage Progress Bar

An interactive modal simulating on-device Neural Engine video ingestion on an iPhone 15 / Apple Neural Engine (ANE) with **$0.00 / month server overhead**:

1. **Stage 1: Court Line Calibration & Homography (0-15%)** — CourtKeyNet identifies 4 corners + 2 net posts, solving ground homography $H$ with error $< 0.82\text{px}$.
2. **Stage 2: Rally Segmentation & Scorebug OCR (15-30%)** — PaddleOCR isolates the BWF scorebug and discards 62% downtime/replays.
3. **Stage 3: Shuttlecock & Player Pose Tracking (30-85%)** — TrackNetV3 (9-channel concatenated input) + YOLO11-Pose with a live frame ticker (`18,420 / 28,800 frames @ 148 FPS`).
4. **Stage 4: 3D Aerodynamic Speed & Heatmap Synthesis (85-100%)** — MonoTrack solves aerodynamic drag ODEs to eliminate 2D ground projection error and resolve true 3D smash velocity.
5. **Real-time Teaser Ticker**: Live alerts highlighting discoveries (e.g., *"⚡ Detected 412 km/h smash by Lee Zii Jia at 05:28!"*).

---

## 🎥 3. Synchronized Broadcast Player & 2D Court Telemetry

* **Simulated BWF TV Broadcast**: Dynamic 3D perspective court rendering with animated player avatars, jump smash action, ballistic shuttlecock smoke trails, and BWF speed radar flash badges.
* **Custom Video Support**: Drag and drop any 1080p/720p `.mp4` file directly onto the video container to analyze external footage.
* **2D BWF Court Canvas (13.4m × 6.1m)**: Official Yonex tournament mat layout, player movement trails (Cyan for LZJ, Orange for SLY), height-dependent shuttle shadow, metric coordinate hover inspection, and Kernel Density Estimation (KDE) court coverage heatmaps.

---

## 🚀 4. Quick Start & Execution

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
* `Left / Right Arrow`: Step backward / forward frame-by-frame across shots
* `M`: Cycle display mode
* `H`: Toggle 2D court heatmap overlay
* `A`: Open the on-device ANE ingestion modal
