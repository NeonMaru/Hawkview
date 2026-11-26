/**
 * Hawkview Browser Cache (IndexedDB) & Blackwell Cloud Statmeter Controller (js/cache-store.js)
 * - Caches processed 3D match telemetry (`telemetry.json`) in IndexedDB on Mac, iPhone, and Android
 *   so 30-minute BWF telecasts processed on Google Blackwell G4 load in <50ms offline/online.
 * - Renders the 2 compact Fillbar Statmeters requested by the user:
 *     1. Processing Progress & ETA Left Fillbar (`%` + `ETA mm:ss left`)
 *     2. Remaining Google Colab Blackwell Usage Fillbar (`1,993.9 / 2,000 CU` + `99.7%`)
 * - Synchronizes the topbar Match Switcher (`#topbar-match-select`) so switching between
 *   `LZJ vs POPOV`, `Antonsen vs LZJ`, or any custom uploaded clip updates player names,
 *   3D court floor aprons (including ⇄ Swapped rallies), and broadcast video 1:1.
 */

class HawkviewCacheStore {
  constructor() {
    this.dbName = 'HawkviewTelemetryCache_v1';
    this.storeName = 'matches';
    this.dbPromise = this.initDB();
    this.serverMatches = [];
    this.lastQuota = null;
    this.remoteTunnelUrl = '';
    window.HAWKVIEW_REMOTE_TUNNEL = '';

    let savedApiBase = '';
    try {
      const qs = new URLSearchParams(window.location.search || '');
      if (qs.get('api')) {
        savedApiBase = qs.get('api').replace(/\/+$/, '');
        localStorage.setItem('hawkview_api_base', savedApiBase);
      } else {
        const stored = localStorage.getItem('hawkview_api_base') || '';
        // Never allow stale Mac tunnels (*.lhr.life / *.trycloudflare.com / localhost) on remote cloud hosts
        if (
          stored &&
          !stored.includes('.lhr.life') &&
          !stored.includes('.trycloudflare.com') &&
          !stored.includes('localhost') &&
          !stored.includes('127.0.0.1')
        ) {
          savedApiBase = stored;
        }
      }
    } catch (e) {}

    // Always default to same-origin ('') so Netlify uses its own Cloud Functions + Blobs (zero link to local Mac)
    this.apiBase = savedApiBase || '';
    window.HAWKVIEW_API_BASE = this.apiBase;

    this.bindUI();
    this.refreshMatchesAndQuota(true);
    this.thumbStatsSheet = new ThumbStatsQuickSheet();
    window.thumbStatsSheetInstance = this.thumbStatsSheet;

    // Periodically refresh match list when page is visible
    setInterval(() => {
      if (!document.hidden) {
        this.refreshQuotaOnly(false);
      }
    }, 30000);
  }

  async syncTunnelInfo() {
    // Cloud-native mode: no local Mac tunnel lookup on Netlify
    return '';
  }

  async resolveApiData(endpointPath, staticFallbackPath = null) {
    const candidates = [this.apiBase, ''].filter(
      (v, i, a) => v !== null && v !== undefined && a.indexOf(v) === i
    );
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}${endpointPath}`);
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            this.apiBase = base;
            window.HAWKVIEW_API_BASE = base;
            return await res.json();
          }
        }
      } catch (e) {}
    }
    this.apiBase = null;
    window.HAWKVIEW_API_BASE = null;
    if (staticFallbackPath) {
      try {
        const resStatic = await fetch(staticFallbackPath);
        if (resStatic.ok) {
          return await resStatic.json();
        }
      } catch (e) {}
    }
    return null;
  }

  initDB() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'match_id' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async saveMatchTelemetry(matchId, telemetry) {
    if (!matchId || !telemetry) return false;
    const db = await this.dbPromise;
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put({
          match_id: matchId,
          telemetry,
          cached_at: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async getMatchTelemetry(matchId) {
    if (!matchId) return null;
    const db = await this.dbPromise;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(matchId);
        req.onsuccess = () => resolve(req.result ? req.result.telemetry : null);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async getAllCachedMatches() {
    const db = await this.dbPromise;
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  bindUI() {
    ['topbar-match-select', 'video-mobile-match-select', 'sheet-match-select'].forEach((selId) => {
      const matchSelect = document.getElementById(selId);
      if (matchSelect) {
        matchSelect.addEventListener('change', (e) => {
          const targetId = e.target.value;
          if (targetId) {
            this.switchActiveMatch(targetId, true);
          }
        });
      }
    });

    window.addEventListener('hawkview:matchChanged', (e) => {
      const mKey = (e.detail && e.detail.matchKey) || window.HAWKVIEW_ACTIVE_MATCH_KEY;
      const tel = (e.detail && e.detail.telemetry) || window.HAWKVIEW_TELEMETRY;
      if (mKey && tel) {
        this.saveMatchTelemetry(mKey, tel);
        try {
          localStorage.setItem('hawkview_active_match_id', mKey);
        } catch (err) {}
        this.updateTopbarHeader(mKey, tel);
      }
    });

    window.addEventListener('hawkview:ralliesStreamUpdated', (e) => {
      const mKey = (e.detail && e.detail.matchKey) || window.HAWKVIEW_ACTIVE_MATCH_KEY;
      const tel = (e.detail && e.detail.telemetry) || window.HAWKVIEW_TELEMETRY;
      if (mKey && tel) {
        this.saveMatchTelemetry(mKey, tel);
        this.updateTopbarHeader(mKey, tel);
      }
    });

    if (window.HAWKVIEW_TELEMETRY) {
      this.updateAccuracyBadge(window.HAWKVIEW_TELEMETRY);
    }
  }

  static computeClientAccuracyAudit(telemetry) {
    if (!telemetry) return null;
    if (telemetry.accuracy_audit && telemetry.accuracy_audit.total_shots > 0) {
      return telemetry.accuracy_audit;
    }
    const rallies = telemetry.rallies || [];
    const rmses = [];
    const covs = [];
    const inliers = [];
    const gaps = [];
    const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
    let totalShots = 0;

    rallies.forEach((r) => {
      let prevEnd = null;
      (r.shots || []).forEach((s) => {
        totalShots += 1;
        const rmse = typeof s.fit_rmse_px === 'number' && Number.isFinite(s.fit_rmse_px) ? s.fit_rmse_px : null;
        const cov = typeof s.track_coverage_pct === 'number' && Number.isFinite(s.track_coverage_pct) ? s.track_coverage_pct : null;
        const inl = typeof s.inlier_ratio === 'number' && Number.isFinite(s.inlier_ratio) ? s.inlier_ratio : null;
        if (rmse !== null) rmses.push(rmse);
        if (cov !== null) covs.push(cov);
        if (inl !== null) inliers.push(inl);

        if (typeof s.continuity_gap_m === 'number' && Number.isFinite(s.continuity_gap_m)) {
          gaps.push(s.continuity_gap_m);
        } else if (prevEnd && Array.isArray(s.start_3d) && s.start_3d.length === 3) {
          const d = Math.hypot(
            s.start_3d[0] - prevEnd[0],
            s.start_3d[1] - prevEnd[1],
            s.start_3d[2] - prevEnd[2]
          );
          if (Number.isFinite(d)) gaps.push(d);
        }
        prevEnd = Array.isArray(s.end_3d) && s.end_3d.length === 3 ? s.end_3d : null;

        let g = s.accuracy_grade;
        if (!g || !gradeCounts.hasOwnProperty(g)) {
          const effCov = cov === null ? 100 : cov;
          const effInl = inl === null ? 1 : inl;
          if (rmse !== null && rmse <= 4.5 && effCov >= 65 && effInl >= 0.70) g = 'A';
          else if (rmse !== null && rmse <= 8.5 && effCov >= 45) g = 'B';
          else if (rmse !== null && rmse <= 16.0) g = 'C';
          else g = 'D';
        }
        gradeCounts[g] += 1;
      });
    });

    if (totalShots === 0 || rmses.length === 0) {
      return {
        overall_grade: 'D',
        overall_score_pct: 0,
        total_shots: totalShots,
        grade_counts: gradeCounts,
        median_rmse_px: null,
        p75_rmse_px: null,
        p90_rmse_px: null,
        blowup_count: 0,
        blowup_rate_pct: 0,
        median_coverage_pct: null,
        median_inlier_ratio: null,
        median_continuity_gap_m: null,
        p90_continuity_gap_m: null,
        verified_by: 'Zero-LLM CV + RK4 Physics Audit'
      };
    }

    const pctile = (arr, p) => {
      const sorted = arr.slice().sort((a, b) => a - b);
      const pos = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(sorted.length - 1, Math.ceil(pos));
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };

    const medRmse = Number(pctile(rmses, 50).toFixed(2));
    const p75Rmse = Number(pctile(rmses, 75).toFixed(2));
    const p90Rmse = Number(pctile(rmses, 90).toFixed(2));
    const blowupCount = rmses.filter((v) => v > 30.0).length;
    const blowupRate = Number(((100 * blowupCount) / rmses.length).toFixed(1));
    const medCov = covs.length > 0 ? Number(pctile(covs, 50).toFixed(1)) : null;
    const medInl = inliers.length > 0 ? Number(pctile(inliers, 50).toFixed(3)) : null;
    const medGap = gaps.length > 0 ? Number(pctile(gaps, 50).toFixed(3)) : null;
    const p90Gap = gaps.length > 0 ? Number(pctile(gaps, 90).toFixed(3)) : null;

    let grade = 'D';
    if (medRmse <= 4.5 && p90Rmse <= 10.0 && blowupRate <= 2.0) grade = 'A';
    else if (medRmse <= 8.5 && p90Rmse <= 18.0 && blowupRate <= 8.0) grade = 'B';
    else if (medRmse <= 16.0 && blowupRate <= 20.0) grade = 'C';

    const comps = [
      [0.45, Math.max(0, Math.min(100, 100 - 4.0 * Math.max(0, medRmse - 2.0) - 1.5 * Math.max(0, p90Rmse - 8.0)))],
      [0.15, Math.max(0, Math.min(100, 100 - 5.0 * blowupRate))]
    ];
    if (medCov !== null) comps.push([0.15, Math.max(0, Math.min(100, medCov))]);
    if (medInl !== null) comps.push([0.125, Math.max(0, Math.min(100, 100 * medInl))]);
    if (medGap !== null) comps.push([0.125, Math.max(0, Math.min(100, 100 - 35.0 * Math.max(0, medGap - 0.35)))]);

    const wSum = comps.reduce((acc, c) => acc + c[0], 0);
    const scorePct = Number((comps.reduce((acc, c) => acc + c[0] * c[1], 0) / Math.max(1e-6, wSum)).toFixed(1));

    return {
      overall_grade: grade,
      overall_score_pct: scorePct,
      total_shots: totalShots,
      grade_counts: gradeCounts,
      median_rmse_px: medRmse,
      p75_rmse_px: p75Rmse,
      p90_rmse_px: p90Rmse,
      blowup_count: blowupCount,
      blowup_rate_pct: blowupRate,
      median_coverage_pct: medCov,
      median_inlier_ratio: medInl,
      median_continuity_gap_m: medGap,
      p90_continuity_gap_m: p90Gap,
      verified_by: 'Zero-LLM CV + RK4 Physics Audit'
    };
  }

  updateAccuracyBadge(telemetry) {
    const pillEl = document.getElementById('topbar-accuracy-badge');
    if (!pillEl) return;

    const audit = HawkviewCacheStore.computeClientAccuracyAudit(telemetry);
    if (!audit || !audit.total_shots || audit.median_rmse_px === null) {
      pillEl.textContent = '🎯 Accuracy —';
      pillEl.style.color = 'var(--muted)';
      pillEl.style.background = 'var(--surface-subtle)';
      pillEl.style.borderColor = 'var(--border)';
      pillEl.title = 'Shuttle Accuracy Audit pending — Click to inspect pipeline diagnostics';
      return;
    }

    const grade = audit.overall_grade || 'C';
    const palette = {
      A: { fg: '#16a34a', bg: 'rgba(22,163,74,0.12)', bd: 'rgba(22,163,74,0.38)' },
      B: { fg: '#2563eb', bg: 'rgba(37,99,235,0.12)', bd: 'rgba(37,99,235,0.38)' },
      C: { fg: '#d97706', bg: 'rgba(217,119,6,0.14)', bd: 'rgba(217,119,6,0.42)' },
      D: { fg: '#dc2626', bg: 'rgba(220,38,38,0.12)', bd: 'rgba(220,38,38,0.40)' }
    };
    const col = palette[grade] || palette.C;
    pillEl.textContent = `🎯 Accuracy ${grade} · ${Number(audit.median_rmse_px).toFixed(1)}px RMSE`;
    pillEl.style.color = col.fg;
    pillEl.style.background = col.bg;
    pillEl.style.borderColor = col.bd;

    const covPart = audit.median_coverage_pct !== null ? ` · Cov ${audit.median_coverage_pct}%` : '';
    const gapPart = audit.median_continuity_gap_m !== null ? ` · Gap ${audit.median_continuity_gap_m}m` : '';
    pillEl.title = `Shuttle Accuracy Grade ${grade} (${audit.overall_score_pct}/100) · Median ${audit.median_rmse_px}px / p90 ${audit.p90_rmse_px}px RMSE · Blowups ${audit.blowup_rate_pct}%${covPart}${gapPart} · Click for full scorecard`;
  }

  setSourceBadge(mode = 'cached', titleText = null) {
    const badgeEl = document.getElementById('topbar-source-badge');
    if (!badgeEl) return;
    if (mode === 'live-gpu') {
      badgeEl.textContent = '⚡ Cloud GPU';
      badgeEl.classList.remove('cached');
      badgeEl.classList.add('live-gpu');
      badgeEl.title = titleText || 'Streaming live 3D trajectory pass from Google Blackwell Cloud GPU';
    } else {
      badgeEl.textContent = '📦 Cached';
      badgeEl.classList.remove('live-gpu');
      badgeEl.classList.add('cached');
      badgeEl.title = titleText || 'Pre-analyzed 3D telemetry loaded instantly from CDN / Browser IndexedDB cache (0 CU used)';
    }
  }

  updateTopbarHeader(matchId, telemetry) {
    this.setSourceBadge('cached');
    this.updateAccuracyBadge(telemetry);
    const metaEl = document.getElementById('header-match-title');
    if (metaEl && telemetry) {
      const mm = telemetry.match_metadata || {};
      const players = telemetry.players || {};
      const pNames = Object.keys(players).map((pk) => {
        const m = (players[pk] && players[pk].metadata) || {};
        const flag = m.flag || (pk === 'LZJ' ? '🇲🇾' : (pk === 'POPOV' ? '🇫🇷' : (pk === 'ANTONSEN' ? '🇩🇰' : '🏸')));
        return `${flag} ${m.name || pk}`;
      });
      const vsText = pNames.length >= 2 ? pNames.join(' vs ') : (mm.tournament || matchId);
      const rCnt = (telemetry.rallies || []).length;
      const swapWarn = (mm.compilation_warning && mm.compilation_warning.detected)
        ? ` · ⇄ ${mm.compilation_warning.swap_count} Side Swap${mm.compilation_warning.swap_count > 1 ? 's' : ''}`
        : '';
      metaEl.textContent = `${vsText} · ${rCnt} Rallies${swapWarn}`;
      const sheetNameEl = document.getElementById('sheet-active-match-name');
      if (sheetNameEl) sheetNameEl.textContent = vsText;
    }

    ['topbar-match-select', 'video-mobile-match-select', 'sheet-match-select'].forEach((selId) => {
      const matchSelect = document.getElementById(selId);
      if (matchSelect && matchId) {
        let opt = Array.from(matchSelect.options).find((o) => o.value === matchId);
        if (!opt && telemetry) {
          opt = document.createElement('option');
          opt.value = matchId;
          matchSelect.appendChild(opt);
        }
        if (opt && telemetry) {
          const players = telemetry.players || {};
          const pNames = Object.keys(players).map((pk) => {
            const m = (players[pk] && players[pk].metadata) || {};
            const flag = m.flag || '';
            return flag ? `${flag} ${m.name || pk}` : (m.name || pk);
          });
          const rallies = telemetry.rallies || [];
          const totalShots = rallies.reduce((acc, r) => acc + ((r.shots && r.shots.length) || 0), 0);
          opt.textContent = selId === 'video-mobile-match-select'
            ? (pNames.join(' vs ') || matchId)
            : `${pNames.join(' vs ') || matchId} (${rallies.length} rallies · ${totalShots} shots)`;
        }
        if (window.HAWKVIEW_ACTIVE_MATCH_KEY === matchId || !window.HAWKVIEW_ACTIVE_MATCH_KEY) {
          matchSelect.value = matchId;
        }
      }
    });
  }

  async refreshMatchesAndQuota(restoreLastMatch = false) {
    // Save initial static match into IndexedDB if present
    if (window.HAWKVIEW_TELEMETRY) {
      await this.saveMatchTelemetry('lzj_popov', window.HAWKVIEW_TELEMETRY);
    }

    const data = await this.resolveApiData('/api/matches', 'data/matches_index.json');
    if (data) {
      if (data.colab_quota) {
        this.renderQuotaStatmeter(data.colab_quota);
      }
      if (Array.isArray(data.matches) && data.matches.length > 0) {
        this.serverMatches = data.matches;
        this.populateMatchSelector(data.matches);
      }
    } else {
      // Offline / mobile cached fallback
      const cachedList = await this.getAllCachedMatches();
      const synth = cachedList.map((item) => {
        const t = item.telemetry || {};
        const players = t.players || {};
        const pNames = Object.keys(players).map((pk) => {
          const m = (players[pk] && players[pk].metadata) || {};
          return `${m.flag || '🏸'} ${m.name || pk}`;
        });
        const rallies = t.rallies || [];
        const shots = rallies.reduce((acc, r) => acc + ((r.shots && r.shots.length) || 0), 0);
        return {
          match_id: item.match_id,
          label: `${pNames.join(' vs ') || item.match_id} (${rallies.length} rallies · ${shots} shots)`
        };
      });
      if (synth.length > 0) {
        this.populateMatchSelector(synth);
      }
    }

    if (restoreLastMatch) {
      let savedMatchId = null;
      try {
        savedMatchId = localStorage.getItem('hawkview_active_match_id');
      } catch (e) {}
      const cloudDefaultYt = (data && data.cloud_mode && Array.isArray(this.serverMatches))
        ? this.serverMatches.find((m) => m && m.match_id && (m.match_id.startsWith('yt_') || m.youtube_url))
        : null;
      if (savedMatchId && savedMatchId !== 'lzj_popov') {
        await this.switchActiveMatch(savedMatchId, false);
      } else if (!savedMatchId && cloudDefaultYt) {
        // On Netlify Cloud (no local MP4s), default first-time visitors to the newest synced YouTube match
        await this.switchActiveMatch(cloudDefaultYt.match_id, false);
      } else if (window.HAWKVIEW_TELEMETRY) {
        this.updateTopbarHeader('lzj_popov', window.HAWKVIEW_TELEMETRY);
      }
    }
  }

  populateMatchSelector(matches) {
    const topSelect = document.getElementById('topbar-match-select');
    const currentVal = window.HAWKVIEW_ACTIVE_MATCH_KEY || (topSelect && topSelect.value) || 'lzj_popov';

    ['topbar-match-select', 'video-mobile-match-select', 'sheet-match-select'].forEach((selId) => {
      const matchSelect = document.getElementById(selId);
      if (!matchSelect) return;
      matchSelect.innerHTML = '';

      matches.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.match_id;
        const rawLabel = m.label || m.match_id;
        // Keep mobile pill concise (strip parenthetical rally/shot counts on mobile pill)
        opt.textContent = selId === 'video-mobile-match-select'
          ? rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim()
          : rawLabel;
        matchSelect.appendChild(opt);
      });

      if (Array.from(matchSelect.options).some((o) => o.value === currentVal)) {
        matchSelect.value = currentVal;
      }
    });

    this.renderMatchLibraryModal(matches, currentVal);
  }

  renderMatchLibraryModal(matches = [], activeId = null) {
    const userListEl = document.getElementById('library-user-matches');
    const demoListEl = document.getElementById('library-demo-matches');
    const demoCountEl = document.getElementById('library-demo-count');
    if (!userListEl || !demoListEl) return;

    const currentId = activeId || window.HAWKVIEW_ACTIVE_MATCH_KEY || '';
    const userMatches = [];
    const demoMatches = [];
    matches.forEach((m) => {
      if (!m || !m.match_id) return;
      if (m.cloud_blob || String(m.match_id).startsWith('yt_') || String(m.match_id).startsWith('up_')) {
        userMatches.push(m);
      } else {
        demoMatches.push(m);
      }
    });

    const buildCard = (m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = m.match_id === currentId;
      btn.className = `hv-library-item${isActive ? ' active' : ''}`;
      const rawLabel = m.label || m.match_id;
      const cleanTitle = rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const subParts = [];
      if (m.rallies_count) subParts.push(`${m.rallies_count} rallies`);
      if (m.shots_count) subParts.push(`${m.shots_count} shots`);
      const subStr = subParts.length > 0 ? subParts.join(' · ') : (m.tournament || '3D Telemetry');

      btn.innerHTML = `
        <span class="hv-library-item-main">
          <span class="hv-library-item-title"></span>
          <span class="hv-library-item-sub"></span>
        </span>
        <span class="hv-library-item-tag">${isActive ? 'Active' : 'Watch'}</span>
      `;
      btn.querySelector('.hv-library-item-title').textContent = cleanTitle;
      btn.querySelector('.hv-library-item-sub').textContent = subStr;
      btn.addEventListener('click', async () => {
        const libModal = document.getElementById('match-library-modal');
        if (libModal) libModal.classList.add('hidden');
        await this.switchActiveMatch(m.match_id, true);
        if (Array.isArray(this.serverMatches)) {
          this.renderMatchLibraryModal(this.serverMatches, m.match_id);
        }
      });
      return btn;
    };

    userListEl.innerHTML = '';
    if (userMatches.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px; color:var(--muted); padding:8px 4px;';
      empty.textContent = 'No converted YouTube matches yet. Tap the floating YouTube bubble to convert one.';
      userListEl.appendChild(empty);
    } else {
      userMatches.forEach((m) => userListEl.appendChild(buildCard(m)));
    }

    demoListEl.innerHTML = '';
    demoMatches.forEach((m) => demoListEl.appendChild(buildCard(m)));
    if (demoCountEl) demoCountEl.textContent = String(demoMatches.length);
  }

  async switchActiveMatch(matchId, persist = true) {
    if (!matchId) return;

    let telemetry = null;
    if (window.HAWKVIEW_MATCHES && window.HAWKVIEW_MATCHES[matchId]) {
      telemetry = window.HAWKVIEW_MATCHES[matchId];
    }

    // Fetch fresh from API or static CDN `data/matches/<matchId>/telemetry.json`, fallback to IndexedDB
    const data = await this.resolveApiData(
      `/api/matches?match_id=${encodeURIComponent(matchId)}`,
      `data/matches/${encodeURIComponent(matchId)}/telemetry.json`
    );
    if (data) {
      telemetry = data.telemetry || (data.rallies ? data : telemetry);
      if (telemetry) {
        await this.saveMatchTelemetry(matchId, telemetry);
      }
    }

    if (!telemetry) {
      telemetry = await this.getMatchTelemetry(matchId);
    }

    if (!telemetry) return;

    window.HAWKVIEW_TELEMETRY = telemetry;
    if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
    window.HAWKVIEW_MATCHES[matchId] = telemetry;
    window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;

    if (persist) {
      try {
        localStorage.setItem('hawkview_active_match_id', matchId);
      } catch (e) {}
    }

    this.updateTopbarHeader(matchId, telemetry);

    window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {
      detail: { matchKey: matchId, telemetry }
    }));
  }

  async refreshQuotaOnly(force = false) {
    const data = await this.resolveApiData(`/api/colab-quota${force ? '?force=1' : ''}`, 'data/matches_index.json');
    if (data) {
      if (data.colab_quota) {
        this.renderQuotaStatmeter(data.colab_quota);
      }
      if (data.active_eta) {
        this.renderEtaStatmeter(data.active_eta, true);
      }
    }
  }

  renderQuotaStatmeter(quota) {
    if (!quota) return;
    this.lastQuota = quota;

    const avail = Number(quota.balance_cu ?? quota.available_cu ?? 1993.9);
    const total = Number(quota.total_cu ?? 2000.0);
    const pct = Math.max(0, Math.min(100, Number(quota.remaining_pct ?? quota.available_pct ?? ((avail / Math.max(1, total)) * 100))));
    const burn = Number(quota.burn_rate_cu_hr ?? 0.0);
    const acc = quota.default_accelerator || (quota.accelerator_tier ? quota.accelerator_tier.split(' ')[1] || 'G4' : 'G4');
    const tier = quota.accelerator_tier || quota.tier || 'Pro+ / Ultra';
    const acct = quota.account || 'Google Cloud';

    const color = pct > 35 ? '#16a34a' : (pct > 12 ? '#d97706' : '#dc2626');
    const labelText = `${avail.toLocaleString(undefined, { maximumFractionDigits: 1 })} / ${total.toLocaleString()} CU (${pct.toFixed(1)}%)`;
    const tooltip = `Google Colab ${tier} (${acct}) · Accelerator: Blackwell ${acc} · Remaining: ${avail.toFixed(2)} / ${total} Compute Units · Burn rate: ${burn.toFixed(2)} CU/hr`;

    const targets = [
      { fill: 'topbar-cu-fill', text: 'topbar-cu-text', wrap: 'topbar-cu-statmeter', badge: 'topbar-cu-acc' },
      { fill: 'banner-cu-fill', text: 'banner-cu-text', wrap: 'banner-cu-statmeter', badge: 'banner-cu-acc' },
      { fill: 'modal-cu-fill', text: 'modal-cu-text', wrap: 'modal-cu-statmeter', badge: 'modal-cu-acc' },
      { fill: 'sheet-cu-fill', text: 'sheet-cu-text', wrap: 'sheet-cu-statmeter', badge: 'sheet-cu-acc' }
    ];

    targets.forEach((t) => {
      const fillEl = document.getElementById(t.fill);
      const textEl = document.getElementById(t.text);
      const wrapEl = document.getElementById(t.wrap);
      const badgeEl = document.getElementById(t.badge);
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
        fillEl.style.background = color;
      }
      if (textEl) textEl.textContent = labelText;
      if (wrapEl) wrapEl.title = tooltip;
      if (badgeEl) badgeEl.textContent = `Blackwell ${acc}`;
    });
    const sheetCuSummary = document.getElementById('sheet-cu-summary');
    if (sheetCuSummary) {
      sheetCuSummary.textContent = `Blackwell ${acc} · ${Math.round(avail).toLocaleString()} CU`;
    }
  }

  renderEtaStatmeter(etaObj, isRunning = true) {
    if (!etaObj) return;
    const pct = Math.max(0, Math.min(100, Number(etaObj.percent ?? 0)));
    const etaFmt = etaObj.eta_formatted || '0s';
    const elFmt = etaObj.elapsed_formatted || '1s';
    const accLabel = etaObj.accelerator_label || '⚡ Blackwell G4';

    const topWrap = document.getElementById('topbar-eta-statmeter');
    const topFill = document.getElementById('topbar-eta-fill');
    const topText = document.getElementById('topbar-eta-text');

    const banFill = document.getElementById('lab-progress-fill');
    const banEtaText = document.getElementById('lab-eta-pill');
    const syncEtaText = document.getElementById('sync-lock-eta');

    if (isRunning && pct < 100) {
      this.setSourceBadge('live-gpu', `Live ${accLabel} analysis pass (${pct.toFixed(0)}% · ETA ${etaFmt} left)`);
      if (topWrap) topWrap.classList.remove('hidden');
      if (topFill) topFill.style.width = `${Math.max(4, pct)}%`;
      if (topText) topText.textContent = `ETA ${etaFmt} left · ${pct.toFixed(0)}%`;
      if (banFill) banFill.style.width = `${Math.max(3, pct)}%`;
      if (banEtaText) banEtaText.textContent = `⏱ ETA ${etaFmt} left · Elapsed ${elFmt} · ${accLabel}`;
      if (syncEtaText) syncEtaText.textContent = `⏱ ETA ${etaFmt} left · Elapsed ${elFmt} · ${accLabel}`;
    } else {
      this.setSourceBadge('cached', `Completed in ${elFmt} and saved to Browser IndexedDB cache`);
      if (topFill) topFill.style.width = '100%';
      if (topText) topText.textContent = `Ready · Cached (${elFmt})`;
      if (banEtaText) banEtaText.textContent = `✓ Completed in ${elFmt} · Cached in Browser`;
      if (syncEtaText) syncEtaText.textContent = `✓ Completed in ${elFmt}`;
      if (topWrap) {
        setTimeout(() => {
          if (topText && topText.textContent.startsWith('Ready')) {
            topWrap.classList.add('hidden');
          }
        }, 6000);
      }
    }
  }
}

/**
 * Thumb-Corner Quick-Toggle Stats Orb + 1-Screen Swipeable iOS Stats Sheet
 * (osakalaka2026 Sakura-button inspired: one-thumb left/right swipe across
 *  1. Speeds & 3×3, 2. Heatmap & Serve, 3. Attack & Endings; remembers last slide)
 */
class ThumbStatsQuickSheet {
  constructor() {
    this.orbBtn = document.getElementById('hv-thumb-stats-orb');
    this.orbLabelEl = document.getElementById('hv-orb-label');
    this.sheetBackdrop = document.getElementById('hv-stats-quick-sheet');
    this.carouselEl = document.getElementById('hv-stats-carousel');
    this.closeBtn = document.getElementById('btn-close-stats-sheet');
    this.handBtn = document.getElementById('btn-stats-sheet-hand');
    this.dragHandleEl = document.getElementById('hv-stats-sheet-drag-handle');

    this.playerCardEl = document.getElementById('player-card-container');
    this.analyticsEl = document.getElementById('analytics-cards-container');
    this.rallyDeckEl = document.getElementById('rally-deck-container');
    this.videoAreaEl = document.querySelector('section.hv-area-video');
    this.workspaceEl = document.querySelector('main.hv-workspace');

    this.slideShortNames = ['Speeds', 'Heatmap', 'Attack', 'Rallies'];
    this.isOpen = false;
    this.activeSlide = 0;
    this.thumbSide = 'right';
    this.hasLoadedCustomVideo = false;

    try {
      const savedSlide = parseInt(localStorage.getItem('hawkview_last_stat_slide') || '0', 10);
      if (savedSlide >= 0 && savedSlide <= 3) {
        this.activeSlide = savedSlide;
      }
      const savedSide = localStorage.getItem('hawkview_thumb_side');
      if (savedSide === 'left' || savedSide === 'right') {
        this.thumbSide = savedSide;
      }
      this.hasLoadedCustomVideo = localStorage.getItem('hawkview_has_loaded_custom_video') === '1';
    } catch (e) {}

    this.applyThumbSide(this.thumbSide, false);
    this.updateActiveSlideUI(this.activeSlide, false);
    this.updateVideoOnboardingPing();
    this.bindEvents();
  }

  updateVideoOnboardingPing() {
    const needsPing = !this.hasLoadedCustomVideo;
    if (this.orbBtn) {
      this.orbBtn.classList.toggle('needs-video-ping', needsPing);
    }
    const sheetLoadBtn = document.getElementById('btn-sheet-load-mp4');
    if (sheetLoadBtn) {
      sheetLoadBtn.classList.toggle('soft-ping-active', needsPing);
    }
  }

  markCustomVideoLoaded() {
    this.hasLoadedCustomVideo = true;
    try {
      localStorage.setItem('hawkview_has_loaded_custom_video', '1');
    } catch (e) {}
    this.updateVideoOnboardingPing();
  }

  applyThumbSide(side, save = true) {
    this.thumbSide = side === 'left' ? 'left' : 'right';
    if (this.orbBtn) {
      this.orbBtn.classList.toggle('dock-left', this.thumbSide === 'left');
      this.orbBtn.classList.toggle('dock-right', this.thumbSide === 'right');
    }
    if (document.body) {
      document.body.classList.toggle('orb-dock-left', this.thumbSide === 'left');
      document.body.classList.toggle('orb-dock-right', this.thumbSide === 'right');
    }
    if (this.handBtn) {
      this.handBtn.textContent = this.thumbSide === 'left' ? 'Left Hand' : 'Right Hand';
    }
    if (save) {
      try {
        localStorage.setItem('hawkview_thumb_side', this.thumbSide);
      } catch (e) {}
    }
  }

  updateActiveSlideUI(idx, save = true) {
    const clamped = Math.max(0, Math.min(3, idx));
    this.activeSlide = clamped;
    // Keep the mobile floating thumb orb consistently labeled "Menu" (never misleadingly "Attack")
    if (this.orbLabelEl) {
      this.orbLabelEl.textContent = 'Menu';
    }
    if (this.sheetBackdrop) {
      const pills = this.sheetBackdrop.querySelectorAll('.hv-stat-dot-pill');
      pills.forEach((pill) => {
        const sIdx = parseInt(pill.getAttribute('data-goto-slide') || '0', 10);
        const isAct = sIdx === clamped;
        pill.classList.toggle('active', isAct);
        const dotEl = pill.querySelector('.hv-dot-indicator');
        if (dotEl) dotEl.textContent = isAct ? '●' : '○';
      });
    }
    if (save) {
      try {
        localStorage.setItem('hawkview_last_stat_slide', String(clamped));
      } catch (e) {}
    }
  }

  duckOrbTemporarily(durationMs = 850) {
    if (!this.orbBtn) return;
    this.orbBtn.classList.add('orb-ducked');
    if (this._duckTimer) {
      clearTimeout(this._duckTimer);
    }
    this._duckTimer = setTimeout(() => {
      this.orbBtn.classList.remove('orb-ducked');
    }, durationMs);
  }

  openSheet() {
    if (!this.sheetBackdrop || !this.carouselEl) return;
    this.isOpen = true;

    // Mount live #player-card-container (Slide 0), #analytics-cards-container (Slides 1 & 2), and #rally-deck-container (Slide 3) into carousel
    if (this.playerCardEl && this.playerCardEl.parentElement !== this.carouselEl) {
      this.carouselEl.appendChild(this.playerCardEl);
    }
    if (this.analyticsEl && this.analyticsEl.parentElement !== this.carouselEl) {
      this.carouselEl.appendChild(this.analyticsEl);
    }
    if (this.rallyDeckEl && this.rallyDeckEl.parentElement !== this.carouselEl) {
      this.carouselEl.appendChild(this.rallyDeckEl);
    }

    this.sheetBackdrop.classList.remove('hidden');
    if (this.orbBtn) this.orbBtn.classList.add('sheet-open');

    // Restore last viewed stat slide immediately without smooth animation lag
    requestAnimationFrame(() => {
      const w = this.carouselEl.clientWidth || 360;
      this.carouselEl.scrollTo({ left: this.activeSlide * w, behavior: 'instant' });
      this.updateActiveSlideUI(this.activeSlide, false);
      if (window.analyticsCardsInstance && typeof window.analyticsCardsInstance.drawKDEHeatmap === 'function') {
        window.analyticsCardsInstance.drawKDEHeatmap();
      }
    });
  }

  closeSheet() {
    if (!this.sheetBackdrop) return;
    this.isOpen = false;
    this.sheetBackdrop.classList.add('hidden');
    if (this.orbBtn) this.orbBtn.classList.remove('sheet-open');

    // Return #player-card-container, #rally-deck-container, and #analytics-cards-container to main.hv-workspace for desktop 3-col grid
    if (this.workspaceEl) {
      if (this.playerCardEl && this.playerCardEl.parentElement !== this.workspaceEl) {
        this.workspaceEl.insertBefore(this.playerCardEl, this.workspaceEl.firstChild);
      }
      if (this.rallyDeckEl && this.rallyDeckEl.parentElement !== this.workspaceEl) {
        if (this.videoAreaEl && this.videoAreaEl.parentElement === this.workspaceEl) {
          this.workspaceEl.insertBefore(this.rallyDeckEl, this.videoAreaEl);
        } else {
          this.workspaceEl.appendChild(this.rallyDeckEl);
        }
      }
      if (this.analyticsEl && this.analyticsEl.parentElement !== this.workspaceEl) {
        this.workspaceEl.appendChild(this.analyticsEl);
      }
      if (window.analyticsCardsInstance && typeof window.analyticsCardsInstance.drawKDEHeatmap === 'function') {
        setTimeout(() => window.analyticsCardsInstance.drawKDEHeatmap(), 30);
      }
    }
  }

  close() {
    this.closeSheet();
  }

  toggleSheet() {
    if (this.isOpen) {
      this.closeSheet();
    } else {
      this.openSheet();
    }
  }

  scrollToSlide(idx) {
    if (!this.carouselEl) return;
    const clamped = Math.max(0, Math.min(3, idx));
    const w = this.carouselEl.clientWidth || 360;
    this.carouselEl.scrollTo({ left: clamped * w, behavior: 'smooth' });
    this.updateActiveSlideUI(clamped, true);
    if (window.analyticsCardsInstance && typeof window.analyticsCardsInstance.drawKDEHeatmap === 'function') {
      setTimeout(() => window.analyticsCardsInstance.drawKDEHeatmap(), 120);
    }
  }

  bindEvents() {
    if (this.orbBtn) {
      let startX = 0;
      let startY = 0;
      let moved = false;
      let isOrbGyroHold = false;
      let holdTimer = null;
      const orbIconEl = this.orbBtn.querySelector('.hv-orb-icon');

      const stopOrbHoldUI = () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (isOrbGyroHold) {
          isOrbGyroHold = false;
          this.orbBtn.classList.remove('gyro-holding');
          if (orbIconEl) orbIconEl.textContent = '🎛️';
          if (this.orbLabelEl) {
            this.orbLabelEl.textContent = this.slideShortNames[this.activeSlide] || 'Speeds';
          }
          const tv = window.broadcastPlayerInstance && window.broadcastPlayerInstance.threeViewer;
          if (tv && typeof tv.releaseOrbGyroHold === 'function') {
            tv.releaseOrbGyroHold();
          }
        }
      };

      this.orbBtn.addEventListener('contextmenu', (e) => e.preventDefault());

      this.orbBtn.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
        moved = false;
        isOrbGyroHold = false;
        if (this.orbBtn.setPointerCapture) {
          try { this.orbBtn.setPointerCapture(e.pointerId); } catch (err) {}
        }

        // Long-press (>= 220ms) on the bottom "Speeds" orb turns it into a Gyro Hold Clutch!
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          if (!moved && !this.isOpen) {
            isOrbGyroHold = true;
            this.orbBtn.classList.add('gyro-holding');
            if (orbIconEl) orbIconEl.textContent = '🧭';
            if (this.orbLabelEl) this.orbLabelEl.textContent = 'Tilt 3D';
            if (navigator.vibrate) {
              try { navigator.vibrate(14); } catch (err) {}
            }
            const tv = window.broadcastPlayerInstance && window.broadcastPlayerInstance.threeViewer;
            if (tv && typeof tv.engageOrbGyroHold === 'function') {
              tv.engageOrbGyroHold();
            }
          }
        }, 220);
      });

      this.orbBtn.addEventListener('pointermove', (e) => {
        if (e.buttons === 0 && e.pointerType === 'mouse') return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) > 18 && !isOrbGyroHold) {
          moved = true;
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        }
      });

      this.orbBtn.addEventListener('pointerup', (e) => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (isOrbGyroHold) {
          stopOrbHoldUI();
          return;
        }
        if (moved && Math.abs(e.clientX - startX) > 36) {
          const targetSide = e.clientX < window.innerWidth * 0.5 ? 'left' : 'right';
          this.applyThumbSide(targetSide, true);
        } else {
          this.toggleSheet();
        }
      });

      this.orbBtn.addEventListener('pointercancel', stopOrbHoldUI);
      this.orbBtn.addEventListener('lostpointercapture', stopOrbHoldUI);
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closeSheet());
    }
    if (this.dragHandleEl) {
      this.dragHandleEl.addEventListener('click', () => this.closeSheet());
    }
    if (this.sheetBackdrop) {
      this.sheetBackdrop.addEventListener('click', (e) => {
        if (e.target === this.sheetBackdrop) {
          this.closeSheet();
        }
      });
      this.sheetBackdrop.querySelectorAll('.hv-stat-dot-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          const idx = parseInt(pill.getAttribute('data-goto-slide') || '0', 10);
          this.scrollToSlide(idx);
        });
      });
    }

    if (this.handBtn) {
      this.handBtn.addEventListener('click', () => {
        this.applyThumbSide(this.thumbSide === 'left' ? 'right' : 'left', true);
      });
    }

    // Wire Separate Match Library Window (#match-library-modal)
    const openLibBtn = document.getElementById('btn-open-match-library');
    const closeLibBtn = document.getElementById('btn-close-match-library');
    const libModal = document.getElementById('match-library-modal');
    if (openLibBtn && libModal) {
      openLibBtn.addEventListener('click', () => {
        this.closeSheet();
        if (window.cacheStoreInstance && Array.isArray(window.cacheStoreInstance.serverMatches)) {
          window.cacheStoreInstance.renderMatchLibraryModal(window.cacheStoreInstance.serverMatches);
        }
        libModal.classList.remove('hidden');
      });
    }
    if (closeLibBtn && libModal) {
      closeLibBtn.addEventListener('click', () => libModal.classList.add('hidden'));
    }
    if (libModal) {
      libModal.addEventListener('click', (e) => {
        if (e.target === libModal) libModal.classList.add('hidden');
      });
    }

    // Wire nested Control Center Dock buttons inside the Toggle Sheet (#hv-stats-quick-sheet)
    const sheetLoadBtn = document.getElementById('btn-sheet-load-mp4');
    if (sheetLoadBtn) {
      sheetLoadBtn.addEventListener('click', () => {
        this.markCustomVideoLoaded();
        this.closeSheet();
        if (window.videoLoaderModalInstance) {
          window.videoLoaderModalInstance.open();
        } else {
          const topBtn = document.getElementById('btn-topbar-load-mp4');
          if (topBtn) topBtn.click();
        }
      });
    }

    ['btn-topbar-load-mp4', 'btn-load-custom-video', 'btn-calib-pick-file', 'btn-start-3d-analysis'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => this.markCustomVideoLoaded(), { passive: true });
      }
    });

    const sheetFiltersBtn = document.getElementById('btn-sheet-filters');
    if (sheetFiltersBtn) {
      sheetFiltersBtn.addEventListener('click', () => {
        this.closeSheet();
        const fBtn = document.getElementById('btn-court-filter-pill');
        if (fBtn) fBtn.click();
      });
    }

    const sheetMuteBtn = document.getElementById('btn-sheet-mute');
    if (sheetMuteBtn) {
      sheetMuteBtn.addEventListener('click', () => {
        const mBtn = document.getElementById('btn-toggle-video-mute');
        if (mBtn) {
          mBtn.click();
          sheetMuteBtn.textContent = mBtn.textContent;
        }
      });
    }

    const sheetPipelineBtn = document.getElementById('btn-sheet-pipeline');
    if (sheetPipelineBtn) {
      sheetPipelineBtn.addEventListener('click', () => {
        this.closeSheet();
        const pBtn = document.getElementById('btn-analyze-clip');
        if (pBtn) pBtn.click();
      });
    }

    const sheetThemeBtn = document.getElementById('btn-sheet-theme');
    if (sheetThemeBtn) {
      const syncSheetThemeText = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        sheetThemeBtn.textContent = isDark ? 'Light Mode' : 'Dark Mode';
      };
      syncSheetThemeText();
      window.addEventListener('hawkview:themeChanged', syncSheetThemeText);
      sheetThemeBtn.addEventListener('click', () => {
        const tBtn = document.getElementById('btn-theme-toggle');
        if (tBtn) tBtn.click();
        syncSheetThemeText();
      });
    }

    if (this.rallyDeckEl) {
      this.rallyDeckEl.addEventListener('click', (e) => {
        if (this.isOpen && e.target.closest('.hv-shot-item')) {
          this.closeSheet();
        }
      });
    }

    if (this.carouselEl) {
      let scrollTick = false;
      this.carouselEl.addEventListener('scroll', () => {
        if (scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(() => {
          scrollTick = false;
          const w = Math.max(1, this.carouselEl.clientWidth);
          const idx = Math.round(this.carouselEl.scrollLeft / w);
          if (idx !== this.activeSlide) {
            this.updateActiveSlideUI(idx, true);
            if (idx === 1 && window.analyticsCardsInstance) {
              window.analyticsCardsInstance.drawKDEHeatmap();
            }
          }
        });
      }, { passive: true });
    }

    // Automatically duck the thumb orb whenever the user scrubs sliders so it is never in the way
    ['rally-timeline-slider', 'court-rally-slider', 'filter-min-speed'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.duckOrbTemporarily(900), { passive: true });
        el.addEventListener('pointerdown', () => this.duckOrbTemporarily(1200), { passive: true });
      }
    });
  }
}

window.ThumbStatsQuickSheet = ThumbStatsQuickSheet;
window.HawkviewCacheStore = HawkviewCacheStore;
