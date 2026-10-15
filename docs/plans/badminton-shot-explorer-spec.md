# Hawkview Badminton Shot Explorer — UI & Rules Spec

**Status:** decided by Sam on 2026-10-14. Supersedes section 3 of
`shot-explorer-plan.md` and sections 5–6 of
`pb-vision-reverse-engineering-and-badminton-blueprint.md`.

**Decisions:**
1. The Casio Edifice design is dropped completely. Hawkview takes PB Vision's
   clean look.
2. Nothing pickleball-specific survives: no "3rd shot", no bounce logic, no
   kitchen, no serve/return depth zones, no DUPR.
3. Every rule, zone, shot type and stat follows BWF Laws of Badminton.

The pipeline phases in `shot-explorer-plan.md` (A–G) still apply. This file
replaces only what the user sees, and adds the badminton rules the pipeline
must enforce.

---

## 0. Fix first (before Phase B)

These came out of reviewing the blueprint and the repo. Fix them before
building on top.

1. **InpaintNet top-of-frame gate** (`engine/tracknet.py`, `_apply_inpaintnet`).
   Match the official TrackNetV3 `generate_inpaint_mask`: only fill a gap when
   the last detection before it **and** the first detection after it are both
   below `0.05 × frame_height` from the top edge. A shuttle that left the top
   of the frame stays missing in 2D. Phase E bridges it in 3D with the drag
   model.
2. **Raw-detection speed gate.** Some jumps are not InpaintNet's fault. Frames
   2458→2459 jump 1,593 px, and frame 2459 is a raw detection at y≈24. Before
   inpainting, drop any raw detection that is more than 250 px from both its
   neighbours within 2 frames. Log how many were dropped per rally.
3. **Calibration overfit.** `calibration.json` now has fx = 3016 and
   fy = 3491, and cy sits exactly on the ±50 px bound (490). Broadcast cameras
   have square pixels. Use one focal length (fx = fy). Either fix (cx, cy) at
   the image centre, or add a penalty for moving away from it, and never let
   it hit a bound. Then add the 4 short-service-line/centre-line
   intersections as extra ground points.
   Net posts stand **on** the doubles sidelines (BWF Law 1.6). The solve
   already uses x = 0 and x = 6.10, but the debug overlay in
   `engine/court_calib.py:312-313` draws them 0.15 m outside. Make it match.
   **Accept when:** 3D reprojection ≤ 3 px, fx = fy, the principal point is
   not on a bound, and the camera position is 10–25 m behind the near
   baseline and 3–12 m up.

---

## 1. Badminton rules the pipeline must use

### 1.1 Court
- 13.40 m × 6.10 m (doubles) and 5.18 m (singles, sidelines 0.46 m inside).
  The net is on y = 6.70 m: 1.55 m high at the posts and 1.524 m at the
  centre. Posts stand on the doubles sidelines.
- Lines: short service line 1.98 m from the net, centre line, doubles long
  service line 0.76 m inside each back boundary line. All lines are 40 mm
  wide.
- **A line is part of the area it bounds.** A shuttle landing on the line is
  in.
- Store the match type (`"singles"` / `"doubles"`) in `match.json`. LZJ vs
  Popov is singles.

### 1.2 Boundaries
| Situation | Side lines | Back line |
|---|---|---|
| Singles rally | singles sideline | back boundary line |
| Singles serve | singles sideline, centre line, short service line | back boundary line (long and narrow) |
| Doubles rally | doubles sideline | back boundary line |
| Doubles serve | doubles sideline, centre line, short service line | doubles long service line (short and wide) |

A serve must land in the service court diagonally opposite the server.

### 1.3 There is no bounce
- The rally ends the moment the shuttle touches the floor. Every shot except
  the last is hit in the air.
- So a **mid-rally shot has no landing point**. It runs from contact to the
  next contact. Only the **rally-ending shot** has a floor landing (or ends
  at the net).

### 1.4 Shot validity
- Every shot must cross the net plane above the net (net clearance > 0 at
  y = 6.70). A shot that doesn't is `error_net`. A shot that clips the tape
  and still goes over is legal, including on the serve.
- Hitters strictly alternate sides. Never assign two shots in a row to the
  same side; if hit detection does, the rally is flagged for review.
- **Serve height:** the whole shuttle must be below 1.15 m when it is hit
  (BWF Law 9.1.6). Flag a serve as `possible_fault_height` only when the
  fitted contact z is above 1.15 m by more than the fit's own uncertainty.
  Never present it as a definite call.
- **In/out:** the cork's footprint (radius about 13 mm) touching any part of
  the line counts as in. When the estimated landing is within 0.15 m of a
  line, mark it `close_call: true` and show it as "close". Monocular 3D is not
  accurate enough to call those.

### 1.5 Scoring and serving (used to check rallies and drive the Rally Deck)
- Rally-point scoring to 21, win by 2. At 29-all, the 30th point wins. Best
  of 3 games.
- The winner of a rally serves the next one.
- **Service court:** server's score even → serves from the right court; odd →
  from the left.
- **Ends:** players change ends after game 1, after game 2, and in game 3
  when the leading side first reaches 11. Use this to check near/far player
  assignment. Never hardcode which player is on which end.
- **Intervals:** about 60 s when the leading score reaches 11, and about 120 s
  between games. Phase B can expect these long gaps.
- Any computed score sequence that breaks these rules marks the affected
  rallies `needs_review: true`. Correct the rally; never the rules.

### 1.6 Badminton shot types (replaces the rules in Phase F)
Contact zones (measured from the hitter's side of the net):
**front** = within 1.98 m of the net (in front of the short service line),
**rear** = within 2.0 m of the back boundary line, **mid** = the rest.

| Type | Rule (first match wins, top to bottom) |
|---|---|
| `serve_short` / `serve_long` / `serve_flick` / `serve_drive` | First shot of the rally. Short: lands in the front 1 m of the service court. Long: peak > 4 m and lands in the back 1 m. Flick: low then lands deep, peak 2.5–4 m. Drive: flat, fast, peak < 2 m. |
| `smash` | Contact z > 2.2 m, steeply downward (angle below horizontal > 10°), speed > 150 km/h |
| `net_kill` | Contact in front zone, z > net height, downward, lands in front/mid zone |
| `drop` | Contact z > 2.0 m in rear/mid zone, lands in front zone of the other side, speed < 150 km/h |
| `clear` | Peak > 5 m and lands in the rear zone. `attacking_clear` if peak < 6.5 m, otherwise `defensive_clear` |
| `lift` | Contact z < net height in front/mid zone, peak > 4 m, lands in rear zone |
| `net_shot` | Contact and landing both in front zones, peak < net height + 0.5 m |
| `push` | Contact in front/mid zone near net height, flat, lands in mid/rear zone |
| `drive` | Flat (peak − contact z < 0.6 m), crosses near net height, speed > 100 km/h |
| `block` | Return of a smash or drive that lands in the front zone of the other side |
| `other` | Anything left over. Never force a type. |

`jump_smash` needs pose (both ankles off the floor at contact) and comes
later. Show `smash` until then.

### 1.7 Outcomes (per shot)
- `continue`: the opponent hit it back.
- `winner`: the rally-ending shot landed in, or the opponent touched it but
  couldn't return it over the net.
- `error_out`: the rally-ending shot landed out.
- `error_net`: it didn't clear the net.
- `unknown`: the rally was cut short by the broadcast edit. Also set
  `rally.partial = true`.

---

## 2. Visual design (replaces Casio Edifice everywhere)

### 2.1 Remove
- `css/edifice.css` (replace with `css/hawkview.css`), carbon-weave
  textures, chassis screws and bevels, tachymeter rings, knurled pusher
  buttons, LCD/7-segment digit styling.
- `js/subdials.js` and the three analog sub-dials.
- The arena scene in `js/three-viewport.js`: hoardings, seating, blue
  surround, player mannequins, the single shuttle mesh with a 50-point trail,
  and the `Math.sin` arc (line ~977).
- The chronograph styling on the progress modal. Keep the modal, plain, with
  real numbers only.

### 2.2 Tokens (`:root`, with a dark-mode set)
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f5f6f8` | `#0f1115` |
| `--panel` | `#ffffff` | `#171a20` |
| `--text` | `#1c1f24` | `#e8eaee` |
| `--muted` | `#6b7280` | `#9aa1ab` |
| `--court-floor` | `#dcdfe4` | `#22262e` |
| `--court-line` | `#2b2f36` | `#d5d8dd` |
| `--net` | `#6b7280` at 45 % | `#9aa1ab` at 45 % |
| `--shot-continue` | `#5fae3a` | `#7cc84a` |
| `--shot-winner` | `#2563eb` | `#4c8dff` |
| `--shot-error` | `#d93025` | `#ff5a4f` |
| `--shot-selected` | `#f59e0b` | `#fbbf24` |

Font: one system sans stack (`-apple-system, Inter, Segoe UI, sans-serif`),
tabular numbers for stats. No glow, no gradients.

---

## 3. Layout

```
┌───────────────┬────────────────────────────────────────────┬────┐
│ PLAYER CARD   │  3D COURT (Shot Explorer)                  │ 3D │
│ (pick player) │                                            │ Top│
│               │                                            │Side│
│               │                                            │Net │
│               │                                            │Near│
│               │                                            │Far │
│               │                                            │ ⛶  │
│               ├────────────────────────────────────────────┴────┤
│               │ FILTER BAR                                       │
├───────────────┼─────────────────────────────────────────────────┤
│ RALLY DECK    │ VIDEO (existing player, 1:1 sync)                │
├───────────────┴─────────────────────────────────────────────────┤
│ ANALYTICS: Court coverage · Serve · Rally endings · Attack       │
└─────────────────────────────────────────────────────────────────┘
```
On a phone, stack the sections vertically: court, filter bar, video, player
card, Rally Deck, analytics.

### 3.1 3D court (`js/shot-explorer.js`, new; slim `three-viewport.js` down to scene setup)
- Flat floor, all BWF lines from 1.1 at the true 40 mm width, a translucent
  net panel with posts at true heights.
- **Mid-rally shot:** a 3D arc from contact to the next contact, plus a small
  ring at each contact point with a thin vertical stem to the floor so the
  height reads.
- **Rally-ending shot:** an arc to the floor landing, with a filled disc
  there (red if out, blue if in, a hollow ring if `close_call`). For
  `error_net`, the arc ends at the net.
- Arcs are sampled from the Phase E fit (`shot.path`), never synthesised.
  Low-confidence fits are drawn dashed at 40 % opacity.
- Two modes:
  - **Playback** (follows the video): the current shot at 100 %, earlier
    shots in the rally at 30 %, later shots hidden.
  - **Explorer** (when a filter is active): every matching shot at 100 %,
    with the rest of the match hidden.
- Hover shows a tooltip with type, hitter, speed (est.), contact height, net
  clearance and time. Clicking seeks the video to `shot.time − 1 s`, plays,
  and highlights the arc in `--shot-selected`.
- Camera buttons: `3D` (elevated, behind the near baseline), `Top`
  (orthographic), `Side` (level with the net line, net in profile), `Net`
  (eye level at the net post), `Near` / `Far` (behind each baseline at
  player eye height), fullscreen.
- Performance: merge the unselected arcs into one `LineSegments` per
  colour.

### 3.2 Filter bar
`Game` · `Rally` · `Player` · `Shot type` (from 1.6) · `Outcome` (from 1.7) ·
`Contact zone` (front / mid / rear) · `Min speed` slider ·
`Rally-ending shots only` toggle · `Clear filters`.

### 3.3 Player card
- Name, flag, handedness, current end.
- Shots, % in (rally-ending shots that landed in), winners, errors split into
  out and net.
- **Speed table**: one row per shot type (smash, clear, drive, drop, serve)
  with average and top speed (est.) and an eye toggle. The eye filters the 3D
  court to that player's shots of that type.
- **Contact map**: a top-down half court split 3 × 3 (front/mid/rear ×
  forehand/centre/backhand side, mirrored by handedness), shaded by how often
  the player hit from each cell. Clicking a cell filters the court.
- Contact filmstrip (3 cropped frames around contact) is a later phase. Leave
  room, ship without it.

### 3.4 Rally Deck
- One row per rally: rally number, game, score before → after, server and
  service court, shot count, how it ended (winner / out / net), and badges
  for `partial` and `needs_review`.
- Expanding a row lists its shots (time, hitter, type, speed). Clicking one
  seeks the video.
- **Correct outcome:** a "⋯" menu with "Change rally winner". It recomputes
  every later score, server and service court from 1.5, and saves to
  `data/matches/<id>/corrections.json`, separate from computed output.

### 3.5 Analytics cards (badminton only)
1. **Court coverage**: distance covered per player (m), average per rally,
   and a KDE heatmap of foot positions on a top-down court.
2. **Serve**: serve-type mix, where serves landed inside the service court
   (front / back × centre / wide), `possible_fault_height` count, and the %
   of rallies won on own serve.
3. **Rally endings**: how points ended per player (winners, opponent out,
   opponent net) and a rally-length histogram (shots per rally).
4. **Attack**: smash count, average/top smash speed (est.), the % of smashes
   that ended the rally, and average smash net clearance.

Every number shows "—" when it hasn't been measured. Speeds always carry
"est.".

---

## 4. Contract additions (on top of Phase G)
- `match.json`: `"match_type": "singles" | "doubles"`, handedness per
  player.
- `rally`: `server`, `service_court` (`"left"|"right"`), `score_before`,
  `score_after`, `ends` (which player is near), `partial`, `needs_review`.
- `shot`: `contact` [x, y, z], `contact_zone`, `next_contact` or `land`
  (exactly one, per 1.3), `net_clearance_m`, `close_call`,
  `possible_fault_height` (serves only).

---

## 5. Order of work
1. Section 0 fixes (re-run the Phase A and C checks, report real numbers).
2. Phases B, D, E, F from `shot-explorer-plan.md`, using the rules in
   section 1.
3. Remove the Edifice UI (2.1), then build the court (3.1), the filter bar,
   the Rally Deck, the player card, then the analytics.
4. Accept when, on LZJ vs Popov:
   - the Rally Deck's score sequence passes every rule in 1.5;
   - filtering "LZJ · smash" shows only steep arcs starting from LZJ's
     rear/mid court;
   - clicking 10 random arcs each seeks to the right moment.
