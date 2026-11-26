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
    let savedKde = 'ALL';
    try {
      savedKde = localStorage.getItem('hawkview_last_kde_player') || 'ALL';
    } catch (e) {}
    this.kdeFilterPlayer = savedKde; // 'ALL' | 'LZJ' | 'POPOV' | 'ANTONSEN'

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
    if (this.kdeFilterPlayer !== 'ALL' && !playerIds.includes(this.kdeFilterPlayer)) {
      this.kdeFilterPlayer = 'ALL';
    }
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

    const compWarn = telemetry.match_metadata && telemetry.match_metadata.compilation_warning;
    const swappedRalliesCount = rallies.filter((r) => r.side_swapped).length;
    const showBottomWarn = Boolean((compWarn && compWarn.detected) || swappedRalliesCount > 0);
    const bottomWarnHtml = showBottomWarn ? `
      <div style="margin-bottom:8px; padding:6px 10px; border-radius:6px; border:1px solid rgba(217, 119, 6, 0.42); background:rgba(245, 158, 11, 0.09); font-size:11px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-weight:700; color:#d97706;">⚠️ ${(compWarn && compWarn.summary) || 'Court-Side Swap / Compilation Detected'}:</span>
          <span style="color:var(--text); opacity:0.92;">
            ${(compWarn && compWarn.warning_message) || `Court ends swapped in ${swappedRalliesCount}/${rallies.length} rallies. If rallies come from different games or players in a compilation, aggregate stats below may mix contexts.`}
          </span>
        </div>
        <span class="hv-badge hv-badge-warn" style="flex-shrink:0;">${swappedRalliesCount}/${rallies.length} rallies swapped ends</span>
      </div>
    ` : '';

    this.container.innerHTML = `
      ${bottomWarnHtml}
      <div class="hv-analytics-grid">
        <div class="hv-analytics-slide hv-analytics-slide-a" data-stat-slide="1">
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

          <div class="hv-kde-box" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--surface-subtle); border:1px solid var(--border); border-radius:8px; padding:8px;">
            <div id="coverage-kde-top-label" style="width:100%; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; font-weight:700; color:var(--text); margin-bottom:4px; letter-spacing:0.01em;"></div>
            <canvas id="coverage-kde-canvas" width="260" height="130" style="width:100%; height:130px; display:block;"></canvas>
            <div id="coverage-kde-bottom-label" style="width:100%; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; font-weight:700; color:var(--text); margin-top:4px; letter-spacing:0.01em;"></div>
            <div style="font-size:10px; color:var(--muted); margin-top:5px; width:100%; display:flex; justify-content:space-between;">
              <span>Top-down BWF KDE foot density</span>
              <span id="coverage-kde-dims">6.10 m × 13.40 m</span>
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
        </div>

        <div class="hv-analytics-slide hv-analytics-slide-b" data-stat-slide="2">
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
      </div>
    `;

    this.container.querySelectorAll('[data-kde-player]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.kdeFilterPlayer = btn.getAttribute('data-kde-player');
        try {
          localStorage.setItem('hawkview_last_kde_player', this.kdeFilterPlayer);
        } catch (e) {}
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
    const isVertical = window.innerWidth <= 859;
    const targetCssH = isVertical ? 286 : 130;
    canvas.style.height = `${targetCssH}px`;

    const cssW = canvas.clientWidth || (isVertical ? 260 : 260);
    const cssH = targetCssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.scale(dpr, dpr);

    // Resolve Far (y >= 6.70m, TOP on vertical) vs Near (y < 6.70m, BOTTOM on vertical) player names
    const telemetry = window.HAWKVIEW_TELEMETRY;
    const players = (telemetry && telemetry.players) || {};
    const playerEntries = Object.entries(players);
    let farName = '';
    let nearName = '';
    if (playerEntries.length >= 2) {
      const scored = playerEntries.map(([pid, pObj]) => {
        const fp = (pObj && pObj.computed && pObj.computed.foot_positions) || [];
        let avgY = null;
        if (fp.length > 0) {
          let sumY = 0;
          for (let i = 0; i < fp.length; i++) sumY += Number(fp[i][1] || 0);
          avgY = sumY / fp.length;
        }
        const meta = (pObj && pObj.metadata) || {};
        const displayName = meta.name || pid;
        const endHint = String(meta.end || meta.side || '').toLowerCase();
        return { pid, displayName, avgY, endHint };
      });
      if (scored[0].avgY !== null && scored[1].avgY !== null) {
        scored.sort((a, b) => b.avgY - a.avgY);
        farName = scored[0].displayName;
        nearName = scored[1].displayName;
      } else if (scored[0].endHint === 'far' || scored[1].endHint === 'near') {
        farName = scored[0].displayName;
        nearName = scored[1].displayName;
      } else {
        nearName = scored[0].displayName;
        farName = scored[1].displayName;
      }
    } else if (playerEntries.length === 1) {
      const meta = (playerEntries[0][1] && playerEntries[0][1].metadata) || {};
      nearName = meta.name || playerEntries[0][0];
    }

    const topLabelEl = document.getElementById('coverage-kde-top-label');
    const bottomLabelEl = document.getElementById('coverage-kde-bottom-label');
    const dimsEl = document.getElementById('coverage-kde-dims');
    if (dimsEl) dimsEl.textContent = isVertical ? '6.10 m × 13.40 m' : '13.40 m × 6.10 m';
    if (isVertical) {
      if (topLabelEl) {
        topLabelEl.style.display = farName ? 'flex' : 'none';
        topLabelEl.innerHTML = farName
          ? `<span style="font-size:9.5px; font-weight:700; color:var(--shot-winner); background:rgba(37,99,235,0.12); padding:1px 6px; border-radius:999px;">FAR</span><span>${farName}</span>`
          : '';
      }
      if (bottomLabelEl) {
        bottomLabelEl.style.display = nearName ? 'flex' : 'none';
        bottomLabelEl.innerHTML = nearName
          ? `<span style="font-size:9.5px; font-weight:700; color:var(--shot-continue); background:rgba(95,174,58,0.14); padding:1px 6px; border-radius:999px;">NEAR</span><span>${nearName}</span>`
          : '';
      }
    } else {
      if (topLabelEl) {
        topLabelEl.style.display = (nearName || farName) ? 'flex' : 'none';
        topLabelEl.style.justifyContent = 'space-between';
        topLabelEl.innerHTML = `<span>${nearName ? `NEAR · ${nearName}` : ''}</span><span>${farName ? `${farName} · FAR` : ''}</span>`;
      }
      if (bottomLabelEl) {
        bottomLabelEl.style.display = 'none';
        bottomLabelEl.innerHTML = '';
      }
    }

    // Compute court box: vertical (6.10m W x 13.40m H) on mobile; horizontal (13.40m W x 6.10m H) on desktop
    const padX = isVertical ? 14 : 12;
    const padY = 6;
    const availW = cssW - padX * 2;
    const availH = cssH - padY * 2;
    const scale = isVertical
      ? Math.min(availW / 6.10, availH / 13.40)
      : Math.min(availW / 13.40, availH / 6.10);
    const courtW = (isVertical ? 6.10 : 13.40) * scale;
    const courtH = (isVertical ? 13.40 : 6.10) * scale;
    const ox = (cssW - courtW) / 2;
    const oy = (cssH - courtH) / 2;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = courtFloor;
    ctx.fillRect(ox, oy, courtW, courtH);

    // Collect foot positions from telemetry
    const pts = [];
    Object.entries(players).forEach(([pid, pObj]) => {
      if (this.kdeFilterPlayer !== 'ALL' && this.kdeFilterPlayer !== pid) return;
      const fp = (pObj && pObj.computed && pObj.computed.foot_positions) || [];
      for (let i = 0; i < fp.length; i++) {
        pts.push(fp[i]);
      }
    });

    // Compute 2D KDE grid (gy along 13.40m length, gx along 6.10m width)
    if (pts.length > 0) {
      const nLen = 44; // along 13.40m court length (y)
      const nWid = 20; // along 6.10m court width (x)
      const grid = new Float32Array(nLen * nWid);
      const sigma = 0.65; // meters
      const inv2Sigma2 = 1.0 / (2.0 * sigma * sigma);

      for (let i = 0; i < pts.length; i++) {
        const cx = pts[i][0]; // 0..6.10
        const cy = pts[i][1]; // 0..13.40
        const ilCenter = Math.floor((cy / 13.40) * nLen);
        const iwCenter = Math.floor((cx / 6.10) * nWid);
        const rad = 4;

        for (let dw = -rad; dw <= rad; dw++) {
          const iw = iwCenter + dw;
          if (iw < 0 || iw >= nWid) continue;
          const cellX = ((iw + 0.5) / nWid) * 6.10;
          for (let dl = -rad; dl <= rad; dl++) {
            const il = ilCenter + dl;
            if (il < 0 || il >= nLen) continue;
            const cellY = ((il + 0.5) / nLen) * 13.40;
            const d2 = (cx - cellX) * (cx - cellX) + (cy - cellY) * (cy - cellY);
            grid[iw * nLen + il] += Math.exp(-d2 * inv2Sigma2);
          }
        }
      }

      let maxVal = 0;
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] > maxVal) maxVal = grid[k];
      }

      if (maxVal > 0) {
        const cellW = isVertical ? (courtW / nWid) : (courtW / nLen);
        const cellH = isVertical ? (courtH / nLen) : (courtH / nWid);
        for (let iw = 0; iw < nWid; iw++) {
          for (let il = 0; il < nLen; il++) {
            const norm = grid[iw * nLen + il] / maxVal;
            if (norm < 0.06) continue;
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
            if (isVertical) {
              // Vertical: x left->right, y bottom->top (Far y=13.40 at top, Near y=0 at bottom)
              const px = ox + iw * cellW;
              const py = oy + (nLen - 1 - il) * cellH;
              ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
            } else {
              const px = ox + il * cellW;
              const py = oy + iw * cellH;
              ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
            }
          }
        }
      }
    }

    // Draw BWF Court Lines on top
    ctx.strokeStyle = courtLine;
    ctx.lineWidth = 1.15;

    const toPx = (courtY, courtX) => (
      isVertical
        ? [ox + (courtX / 6.10) * courtW, oy + ((13.40 - courtY) / 13.40) * courtH]
        : [ox + (courtY / 13.40) * courtW, oy + (courtX / 6.10) * courtH]
    );

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
