/**
 * Hawkview Pipeline Progress & Telemetry Summary Modal (Spec Section 2.1)
 * Plain modal showing real measured pipeline numbers only (zero chronograph styling).
 */

class AntiLagModal {
  constructor() {
    this.modal = document.getElementById('anti-lag-modal');
    this.bodyEl = document.getElementById('anti-lag-modal-body');
    this.bindEvents();
  }

  bindEvents() {
    const openBtn = document.getElementById('btn-analyze-clip');
    const closeBtn = document.getElementById('btn-close-modal');
    const exportBtn = document.getElementById('btn-export-telemetry');

    if (openBtn) openBtn.addEventListener('click', () => this.open());
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportTelemetryJSON());

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }
  }

  open() {
    if (!this.modal) return;
    this.renderRealNumbers();
    this.modal.classList.remove('hidden');
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
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

    this.bodyEl.innerHTML = `
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

      <div style="padding:8px 10px; background:var(--surface-subtle); border:1px solid var(--border); border-radius:6px; font-family:monospace; font-size:11.5px; color:var(--muted);">
        CLI command: <span style="color:var(--text);">python3 -m engine.pipeline --video "${src.video || 'assets/LZJvPopov.mp4'}"</span>
      </div>
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
