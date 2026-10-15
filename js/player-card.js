/**
 * Hawkview Player Card (Spec Section 3.3)
 * - Player picker (LZJ vs POPOV), showing name, flag, handedness, and current court end (Near / Far)
 * - Summary stats: Shots, % In (rally-ending shots that landed in), Winners, Errors (Out / Net)
 * - Speed Table: smash, clear, drive, drop, lift, push, net_shot, serve with count, avg & top speed (km/h est.)
 *   and eye toggle button (👁) that filters the 3D court to that player's shots of that type
 * - 3x3 Contact Map: top-down half-court (front / mid / rear × forehand / centre / backhand
 *   mirrored by player handedness and court side), shaded by shot count; clicking a cell filters the 3D court
 */

class PlayerCard {
  constructor(shotExplorer, broadcastPlayer) {
    this.explorer = shotExplorer;
    this.player = broadcastPlayer;
    this.activePlayerId = 'LZJ';

    this.container = document.getElementById('player-card-container');
    this.bindEvents();
    this.render();
  }

  bindEvents() {
    window.addEventListener('hawkview:filtersChanged', () => {
      this.render();
    });
    window.addEventListener('hawkview:matchChanged', () => {
      this.render();
    });
    window.addEventListener('hawkview:rallyChanged', () => {
      this.updateCurrentEndBadge();
    });
  }

  getAllPlayerShots(playerId) {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return [];
    const out = [];
    telemetry.rallies.forEach((r) => {
      (r.shots || []).forEach((s) => {
        if (s.hitter === playerId) {
          if (!s._lateralZone) {
            s._lateralZone = ShotExplorer.getLateralZone(s, telemetry);
          }
          out.push(s);
        }
      });
    });
    return out;
  }

  getCurrentEnd(playerId) {
    const rally = (this.player && this.player.currentRally) ||
      (window.HAWKVIEW_TELEMETRY && window.HAWKVIEW_TELEMETRY.rallies && window.HAWKVIEW_TELEMETRY.rallies[0]);
    if (!rally) return '—';
    if (rally.near_player === playerId) return 'Near';
    if (rally.far_player === playerId) return 'Far';
    return '—';
  }

  updateCurrentEndBadge() {
    const el = document.getElementById('player-card-current-end');
    if (el) {
      el.textContent = `${this.getCurrentEnd(this.activePlayerId)} end`;
    }
  }

  selectPlayer(playerId) {
    this.activePlayerId = playerId;
    this.render();
  }

  toggleTypeEye(familyKey) {
    if (!this.explorer) return;
    const f = this.explorer.filters;
    const isCurrentlyActive = (f.player === this.activePlayerId && f.shotType === familyKey);
    if (isCurrentlyActive) {
      this.explorer.setFilters({ player: 'all', shotType: 'all' });
    } else {
      this.explorer.setFilters({
        player: this.activePlayerId,
        shotType: familyKey,
        contactZone: 'all',
        lateralZone: 'all'
      });
    }
  }

  toggleContactCell(depthZone, lateralZone) {
    if (!this.explorer) return;
    const f = this.explorer.filters;
    const isCurrentlyActive = (
      f.player === this.activePlayerId &&
      f.contactZone === depthZone &&
      f.lateralZone === lateralZone
    );
    if (isCurrentlyActive) {
      this.explorer.setFilters({ contactZone: 'all', lateralZone: 'all' });
    } else {
      this.explorer.setFilters({
        player: this.activePlayerId,
        contactZone: depthZone,
        lateralZone: lateralZone
      });
    }
  }

  render() {
    if (!this.container) return;
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !telemetry.players) return;

    const playerIds = Object.keys(telemetry.players);
    if (!playerIds.includes(this.activePlayerId)) {
      this.activePlayerId = playerIds[0] || 'LZJ';
    }

    const pEntry = telemetry.players[this.activePlayerId] || {};
    const meta = pEntry.metadata || {};
    const comp = pEntry.computed || {};
    const shots = this.getAllPlayerShots(this.activePlayerId);

    const totalShots = typeof comp.shots === 'number' ? comp.shots : shots.length;
    const winners = typeof comp.winners === 'number'
      ? comp.winners
      : shots.filter((s) => s.outcome === 'winner').length;
    const errorsOut = typeof comp.errors_out === 'number'
      ? comp.errors_out
      : shots.filter((s) => s.outcome === 'error_out').length;
    const errorsNet = typeof comp.errors_net === 'number'
      ? comp.errors_net
      : shots.filter((s) => s.outcome === 'error_net').length;
    const totalErrors = errorsOut + errorsNet;
    const terminalTotal = winners + totalErrors;
    const pctInStr = terminalTotal > 0
      ? `${((winners / terminalTotal) * 100).toFixed(0)}%`
      : '—';

    const handedness = meta.handedness || meta.dominant_hand || '—';
    const currentEnd = this.getCurrentEnd(this.activePlayerId);

    // Speed Table families
    const families = [
      { key: 'smash', label: 'Smash' },
      { key: 'clear', label: 'Clear' },
      { key: 'drive', label: 'Drive' },
      { key: 'drop', label: 'Drop' },
      { key: 'lift', label: 'Lift' },
      { key: 'push', label: 'Push' },
      { key: 'net_shot', label: 'Net shot' },
      { key: 'serve', label: 'Serve' }
    ];

    const fState = this.explorer ? this.explorer.filters : {};

    const speedRowsHtml = families.map((fam) => {
      const famShots = shots.filter((s) => ShotExplorer.matchesShotTypeFilter(s.type, fam.key));
      const count = famShots.length;
      let avgStr = '—';
      let maxStr = '—';
      if (count > 0) {
        const speeds = famShots.map((s) => Number(s.speed_kmh) || 0).filter((v) => v > 0);
        if (speeds.length > 0) {
          const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          const max = Math.max(...speeds);
          avgStr = `${avg.toFixed(1)}`;
          maxStr = `${max.toFixed(1)}`;
        }
      }
      const eyeActive = (fState.player === this.activePlayerId && fState.shotType === fam.key);
      return `
        <tr>
          <td style="font-weight:500;">${fam.label} <span style="color:var(--muted); font-size:11px;">(${count})</span></td>
          <td style="text-align:right;">${avgStr}</td>
          <td style="text-align:right; font-weight:600;">${maxStr}</td>
          <td style="text-align:right; width:36px;">
            <button class="hv-eye-btn ${eyeActive ? 'active' : ''}" data-eye-family="${fam.key}" title="Filter 3D court to ${this.activePlayerId} ${fam.label} shots">👁</button>
          </td>
        </tr>
      `;
    }).join('');

    // 3x3 Contact Map (front / mid / rear × lateral columns ordered by handedness)
    // Looking at player's half-court with net at top:
    // For Right-handed player facing net: Left = Backhand, Centre = Centre, Right = Forehand
    // For Left-handed player facing net:  Left = Forehand, Centre = Centre, Right = Backhand
    const isLeftHanded = handedness.toLowerCase().startsWith('l');
    const colOrder = isLeftHanded
      ? [
          { key: 'forehand', label: 'Forehand (L)' },
          { key: 'centre', label: 'Centre' },
          { key: 'backhand', label: 'Backhand (R)' }
        ]
      : [
          { key: 'backhand', label: 'Backhand (L)' },
          { key: 'centre', label: 'Centre' },
          { key: 'forehand', label: 'Forehand (R)' }
        ];
    const rowOrder = [
      { key: 'front', label: 'Front' },
      { key: 'mid', label: 'Mid' },
      { key: 'rear', label: 'Rear' }
    ];

    const cellCounts = {};
    let maxCellCount = 1;
    rowOrder.forEach((r) => {
      colOrder.forEach((c) => {
        const k = `${r.key}:${c.key}`;
        cellCounts[k] = 0;
      });
    });

    shots.forEach((s) => {
      const rz = s.contact_zone || 'mid';
      const cz = s._lateralZone || 'centre';
      const k = `${rz}:${cz}`;
      if (k in cellCounts) {
        cellCounts[k]++;
        if (cellCounts[k] > maxCellCount) maxCellCount = cellCounts[k];
      }
    });

    const contactCellsHtml = rowOrder.map((r) => {
      return colOrder.map((c) => {
        const k = `${r.key}:${c.key}`;
        const cnt = cellCounts[k] || 0;
        const pct = totalShots > 0 ? Math.round((cnt / totalShots) * 100) : 0;
        const alpha = cnt > 0 ? (0.10 + 0.42 * (cnt / maxCellCount)).toFixed(2) : '0.0';
        const isCellActive = (
          fState.player === this.activePlayerId &&
          fState.contactZone === r.key &&
          fState.lateralZone === c.key
        );
        return `
          <div class="hv-contact-cell ${isCellActive ? 'active' : ''}"
               data-depth="${r.key}" data-lateral="${c.key}"
               style="background-color: rgba(37, 99, 235, ${alpha});"
               title="Click to filter 3D court: ${this.activePlayerId} · ${r.label} · ${c.label}">
            <div style="font-size:10px; color:var(--muted);">${r.label} · ${c.key === 'centre' ? 'Ctr' : (c.key === 'forehand' ? 'FH' : 'BH')}</div>
            <div style="font-size:13px; font-weight:700;" class="tabular-nums">${cnt}</div>
            <div style="font-size:10px; color:var(--muted);" class="tabular-nums">${pct}%</div>
          </div>
        `;
      }).join('');
    }).join('');

    this.container.innerHTML = `
      <div class="hv-panel-header">
        <h2 class="hv-panel-title">Player Card</h2>
        <span id="player-card-current-end" class="hv-badge">${currentEnd} end</span>
      </div>

      <!-- Player Picker Tabs -->
      <div class="hv-player-tabs">
        ${playerIds.map((pid) => {
          const pm = (telemetry.players[pid] && telemetry.players[pid].metadata) || {};
          const active = pid === this.activePlayerId;
          return `
            <button class="hv-player-tab ${active ? 'active' : ''}" data-select-player="${pid}">
              <span>${pm.flag || ''}</span>
              <span>${pid}</span>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Player Identity Row -->
      <div class="hv-player-profile">
        <div>
          <div style="font-weight:700; font-size:13.5px;">${meta.flag || ''} ${meta.name || this.activePlayerId}</div>
          <div style="font-size:11px; color:var(--muted);">${meta.country || ''} · ${handedness}-handed</div>
        </div>
        <div style="text-align:right; font-size:11px; color:var(--muted);">
          <div>Rank #${meta.world_ranking ?? '—'}</div>
        </div>
      </div>

      <!-- 4 Summary Stat Boxes -->
      <div class="hv-stat-strip">
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">Shots</span>
          <span class="hv-stat-box-value">${totalShots ?? '—'}</span>
          <span class="hv-stat-box-sub">total</span>
        </div>
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">% In</span>
          <span class="hv-stat-box-value">${pctInStr}</span>
          <span class="hv-stat-box-sub">rally-end</span>
        </div>
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">Winners</span>
          <span class="hv-stat-box-value" style="color:var(--shot-winner);">${winners ?? '—'}</span>
          <span class="hv-stat-box-sub">in</span>
        </div>
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">Errors</span>
          <span class="hv-stat-box-value" style="color:var(--shot-error);">${totalErrors ?? '—'}</span>
          <span class="hv-stat-box-sub">${errorsOut} out · ${errorsNet} net</span>
        </div>
      </div>

      <!-- Speed Table -->
      <div style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Speed by Shot Type (km/h est.)</span>
        </div>
        <table class="hv-table">
          <thead>
            <tr>
              <th>Shot Type</th>
              <th style="text-align:right;">Avg est.</th>
              <th style="text-align:right;">Top est.</th>
              <th style="text-align:right;">3D</th>
            </tr>
          </thead>
          <tbody>
            ${speedRowsHtml}
          </tbody>
        </table>
      </div>

      <!-- 3x3 Half-Court Contact Map -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Contact Map (3×3 Half-Court)</span>
          <span style="font-size:10.5px; color:var(--muted);">↑ Net</span>
        </div>
        <div class="hv-contact-map-grid">
          ${contactCellsHtml}
        </div>
      </div>
    `;

    // Bind interactive events
    this.container.querySelectorAll('[data-select-player]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectPlayer(btn.getAttribute('data-select-player'));
      });
    });

    this.container.querySelectorAll('[data-eye-family]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.toggleTypeEye(btn.getAttribute('data-eye-family'));
      });
    });

    this.container.querySelectorAll('.hv-contact-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        this.toggleContactCell(
          cell.getAttribute('data-depth'),
          cell.getAttribute('data-lateral')
        );
      });
    });
  }
}

window.PlayerCard = PlayerCard;
