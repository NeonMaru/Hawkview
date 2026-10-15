/**
 * Hawkview Rally Deck (Spec Section 3.4 & Section 1.5)
 * - One row per rally: rally #, game, score_before → score_after, server + service_court (L/R),
 *   shot_count, how it ended (winner / out / net), and badges for partial and needs_review.
 * - Expanding a row lists all shots in that rally (#, time, hitter, type, speed km/h est., outcome).
 *   Clicking a shot seeks the video to shot.time - 1 s and highlights the 3D arc.
 * - "⋯" menu with "Change rally winner": flips the rally winner, recomputes all subsequent rally
 *   scores, servers, service courts, and needs_review flags per Section 1.5, saves to
 *   data/matches/lzj_popov/corrections.json (via localStorage + server endpoint + JSON export).
 */

class RallyDeck {
  constructor(shotExplorer, broadcastPlayer) {
    this.explorer = shotExplorer;
    this.player = broadcastPlayer;
    this.container = document.getElementById('rally-deck-container');

    this.expandedRallyIds = new Set([1]);
    this.openMenuRallyId = null;
    this.storageKey = 'hawkview_corrections_lzj_popov';
    this.corrections = this.loadStoredCorrections();

    // Snapshot original rallies so corrections can be cleanly re-applied or reset
    this.snapshotOriginalRallies();
    if (Object.keys(this.corrections.flipped_rallies || {}).length > 0) {
      this.applyCorrectionsToTelemetry();
    } else {
      this.validateAllRallies();
    }

    this.bindEvents();
    this.render();
  }

  snapshotOriginalRallies() {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;
    telemetry.rallies.forEach((r) => {
      if (!r._original) {
        r._original = {
          winner: r.winner,
          ended_by: r.ended_by,
          server: r.server,
          service_court: r.service_court,
          score_before: JSON.parse(JSON.stringify(r.score_before || { LZJ: 0, POPOV: 0 })),
          score_after: JSON.parse(JSON.stringify(r.score_after || { LZJ: 0, POPOV: 0 })),
          needs_review: Boolean(r.needs_review)
        };
      }
    });
  }

  loadStoredCorrections() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {
      match_id: 'lzj_popov',
      updated_at: null,
      flipped_rallies: {}
    };
  }

  saveCorrections() {
    this.corrections.updated_at = new Date().toISOString();
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.corrections));
    } catch (e) {}

    // Also persist to data/matches/lzj_popov/corrections.json if local server supports POST
    try {
      fetch('data/matches/lzj_popov/corrections.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.corrections, null, 2)
      }).catch(() => {});
    } catch (e) {}
  }

  exportCorrectionsJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(this.corrections, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', 'corrections.json');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  resetCorrections() {
    this.corrections = {
      match_id: 'lzj_popov',
      updated_at: null,
      flipped_rallies: {}
    };
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {}
    this.applyCorrectionsToTelemetry();
    this.render();
    window.dispatchEvent(new CustomEvent('hawkview:filtersChanged'));
  }

  /**
   * Enforces BWF Laws of Badminton Section 1.5 scoring & serving rules across all rallies:
   * - Rally-point scoring to 21, win by 2 (at 29-all, 30th point wins).
   * - Winner of a rally serves the next one.
   * - Service court: server's score even -> 'right', odd -> 'left'.
   * - Ends: players change ends after game 1, after game 2, and in game 3 at 11.
   * - Any computed score sequence that breaks these rules marks affected rallies needs_review: true.
   */
  validateAllRallies() {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;

    const rallies = telemetry.rallies;
    let prevRally = null;

    rallies.forEach((r) => {
      let review = false;
      const sb = r.score_before || { LZJ: 0, POPOV: 0 };
      const sa = r.score_after || { LZJ: 0, POPOV: 0 };
      const winner = r.winner;
      const loser = winner === 'LZJ' ? 'POPOV' : 'LZJ';

      // Rule 1: score_after must increment winner by +1 and keep loser unchanged
      if (!winner || sa[winner] !== sb[winner] + 1 || sa[loser] !== sb[loser]) {
        review = true;
      }

      // Rule 2: service court must match parity of server's score_before (even -> right, odd -> left)
      const srv = r.server;
      if (srv && typeof sb[srv] === 'number') {
        const expectedCourt = (sb[srv] % 2 === 0) ? 'right' : 'left';
        if (r.service_court !== expectedCourt) {
          review = true;
        }
      } else {
        review = true;
      }

      // Rule 3: if first shot is a non-partial serve, server should match first shot hitter
      if (!r.partial && r.shots && r.shots.length > 0) {
        const firstShot = r.shots[0];
        if (firstShot.is_serve && firstShot.hitter && srv && firstShot.hitter !== srv) {
          review = true;
        }
      }

      // Rule 4: Shot alternation check (no two consecutive shots by same hitter)
      if (r.shots && r.shots.length > 1) {
        for (let k = 1; k < r.shots.length; k++) {
          if (r.shots[k].hitter === r.shots[k - 1].hitter) {
            review = true;
            break;
          }
        }
      }

      // Rule 5: Progression from previous rally in the same game
      if (prevRally && prevRally.game === r.game) {
        const psb = prevRally.score_after || { LZJ: 0, POPOV: 0 };
        const dLzj = sb.LZJ - psb.LZJ;
        const dPop = sb.POPOV - psb.POPOV;

        // Scores cannot go backwards within a game
        if (dLzj < 0 || dPop < 0) {
          review = true;
        }

        // If consecutive points (no unshown broadcast gap), winner of prevRally must serve
        if (dLzj === 0 && dPop === 0 && prevRally.winner && r.server !== prevRally.winner) {
          review = true;
        }

        // Verify game-winning score bounds (21, win by 2, max 30)
        if (sb.LZJ >= 30 || sb.POPOV >= 30) {
          review = true;
        }
      } else if (prevRally && prevRally.game !== r.game) {
        // Players must swap ends between games
        if (prevRally.near_player && r.near_player && prevRally.near_player === r.near_player) {
          review = true;
        }
      }

      r.needs_review = review;
      prevRally = r;
    });
  }

  /**
   * Re-applies all user winner overrides from `this.corrections.flipped_rallies`
   * and recomputes every later rally's score, server, and service court in that game.
   */
  applyCorrectionsToTelemetry() {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;

    this.snapshotOriginalRallies();
    const rallies = telemetry.rallies;

    // 1. Restore from original snapshot
    rallies.forEach((r) => {
      const orig = r._original;
      r.winner = orig.winner;
      r.ended_by = orig.ended_by;
      r.server = orig.server;
      r.service_court = orig.service_court;
      r.score_before = JSON.parse(JSON.stringify(orig.score_before));
      r.score_after = JSON.parse(JSON.stringify(orig.score_after));
      r.needs_review = orig.needs_review;
    });

    // 2. Group rallies by game and propagate score/server/service_court changes
    const flipped = this.corrections.flipped_rallies || {};
    const games = {};
    rallies.forEach((r) => {
      const g = r.game || 1;
      if (!games[g]) games[g] = [];
      games[g].push(r);
    });

    Object.values(games).forEach((gameRallies) => {
      const delta = { LZJ: 0, POPOV: 0 };

      for (let i = 0; i < gameRallies.length; i++) {
        const r = gameRallies[i];
        const origBefore = r._original.score_before;
        const origPrevAfter = i > 0 ? gameRallies[i - 1]._original.score_after : null;
        const isConsecutive = origPrevAfter &&
          origBefore.LZJ === origPrevAfter.LZJ &&
          origBefore.POPOV === origPrevAfter.POPOV;

        // Apply accumulated score delta from earlier flipped rallies in this game
        r.score_before = {
          LZJ: Math.max(0, origBefore.LZJ + delta.LZJ),
          POPOV: Math.max(0, origBefore.POPOV + delta.POPOV)
        };

        // If this rally was flipped by user
        const overrideWinner = flipped[String(r.rally_id)];
        if (overrideWinner && overrideWinner !== r._original.winner) {
          const oldWinner = r._original.winner;
          r.winner = overrideWinner;
          delta[oldWinner] -= 1;
          delta[overrideWinner] += 1;
        }

        // Compute score_after from score_before + winner
        r.score_after = {
          LZJ: r.score_before.LZJ + (r.winner === 'LZJ' ? 1 : 0),
          POPOV: r.score_before.POPOV + (r.winner === 'POPOV' ? 1 : 0)
        };

        // Recompute server if consecutive with previous rally (or if previous rally was flipped)
        if (i > 0 && (isConsecutive || flipped[String(gameRallies[i - 1].rally_id)])) {
          r.server = gameRallies[i - 1].winner;
        }

        // Recompute service court from server's score parity (Section 1.5: even -> right, odd -> left)
        if (r.server && typeof r.score_before[r.server] === 'number') {
          r.service_court = (r.score_before[r.server] % 2 === 0) ? 'right' : 'left';
        }
      }
    });

    // 3. Re-validate all rallies per Section 1.5
    this.validateAllRallies();
  }

  getMatchPlayerIds() {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (telemetry && telemetry.players) {
      const keys = Object.keys(telemetry.players);
      if (keys.length >= 2) return [keys[0], keys[1]];
    }
    return ['LZJ', 'POPOV'];
  }

  changeRallyWinner(rallyId) {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;

    const rally = telemetry.rallies.find((r) => r.rally_id === Number(rallyId));
    if (!rally) return;

    const [pA, pB] = this.getMatchPlayerIds();
    const newWinner = rally.winner === pA ? pB : pA;
    const origWinner = rally._original ? rally._original.winner : rally.winner;

    if (!this.corrections.flipped_rallies) {
      this.corrections.flipped_rallies = {};
    }

    if (newWinner === origWinner) {
      delete this.corrections.flipped_rallies[String(rallyId)];
    } else {
      this.corrections.flipped_rallies[String(rallyId)] = newWinner;
    }

    this.saveCorrections();
    this.applyCorrectionsToTelemetry();
    this.openMenuRallyId = null;
    this.render();

    window.dispatchEvent(new CustomEvent('hawkview:filtersChanged'));
  }

  formatEndedBy(endedBy) {
    if (endedBy === 'winner') return { label: 'winner', cls: 'hv-badge-winner' };
    if (endedBy === 'error_out') return { label: 'out', cls: 'hv-badge-error' };
    if (endedBy === 'error_net') return { label: 'net', cls: 'hv-badge-error' };
    return { label: endedBy || '—', cls: '' };
  }

  formatTime(sec) {
    if (typeof sec !== 'number' || isNaN(sec)) return '—';
    const mins = Math.floor(sec / 60).toString().padStart(2, '0');
    const rem = (sec % 60).toFixed(1).padStart(4, '0');
    return `${mins}:${rem}`;
  }

  bindEvents() {
    window.addEventListener('hawkview:rallyChanged', (e) => {
      const r = e.detail && e.detail.rally;
      if (r) {
        this.highlightActiveRallyRow(r.rally_id);
      }
    });

    window.addEventListener('hawkview:shotSelected', (e) => {
      const shot = e.detail && e.detail.shot;
      const rally = e.detail && e.detail.rally;
      if (rally) {
        this.expandedRallyIds.add(rally.rally_id);
        this.render();
      }
      if (shot) {
        this.highlightSelectedShotRow(shot.shot_id);
      }
    });

    window.addEventListener('hawkview:matchChanged', () => {
      this.snapshotOriginalRallies();
      this.applyCorrectionsToTelemetry();
      this.render();
    });

    window.addEventListener('hawkview:ralliesStreamUpdated', () => {
      this.snapshotOriginalRallies();
      this.render();
    });

    document.addEventListener('click', (e) => {
      if (this.openMenuRallyId !== null && !e.target.closest('[data-rally-menu-wrap]')) {
        this.openMenuRallyId = null;
        this.render();
      }
    });
  }

  highlightActiveRallyRow(rallyId) {
    if (!this.container) return;
    this.container.querySelectorAll('.hv-rally-row').forEach((row) => {
      const id = Number(row.getAttribute('data-rally-row-id'));
      row.classList.toggle('active', id === Number(rallyId));
    });
  }

  highlightSelectedShotRow(shotId) {
    if (!this.container) return;
    this.container.querySelectorAll('.hv-shot-item').forEach((el) => {
      const id = Number(el.getAttribute('data-shot-id'));
      el.classList.toggle('selected', id === Number(shotId));
    });
  }

  render() {
    if (!this.container) return;
    const telemetry = window.HAWKVIEW_TELEMETRY;
    const rallies = (telemetry && telemetry.rallies) || [];
    const [pA, pB] = this.getMatchPlayerIds();
    const activeRallyId = (this.player && this.player.currentRally && this.player.currentRally.rally_id) || 1;
    const selectedShotId = this.explorer ? this.explorer.selectedShotId : null;
    const hasCorrections = Object.keys((this.corrections && this.corrections.flipped_rallies) || {}).length > 0;

    const rowsHtml = rallies.map((r, rIdx) => {
      const isExpanded = this.expandedRallyIds.has(r.rally_id);
      const isActive = r.rally_id === activeRallyId;
      const sb = r.score_before || {};
      const sa = r.score_after || {};
      const sbA = sb[pA] !== undefined ? sb[pA] : '—';
      const sbB = sb[pB] !== undefined ? sb[pB] : '—';
      const saA = sa[pA] !== undefined ? sa[pA] : '—';
      const saB = sa[pB] !== undefined ? sa[pB] : '—';
      const srvCourtShort = r.service_court === 'left' ? 'L' : (r.service_court === 'right' ? 'R' : '—');
      const endInfo = this.formatEndedBy(r.ended_by);
      const isMenuOpen = this.openMenuRallyId === r.rally_id;
      const isFlipped = Boolean(this.corrections?.flipped_rallies?.[String(r.rally_id)]);

      const shotsHtml = isExpanded ? `
        <div class="hv-rally-shots-drawer">
          <div style="display:grid; grid-template-columns:32px 48px 54px 1fr 78px 66px; gap:4px; padding:2px 6px 4px; font-size:10px; font-weight:600; color:var(--muted); border-bottom:1px solid var(--border); margin-bottom:4px;">
            <span>#</span>
            <span>Time</span>
            <span>Hitter</span>
            <span>Type</span>
            <span style="text-align:right;">Speed</span>
            <span style="text-align:right;">Outcome</span>
          </div>
          ${(r.shots || []).map((s) => {
            const isSel = s.shot_id === selectedShotId;
            const spd = typeof s.speed_kmh === 'number' ? `${s.speed_kmh.toFixed(1)} est.` : '—';
            const outCls = s.outcome === 'winner'
              ? 'hv-badge-winner'
              : (s.outcome === 'error_out' || s.outcome === 'error_net' ? 'hv-badge-error' : '');
            return `
              <div class="hv-shot-item ${isSel ? 'selected' : ''}" data-shot-id="${s.shot_id}" data-rally-index="${rIdx}">
                <span style="color:var(--muted);">#${s.shot_num}</span>
                <span>${this.formatTime(s.time)}</span>
                <span style="font-weight:600;">${s.hitter || '—'}</span>
                <span style="text-transform:capitalize;">${ShotExplorer.formatShotType(s.type)}</span>
                <span style="text-align:right;">${spd}</span>
                <span style="text-align:right;"><span class="hv-badge ${outCls}">${s.outcome}</span></span>
              </div>
            `;
          }).join('')}
        </div>
      ` : '';

      return `
        <div class="hv-rally-row ${isActive ? 'active' : ''}" data-rally-row-id="${r.rally_id}">
          <div class="hv-rally-row-header" data-toggle-rally="${r.rally_id}" data-rally-idx="${rIdx}">
            <div style="display:flex; align-items:center; gap:6px; min-width:0; flex-wrap:wrap;">
              <span style="font-weight:700; min-width:26px;">R${r.rally_id}</span>
              <span class="hv-badge">G${r.game || 1}</span>
              <span style="font-weight:600;" class="tabular-nums">${sbA}–${sbB} → ${saA}–${saB}</span>
              <span style="color:var(--muted); font-size:11px;">${r.server || '—'} (${srvCourtShort})</span>
            </div>
            <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
              <span style="color:var(--muted); font-size:11px;">${r.shot_count || (r.shots ? r.shots.length : 0)}s</span>
              <span class="hv-badge ${endInfo.cls}">${r.winner || ''} ${endInfo.label}</span>
              ${r.partial ? '<span class="hv-badge" title="Rally cut short by broadcast edit">partial</span>' : ''}
              ${r.needs_review ? '<span class="hv-badge hv-badge-warn" title="Score/server sequence flagged for review per Section 1.5">needs_review</span>' : ''}
              ${isFlipped ? '<span class="hv-badge hv-badge-winner" title="Winner manually corrected">edited</span>' : ''}
              <div style="position:relative;" data-rally-menu-wrap="${r.rally_id}">
                <button class="hv-btn" style="padding:2px 6px; font-size:12px;" data-open-menu="${r.rally_id}" title="Rally options">⋯</button>
                ${isMenuOpen ? `
                  <div style="position:absolute; right:0; top:26px; z-index:40; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:4px; min-width:170px; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                    <button class="hv-btn" style="width:100%; justify-content:flex-start; border:none;" data-flip-winner="${r.rally_id}">
                      Change rally winner (→ ${r.winner === pA ? pB : pA})
                    </button>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
          ${shotsHtml}
        </div>
      `;
    }).join('');

    const reviewCount = rallies.filter((r) => r.needs_review).length;

    this.container.innerHTML = `
      <div class="hv-panel-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <h2 class="hv-panel-title">Rally Deck (${rallies.length})</h2>
          <span class="hv-badge ${reviewCount > 0 ? 'hv-badge-warn' : 'hv-badge-continue'}">
            ${reviewCount > 0 ? `${reviewCount} needs_review` : '1.5 rules OK'}
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
          ${hasCorrections ? `
            <button id="btn-export-corrections" class="hv-btn" style="padding:3px 7px; font-size:11px;" title="Download data/matches/lzj_popov/corrections.json">Export JSON</button>
            <button id="btn-reset-corrections" class="hv-btn" style="padding:3px 7px; font-size:11px;">Reset</button>
          ` : ''}
        </div>
      </div>
      <div class="hv-rally-list">
        ${rowsHtml}
      </div>
    `;

    // Bind row expand + rally seek
    this.container.querySelectorAll('[data-toggle-rally]').forEach((hdr) => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('[data-rally-menu-wrap]')) return;
        const rid = Number(hdr.getAttribute('data-toggle-rally'));
        const rIdx = Number(hdr.getAttribute('data-rally-idx'));
        if (this.expandedRallyIds.has(rid)) {
          this.expandedRallyIds.delete(rid);
        } else {
          this.expandedRallyIds.add(rid);
        }
        if (this.player) {
          this.player.selectRally(rIdx);
        }
        this.render();
      });
    });

    // Bind individual shot row click -> seek video to shot.time - 1s & highlight 3D arc
    this.container.querySelectorAll('[data-shot-id]').forEach((shotRow) => {
      shotRow.addEventListener('click', (e) => {
        e.stopPropagation();
        const shotId = Number(shotRow.getAttribute('data-shot-id'));
        if (this.explorer) {
          this.explorer.selectShot(shotId, true);
        }
        this.highlightSelectedShotRow(shotId);
      });
    });

    // Bind "⋯" menu button
    this.container.querySelectorAll('[data-open-menu]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rid = Number(btn.getAttribute('data-open-menu'));
        this.openMenuRallyId = (this.openMenuRallyId === rid) ? null : rid;
        this.render();
      });
    });

    // Bind "Change rally winner" action
    this.container.querySelectorAll('[data-flip-winner]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rid = Number(btn.getAttribute('data-flip-winner'));
        this.changeRallyWinner(rid);
      });
    });

    const expBtn = document.getElementById('btn-export-corrections');
    if (expBtn) {
      expBtn.addEventListener('click', () => this.exportCorrectionsJSON());
    }
    const rstBtn = document.getElementById('btn-reset-corrections');
    if (rstBtn) {
      rstBtn.addEventListener('click', () => this.resetCorrections());
    }
  }
}

window.RallyDeck = RallyDeck;
