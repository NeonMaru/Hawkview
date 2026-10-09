/**
 * The "Is This Shit Lagging?" Multi-Stage Progress Bar & ANE Ingestion Modal
 * Simulates on-device Neural Engine video processing with:
 * - Deterministic 4-stage pipeline progression
 * - Live frame ticker (e.g. 18,420 / 28,800 frames @ 148 FPS)
 * - Real-time breakthrough teasers ("⚡ Detected 412 km/h smash by Lee Zii Jia at 05:28!")
 * - Zero-server overhead ($0.00/mo) on-device telemetry dashboard
 * - Live computer vision terminal stream
 */

class AntiLagModal {
  constructor() {
    this.modal = document.getElementById('anti-lag-modal');
    this.progressBar = document.getElementById('pipeline-progress-bar');
    this.progressPct = document.getElementById('pipeline-progress-pct');
    this.frameTicker = document.getElementById('pipeline-frame-ticker');
    this.fpsCounter = document.getElementById('pipeline-fps-counter');
    this.stageName = document.getElementById('pipeline-stage-name');
    this.teaserTicker = document.getElementById('pipeline-teaser-ticker');
    this.terminal = document.getElementById('pipeline-terminal-output');

    this.isRunning = false;
    this.currentPct = 0;
    this.currentFrame = 0;
    this.totalFrames = 28800; // 8-min 1080p60 clip
    this.currentFps = 148;
    this.animationId = null;

    this.stages = [
      { id: 1, name: "Stage 1: Court Line Calibration & Homography", range: [0, 15] },
      { id: 2, name: "Stage 2: Rally Segmentation & Scorebug OCR", range: [15, 30] },
      { id: 3, name: "Stage 3: Shuttlecock & Player Pose Tracking", range: [30, 85] },
      { id: 4, name: "Stage 4: 3D Aerodynamic Speed & Heatmap Synthesis", range: [85, 100] }
    ];

    this.teasers = [
      "🔍 Calibrating 4 corners: homography det(H) = 1.042 locked.",
      "📋 OCR detected BWF scorebug: MAS LEE Z.J. vs TPE SU L.Y. (G2 4-5)",
      "⚡ Detected 388 km/h smash by Lee Zii Jia at 01:26!",
      "⚡ DETECTED 412 KM/H RECORD SMASH BY LEE ZII JIA AT 05:28! 💥",
      "🏸 Rally #21: 28-shot net tumble masterclass registered.",
      "🏃 Rally #34: 38 shots detected (marathon dogfight, 142m covered)!",
      "🎯 17-keypoint pose tracking: 0 player ID swaps across 45 rallies.",
      "🏆 Match Point isolated: 404 km/h jump smash down-the-line at 21:05!"
    ];

    this.bindEvents();
  }

  bindEvents() {
    const openBtn = document.getElementById('btn-analyze-clip');
    const closeBtn = document.getElementById('btn-close-modal');
    const startBtn = document.getElementById('btn-start-ingestion');
    const fastDemoBtn = document.getElementById('btn-fast-demo');
    const exportBtn = document.getElementById('btn-export-telemetry');

    if (openBtn) openBtn.addEventListener('click', () => this.open());
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (startBtn) startBtn.addEventListener('click', () => this.startPipeline(false));
    if (fastDemoBtn) fastDemoBtn.addEventListener('click', () => this.startPipeline(true));
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportTelemetryJSON());

    // Close on backdrop click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }
  }

  open() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
    if (!this.isRunning && this.currentPct === 0) {
      this.startPipeline(false);
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
  }

  logTerminal(msg, type = 'info') {
    if (!this.terminal) return;
    const line = document.createElement('div');
    line.className = 'font-mono text-xs leading-relaxed py-0.5';

    const timestamp = new Date().toISOString().substring(11, 19);
    let colorClass = 'text-slate-400';
    let prefix = 'ℹ️';

    if (type === 'success') {
      colorClass = 'text-emerald-400 font-semibold';
      prefix = '✅';
    } else if (type === 'highlight') {
      colorClass = 'text-cyan-300 font-bold';
      prefix = '⚡';
    } else if (type === 'warn') {
      colorClass = 'text-amber-400';
      prefix = '⚠️';
    }

    line.innerHTML = `<span class="text-slate-600">[${timestamp}]</span> <span class="${colorClass}">${prefix} ${msg}</span>`;
    this.terminal.appendChild(line);
    this.terminal.scrollTop = this.terminal.scrollHeight;
  }

  startPipeline(isFast = false) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentPct = 0;
    this.currentFrame = 0;
    if (this.terminal) this.terminal.innerHTML = '';

    this.logTerminal("Initializing Apple Neural Engine (ANE) CoreML hardware session...", 'info');
    this.logTerminal("Ingesting BWF 1080p60 broadcast stream (28,800 frames)...", 'info');

    const durationMs = isFast ? 4000 : 12000;
    const startTime = performance.now();
    let lastTeaserIndex = -1;

    const tick = (now) => {
      const elapsed = now - startTime;
      let pct = Math.min(100, (elapsed / durationMs) * 100);
      this.currentPct = pct;

      // Update frame ticker
      this.currentFrame = Math.floor((pct / 100) * this.totalFrames);
      this.currentFps = Math.floor(142 + Math.sin(now / 200) * 12);

      // Determine active stage
      let activeStage = this.stages[0];
      for (const st of this.stages) {
        if (pct >= st.range[0] && pct <= st.range[1]) {
          activeStage = st;
          break;
        }
      }
      if (pct >= 100) activeStage = this.stages[3];

      // Update stage UI cards
      for (let i = 1; i <= 4; i++) {
        const stepCard = document.getElementById(`stage-card-${i}`);
        const statusBadge = document.getElementById(`stage-badge-${i}`);
        if (stepCard && statusBadge) {
          if (i < activeStage.id || (pct >= 100 && i === 4)) {
            stepCard.className = "p-3 rounded-lg border border-emerald-500/40 bg-emerald-950/20";
            statusBadge.textContent = "VERIFIED";
            statusBadge.className = "text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30";
          } else if (i === activeStage.id && pct < 100) {
            stepCard.className = "p-3 rounded-lg border border-cyan-400 bg-cyan-950/20 shadow-[0_0_15px_rgba(0,240,255,0.15)]";
            statusBadge.textContent = "PROCESSING...";
            statusBadge.className = "text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-400/40 animate-pulse";
          } else {
            stepCard.className = "p-3 rounded-lg border border-slate-800 bg-slate-900/40 opacity-60";
            statusBadge.textContent = "QUEUED";
            statusBadge.className = "text-[10px] font-bold text-slate-500 bg-slate-950 px-2 py-0.5 rounded";
          }
        }
      }

      // Update DOM elements
      if (this.progressBar) this.progressBar.style.width = `${pct.toFixed(1)}%`;
      if (this.progressPct) this.progressPct.textContent = `${pct.toFixed(0)}%`;
      if (this.frameTicker) this.frameTicker.textContent = `${this.currentFrame.toLocaleString()} / ${this.totalFrames.toLocaleString()} FRAMES`;
      if (this.fpsCounter) this.fpsCounter.textContent = `${this.currentFps} FPS (ANE)`;
      if (this.stageName) this.stageName.textContent = activeStage.name;

      // Update teasers & terminal logs
      const teaserIndex = Math.min(this.teasers.length - 1, Math.floor((pct / 100) * this.teasers.length));
      if (teaserIndex !== lastTeaserIndex) {
        lastTeaserIndex = teaserIndex;
        const msg = this.teasers[teaserIndex];
        if (this.teaserTicker) this.teaserTicker.textContent = msg;
        const isHighlight = msg.includes('412') || msg.includes('RECORD') || msg.includes('Match Point');
        this.logTerminal(msg, isHighlight ? 'highlight' : 'info');
      }

      if (pct < 100) {
        this.animationId = requestAnimationFrame(tick);
      } else {
        this.isRunning = false;
        this.logTerminal("✨ Ingestion complete! 45 rallies segmented, zero cloud cost, 1.2MB telemetry ready.", 'success');
        if (this.teaserTicker) {
          this.teaserTicker.textContent = "✅ Analysis Complete: Ready to explore 412 km/h match telemetry!";
        }
      }
    };

    this.animationId = requestAnimationFrame(tick);
  }

  exportTelemetryJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.HAWKVIEW_TELEMETRY, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "match_telemetry_arctic_open_lzj_vs_sly.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.logTerminal("💾 Exported match_telemetry_arctic_open_lzj_vs_sly.json (1.2 MB)", 'success');
  }
}

window.AntiLagModal = AntiLagModal;
