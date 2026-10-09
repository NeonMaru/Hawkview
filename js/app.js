/**
 * Master Hawkview Application Coordinator
 * Binds the Casio Edifice Chronograph bezel, dual negative LCDs,
 * 3 sub-dials, 2D BWF court canvas, and real Three.js 3D Viewport together.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Instantiate Subsystems
  const subDials = new SubDialManager();
  const courtView = new CourtViewManager('court-canvas');
  const antiLagModal = new AntiLagModal();

  // Negative LCD Readout DOM Elements
  const lcdScoreMAS = document.getElementById('lcd-score-mas');
  const lcdScoreTPE = document.getElementById('lcd-score-tpe');
  const lcdStopwatch = document.getElementById('lcd-stopwatch-timer');
  const lcdSplitTimer = document.getElementById('lcd-split-timer');
  const lcdShotFreq = document.getElementById('lcd-shot-freq');
  const lcdRallyBadge = document.getElementById('lcd-rally-badge');
  const lcdKeyMoment = document.getElementById('lcd-key-moment');

  // Mode state: 0 = Cockpit, 1 = Court Focus, 2 = Radar Focus
  let currentMode = 0;
  const modes = ['FULL CHRONOGRAPH', 'COURT HEATMAP FOCUS', 'SMASH RADAR FOCUS'];

  // 2. Initialize Broadcast Player with 3D & 2D Sync Hooks
  const broadcastPlayer = new BroadcastPlayer({
    onRallyChange: (rally) => {
      courtView.loadRally(rally);
      updateRallyLCD(rally);
      highlightActiveRallyChip(rally.rally_id);
    },
    onTimeUpdate: (data) => {
      // Format stopwatch: MM:SS.SS
      const elapsed = data.elapsed || 0;
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
      const hundredths = Math.floor((elapsed % 1) * 100).toString().padStart(2, '0');
      if (lcdStopwatch) {
        lcdStopwatch.textContent = `${mins}:${secs}.${hundredths}`;
      }

      // Match timecode split
      const totalSecs = data.time || 0;
      const tMins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
      const tSecs = Math.floor(totalSecs % 60).toString().padStart(2, '0');
      if (lcdSplitTimer) {
        lcdSplitTimer.textContent = `${tMins}:${tSecs}`;
      }

      // Update Sub-Dials
      if (data.shot) {
        subDials.setSpeed(data.shot.speed_kmh, data.shot.stroke.includes('Smash'));
        subDials.setShotCount(data.shot.shot_num, data.rally ? data.rally.shot_count : 24);
        courtView.setShot(data.shotIndex);

        // Shot frequency
        if (lcdShotFreq && elapsed > 0) {
          const freq = (data.shot.shot_num / elapsed).toFixed(2);
          lcdShotFreq.textContent = `${freq} S/S`;
        }
      }

      // Cumulative coverage sprint interpolation
      if (data.rally) {
        const pct = Math.min(1, elapsed / data.rally.duration_sec);
        const lzjDist = 2.84 + (data.rally.lzj_sprint_dist_m / 1000) * pct;
        subDials.setCoverage(lzjDist, 18.5 + Math.sin(totalSecs) * 6.5);
      }
    }
  });

  // 3. Update LCD Scoreboard & Banner
  function updateRallyLCD(rally) {
    if (!rally) return;
    if (lcdScoreMAS) lcdScoreMAS.textContent = rally.score_after.player_1.toString().padStart(2, '0');
    if (lcdScoreTPE) lcdScoreTPE.textContent = rally.score_after.player_2.toString().padStart(2, '0');
    if (lcdRallyBadge) lcdRallyBadge.textContent = `${rally.badge} [${rally.shot_count} SHOTS]`;
    if (lcdKeyMoment) lcdKeyMoment.textContent = rally.key_moment.toUpperCase();

    // Set dial targets
    subDials.setSpeed(rally.max_smash_kmh, true);
    subDials.setShotCount(rally.shot_count, rally.shot_count);
  }

  // 4. Rally Bookmark Chips Binding
  const chips = document.querySelectorAll('.rally-chip-btn');
  chips.forEach((chip) => {
    chip.addEventListener('click', (e) => {
      const rallyId = parseInt(chip.getAttribute('data-rally-id'), 10);
      const rallies = window.HAWKVIEW_TELEMETRY.rallies;
      const index = rallies.findIndex(r => r.rally_id === rallyId);
      if (index !== -1) {
        broadcastPlayer.selectRally(index);
      }
    });
  });

  function highlightActiveRallyChip(rallyId) {
    chips.forEach(chip => {
      const id = parseInt(chip.getAttribute('data-rally-id'), 10);
      if (id === rallyId) {
        chip.className = "rally-chip-btn px-3 py-1.5 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs transition-all";
      } else {
        chip.className = "rally-chip-btn px-3 py-1.5 rounded bg-slate-900/90 border border-slate-800 text-slate-400 hover:border-slate-600 hover:bg-slate-800/90 text-xs transition-all";
      }
    });
  }

  // 5. Knurled Pusher Buttons
  const btnStartStop = document.getElementById('btn-play-pause');
  const btnLapSplit = document.getElementById('btn-lap-split');
  const btnMode = document.getElementById('btn-mode-switch');
  const btnHeatmapToggle = document.getElementById('btn-toggle-heatmap');
  const btnTrailsToggle = document.getElementById('btn-toggle-trails');

  if (btnLapSplit) {
    btnLapSplit.addEventListener('click', () => {
      broadcastPlayer.playMechanicalClick();
      // Jump to next rally
      const nextIdx = (broadcastPlayer.currentRallyIndex + 1) % broadcastPlayer.rallies.length;
      broadcastPlayer.selectRally(nextIdx);
    });
  }

  if (btnMode) {
    btnMode.addEventListener('click', () => {
      broadcastPlayer.playMechanicalClick();
      currentMode = (currentMode + 1) % modes.length;
      const modeLabel = document.getElementById('lcd-mode-indicator');
      if (modeLabel) modeLabel.textContent = modes[currentMode];

      // Auto-toggle court heatmap in mode 1
      if (currentMode === 1) {
        courtView.toggleHeatmap(true);
      } else if (currentMode === 2) {
        subDials.setSpeed(412, true);
      }
    });
  }

  if (btnHeatmapToggle) {
    btnHeatmapToggle.addEventListener('click', () => {
      broadcastPlayer.playMechanicalClick();
      const isActive = courtView.toggleHeatmap();
      btnHeatmapToggle.classList.toggle('bg-emerald-950/60', isActive);
      btnHeatmapToggle.classList.toggle('border-emerald-500/60', isActive);
      btnHeatmapToggle.classList.toggle('text-emerald-300', isActive);
    });
  }

  if (btnTrailsToggle) {
    btnTrailsToggle.addEventListener('click', () => {
      broadcastPlayer.playMechanicalClick();
      const isActive = courtView.toggleTrails();
      btnTrailsToggle.classList.toggle('opacity-40', !isActive);
    });
  }

  // 6. Keyboard Shortcuts
  const cameraPresets = ['broadcast', 'server', 'side', 'top'];
  let currentCamIdx = 0;

  window.addEventListener('keydown', (e) => {
    // Avoid interfering if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      broadcastPlayer.togglePlay();
    } else if (e.code === 'KeyM') {
      if (btnMode) btnMode.click();
    } else if (e.code === 'KeyH') {
      if (btnHeatmapToggle) btnHeatmapToggle.click();
    } else if (e.code === 'KeyC') {
      // Cycle camera preset
      currentCamIdx = (currentCamIdx + 1) % cameraPresets.length;
      if (broadcastPlayer.threeViewer) {
        broadcastPlayer.threeViewer.setPreset(cameraPresets[currentCamIdx]);
      }
    } else if (e.code === 'KeyA') {
      antiLagModal.open();
    } else if (e.code === 'Digit1') {
      broadcastPlayer.selectRally(0);
    } else if (e.code === 'Digit2') {
      broadcastPlayer.selectRally(1); // 412 km/h
    } else if (e.code === 'Digit3') {
      broadcastPlayer.selectRally(2);
    } else if (e.code === 'Digit4') {
      broadcastPlayer.selectRally(3);
    } else if (e.code === 'Digit5') {
      broadcastPlayer.selectRally(4);
    } else if (e.code === 'ArrowRight') {
      // Step forward shot
      const r = broadcastPlayer.currentRally;
      if (r && r.shots) {
        const nextShot = Math.min(r.shots.length - 1, broadcastPlayer.activeShotIndex + 1);
        broadcastPlayer.currentTime = r.shots[nextShot].time;
        broadcastPlayer.syncRallyState();
      }
    } else if (e.code === 'ArrowLeft') {
      // Step backward shot
      const r = broadcastPlayer.currentRally;
      if (r && r.shots) {
        const prevShot = Math.max(0, broadcastPlayer.activeShotIndex - 1);
        broadcastPlayer.currentTime = r.shots[prevShot].time;
        broadcastPlayer.syncRallyState();
      }
    }
  });

  // 7. Initial Select (Start on Rally #18 - LZJ 412 km/h Smash!)
  broadcastPlayer.selectRally(1);
  courtView.loadRally(broadcastPlayer.currentRally);
  updateRallyLCD(broadcastPlayer.currentRally);

  // Initialize Lucide icons if available
  if (window.lucide) {
    window.lucide.createIcons();
  }
});
