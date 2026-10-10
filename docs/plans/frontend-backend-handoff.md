# Hawkview Frontend / Backend Cross-Agent Handoff

**Timestamp:** 2026-10-10 16:42:00  
**Between:** Backend Engine Pipeline Agent (`7114ffde-f9c0-4d1b-a79d-d8bfc41ab495`) & Frontend Agent Claude (`ea6a2703-56c7-4216-b82c-e58cff24903a`) & "Redoing 3D Court View" Agent (`2d57985a-6764-4025-b00b-98b16c551cdd`).

---

## 1. What the User Requested for Frontend ("Redoing 3D Court View")

1. **PB-Vision Style Clean 3D Court View:**
   - Strips out bulky stadium surrounds, high walls, and static mannequins.
   - Minimalist regulation court: flat light-grey / neutral matte floor, dark 40mm BWF boundary lines, thin semi-transparent net with 1.55m posts.
   - Toggle back to stadium arena look via existing mode button.

2. **Shot Trajectory Arcs with Temporal Opacity Decay:**
   - Current / live shot: fully bright, active stroke color (Cyan/Redline for smashes, Green for standard rally shots, Gold for winners).
   - Past shots in the current rally: render with decaying opacity (older shots fade to 20–40% opacity, newest shot at 100%).
   - Future shots: hidden until video player reaches timestamp.

3. **Casio Edifice Rally Deck Integration:**
   - In the right-hand panel (currently housing 2D court canvas and sub-registers):
     - **View Toggle:** `[ 2D TELEMETRY ]` vs `[ 🗂️ RALLY DECK ]` (or collapsible side drawer).
   - **Rally Deck Structure:**
     - Header Accordion: Shows `RALLY #X`, score progression (`0-0 -> 1-0`), shot count, and winner badge.
     - Expanded Rows: Lists each shot with timestamp, stroke tag, speed readout in LCD typography, and thumbnail preview.
     - Quick Correction: Discreet 3-dot menu allowing manual flip of point outcome (`Change Winner: P1 <=> P2`) with automatic downstream score recalculation for recreational matches.

---

## 2. Current Backend Status & Data Artifacts

1. **Phase A (Court Calibration) — COMPLETE & FIXED (`commit 2a74233`):**
   - Optical center strictly locked at image center: $c_x = 960.0\text{ px}, c_y = 540.0\text{ px}$.
   - Solved focal length: $f = 2,740.1\text{ px}$ ($FOV \approx 38.6^\circ$).
   - Net post top coordinates refined to sub-pixel precision from video:
     - Left post: `(521.80, 354.62)`
     - Right post: `(1401.50, 362.56)`
   - 5-frame line reprojection error: **1.00 px median error** (threshold $\le 4.0\text{ px}$).
   - Calibration file: [`data/matches/lzj_popov/calibration.json`](file:///Users/anyasmac/GitHub/Hawkview/data/matches/lzj_popov/calibration.json).

2. **Phase C (TrackNetV3 Shuttlecock Tracking) — COMPLETE (`commit 2a74233`):**
   - Checkpoints loaded: `TrackNet_best.pt` (136.2 MB) & `InpaintNet_best.pt` (6.3 MB) on Apple Silicon MPS.
   - Tested on 3 hand-picked rallies (1,123 total frames):
     - Rally 1 (frames 740–950): 165 visible (78.2%), 14 inpainted.
     - Rally 2 (frames 1180–1700): 428 visible (82.1%), 17 inpainted.
     - Rally 3 (frames 2070–2460): 320 visible (81.8%), 27 inpainted.
     - **Combined Visibility Ratio:** **81.3%** (threshold $\ge 80.0\%$, **PASSED**).
   - Trajectory output: [`data/matches/lzj_popov/shuttle_2d.csv`](file:///Users/anyasmac/GitHub/Hawkview/data/matches/lzj_popov/shuttle_2d.csv).
   - Visual verification video: [`data/matches/lzj_popov/debug/tracknet_probe.mp4`](file:///Users/anyasmac/GitHub/Hawkview/data/matches/lzj_popov/debug/tracknet_probe.mp4).
   - Proof strips: `data/matches/lzj_popov/debug/tracknet_strip_rally1.png`, `rally2.png`, `rally3.png`.

---

## 3. Immediate Next Steps

1. **Backend Pipeline:**
   - Execute **Phase B (Broadcast Scoreboard OCR & Full-Match Rally Segmentation)** to segment all rallies and extract official score progression (`data/matches/lzj_popov/rallies.json`).
   - Execute **Phase D, E, F** to produce 3D shot curves and telemetry for each rally.
2. **Frontend Agent (Claude):**
   - Can now build the **Clean 3D Court View Toggle**, **Decaying Opacity Arc Shader**, and **Casio Edifice Rally Deck** UI components knowing the backend trajectory data format (`shuttle_2d.csv` and future `rallies.json` schema).
