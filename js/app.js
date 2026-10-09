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

      // Update Sub-Dials and Court View
      if (data.isDowntime) {
        courtView.updateTelemetry(data);
        if (lcdRallyBadge) lcdRallyBadge.textContent = `⏱️ BETWEEN RALLIES // READY`;
        if (lcdKeyMoment) lcdKeyMoment.textContent = `NEXT: ${data.rally ? data.rally.label.toUpperCase() : 'PREPARING SERVICE'}`;
        subDials.setSpeed(0, false);
      } else if (data.shot) {
        subDials.setSpeed(data.shot.speed_kmh, data.shot.stroke.includes('Smash'));
        subDials.setShotCount(data.shot.shot_num, data.rally ? data.rally.shot_count : 24);
        courtView.updateTelemetry(data);

        // Shot frequency
        if (lcdShotFreq && elapsed > 0) {
          const freq = (data.shot.shot_num / elapsed).toFixed(2);
          lcdShotFreq.textContent = `${freq} S/S`;
        }
      }

      // Cumulative coverage sprint interpolation
      if (data.rally) {
        const dur = data.rally.duration_sec || 20;
        const pct = Math.min(1, elapsed / dur);
        const lzjDist = 2.84 + (data.rally.lzj_sprint_dist_m / 1000) * pct;
        subDials.setCoverage(lzjDist, 18.5 + Math.sin(totalSecs) * 6.5);
      }
    }
  });

  // 3. Update LCD Scoreboard & Banner
  function updateRallyLCD(rally) {
    if (!rally) return;
    const masScore = rally.score_after.player_1.toString().padStart(2, '0');
    const p2Score = rally.score_after.player_2.toString().padStart(2, '0');
    if (lcdScoreMAS) lcdScoreMAS.textContent = masScore;
    if (lcdScoreTPE) lcdScoreTPE.textContent = p2Score;
    const p1Overlay = document.getElementById('overlay-p1-score');
    const p2Overlay = document.getElementById('overlay-p2-score');
    if (p1Overlay) p1Overlay.textContent = masScore;
    if (p2Overlay) {
      p2Overlay.textContent = p2Score;
      const isRed = (window.HAWKVIEW_TELEMETRY?.players?.player_2?.jersey_color || '#ff2a55') === '#ff2a55';
      p2Overlay.className = isRed 
        ? "font-lcd text-red-400 font-black text-xs sm:text-sm tabular-nums leading-none"
        : "font-lcd text-orange-400 font-black text-xs sm:text-sm tabular-nums leading-none";
    }
    if (lcdRallyBadge) lcdRallyBadge.textContent = `${rally.badge} [${rally.shot_count} SHOTS]`;
    if (lcdKeyMoment) lcdKeyMoment.textContent = rally.key_moment.toUpperCase();

    // Set dial targets
    subDials.setSpeed(rally.max_smash_kmh, true);
    subDials.setShotCount(rally.shot_count, rally.shot_count);
  }

  // 4. Dynamic Rally Bookmark Chips
  function renderRallyChips(rallies, activeRallyId) {
    const container = document.getElementById('rally-chips-container');
    if (!container || !rallies) return;
    container.innerHTML = '';

    rallies.forEach((rally, index) => {
      const btn = document.createElement('button');
      btn.setAttribute('data-rally-id', rally.rally_id);
      const isActive = rally.rally_id === activeRallyId;
      btn.className = isActive
        ? "rally-chip-btn min-h-[32px] px-3 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs whitespace-nowrap shrink-0 transition-all shadow-sm"
        : "rally-chip-btn min-h-[32px] px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-400 hover:border-slate-600 hover:bg-slate-800/90 text-xs whitespace-nowrap shrink-0 transition-all";

      const timeLabel = rally.timestamp_start ? `(${rally.timestamp_start.substring(0, 5)})` : '';
      btn.textContent = `${rally.badge} ${timeLabel}`;

      btn.addEventListener('click', () => {
        broadcastPlayer.playMechanicalClick();
        broadcastPlayer.selectRally(index);
        highlightActiveRallyChip(rally.rally_id);
      });

      container.appendChild(btn);
    });
  }

  function highlightActiveRallyChip(rallyId) {
    const chips = document.querySelectorAll('.rally-chip-btn');
    chips.forEach(chip => {
      const id = parseInt(chip.getAttribute('data-rally-id'), 10);
      if (id === rallyId) {
        chip.className = "rally-chip-btn min-h-[32px] px-3 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs whitespace-nowrap shrink-0 transition-all shadow-sm";
      } else {
        chip.className = "rally-chip-btn min-h-[32px] px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-400 hover:border-slate-600 hover:bg-slate-800/90 text-xs whitespace-nowrap shrink-0 transition-all";
      }
    });
  }

  // Match Selector Binding
  const matchSelector = document.getElementById('match-selector');
  if (matchSelector) {
    matchSelector.value = window.HAWKVIEW_ACTIVE_MATCH_KEY || 'popov';
    matchSelector.addEventListener('change', (e) => {
      broadcastPlayer.playMechanicalClick();
      if (window.setHawkviewMatch) {
        window.setHawkviewMatch(e.target.value);
      }
    });
  }

  // Listen to match changes and update UI elements
  window.addEventListener('hawkview:matchChanged', (e) => {
    const telemetry = e.detail?.telemetry || window.HAWKVIEW_TELEMETRY;
    const matchKey = e.detail?.matchKey || window.HAWKVIEW_ACTIVE_MATCH_KEY;
    if (matchSelector) matchSelector.value = matchKey;

    const titleEl = document.getElementById('header-match-title');
    if (titleEl && telemetry?.players) {
      const p1 = telemetry.players.player_1;
      const p2 = telemetry.players.player_2;
      const round = telemetry.match_metadata.round?.includes('Quarter') ? 'QF' : 'R16';
      titleEl.textContent = `BWF ARCTIC OPEN S500 // ${round} - ${p1.country} vs ${p2.country}`;
    }

    renderRallyChips(telemetry.rallies, broadcastPlayer.currentRally?.rally_id);
    if (broadcastPlayer.currentRally) {
      updateRallyLCD(broadcastPlayer.currentRally);
    }
  });

  // 5. Mobile Tab Switcher (3D Court vs 2D Telemetry & Gauges)
  const tab3D = document.getElementById('mobile-tab-3d');
  const tab2D = document.getElementById('mobile-tab-2d');
  const col3D = document.getElementById('view-column-3d');
  const col2D = document.getElementById('view-column-2d');
  let currentMobileTab = '3d';

  function setMobileTab(active) {
    if (!tab3D || !tab2D || !col3D || !col2D) return;
    currentMobileTab = active;
    broadcastPlayer.playMechanicalClick();
    if (active === '3d') {
      tab3D.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-chronograph font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 flex items-center justify-center space-x-1.5 transition-all";
      tab2D.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-chronograph font-bold bg-slate-900/90 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center space-x-1.5 transition-all";
      col3D.classList.remove('hidden');
      col3D.classList.add('flex');
      col2D.classList.remove('flex');
      col2D.classList.add('hidden', 'lg:flex');
      setTimeout(() => {
        if (broadcastPlayer.threeViewer) {
          broadcastPlayer.threeViewer.onResize();
        }
      }, 50);
    } else {
      tab2D.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-chronograph font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 flex items-center justify-center space-x-1.5 transition-all";
      tab3D.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-chronograph font-bold bg-slate-900/90 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center space-x-1.5 transition-all";
      col2D.classList.remove('hidden');
      col2D.classList.add('flex');
      col3D.classList.remove('flex');
      col3D.classList.add('hidden', 'lg:flex');
      setTimeout(() => {
        courtView.initCanvas();
        subDials.initCanvases();
      }, 50);
    }
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      if (col3D) {
        col3D.classList.remove('hidden');
        col3D.classList.add('flex');
      }
      if (col2D) {
        col2D.classList.remove('hidden');
        col2D.classList.add('flex');
      }
    } else {
      if (col3D && col2D) {
        if (currentMobileTab === '3d') {
          col3D.classList.remove('hidden');
          col3D.classList.add('flex');
          col2D.classList.add('hidden');
          col2D.classList.remove('flex');
        } else {
          col2D.classList.remove('hidden');
          col2D.classList.add('flex');
          col3D.classList.add('hidden');
          col3D.classList.remove('flex');
        }
      }
    }
  });

  if (tab3D) tab3D.addEventListener('click', () => setMobileTab('3d'));
  if (tab2D) tab2D.addEventListener('click', () => setMobileTab('2d'));

  // 6. Knurled Pusher Buttons
  const btnStartStop = document.getElementById('btn-play-pause');
  const btnLapSplit = document.getElementById('btn-lap-split');
  const btnCamCycle = document.getElementById('btn-cam-cycle');
  const btnMode = document.getElementById('btn-mode-switch');
  const btnHeatmapToggle = document.getElementById('btn-toggle-heatmap');
  const btnTrailsToggle = document.getElementById('btn-toggle-trails');

  if (btnCamCycle) {
    btnCamCycle.addEventListener('click', () => {
      broadcastPlayer.playMechanicalClick();
      if (broadcastPlayer.threeViewer) {
        broadcastPlayer.threeViewer.cyclePreset();
      }
    });
  }

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
      if (broadcastPlayer.threeViewer) {
        broadcastPlayer.threeViewer.cyclePreset();
      }
    } else if (e.code === 'KeyV') {
      // Cycle dual-view modes: 3d -> split -> pip -> full -> 3d
      const viewModes = ['3d', 'split', 'pip', 'full'];
      const curIdx = viewModes.indexOf(broadcastPlayer.currentViewMode);
      const nextMode = viewModes[(curIdx + 1) % viewModes.length];
      broadcastPlayer.setDualViewMode(nextMode);
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
      // Step forward 3 seconds
      broadcastPlayer.seekTo(broadcastPlayer.currentTime + 3, true);
    } else if (e.code === 'ArrowLeft') {
      // Step backward 3 seconds
      broadcastPlayer.seekTo(broadcastPlayer.currentTime - 3, true);
    }
  });

  // 7. Initial Select & Rally Chips Setup
  const initRallies = window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : [];
  const defaultIdx = initRallies.findIndex(r => r.max_smash_kmh >= 400);
  const startIdx = defaultIdx >= 0 ? defaultIdx : 0;
  broadcastPlayer.selectRally(startIdx);
  renderRallyChips(initRallies, broadcastPlayer.currentRally?.rally_id);
  courtView.loadRally(broadcastPlayer.currentRally);
  // Initial dual-view mode: support URL param/hash (e.g. ?view=split or #split), default to 'pip'
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : null;
    const requestedMatch = urlParams.get('match');
    if (requestedMatch && window.setHawkviewMatch) {
      window.setHawkviewMatch(requestedMatch);
    }
    const requestedView = urlParams.get('view') || hash;
    if (['3d', 'split', 'pip', 'full'].includes(requestedView)) {
      broadcastPlayer.setDualViewMode(requestedView);
    } else {
      broadcastPlayer.setDualViewMode('pip');
    }
  } catch (e) {
    broadcastPlayer.setDualViewMode('pip');
  }

  // Initialize Lucide icons if available
  if (window.lucide) {
    window.lucide.createIcons();
  }
});
