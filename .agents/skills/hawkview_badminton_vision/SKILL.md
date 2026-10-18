---
name: Hawkview Badminton Analytics & Sports Vision Protocol
description: Master architectural overview, PB-Vision 3D Shot Explorer UI/UX specification, interactive 6-point MP4 calibration wizard, and frontend-backend telemetry contract for Hawkview.
---

# Hawkview: 3D Badminton Shot Explorer & Match Analytics Platform

## 1. Project Overview & Repository Structure
- **Repository**: `/Users/anyasmac/GitHub/Hawkview` (`https://github.com/NeonMaru/Hawkview`)
- **Local Dev Server**: `python3 -u server.py 8123` (`http://localhost:8123`, supports HTTP 206 byte-range video scrubbing + live upload/calibration/streaming APIs)
- **Design Language**: Clean, high-density **PB-Vision style** sports analytics workspace (`css/hawkview.css`, Light & Dark themes, tabular numerals, zero skeuomorphic/chronograph clutter).

```
Hawkview/
├── index.html                  # Side-by-side Desktop Cockpit + responsive Mobile layout
├── css/hawkview.css            # PB-Vision theme tokens (:root light & [data-theme="dark"])
├── server.py                   # Range-enabled HTTP server + /api/upload-video, /api/auto-calibrate, /api/analyze-start, /api/analyze-status
├── js/
│   ├── app.js                  # Master coordinator, theme switcher, keyboard shortcuts
│   ├── three-viewport.js       # Three.js BWF court, floor-pinned score mats, 16-feather 3D shuttlecock, NURBS directional chevrons
│   ├── shot-explorer.js        # 3D trajectory arcs, Playback vs Explorer mode, rally scrubber, last-4-shots fade, clutter clearing
│   ├── video-loader-modal.js   # True "Load MP4" wizard: 6-point homography court/net calibrator, 2.6x touch loupe, live rally streaming
│   ├── broadcast-player.js     # 1:1 HTML5 video sync, rally timeline ticks, custom MP4 switching
│   ├── filter-bar.js           # Multi-criteria shot filtering + toggle-off clutter clearing
│   ├── player-card.js          # Player picker, summary stats, Speed Table with eye toggles (👁), 3x3 Contact Map
│   ├── rally-deck.js           # Rally list, expandable shot drawer, BWF Section 1.5 score correction cascade
│   ├── analytics-cards.js      # 4 bottom cards: Court Coverage KDE, Serve, Rally Endings, Attack
│   └── anti-lag-modal.js       # Pipeline telemetry & measured accuracy inspector
├── engine/                     # 7-Stage Python CV & 3D Physics Pipeline (see hawkview_shuttle_tracking_and_3d_physics skill)
└── tests/
    └── test_physics_engine.py  # 11 unit & smoke tests covering aerodynamics, calibration, classification, and telemetry contract
```

---

## 2. Frontend UI/UX Architecture & Key Features

### 2.1 Desktop Side-by-Side Cockpit & Mobile Layout (`css/hawkview.css`)
- **Desktop (`>= 1180px`)**: CSS Grid layout (`295px minmax(0, 1.38fr) minmax(350px, 0.95fr)`) placing the **Player Card** on the left, the **3D Court & Shot Explorer** in the center, and the **Broadcast Video + Rally Deck** on the right so the user can watch the video and the 3D court simultaneously without scrolling.
- **Mobile / iPhone (`< 860px`)**: Single-column stack with a collapsible filter drawer (`#btn-toggle-mobile-filters`) and touch-friendly controls.

### 2.2 3D Court, Shuttlecock & NURBS Trajectory Visualization (`js/three-viewport.js` & `js/shot-explorer.js`)
- **Strict Resize Loop Guard**: `#three-viewport-container` is `position: absolute; inset: 0` inside `.hv-court-stage` (`overflow: hidden`), and `ResizeObserver` checks delta `>= 2px` via `requestAnimationFrame` so OrbitControls pan/zoom never causes layout feedback loops.
- **Vertically Resizable 3D Court**: Users can drag `#court-resize-handle` (bottom bar + `◢` corner grip) or `#court-height-slider` (`280px–860px`, persisted in `localStorage`).
- **Floor-Pinned Scoreboard Mats**: Player side, flag, name, and live rally score are rendered onto crisp `1024×220` canvas textures (`PlaneGeometry(5.6, 1.2)`) pinned flat on the court floor just outside the near (`y = -0.82 m`) and far (`y = 14.22 m`) baselines. They never block 3D trajectories when orbiting, and auto-flip 180° when viewed from the `Far` camera preset.
- **Blender NURBS-Style Directional Chevrons**: Every 3D shot curve displays sleek directional V-chevrons (`buildShotChevronSegments` in `js/shot-explorer.js`) whose spacing scales inversely with shot speed (`speedKmh = 380` smash → wide spacing `~2.35 m`, few fast chevrons; `speedKmh = 60` drop/net shot → dense spacing `~0.68 m`, many tight chevrons).
- **3D Feathered Shuttlecock (`buildShuttlecockMesh`)**:
  - Real 3D badminton shuttlecock (hemispherical cork base, cobalt-blue band, 16-ribbed conical feather skirt, open crown ring) oriented nose-first along the instantaneous 3D velocity tangent vector.
  - Scaled cleanly (`scale.setScalar(1.02)`) with **zero circle/ring clutter** on the floor.
  - **Strictly Single-Pass (Non-Looping)**: During a shot, the shuttlecock flies from hitter to receiver **once** and rests at the landing/intercept point until the next shot begins.
- **Last 4 Shots Fading Trail & Dedicated Rally Scrubber**:
  - In `Playback` mode, only the **last 4 shots** up to the current timestamp are shown (`100%`, `58%`, `32%`, `15%` opacity; older shots hidden) to prevent mid-rally visual spaghetti.
  - Hovering or clicking **`👁 Full Rally`** (`#btn-show-full-rally`) reveals all shots in the current rally at once.
  - The bottom of the 3D court has a dedicated **Rally Scrubber** (`#court-rally-slider`) with color-coded per-shot tick marks (`#court-rally-shot-ticks`) to scrub through the active rally shot-by-shot.
- **One-Click & Toggle-Off Clutter Clearing**:
  - Clicking an active **3×3 Contact Map cell** or **Speed Table eye button (`👁`)** a second time toggles it **OFF** and restores clean Playback mode (`clearAllFilters()`).
  - Whenever Explorer mode or any filter is active, a red **`✕ Clear Clutter`** button (`#btn-clear-3d-clutter`) appears in the 3D court header.

### 2.3 True `Load MP4` & Interactive 6-Point Court Calibrator (`js/video-loader-modal.js`)
- Clicking **`📂 Load / Calibrate MP4`** opens `#video-loader-modal`:
  1. **Upload Any Video**: Supports desktop drag-and-drop or iPhone Camera Roll `.mp4` / `.mov` / `.webm` uploads (`POST /api/upload-video`), probing resolution, FPS, duration, and returning a server-decoded JPEG preview (`frame_jpeg_b64`) so iOS Safari and desktop browsers always show the court frame immediately.
  2. **6-Point Interactive Calibrator**: Users drag **4 Court Corners** (`Near-L`, `Near-R`, `Far-R`, `Far-L`) + **2 Net Post Tops** (`Net-L`, `Net-R`) on `<canvas id="calib-court-canvas">`. A 60 FPS JS homography solver projects all BWF regulation lines and a 3D net mesh live, with a **2.6× touch magnifier loupe** in the opposite corner while dragging.
  3. **Progressive Rally-by-Rally Live Streaming**: Clicking **`🚀 Calibrate & Stream 3D Rallies Live`** starts `POST /api/analyze-start` and polls `GET /api/analyze-status` every 1 second. Each rally is streamed into the 3D Court (`hawkview:ralliesStreamUpdated`) the moment that single rally finishes, with a **`⏹ Stop & Keep Rallies`** button in `#live-analysis-banner`.
