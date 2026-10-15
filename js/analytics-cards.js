/**
 * Hawkview Badminton Analytics Cards (Spec Section 3.5)
 * Implements the 4 badminton-only analytics cards:
 * 1. Court coverage: distance covered per player (m), average per rally (m),
 *    and a 2D canvas KDE heatmap of foot positions on a top-down BWF court.
 * 2. Serve: serve-type mix, where serves landed inside the service court
 *    (front / back × centre / wide), possible_fault_height count, and % of rallies won on own serve.
 * 3. Rally endings: how points ended per player (winners, opponent out, opponent net)
 *    and a rally-length histogram (shots per rally).
 * 4. Attack: smash count, average/top smash speed (est.), % of smashes that ended the rally,
 *    and average smash net clearance (m).
 *
 * Every unmeasured number shows "—"; all speeds carry "est.".
 */

class AnalyticsCards {
  constructor() {
    this.container = document.getElementById('analytics-cards-container');
    this.kdeFilterPlayer = 'ALL'; // 'ALL' | 'LZJ' | 'POPOV'

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    window.addEventListener('hawkview:filtersChanged', () => this.render());
    window.addEventListener('hawkview:matchChanged', () => this.render());
    window.addEventListener('hawkview:ralliesStreamUpdated', () => this.render());
    window.addEventListener('hawkview:themeChanged', () => this.drawKDEHeatmap());
    window.addEventListener('resize', () => this.drawKDEHeatmap());
  }

  render() {
    if (!this.container) return;
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry) return;

    const rallies = telemetry.rallies || [];
    const players = telemetry.players || {};
    const playerIds = Object.keys(players).length > 0 ? Object.keys(players) : ['LZJ', 'POPOV'];
    const allShots = [];
    rallies.forEach((r) => {
      (r.shots || []).forEach((s) => allShots.push({ shot: s, rally: r }));
    });

    // =========================================================================
    // 1. COURT COVERAGE STATS
    // =========================================================================
    const coverageRows = playerIds.map((pid) => {
      const comp = (players[pid] && players[pid].computed) || {};
      const dist = typeof comp.distance_m === 'number' ? `${comp.distance_m.toFixed(1)} m` : '—';
      const avgRally = typeof comp.avg_rally_distance_m === 'number'
        ? `${comp.avg_rally_distance_m.toFixed(1)} m`
        : (typeof comp.distance_m === 'number' && rallies.length > 0
            ? `${(comp.distance_m / rallies.length).toFixed(1)} m`
            : '—');
      const samples = Array.isArray(comp.foot_positions) ? comp.foot_positions.length : 0;
      return { pid, dist, avgRally, samples };
    });

    // =========================================================================
    // 2. SERVE STATS
    // =========================================================================
    const serveEntries = allShots.filter(({ shot }) => Boolean(shot.is_serve) || (shot.type && shot.type.startsWith('serve')));
    const serveMix = {
      serve_short: 0,
      serve_flick: 0,
      serve_drive: 0,
      serve_long: 0
    };
    const serveLandingGrid = {
      'front:centre': 0,
      'front:wide': 0,
      'back:centre': 0,
      'back:wide': 0
    };
    let possibleFaultHeightCount = 0;

    serveEntries.forEach(({ shot }) => {
      if (shot.type in serveMix) {
        serveMix[shot.type]++;
      } else {
        serveMix.serve_short++;
      }
      if (shot.possible_fault_height) {
        possibleFaultHeightCount++;
      }

      // Service court landing zone from end_3d / intercept_xy / land
      const endPt = shot.land || shot.intercept_xy || shot.end_3d;
      if (endPt && endPt.length >= 2) {
        const lx = Number(endPt[0]);
        const ly = Number(endPt[1]);
        const distFromNet = Math.abs(ly - 6.70);
        // Service court depth runs 1.98m (short service line) to 6.70m (back line), midpoint 4.34m
        const depthKey = distFromNet < 4.34 ? 'front' : 'back';
        // Service court width runs 0m (centre line x=3.05) to 2.59m (singles sideline), midpoint 1.295m
        const distFromCentre = Math.abs(lx - 3.05);
        const widthKey = distFromCentre <= 1.295 ? 'centre' : 'wide';
        serveLandingGrid[`${depthKey}:${widthKey}`]++;
      }
    });

    const serveWinByPlayer = playerIds.map((pid) => {
      const servedRallies = rallies.filter((r) => r.server === pid);
      const wonOnServe = servedRallies.filter((r) => r.winner === pid).length;
      const pct = servedRallies.length > 0
        ? `${((wonOnServe / servedRallies.length) * 100).toFixed(0)}% (${wonOnServe}/${servedRallies.length})`
        : '—';
      return { pid, pct };
    });

    // =========================================================================
    // 3. RALLY ENDINGS & RALLY-LENGTH HISTOGRAM
    // =========================================================================
    const endingsByPlayer = playerIds.map((pid) => {
      let winners = 0;
      let oppOut = 0;
      let oppNet = 0;
      rallies.forEach((r) => {
        if (r.winner !== pid) return;
        if (r.ended_by === 'winner') winners++;
        else if (r.ended_by === 'error_out') oppOut++;
        else if (r.ended_by === 'error_net') oppNet++;
      });
      return { pid, winners, oppOut, oppNet, totalPts: winners + oppOut + oppNet };
    });

    const lengthBuckets = [
      { label: '1–5', min: 1, max: 5, count: 0 },
      { label: '6–10', min: 6, max: 10, count: 0 },
      { label: '11–15', min: 11, max: 15, count: 0 },
      { label: '16–20', min: 16, max: 20, count: 0 },
      { label: '21+', min: 21, max: 999, count: 0 }
    ];
    rallies.forEach((r) => {
      const sc = r.shot_count || (r.shots ? r.shots.length : 0);
      const b = lengthBuckets.find((bk) => sc >= bk.min && sc <= bk.max);
      if (b) b.count++;
    });
    const maxBucketCount = Math.max(1, ...lengthBuckets.map((b) => b.count));

    // =========================================================================
    // 4. ATTACK (SMASH) STATS
    // =========================================================================
    const attackByPlayer = playerIds.map((pid) => {
      const pSmashes = allShots
        .map((x) => x.shot)
        .filter((s) => s.hitter === pid && s.type === 'smash');
      const count = pSmashes.length;
      if (count === 0) {
        return {
          pid,
          count: 0,
          avgSpeed: '—',
          topSpeed: '—',
          endedPct: '—',
          avgClearance: '—'
        };
      }
      const speeds = pSmashes.map((s) => Number(s.speed_kmh) || 0).filter((v) => v > 0);
      const avgSpd = speeds.length > 0
        ? `${(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)} km/h est.`
        : '—';
      const topSpd = speeds.length > 0
        ? `${Math.max(...speeds).toFixed(1)} km/h est.`
        : '—';
      const endedRallyCount = pSmashes.filter((s) => s.is_terminal).length;
      const endedPct = `${((endedRallyCount / count) * 100).toFixed(0)}% (${endedRallyCount}/${count})`;
      const clearances = pSmashes
        .map((s) => (typeof s.net_clearance_m === 'number' ? s.net_clearance_m : null))
        .filter((v) => v !== null);
      const avgClearance = clearances.length > 0
        ? `${(clearances.reduce((a, b) => a + b, 0) / clearances.length).toFixed(2)} m`
        : '—';

      return { pid, count, avgSpeed: avgSpd, topSpeed: topSpd, endedPct, avgClearance };
    });

    this.container.innerHTML = `
      <div class="hv-analytics-grid">
        <!-- CARD 1: COURT COVERAGE -->
        <div class="hv-panel">
          <div class="hv-panel-header">
            <h3 class="hv-panel-title">1. Court Coverage</h3>
            <div style="display:flex; gap:4px;">
              ${['ALL', ...playerIds].map((k) => `
                <button class="hv-btn ${this.kdeFilterPlayer === k ? 'active' : ''}"
                        style="padding:2px 6px; font-size:10.5px;"
                        data-kde-player="${k}">${k}</button>
              `).join('')}
            </div>
          </div>

          <table class="hv-table" style="margin-bottom:8px;">
            <thead>
              <tr>
                <th>Player</th>
                <th style="text-align:right;">Total Dist</th>
                <th style="text-align:right;">Avg / Rally</th>
              </tr>
            </thead>
            <tbody>
              ${coverageRows.map((row) => `
                <tr>
                  <td style="font-weight:600;">${row.pid}</td>
                  <td style="text-align:right; font-weight:600;">${row.dist}</td>
                  <td style="text-align:right; color:var(--muted);">${row.avgRally}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--surface-subtle); border:1px solid var(--border); border-radius:6px; padding:6px;">
            <canvas id="coverage-kde-canvas" width="260" height="130" style="width:100%; height:130px; display:block;"></canvas>
            <div style="font-size:10px; color:var(--muted); margin-top:4px; width:100%; display:flex; justify-content:space-between;">
              <span>Top-down BWF KDE foot density</span>
              <span>13.40 m × 6.10 m</span>
            </div>
          </div>
        </div>

        <!-- CARD 2: SERVE -->
        <div class="hv-panel">
          <div class="hv-panel-header">
            <h3 class="hv-panel-title">2. Serve</h3>
            <span class="hv-badge ${possibleFaultHeightCount > 0 ? 'hv-badge-warn' : ''}">
              possible_fault_height: ${possibleFaultHeightCount}
            </span>
          </div>

          <div style="margin-bottom:8px;">
            <div style="font-size:10.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">SERVE-TYPE MIX</div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:4px;">
              <div class="hv-stat-box">
                <span class="hv-stat-box-label">Short</span>
                <span class="hv-stat-box-value">${serveMix.serve_short}</span>
              </div>
              <div class="hv-stat-box">
                <span class="hv-stat-box-label">Flick</span>
                <span class="hv-stat-box-value">${serveMix.serve_flick}</span>
              </div>
              <div class="hv-stat-box">
                <span class="hv-stat-box-label">Drive</span>
                <span class="hv-stat-box-value">${serveMix.serve_drive}</span>
              </div>
              <div class="hv-stat-box">
                <span class="hv-stat-box-label">Long</span>
                <span class="hv-stat-box-value">${serveMix.serve_long}</span>
              </div>
            </div>
          </div>

          <div style="margin-bottom:8px;">
            <div style="font-size:10.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">SERVICE COURT LANDING (FRONT/BACK × CENTRE/WIDE)</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
              <div class="hv-stat-box" style="display:flex; justify-content:space-between; padding:5px 8px;">
                <span style="color:var(--muted); font-size:11px;">Front · Centre</span>
                <span style="font-weight:700;">${serveLandingGrid['front:centre']}</span>
              </div>
              <div class="hv-stat-box" style="display:flex; justify-content:space-between; padding:5px 8px;">
                <span style="color:var(--muted); font-size:11px;">Front · Wide</span>
                <span style="font-weight:700;">${serveLandingGrid['front:wide']}</span>
              </div>
              <div class="hv-stat-box" style="display:flex; justify-content:space-between; padding:5px 8px;">
                <span style="color:var(--muted); font-size:11px;">Back · Centre</span>
                <span style="font-weight:700;">${serveLandingGrid['back:centre']}</span>
              </div>
              <div class="hv-stat-box" style="display:flex; justify-content:space-between; padding:5px 8px;">
                <span style="color:var(--muted); font-size:11px;">Back · Wide</span>
                <span style="font-weight:700;">${serveLandingGrid['back:wide']}</span>
              </div>
            </div>
          </div>

          <div style="margin-top:auto;">
            <div style="font-size:10.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">% RALLIES WON ON OWN SERVE</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
              ${serveWinByPlayer.map((sw) => `
                <div class="hv-stat-box" style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px;">
                  <span style="font-weight:600;">${sw.pid}</span>
                  <span style="font-weight:700;">${sw.pct}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- CARD 3: RALLY ENDINGS -->
        <div class="hv-panel">
          <div class="hv-panel-header">
            <h3 class="hv-panel-title">3. Rally Endings</h3>
            <span class="hv-badge">${rallies.length} pts</span>
          </div>

          <table class="hv-table" style="margin-bottom:10px;">
            <thead>
              <tr>
                <th>Point Winner</th>
                <th style="text-align:right;">Winners</th>
                <th style="text-align:right;">Opp Out</th>
                <th style="text-align:right;">Opp Net</th>
              </tr>
            </thead>
            <tbody>
              ${endingsByPlayer.map((eb) => `
                <tr>
                  <td style="font-weight:600;">${eb.pid} <span style="color:var(--muted); font-size:11px;">(${eb.totalPts})</span></td>
                  <td style="text-align:right; color:var(--shot-winner); font-weight:600;">${eb.winners}</td>
                  <td style="text-align:right; color:var(--shot-error);">${eb.oppOut}</td>
                  <td style="text-align:right; color:var(--shot-error);">${eb.oppNet}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="margin-top:auto;">
            <div style="font-size:10.5px; font-weight:600; color:var(--muted); margin-bottom:6px;">RALLY-LENGTH HISTOGRAM (SHOTS / RALLY)</div>
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:6px; align-items:end; height:84px; padding-top:8px;">
              ${lengthBuckets.map((b) => {
                const barH = Math.max(4, Math.round((b.count / maxBucketCount) * 52));
                return `
                  <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
                    <span style="font-size:10.5px; font-weight:700;" class="tabular-nums">${b.count}</span>
                    <div style="width:100%; max-width:34px; height:${barH}px; background:var(--shot-continue); border-radius:3px;"></div>
                    <span style="font-size:10px; color:var(--muted);">${b.label}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- CARD 4: ATTACK -->
        <div class="hv-panel">
          <div class="hv-panel-header">
            <h3 class="hv-panel-title">4. Attack (Smashes)</h3>
            <span class="hv-badge">Speeds est.</span>
          </div>

          <table class="hv-table">
            <thead>
              <tr>
                <th>Metric</th>
                ${attackByPlayer.map((a) => `<th style="text-align:right;">${a.pid}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="color:var(--muted);">Smash count</td>
                ${attackByPlayer.map((a) => `<td style="text-align:right; font-weight:700;">${a.count}</td>`).join('')}
              </tr>
              <tr>
                <td style="color:var(--muted);">Avg speed</td>
                ${attackByPlayer.map((a) => `<td style="text-align:right;">${a.avgSpeed}</td>`).join('')}
              </tr>
              <tr>
                <td style="color:var(--muted);">Top speed</td>
                ${attackByPlayer.map((a) => `<td style="text-align:right; font-weight:700; color:var(--shot-winner);">${a.topSpeed}</td>`).join('')}
              </tr>
              <tr>
                <td style="color:var(--muted);">Ended rally %</td>
                ${attackByPlayer.map((a) => `<td style="text-align:right;">${a.endedPct}</td>`).join('')}
              </tr>
              <tr>
                <td style="color:var(--muted);">Avg net clearance</td>
                ${attackByPlayer.map((a) => `<td style="text-align:right;">${a.avgClearance}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.container.querySelectorAll('[data-kde-player]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.kdeFilterPlayer = btn.getAttribute('data-kde-player');
        this.render();
      });
    });

    this.drawKDEHeatmap();
  }

  /**
   * Renders a 2D Gaussian Kernel Density Estimation (KDE) heatmap of player foot
   * positions onto the top-down BWF regulation court canvas (#coverage-kde-canvas).
   */
  drawKDEHeatmap() {
    const canvas = document.getElementById('coverage-kde-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const style = getComputedStyle(document.documentElement);
    const courtFloor = (style.getPropertyValue('--court-floor') || '#dcdfe4').trim();
    const courtLine = (style.getPropertyValue('--court-line') || '#2b2f36').trim();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 260;
    const cssH = canvas.clientHeight || 130;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.scale(dpr, dpr);

    // Draw horizontal top-down BWF court (length 13.40m along X, width 6.10m along Y)
    const padX = 12;
    const padY = 8;
    const availW = cssW - padX * 2;
    const availH = cssH - padY * 2;
    const scale = Math.min(availW / 13.40, availH / 6.10);
    const courtW = 13.40 * scale;
    const courtH = 6.10 * scale;
    const ox = (cssW - courtW) / 2;
    const oy = (cssH - courtH) / 2;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = courtFloor;
    ctx.fillRect(ox, oy, courtW, courtH);

    // Collect foot positions from telemetry
    const telemetry = window.HAWKVIEW_TELEMETRY;
    const players = (telemetry && telemetry.players) || {};
    const pts = [];

    Object.entries(players).forEach(([pid, pObj]) => {
      if (this.kdeFilterPlayer !== 'ALL' && this.kdeFilterPlayer !== pid) return;
      const fp = (pObj && pObj.computed && pObj.computed.foot_positions) || [];
      for (let i = 0; i < fp.length; i++) {
        pts.push(fp[i]);
      }
    });

    // Compute 2D KDE grid (gridX along 13.40m length, gridY along 6.10m width)
    if (pts.length > 0) {
      const gx = 44;
      const gy = 20;
      const grid = new Float32Array(gx * gy);
      const sigma = 0.65; // meters
      const inv2Sigma2 = 1.0 / (2.0 * sigma * sigma);

      // Accumulate Gaussian kernels
      for (let i = 0; i < pts.length; i++) {
        const cx = pts[i][0]; // 0..6.10
        const cy = pts[i][1]; // 0..13.40
        const ixCenter = Math.floor((cy / 13.40) * gx);
        const iyCenter = Math.floor((cx / 6.10) * gy);
        const radX = 4;
        const radY = 4;

        for (let dy = -radY; dy <= radY; dy++) {
          const iy = iyCenter + dy;
          if (iy < 0 || iy >= gy) continue;
          const cellX = ((iy + 0.5) / gy) * 6.10;
          for (let dx = -radX; dx <= radX; dx++) {
            const ix = ixCenter + dx;
            if (ix < 0 || ix >= gx) continue;
            const cellY = ((ix + 0.5) / gx) * 13.40;
            const d2 = (cx - cellX) * (cx - cellX) + (cy - cellY) * (cy - cellY);
            grid[iy * gx + ix] += Math.exp(-d2 * inv2Sigma2);
          }
        }
      }

      let maxVal = 0;
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] > maxVal) maxVal = grid[k];
      }

      if (maxVal > 0) {
        const cellW = courtW / gx;
        const cellH = courtH / gy;
        for (let iy = 0; iy < gy; iy++) {
          for (let ix = 0; ix < gx; ix++) {
            const norm = grid[iy * gx + ix] / maxVal;
            if (norm < 0.06) continue;
            // Clean blue -> amber -> red thermal map without neon glow
            let r, g, b;
            if (norm < 0.5) {
              const t = norm * 2;
              r = Math.round(37 + t * (245 - 37));
              g = Math.round(99 + t * (158 - 99));
              b = Math.round(235 - t * (235 - 11));
            } else {
              const t = (norm - 0.5) * 2;
              r = Math.round(245 + t * (217 - 245));
              g = Math.round(158 - t * (158 - 48));
              b = Math.round(11 + t * (37 - 11));
            }
            const alpha = Math.min(0.78, 0.18 + norm * 0.62);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
            ctx.fillRect(ox + ix * cellW, oy + iy * cellH, Math.ceil(cellW), Math.ceil(cellH));
          }
        }
      }
    }

    // Draw BWF Court Lines on top
    ctx.strokeStyle = courtLine;
    ctx.lineWidth = 1.1;

    const toPx = (courtY, courtX) => [
      ox + (courtY / 13.40) * courtW,
      oy + (courtX / 6.10) * courtH
    ];

    // Outer boundary
    ctx.strokeRect(ox, oy, courtW, courtH);

    const drawSeg = (y1, x1, y2, x2, dashed = false) => {
      const [px1, py1] = toPx(y1, x1);
      const [px2, py2] = toPx(y2, x2);
      ctx.beginPath();
      if (dashed) ctx.setLineDash([3, 3]);
      else ctx.setLineDash([]);
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.stroke();
    };

    // Singles sidelines (x = 0.46, 5.64)
    drawSeg(0, 0.46, 13.40, 0.46);
    drawSeg(0, 5.64, 13.40, 5.64);
    // Short service lines (y = 4.72, 8.68)
    drawSeg(4.72, 0, 4.72, 6.10);
    drawSeg(8.68, 0, 8.68, 6.10);
    // Doubles long service lines (y = 0.76, 12.64)
    drawSeg(0.76, 0, 0.76, 6.10);
    drawSeg(12.64, 0, 12.64, 6.10);
    // Centre lines
    drawSeg(0, 3.05, 4.72, 3.05);
    drawSeg(8.68, 3.05, 13.40, 3.05);
    // Net line (y = 6.70)
    drawSeg(6.70, 0, 6.70, 6.10, true);
    ctx.setLineDash([]);
  }
}

window.AnalyticsCards = AnalyticsCards;
