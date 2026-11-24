/**
 * Hawkview Live Server Error & Telemetry Diagnostics Console + Pipeline Metrics (js/anti-lag-modal.js)
 * Pulls live telemetry from `GET /api/diagnostics`:
 *   - Active Tunnel URL, Provider (Cloudflare Edge vs SSH), & Measured HTTP RTT (ms)
 *   - Chunked MP4 Upload Sessions (chunks received, MB/s throughput, bytes on disk)
 *   - Active / Failed Analysis Jobs with full Python stack trace (`traceback`)
 *   - Server Event & Error Log Ring Buffer (`recent_events` — last 60 HTTP events & errors)
 *   - Measured 7-Stage CV & 3D Aerodynamic Pipeline Accuracy Metrics
 */

class AntiLagModal {
  constructor() {
    this.modal = document.getElementById('anti-lag-modal');
    this.bodyEl = document.getElementById('anti-lag-modal-body');
    this.lastDiagnostics = null;
    this.lastPingMs = null;
    this.autoRefreshTimer = null;
    this.bindEvents();
  }

  bindEvents() {
    const openBtn = document.getElementById('btn-analyze-clip');
    const accuracyPillBtn = document.getElementById('topbar-accuracy-badge');
    const closeBtn = document.getElementById('btn-close-modal');
    const exportBtn = document.getElementById('btn-export-telemetry');
    const syncLockDiagBtn = document.getElementById('btn-sync-lock-diag');
    const calibDiagBtn = document.getElementById('btn-calib-open-diag');

    if (openBtn) openBtn.addEventListener('click', () => this.open('diagnostics'));
    if (accuracyPillBtn) accuracyPillBtn.addEventListener('click', () => this.open('accuracy'));
    if (syncLockDiagBtn) syncLockDiagBtn.addEventListener('click', () => this.open('diagnostics'));
    if (calibDiagBtn) calibDiagBtn.addEventListener('click', () => this.open('diagnostics'));
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportTelemetryJSON());

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }
  }

  open(tab = 'diagnostics') {
    if (!this.modal) return;
    this.modal.style.zIndex = '10000';
    this.modal.classList.remove('hidden');
    this.renderRealNumbers();
    if (tab === 'accuracy') {
      const scEl = document.getElementById('hv-accuracy-scorecard-section');
      if (scEl && typeof scEl.scrollIntoView === 'function') {
        setTimeout(() => scEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
      }
    }
    this.fetchLiveServerDiagnostics();
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
    this.autoRefreshTimer = setInterval(() => {
      if (this.modal && !this.modal.classList.contains('hidden')) {
        this.fetchLiveServerDiagnostics(true);
      }
    }, 4000);
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  getApiUrl(path) {
    const base = (window.HAWKVIEW_API_BASE || window.HAWKVIEW_REMOTE_TUNNEL || '').replace(/\/+$/, '');
    const isRemoteHost = typeof window !== 'undefined' &&
      window.location &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';
    if (isRemoteHost && base) {
      return `${base}${path}`;
    }
    return path;
  }

  async fetchLiveServerDiagnostics(silent = false) {
    const statusBadge = document.getElementById('diag-live-status-badge');
    if (statusBadge && !silent) {
      statusBadge.textContent = '🔄 Pulling live logs from server...';
    }
    const t0 = performance.now();
    let diag = null;
    try {
      let r = await fetch(`${this.getApiUrl('/api/diagnostics')}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r || !r.ok) {
        r = await fetch(`/api/diagnostics?t=${Date.now()}`, { cache: 'no-store' });
      }
      if (r && r.ok) {
        diag = await r.json();
        this.lastPingMs = Math.round(performance.now() - t0);
        this.lastDiagnostics = diag;
      }
    } catch (e) {
      try {
        const r2 = await fetch(`/api/diagnostics?t=${Date.now()}`, { cache: 'no-store' });
        if (r2 && r2.ok) {
          diag = await r2.json();
          this.lastPingMs = Math.round(performance.now() - t0);
          this.lastDiagnostics = diag;
        }
      } catch (e2) {}
    }
    this.renderDiagnosticsSection(diag);
  }

  escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  renderDiagnosticsSection(diag) {
    const container = document.getElementById('hv-live-diagnostics-mount');
    if (!container) return;

    if (!diag) {
      container.innerHTML = `
        <div style="padding:10px 12px; border:1px solid var(--shot-error); background:rgba(220,38,38,0.08); border-radius:8px; margin-bottom:12px;">
          <div style="font-weight:700; color:var(--shot-error); font-size:12.5px;">
            ⚠️ Server Diagnostics Endpoint Unreachable (/api/diagnostics)
          </div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">
            Could not reach <code>${this.escapeHtml(this.getApiUrl('/api/diagnostics'))}</code>. Check that <code>server.py</code> (:8123) and <code>tunnel_watchdog.py</code> are running.
          </div>
        </div>
      `;
      return;
    }

    const providerLabel = diag.tunnel_provider === 'cloudflare_edge'
      ? '⚡ Cloudflare Edge HTTP/2 (Unthrottled)'
      : diag.tunnel_provider === 'localhost_run_ssh'
        ? '⚠️ localhost.run SSH (~29 KB/s cap)'
        : '💻 Localhost Direct (:8123)';

    const jobs = Object.values(diag.analysis_jobs || {});
    const uploads = Object.values(diag.upload_sessions || {});
    const events = (diag.recent_events || []).slice(0, 35);

    const uploadsHtml = uploads.length === 0
      ? `<div style="font-size:11.5px; color:var(--muted); padding:6px 0;">No chunked MP4 uploads recorded in this server session yet.</div>`
      : `<table class="hv-table" style="margin-bottom:8px; font-size:11.5px;">
          <thead>
            <tr>
              <th>Match ID / File</th>
              <th>Chunks</th>
              <th>Throughput</th>
              <th>On Disk</th>
              <th style="text-align:right;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${uploads.map((u) => `
              <tr>
                <td><strong>${this.escapeHtml(u.filename || u.match_id)}</strong><br><span style="color:var(--muted); font-size:10.5px;">${this.escapeHtml(u.match_id)}</span></td>
                <td class="tabular-nums">${u.chunks_received || 0} / ${u.total_chunks || '?'}</td>
                <td class="tabular-nums">${u.mb_per_sec || 0} MB/s (${u.avg_kbps || 0} KB/s)</td>
                <td class="tabular-nums">${((u.on_disk_bytes || 0) / (1024 * 1024)).toFixed(2)} MB</td>
                <td style="text-align:right; font-weight:700; color:${u.status === 'completed' ? '#16a34a' : '#2563eb'};">${this.escapeHtml(u.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;

    const jobsHtml = jobs.length === 0
      ? `<div style="font-size:11.5px; color:var(--muted); padding:6px 0;">No active or failed analysis jobs in this server session.</div>`
      : jobs.map((j) => {
          const isErr = j.status === 'error';
          const borderCol = isErr ? 'var(--shot-error)' : j.status === 'completed' ? '#16a34a' : 'var(--border)';
          return `
            <div style="padding:8px 10px; border:1px solid ${borderCol}; border-radius:6px; margin-bottom:6px; background:var(--surface-subtle);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px;">
                <strong>${this.escapeHtml(j.match_id)} · <span style="text-transform:uppercase; color:${borderCol};">${this.escapeHtml(j.status)}</span> (${j.percent || 0}%)</strong>
                <span class="tabular-nums" style="font-size:11px; color:var(--muted);">Rallies: ${j.rallies_completed || 0}/${j.rallies_total || 0}</span>
              </div>
              <div style="font-size:11.5px; color:var(--text); margin-top:3px;">
                ${this.escapeHtml(j.stage || '')} — <span style="color:var(--muted);">${this.escapeHtml(j.message || '')}</span>
              </div>
              ${j.error ? `<div style="margin-top:5px; color:var(--shot-error); font-weight:600; font-size:11.5px;">❌ Error: ${this.escapeHtml(j.error)}</div>` : ''}
              ${j.traceback ? `<pre style="margin-top:6px; padding:8px; background:#0f172a; color:#fca5a5; border-radius:6px; font-size:10.5px; overflow-x:auto; max-height:160px;">${this.escapeHtml(j.traceback)}</pre>` : ''}
            </div>
          `;
        }).join('');

    const eventsHtml = events.length === 0
      ? `<div style="font-size:11.5px; color:var(--muted);">No server events logged yet.</div>`
      : events.map((ev) => {
          const isBad = Number(ev.status) >= 400 || ev.error_trace;
          const badgeBg = isBad ? 'rgba(220,38,38,0.15)' : 'rgba(22,163,74,0.14)';
          const badgeCol = isBad ? '#ef4444' : '#16a34a';
          return `
            <div style="padding:5px 8px; border-bottom:1px solid var(--border); font-family:monospace; font-size:11px;">
              <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <span>
                  <span style="color:var(--muted);">${this.escapeHtml((ev.iso || '').slice(11, 19))}</span>
                  <span style="display:inline-block; padding:1px 5px; border-radius:4px; background:${badgeBg}; color:${badgeCol}; font-weight:700; margin:0 4px;">${ev.status}</span>
                  <strong>${this.escapeHtml(ev.kind)}</strong> · ${this.escapeHtml(ev.endpoint)}
                </span>
                <span style="color:var(--muted);">${ev.duration_ms || 0} ms</span>
              </div>
              ${ev.detail ? `<div style="color:var(--muted); margin-top:2px; word-break:break-all;">${this.escapeHtml(ev.detail)}</div>` : ''}
              ${ev.error_trace ? `<pre style="margin-top:4px; padding:6px; background:#0f172a; color:#fca5a5; border-radius:4px; font-size:10px; overflow-x:auto;">${this.escapeHtml(ev.error_trace)}</pre>` : ''}
            </div>
          `;
        }).join('');

    container.innerHTML = `
      <div style="padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-subtle); margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          <div style="font-weight:700; font-size:12.5px; color:var(--text);">
            🩺 Live Server Telemetry &amp; Error Log Console
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <span id="diag-live-status-badge" class="hv-badge" style="font-size:11px;">
              🟢 Connected · Ping ${this.lastPingMs || 0} ms · Uptime ${diag.uptime_sec || 0}s
            </span>
            <button id="btn-diag-refresh-now" type="button" class="hv-btn" style="padding:3px 8px; font-size:11px;">
              🔄 Pull Server Logs
            </button>
            <button id="btn-diag-copy-json" type="button" class="hv-btn" style="padding:3px 8px; font-size:11px;">
              📋 Copy Diagnostics JSON
            </button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin-bottom:10px;">
          <div class="hv-stat-box">
            <span class="hv-stat-box-label">Tunnel Provider</span>
            <span class="hv-stat-box-value" style="font-size:12.5px;">${providerLabel}</span>
            <span class="hv-stat-box-sub" style="word-break:break-all;">${this.escapeHtml(diag.tunnel_url || 'localhost:8123')}</span>
          </div>
          <div class="hv-stat-box">
            <span class="hv-stat-box-label">Upload Sessions</span>
            <span class="hv-stat-box-value">${uploads.length}</span>
            <span class="hv-stat-box-sub">1 MB chunked stream</span>
          </div>
          <div class="hv-stat-box">
            <span class="hv-stat-box-label">Analysis Jobs</span>
            <span class="hv-stat-box-value">${jobs.length}</span>
            <span class="hv-stat-box-sub">${(diag.available_videos || []).length} MP4s on server</span>
          </div>
        </div>

        <div style="font-weight:700; font-size:11.5px; text-transform:uppercase; color:var(--muted); margin:8px 0 4px;">
          1. Chunked MP4 Upload Sessions
        </div>
        ${uploadsHtml}

        <div style="font-weight:700; font-size:11.5px; text-transform:uppercase; color:var(--muted); margin:8px 0 4px;">
          2. Active / Recent Analysis Jobs &amp; Python Tracebacks
        </div>
        ${jobsHtml}

        <div style="font-weight:700; font-size:11.5px; text-transform:uppercase; color:var(--muted); margin:8px 0 4px;">
          3. Server HTTP Event &amp; Error Ring Buffer (Latest ${events.length})
        </div>
        <div style="max-height:190px; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--panel);">
          ${eventsHtml}
        </div>
      </div>
    `;

    const refreshBtn = document.getElementById('btn-diag-refresh-now');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.fetchLiveServerDiagnostics(false);
    }
    const copyBtn = document.getElementById('btn-diag-copy-json');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const payloadStr = JSON.stringify({
          client_time: new Date().toISOString(),
          client_url: window.location.href,
          remote_tunnel: window.HAWKVIEW_REMOTE_TUNNEL,
          ping_ms: this.lastPingMs,
          server_diagnostics: this.lastDiagnostics
        }, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payloadStr).then(() => {
            copyBtn.textContent = '✅ Copied Diagnostics JSON!';
            setTimeout(() => { copyBtn.textContent = '📋 Copy Diagnostics JSON'; }, 2000);
          });
        }
      };
    }
  }

  renderRealNumbers() {
    if (!this.bodyEl) return;
    const telemetry = window.HAWKVIEW_TELEMETRY || {};
    const src = telemetry.source || {};
    const cal = telemetry.calibration || {};
    const rallies = telemetry.rallies || [];
    const totalShots = rallies.reduce((acc, r) => acc + ((r.shots && r.shots.length) || 0), 0);

    const allRmse = [];
    rallies.forEach((r) => {
      (r.shots || []).forEach((s) => {
        if (typeof s.fit_rmse_px === 'number') allRmse.push(s.fit_rmse_px);
      });
    });
    allRmse.sort((a, b) => a - b);
    const medianRmse = allRmse.length > 0
      ? `${allRmse[Math.floor(allRmse.length / 2)].toFixed(2)} px`
      : '—';

    const framesStr = typeof src.frames_processed === 'number'
      ? src.frames_processed.toLocaleString()
      : '—';
    const fpsStr = typeof src.fps === 'number' ? `${src.fps.toFixed(1)} fps` : '—';
    const decodeFpsStr = typeof src.decode_fps === 'number' && src.decode_fps > 0
      ? `${src.decode_fps.toFixed(1)} fps`
      : '—';
    const durStr = typeof src.duration_sec === 'number' ? `${src.duration_sec.toFixed(2)} s` : '—';
    const reprojStr = typeof cal.reprojection_error_px === 'number'
      ? `${cal.reprojection_error_px.toFixed(2)} px`
      : '—';
    const lineRmseStr = typeof cal.line_sample_rmse_px === 'number'
      ? `${cal.line_sample_rmse_px.toFixed(2)} px`
      : '—';
    const focalStr = (cal.K && cal.K[0] && typeof cal.K[0][0] === 'number')
      ? `${cal.K[0][0].toFixed(1)} px`
      : '—';

    const audit = (window.HawkviewCacheStore && typeof window.HawkviewCacheStore.computeClientAccuracyAudit === 'function')
      ? window.HawkviewCacheStore.computeClientAccuracyAudit(telemetry)
      : (telemetry.accuracy_audit || null);

    const gradeColors = {
      A: { fg: '#16a34a', bg: 'rgba(22,163,74,0.14)', bd: 'rgba(22,163,74,0.40)', bar: '#16a34a' },
      B: { fg: '#2563eb', bg: 'rgba(37,99,235,0.14)', bd: 'rgba(37,99,235,0.40)', bar: '#2563eb' },
      C: { fg: '#d97706', bg: 'rgba(217,119,6,0.14)', bd: 'rgba(217,119,6,0.42)', bar: '#d97706' },
      D: { fg: '#dc2626', bg: 'rgba(220,38,38,0.14)', bd: 'rgba(220,38,38,0.42)', bar: '#dc2626' }
    };

    let accuracyScorecardHtml = '';
    if (audit && audit.total_shots > 0) {
      const og = audit.overall_grade || 'C';
      const oc = gradeColors[og] || gradeColors.C;
      const gc = audit.grade_counts || { A: 0, B: 0, C: 0, D: 0 };
      const tot = Math.max(1, audit.total_shots);
      const pctA = ((100 * (gc.A || 0)) / tot).toFixed(1);
      const pctB = ((100 * (gc.B || 0)) / tot).toFixed(1);
      const pctC = ((100 * (gc.C || 0)) / tot).toFixed(1);
      const pctD = ((100 * (gc.D || 0)) / tot).toFixed(1);

      const p50Str = audit.median_rmse_px != null ? `${Number(audit.median_rmse_px).toFixed(2)} px` : '—';
      const p75Str = audit.p75_rmse_px != null ? `${Number(audit.p75_rmse_px).toFixed(1)}px` : '—';
      const p90Str = audit.p90_rmse_px != null ? `${Number(audit.p90_rmse_px).toFixed(1)}px` : '—';
      const blowStr = `${Number(audit.blowup_rate_pct || 0).toFixed(1)}%`;
      const blowSub = `${audit.blowup_count || 0} / ${audit.total_shots} shots (>30px)`;
      const covStr = audit.median_coverage_pct != null ? `${Number(audit.median_coverage_pct).toFixed(1)}%` : '—';
      const inlStr = audit.median_inlier_ratio != null ? `${(Number(audit.median_inlier_ratio) * 100).toFixed(1)}%` : '—';
      const contStr = audit.median_continuity_gap_m != null ? `${Number(audit.median_continuity_gap_m).toFixed(2)} m` : '—';
      const contP90Str = audit.p90_continuity_gap_m != null ? `${Number(audit.p90_continuity_gap_m).toFixed(2)} m` : '—';

      accuracyScorecardHtml = `
        <div id="hv-accuracy-scorecard-section" style="padding:10px 12px; border:1px solid ${oc.bd}; border-radius:8px; background:var(--surface-subtle); margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <div style="font-weight:700; font-size:12.5px; color:var(--text);">
              🎯 Shuttle Tracking &amp; 3D Accuracy Scorecard
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span class="hv-badge tabular-nums" style="background:${oc.bg}; color:${oc.fg}; border:1px solid ${oc.bd}; font-weight:700; font-size:11.5px;">
                Grade ${this.escapeHtml(og)} · ${Number(audit.overall_score_pct || 0).toFixed(1)} / 100
              </span>
              <span class="hv-badge" style="font-size:10.5px; color:var(--muted);">
                ${this.escapeHtml(audit.verified_by || 'Zero-LLM CV + RK4 Physics Audit')}
              </span>
            </div>
          </div>

          <div style="margin-bottom:10px;">
            <div style="display:flex; width:100%; height:10px; border-radius:999px; overflow:hidden; background:var(--border);">
              <div style="width:${pctA}%; background:${gradeColors.A.bar};" title="Grade A: ${gc.A || 0} (${pctA}%)"></div>
              <div style="width:${pctB}%; background:${gradeColors.B.bar};" title="Grade B: ${gc.B || 0} (${pctB}%)"></div>
              <div style="width:${pctC}%; background:${gradeColors.C.bar};" title="Grade C: ${gc.C || 0} (${pctC}%)"></div>
              <div style="width:${pctD}%; background:${gradeColors.D.bar};" title="Grade D: ${gc.D || 0} (${pctD}%)"></div>
            </div>
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-top:5px; font-size:11px;" class="tabular-nums">
              <span style="color:${gradeColors.A.fg}; font-weight:600;">● Grade A: ${gc.A || 0} (${pctA}%)</span>
              <span style="color:${gradeColors.B.fg}; font-weight:600;">● Grade B: ${gc.B || 0} (${pctB}%)</span>
              <span style="color:${gradeColors.C.fg}; font-weight:600;">● Grade C: ${gc.C || 0} (${pctC}%)</span>
              <span style="color:${gradeColors.D.fg}; font-weight:600;">● Grade D: ${gc.D || 0} (${pctD}%)</span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:8px;">
            <div class="hv-stat-box">
              <span class="hv-stat-box-label">3D→2D Fit RMSE (p50)</span>
              <span class="hv-stat-box-value tabular-nums">${p50Str}</span>
              <span class="hv-stat-box-sub tabular-nums">p75: ${p75Str} · p90: ${p90Str}</span>
            </div>
            <div class="hv-stat-box">
              <span class="hv-stat-box-label">Blowup Rate</span>
              <span class="hv-stat-box-value tabular-nums">${blowStr}</span>
              <span class="hv-stat-box-sub tabular-nums">${blowSub}</span>
            </div>
            <div class="hv-stat-box">
              <span class="hv-stat-box-label">Median Track Coverage</span>
              <span class="hv-stat-box-value tabular-nums">${covStr}</span>
              <span class="hv-stat-box-sub tabular-nums">RANSAC inliers: ${inlStr}</span>
            </div>
            <div class="hv-stat-box">
              <span class="hv-stat-box-label">3D Shot Continuity</span>
              <span class="hv-stat-box-value tabular-nums">${contStr}</span>
              <span class="hv-stat-box-sub tabular-nums">p90 gap: ${contP90Str}</span>
            </div>
          </div>
        </div>
      `;
    }

    this.bodyEl.innerHTML = `
      ${accuracyScorecardHtml}

      <div id="hv-live-diagnostics-mount">
        <div style="padding:10px; font-size:12px; color:var(--muted);">🔄 Connecting to live server diagnostics (/api/diagnostics)...</div>
      </div>

      <div style="font-weight:700; font-size:12px; color:var(--text); margin-bottom:6px;">
        📊 Active Match 3D Telemetry Summary
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;">
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">Frames Processed</span>
          <span class="hv-stat-box-value">${framesStr}</span>
          <span class="hv-stat-box-sub">${fpsStr} (${durStr})</span>
        </div>
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">Rallies & Shots</span>
          <span class="hv-stat-box-value">${rallies.length} / ${totalShots}</span>
          <span class="hv-stat-box-sub">rallies / 3D shots</span>
        </div>
        <div class="hv-stat-box">
          <span class="hv-stat-box-label">3D Reprojection</span>
          <span class="hv-stat-box-value">${reprojStr}</span>
          <span class="hv-stat-box-sub">median shot fit: ${medianRmse}</span>
        </div>
      </div>

      <table class="hv-table" style="margin-bottom:12px;">
        <thead>
          <tr>
            <th>Pipeline Stage</th>
            <th>Model / Solver</th>
            <th style="text-align:right;">Measured Metric</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Phase A · Decode & Calibration</td>
            <td>OpenCV solvePnP (fx = fy = ${focalStr})</td>
            <td style="text-align:right;">Reproj ${reprojStr} · Line RMSE ${lineRmseStr}</td>
          </tr>
          <tr>
            <td>Phase B · Rally Segmentation</td>
            <td>Court green-ratio + cut detector</td>
            <td style="text-align:right;">${rallies.length} rallies (0 replays)</td>
          </tr>
          <tr>
            <td>Phase C · 2D Shuttle Tracking</td>
            <td>${(src.models && src.models.shuttle) || 'TrackNetV3'}</td>
            <td style="text-align:right;">${framesStr} frames @ ${decodeFpsStr}</td>
          </tr>
          <tr>
            <td>Phase D · Pose & Hit Detection</td>
            <td>${(src.models && src.models.pose) || 'rtmlib-rtmpose-m'}</td>
            <td style="text-align:right;">${totalShots} hits attributed</td>
          </tr>
          <tr>
            <td>Phase E/F · 3D Fit & BWF Rules</td>
            <td>${(src.models && src.models.trajectory_3d) || 'MonoTrack-RK4'}</td>
            <td style="text-align:right;">Median RMSE ${medianRmse}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  exportTelemetryJSON() {
    const activeTelemetry = window.HAWKVIEW_TELEMETRY || {};
    const dataStr = 'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(activeTelemetry, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', 'match_telemetry.json');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

window.AntiLagModal = AntiLagModal;
