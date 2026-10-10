/**
 * Broadcast Video Player & Synchronized Match Engine (Hawkview)
 * Orchestrates:
 * - Real Three.js 3D Court Viewport integration with free tilt/orbit
 * - Dual-View Modes: Pure 3D Twin, Split Dual-View (50/50), Picture-in-Picture (PiP), Full Video
 * - Direct YouTube Stream Loading & IFrame Player API bi-directional timecode lockstep
 * - Local HTML5 <video> drag-and-drop & native file picker (.mp4 / .mov)
 * - Web Audio API synthesized mechanical watch clicks and supersonic smash cracks
 * - Frame-accurate timecode scrubbing synchronized with dials & court
 * - Real-time BWF TV Scorebug and Speed Radar Banner overlays
 */

class BroadcastPlayer {
  constructor(options = {}) {
    this.timelineSlider = document.getElementById('rally-timeline-slider');
    this.timecodeElapsedEl = document.getElementById('timeline-timecode-elapsed');
    this.timecodeTotalEl = document.getElementById('timeline-timecode-total');
    this.ticksContainer = document.getElementById('rally-timeline-ticks');

    this.playBtn = document.getElementById('btn-play-pause');
    this.videoElement = document.getElementById('real-video-player');
    this.videoWrapper = document.getElementById('video-viewport-wrapper');
    this.threeContainer = document.getElementById('three-viewport-container');
    this.dropZone = document.getElementById('video-viewport-container');
    this.dropOverlay = document.getElementById('video-dropzone-overlay');
    this.fileInput = document.getElementById('video-file-input');

    // YouTube DOM Elements
    this.ytContainer = document.getElementById('youtube-player-container');
    this.ytModal = document.getElementById('youtube-url-modal');
    this.ytUrlInput = document.getElementById('yt-url-input');

    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onRallyChange = options.onRallyChange || (() => {});

    this.isPlaying = false;
    this.rallies = window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : [];
    const landmarkIdx = this.rallies.findIndex(r => r.max_smash_kmh >= 400);
    this.currentRallyIndex = landmarkIdx >= 0 ? landmarkIdx : 0;
    this.currentRally = this.rallies[this.currentRallyIndex] || null;
    this.currentTime = this.currentRally ? this.currentRally.seconds_start : 25.0;
    this.totalDuration = window.HAWKVIEW_TELEMETRY?.match_metadata?.video_duration_sec || 498;
    this.playbackRate = 1.0;
    this.activeShotIndex = 0;
    this.isUserScrubbing = false;

    // Dual-View State: Default to PiP!
    this.currentViewMode = 'pip'; // '3d', 'split', 'pip', 'full'
    this.hasVideo = false;
    this.videoOffset = 0;
    this.isSampleVideoLoaded = false;

    // YouTube Player State
    this.isYouTubeActive = false;
    this.ytPlayer = null;
    this.ytVideoId = null;
    this._ytSeekDebounce = null;

    this.radarTimer = null;
    this.audioCtx = null;

    // Initialize Real Three.js 3D Viewer
    this.initThreeViewer();

    this.bindEvents();
    this.bindDualViewControls();
    this.bindYouTubeModalEvents();

    this.updateTimecodeUI();
    this.renderTimelineTicks();

    // Prime sample video if present in DOM
    if (this.videoElement && this.videoElement.getAttribute('src')) {
      const initialSrc = this.videoElement.getAttribute('src');
      const isPopovMatch = initialSrc.includes('LZJvPopov') || (window.HAWKVIEW_ACTIVE_MATCH_KEY === 'popov');
      const label = isPopovMatch
        ? 'BWF ARCTIC OPEN // QF (LEE ZII JIA vs CHRISTO POPOV)'
        : 'BWF ARCTIC OPEN // QF (MAS vs TPE)';
      this.loadVideoSource(initialSrc, label, true);
    }

    this.startPlaybackLoop();

    window.broadcastPlayerInstance = this;
  }

  initThreeViewer() {
    if (window.ThreeCourtViewer) {
      try {
        this.threeViewer = new window.ThreeCourtViewer('three-viewport-container');
      } catch (e) {
        console.warn('ThreeCourtViewer failed to initialize:', e);
      }
    }
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playMechanicalClick() {
    this.initAudio();
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.04);
    } catch (e) {}
  }

  playSmashSound(speedKmh) {
    this.initAudio();
    if (!this.audioCtx) return;
    try {
      const bufferSize = this.audioCtx.sampleRate * 0.12;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }
      const noise = this.audioCtx.createBufferSource();
      noise.buffer = buffer;
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = speedKmh > 380 ? 2400 : 1600;
      filter.Q.value = 3.0;

      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(speedKmh > 380 ? 0.35 : 0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);
      noise.start();
    } catch (e) {}
  }

  formatTimecode(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const totalSec = Math.floor(seconds);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  getDuration() {
    if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {
      try {
        const d = this.ytPlayer.getDuration();
        if (d > 0) return d;
      } catch (e) {}
    }
    if (this.hasVideo && this.videoElement && this.videoElement.duration > 0) {
      return this.videoElement.duration;
    }
    return this.totalDuration || 498;
  }

  updateTimecodeUI() {
    if (this.timecodeElapsedEl) {
      this.timecodeElapsedEl.textContent = this.formatTimecode(this.currentTime);
    }
    const dur = this.getDuration();
    if (this.timecodeTotalEl) {
      this.timecodeTotalEl.textContent = this.formatTimecode(dur);
    }
    if (this.timelineSlider) {
      const ceilDur = Math.ceil(dur);
      if (this.timelineSlider.max != ceilDur) {
        this.timelineSlider.max = ceilDur;
        this.renderTimelineTicks();
      }
    }
  }

  renderTimelineTicks() {
    if (!this.ticksContainer) return;
    this.ticksContainer.innerHTML = '';
    const dur = this.getDuration();
    if (!dur || dur <= 0) return;

    this.rallies.forEach((rally, index) => {
      const startPct = Math.max(0, Math.min(100, (rally.seconds_start / dur) * 100));
      const endPct = Math.max(0, Math.min(100, (rally.seconds_end / dur) * 100));
      const widthPct = Math.max(0.8, endPct - startPct);

      const tick = document.createElement('div');
      tick.className = `rally-tick-zone ${rally.max_smash_kmh >= 400 ? 'smash-record-tick' : ''}`;
      tick.style.left = `${startPct.toFixed(2)}%`;
      tick.style.width = `${widthPct.toFixed(2)}%`;
      tick.title = `${rally.badge} (${this.formatTimecode(rally.seconds_start)} - ${this.formatTimecode(rally.seconds_end)}) [${rally.max_smash_kmh} km/h]`;
      tick.setAttribute('data-rally-index', index);

      tick.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectRally(index);
      });

      this.ticksContainer.appendChild(tick);
    });
  }

  updateActiveTickUI(activeIndex, isDowntime) {
    if (!this.ticksContainer) return;
    const ticks = this.ticksContainer.querySelectorAll('.rally-tick-zone');
    ticks.forEach((tick) => {
      const idx = parseInt(tick.getAttribute('data-rally-index'), 10);
      if (idx === activeIndex && !isDowntime) {
        tick.classList.add('active-rally-tick');
      } else {
        tick.classList.remove('active-rally-tick');
      }
    });
  }

  getRallyAtTime(time) {
    if (!this.rallies || this.rallies.length === 0) return null;

    // Check if directly inside a rally [seconds_start, seconds_end]
    for (let i = 0; i < this.rallies.length; i++) {
      const r = this.rallies[i];
      if (time >= r.seconds_start && time <= r.seconds_end) {
        return { rally: r, index: i, isDowntime: false };
      }
    }

    // Between rallies or in transition/replay downtime:
    // If before first rally:
    if (time < this.rallies[0].seconds_start) {
      return { rally: this.rallies[0], index: 0, isDowntime: true };
    }

    // Find the contextual rally between points
    for (let i = 0; i < this.rallies.length - 1; i++) {
      const curr = this.rallies[i];
      const next = this.rallies[i + 1];
      if (time > curr.seconds_end && time < next.seconds_start) {
        const mid = curr.seconds_end + (next.seconds_start - curr.seconds_end) * 0.45;
        if (time >= mid) {
          return { rally: next, index: i + 1, isDowntime: true };
        } else {
          return { rally: curr, index: i, isDowntime: true };
        }
      }
    }

    const lastIdx = this.rallies.length - 1;
    return { rally: this.rallies[lastIdx], index: lastIdx, isDowntime: true };
  }

  seekTo(targetSeconds, instant = false) {
    const maxDur = this.getDuration();
    const clamped = Math.max(0, Math.min(maxDur, targetSeconds));
    this.currentTime = clamped;

    if (this.timelineSlider) {
      this.timelineSlider.value = clamped;
    }
    this.updateTimecodeUI();

    // Bi-directional seek to YouTube immediately
    if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      this.ytPlayer.seekTo(clamped, true);
    }
    // Seek HTML5 video
    else if (this.hasVideo && this.videoElement) {
      const isRally18Clip = this.videoElement.src && this.videoElement.src.includes('sample_rally.mp4');
      const vidTarget = (isRally18Clip && clamped >= 312.1)
        ? Math.max(0, Math.min(this.videoElement.duration || 20, clamped - 312.1))
        : Math.max(0, Math.min(this.videoElement.duration || 1200, clamped - (this.videoOffset || 0)));
      this.videoElement.currentTime = vidTarget;
    }

    this.syncRallyState(instant);
  }

  bindEvents() {
    // Listen for match changes
    window.addEventListener('hawkview:matchChanged', (e) => {
      this.rallies = e.detail?.telemetry?.rallies || (window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : []);
      this.totalDuration = window.HAWKVIEW_TELEMETRY?.match_metadata?.video_duration_sec || 498;

      const landmarkIdx = this.rallies.findIndex(r => r.max_smash_kmh >= 400);
      this.currentRallyIndex = landmarkIdx >= 0 ? landmarkIdx : 0;
      this.currentRally = this.rallies[this.currentRallyIndex] || null;

      if (this.currentRally) {
        this.currentTime = this.currentRally.seconds_start;
        this.videoOffset = 0;
      }

      this.renderTimelineTicks();
      this.updateTimecodeUI();
      if (this.threeViewer) {
        this.threeViewer.updatePlayersFromTelemetry(window.HAWKVIEW_TELEMETRY);
        this.threeViewer.clearTrail();
      }
      this.updateScorebugUI();
      if (this.currentRally) {
        this.onRallyChange(this.currentRally);
      }
      this.syncRallyState(true);
    });

    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => {
        this.togglePlay();
      });
    }

    if (this.timelineSlider) {
      this.timelineSlider.addEventListener('input', (e) => {
        this.isUserScrubbing = true;
        const targetSeconds = parseFloat(e.target.value);
        this.currentTime = targetSeconds;
        this.updateTimecodeUI();

        // Bi-directional seek in real time as slider is dragged
        if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
          this.ytPlayer.seekTo(targetSeconds, true);
        } else if (this.hasVideo && this.videoElement) {
          const isRally18Clip = this.videoElement.src && this.videoElement.src.includes('sample_rally.mp4');
          const vidTarget = (isRally18Clip && targetSeconds >= 312.1)
            ? Math.max(0, Math.min(this.videoElement.duration || 20, targetSeconds - 312.1))
            : Math.max(0, Math.min(this.videoElement.duration || 1200, targetSeconds - (this.videoOffset || 0)));
          this.videoElement.currentTime = vidTarget;
        }

        this.syncRallyState(true);
      });

      this.timelineSlider.addEventListener('change', (e) => {
        const targetSeconds = parseFloat(e.target.value);
        this.seekTo(targetSeconds, true);
        setTimeout(() => {
          this.isUserScrubbing = false;
        }, 150);
      });
    }

    // Video Drag & Drop on Viewport Frame
    if (this.dropZone) {
      this.dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (this.dropOverlay) {
          this.dropOverlay.classList.remove('opacity-0', 'pointer-events-none');
          this.dropOverlay.classList.add('opacity-100');
        }
      });
      this.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      this.dropZone.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && this.dropZone.contains(e.relatedTarget)) return;
        if (this.dropOverlay) {
          this.dropOverlay.classList.remove('opacity-100');
          this.dropOverlay.classList.add('opacity-0', 'pointer-events-none');
        }
      });
      this.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this.dropOverlay) {
          this.dropOverlay.classList.remove('opacity-100');
          this.dropOverlay.classList.add('opacity-0', 'pointer-events-none');
        }

        // Check if user dropped text/URL (e.g. dragged YouTube URL)
        const droppedText = e.dataTransfer.getData('text/plain');
        if (droppedText && (droppedText.includes('youtube.com') || droppedText.includes('youtu.be'))) {
          this.loadYouTubeVideo(droppedText);
          return;
        }

        const file = e.dataTransfer.files[0];
        if (file && (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm)$/i))) {
          this.loadCustomVideoFile(file);
        }
      });
    }

    // Video Element synchronization events
    if (this.videoElement) {
      this.videoElement.addEventListener('ended', () => {
        if (this.hasVideo && !this.isYouTubeActive) {
          this.videoElement.currentTime = 0;
          if (this.isPlaying) {
            this.videoElement.play();
          }
        }
      });

      this.videoElement.addEventListener('play', () => {
        this.isPlaying = true;
        this.updatePlayBtnIcon();
      });

      this.videoElement.addEventListener('pause', () => {
        this.isPlaying = false;
        this.updatePlayBtnIcon();
      });
    }
  }

  bindDualViewControls() {
    // Mode Buttons
    const btn3D = document.getElementById('view-mode-3d');
    const btnSplit = document.getElementById('view-mode-split');
    const btnPiP = document.getElementById('view-mode-pip');
    const btnFull = document.getElementById('view-mode-full');

    if (btn3D) btn3D.addEventListener('click', () => this.setDualViewMode('3d'));
    if (btnSplit) btnSplit.addEventListener('click', () => this.setDualViewMode('split'));
    if (btnPiP) btnPiP.addEventListener('click', () => this.setDualViewMode('pip'));
    if (btnFull) btnFull.addEventListener('click', () => this.setDualViewMode('full'));

    // Video Ingestion Buttons
    const btnYouTube = document.getElementById('btn-load-youtube-video');
    const btnSample = document.getElementById('btn-load-sample-video');
    const btnCustom = document.getElementById('btn-load-custom-video');

    if (btnYouTube) {
      btnYouTube.addEventListener('click', () => this.openYouTubeModal());
    }

    if (btnSample) {
      btnSample.addEventListener('click', () => this.loadSampleVideo());
    }

    if (btnCustom && this.fileInput) {
      btnCustom.addEventListener('click', () => {
        this.playMechanicalClick();
        this.fileInput.click();
      });

      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.loadCustomVideoFile(file);
        }
      });
    }

    // PiP Split, Expand & Close Buttons
    const btnPipSplit = document.getElementById('btn-pip-split');
    const btnPipExpand = document.getElementById('btn-pip-expand');
    const btnPipClose = document.getElementById('btn-pip-close');

    if (btnPipSplit) {
      btnPipSplit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDualViewMode('split');
      });
    }

    if (btnPipExpand) {
      btnPipExpand.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDualViewMode('full');
      });
    }

    if (btnPipClose) {
      btnPipClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDualViewMode('3d');
      });
    }

    // Video Mute / Audio Toggle Button
    const btnMute = document.getElementById('btn-toggle-video-mute');
    const muteLabel = document.getElementById('mute-icon-label');
    if (btnMute) {
      btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playMechanicalClick();
        if (this.isYouTubeActive && this.ytPlayer) {
          try {
            if (this.ytPlayer.isMuted()) {
              this.ytPlayer.unMute();
              this.ytPlayer.setVolume(80);
              if (muteLabel) muteLabel.textContent = "🔊 AUDIO ON";
              btnMute.classList.replace('text-cyan-300', 'text-emerald-400');
            } else {
              this.ytPlayer.mute();
              if (muteLabel) muteLabel.textContent = "🔇 MUTED";
              btnMute.classList.replace('text-emerald-400', 'text-cyan-300');
            }
          } catch (err) {}
        } else if (this.hasVideo && this.videoElement) {
          this.videoElement.muted = !this.videoElement.muted;
          if (muteLabel) muteLabel.textContent = this.videoElement.muted ? "🔇 MUTED" : "🔊 AUDIO ON";
          btnMute.classList.toggle('text-emerald-400', !this.videoElement.muted);
          btnMute.classList.toggle('text-cyan-300', this.videoElement.muted);
        }
      });
    }
  }

  // =========================================================================
  // YOUTUBE STREAM SYNC & MODAL HANDLING
  // =========================================================================

  bindYouTubeModalEvents() {
    const btnClose = document.getElementById('btn-close-yt-modal');
    const btnCancel = document.getElementById('btn-cancel-yt-modal');
    const btnSubmit = document.getElementById('btn-submit-yt-url');
    const btnPaste = document.getElementById('btn-paste-clipboard');

    if (btnClose) btnClose.addEventListener('click', () => this.closeYouTubeModal());
    if (btnCancel) btnCancel.addEventListener('click', () => this.closeYouTubeModal());

    if (btnPaste && this.ytUrlInput) {
      btnPaste.addEventListener('click', async () => {
        this.playMechanicalClick();
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            this.ytUrlInput.value = text;
          }
        } catch (err) {
          console.warn("Clipboard access denied or unavailable", err);
        }
      });
    }

    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => {
        const url = this.ytUrlInput ? this.ytUrlInput.value.trim() : '';
        if (url) {
          this.loadYouTubeVideo(url);
          this.closeYouTubeModal();
        }
      });
    }

    if (this.ytUrlInput) {
      this.ytUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (btnSubmit) btnSubmit.click();
        } else if (e.key === 'Escape') {
          this.closeYouTubeModal();
        }
      });
    }

    // Preset buttons inside modal
    const presetBtns = document.querySelectorAll('.yt-preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        const offset = parseFloat(btn.getAttribute('data-offset') || '0');
        const label = btn.getAttribute('data-label') || 'YOUTUBE MATCH STREAM';
        if (url) {
          this.loadYouTubeVideo(url, offset, label);
          this.closeYouTubeModal();
        }
      });
    });
  }

  openYouTubeModal() {
    this.playMechanicalClick();
    if (!this.ytModal) return;
    this.ytModal.classList.remove('hidden');
    setTimeout(() => {
      if (this.ytUrlInput) {
        this.ytUrlInput.focus();
        this.ytUrlInput.select();
      }
    }, 50);
  }

  closeYouTubeModal() {
    this.playMechanicalClick();
    if (!this.ytModal) return;
    this.ytModal.classList.add('hidden');
  }

  extractYouTubeVideoId(url) {
    if (!url) return null;
    const cleanUrl = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return cleanUrl;
    }
    const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts|live)\/|\S*?[?&]v=)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/i;
    const match = cleanUrl.match(regExp);
    return match ? match[1] : null;
  }

  extractYouTubeTimestamp(url) {
    if (!url) return 0;
    const match = url.match(/[?&]t=(?:(\d+)m)?(?:(\d+)s)?(?:(\d+))?/);
    if (!match) return 0;
    if (match[3]) return parseInt(match[3], 10);
    const m = parseInt(match[1] || '0', 10);
    const s = parseInt(match[2] || '0', 10);
    return m * 60 + s;
  }

  renderDirectYouTubeIframe(container, videoId, startSec, pageOrigin) {
    container.innerHTML = `
      <iframe id="yt-fallback-iframe" class="w-full h-full border-0" 
              src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(pageOrigin)}&widget_referrer=${encodeURIComponent(pageOrigin)}&start=${Math.floor(startSec)}&rel=0" 
              referrerpolicy="strict-origin-when-cross-origin" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
              allowfullscreen></iframe>
    `;
  }

  handleYouTubeError(videoId, errorCode, container) {
    if (!container) container = document.getElementById('youtube-iframe-player');
    if (!container) return;

    const isFileProto = window.location.protocol === 'file:';
    const isBufferTimeout = errorCode === 'BUFFER_TIMEOUT';
    const isRightsRestricted = (errorCode === 150 || errorCode === 101);

    container.innerHTML = `
      <div class="w-full h-full bg-[#080c12] p-4 flex flex-col items-center justify-center text-center font-mono border border-red-500/40 rounded-lg relative overflow-hidden">
        <div class="w-9 h-9 rounded-full bg-red-950/80 border border-red-500/50 flex items-center justify-center text-red-400 mb-2 text-base shadow-lg">
          ${isBufferTimeout ? '⏱️' : isRightsRestricted ? '🔒' : '⚠️'}
        </div>
        <div class="text-xs font-bold text-red-300 uppercase tracking-wider mb-1">
          ${isBufferTimeout 
            ? 'STREAM BUFFER TIMEOUT (HOST THROTTLED)' 
            : isRightsRestricted 
            ? 'BROADCASTER GEO-BLOCK / EMBED RESTRICTED' 
            : `YOUTUBE EMBED ERROR (${errorCode})`}
        </div>
        <p class="text-[10px] text-slate-400 max-w-sm mb-3">
          ${isBufferTimeout 
            ? "YouTube's media stream took too long to deliver chunks or was paused by regional network throttling." 
            : isRightsRestricted 
            ? "Official BWF tournament streams are licensed to exclusive regional TV networks (Astro / SPOTV / ELTA) and disallow external embeds." 
            : isFileProto 
            ? "YouTube blocks embeds from local disk (file:// protocol). Please use the local server link below." 
            : "The video publisher restricted embedding on third-party sites."}
        </p>

        <div class="flex flex-wrap items-center justify-center gap-2">
          ${isFileProto ? `
          <a href="http://localhost:8123/index.html" class="px-3 py-1.5 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 hover:border-cyan-400 text-[10px] font-bold tracking-wider transition-all">
            🚀 OPEN VIA LOCALHOST:8123
          </a>` : ''}
          <a href="https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(this.currentTime || 0)}" target="_blank" rel="noopener noreferrer" 
             class="px-3 py-1.5 rounded bg-red-950/80 border border-red-500/50 text-red-300 hover:border-red-400 text-[10px] font-bold tracking-wider transition-all flex items-center space-x-1">
            <span>WATCH ON YOUTUBE ↗</span>
          </a>
          <button id="btn-fallback-twin" class="px-3 py-1.5 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 hover:border-cyan-400 text-[10px] font-bold tracking-wider transition-all">
            🏸 3D TWIN ONLY
          </button>
          <button id="btn-fallback-sample" class="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-slate-500 text-[10px] font-bold tracking-wider transition-all">
            ▶ LOAD SAMPLE RALLY
          </button>
        </div>
      </div>
    `;

    const twinBtn = document.getElementById('btn-fallback-twin');
    if (twinBtn) {
      twinBtn.addEventListener('click', () => this.setDualViewMode('3d'));
    }

    const sampleBtn = document.getElementById('btn-fallback-sample');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', () => this.loadSampleVideo());
    }
  }

  loadYouTubeVideo(urlOrId, offsetSec = 0, customLabel = null) {
    this.playMechanicalClick();
    const videoId = this.extractYouTubeVideoId(urlOrId);
    if (!videoId) {
      alert("Invalid YouTube URL or ID. Please check the URL format.");
      return;
    }

    this.ytVideoId = videoId;
    this.isYouTubeActive = true;
    this.hasVideo = true;
    this.isLoopingRally = false;

    // Auto-detect match from YouTube video ID or label
    if (videoId === 'EhN9qzVe7_g' || (urlOrId && urlOrId.toLowerCase().includes('popov')) || (customLabel && customLabel.toLowerCase().includes('popov'))) {
      if (window.setHawkviewMatch) {
        window.setHawkviewMatch('popov');
      }
    } else if (videoId === 'BPv0hE0ugkk' || videoId === 'cFO4yO5s0BA' || (urlOrId && urlOrId.toLowerCase().includes('su li yang')) || (customLabel && customLabel.toLowerCase().includes('su li yang'))) {
      if (window.setHawkviewMatch) {
        window.setHawkviewMatch('sly');
      }
    }

    const timeInUrl = this.extractYouTubeTimestamp(urlOrId);
    const startSec = timeInUrl > 0 ? timeInUrl : (offsetSec > 0 ? offsetSec : (this.currentRally ? this.currentRally.seconds_start : 0));
    this.videoOffset = startSec;

    // Pause and hide local HTML5 video
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.classList.add('hidden');
    }

    // Show YouTube container
    if (this.ytContainer) {
      this.ytContainer.classList.remove('hidden');
    }

    const labelText = customLabel || `YOUTUBE: ${videoId} // BWF MATCH STREAM`;
    const labelEl = document.getElementById('video-feed-label');
    if (labelEl) {
      labelEl.textContent = labelText;
    }

    // Embed via YouTube IFrame API or direct nocookie embed
    const initOrLoadYT = () => {
      const targetDiv = document.getElementById('youtube-iframe-player');
      if (!targetDiv) return;

      const pageOrigin = (window.location.protocol === 'http:' || window.location.protocol === 'https:') 
        ? window.location.origin 
        : 'https://www.youtube-nocookie.com';

      // Reset target div for clean embed
      targetDiv.innerHTML = '';
      const playerHost = document.createElement('div');
      playerHost.id = 'yt-player-host';
      playerHost.className = 'w-full h-full';
      targetDiv.appendChild(playerHost);

      let bufferWatchdogTimer = null;

      if (window.YT && window.YT.Player) {
        try {
          this.ytPlayer = new window.YT.Player('yt-player-host', {
            width: '100%',
            height: '100%',
            videoId: videoId,
            host: 'https://www.youtube-nocookie.com',
            playerVars: {
              autoplay: 1,
              controls: 1,
              modestbranding: 1,
              rel: 0,
              playsinline: 1,
              start: Math.floor(startSec),
              origin: pageOrigin,
              enablejsapi: 1,
              mute: 1 // CRITICAL: Muted autoplay satisfies Chrome Autoplay Policy to eliminate infinite buffer lock
            },
            events: {
              onReady: () => {
                try {
                  this.ytPlayer.playVideo();
                } catch (e) {}
              },
              onStateChange: (event) => {
                if (window.YT) {
                  // Buffer watchdog: catch infinite loading spinner (>5s)
                  if (event.data === window.YT.PlayerState.BUFFERING) {
                    clearTimeout(bufferWatchdogTimer);
                    bufferWatchdogTimer = setTimeout(() => {
                      console.warn("YouTube stream buffer watchdog timed out after 5s.");
                      this.handleYouTubeError(videoId, 'BUFFER_TIMEOUT', targetDiv);
                    }, 5500);
                  } else {
                    clearTimeout(bufferWatchdogTimer);
                  }

                  if (event.data === window.YT.PlayerState.PLAYING) {
                    this.isPlaying = true;
                    this.updatePlayBtnIcon();
                  } else if (event.data === window.YT.PlayerState.PAUSED) {
                    this.isPlaying = false;
                    this.updatePlayBtnIcon();
                  }
                }
              },
              onError: (event) => {
                clearTimeout(bufferWatchdogTimer);
                console.warn("YouTube Player error:", event.data);
                this.handleYouTubeError(videoId, event.data, targetDiv);
              }
            }
          });
        } catch (err) {
          console.warn("Failed to instantiate YT.Player, falling back to direct iframe:", err);
          this.renderDirectYouTubeIframe(targetDiv, videoId, startSec, pageOrigin);
        }
      } else {
        this.renderDirectYouTubeIframe(targetDiv, videoId, startSec, pageOrigin);
      }
    };

    initOrLoadYT();

    // Default to Sleek Picture-in-Picture (PiP) Video View!
    this.setDualViewMode('pip');
  }

  // =========================================================================
  // DUAL-VIEW LAYOUT & LOCAL VIDEO HANDLING
  // =========================================================================

  setDualViewMode(mode) {
    this.playMechanicalClick();
    this.currentViewMode = mode;

    // Update Mode Buttons UI
    const modes = ['3d', 'split', 'pip', 'full'];
    modes.forEach(m => {
      const btn = document.getElementById(`view-mode-${m}`);
      if (btn) {
        if (m === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });

    if (!this.threeContainer || !this.videoWrapper) return;

    // If switching to video view but no video is loaded yet, auto-load sample rally!
    if (mode !== '3d' && !this.hasVideo) {
      this.loadSampleVideo(false);
    }

    const pipControls = document.getElementById('pip-controls-bar');
    const container = document.getElementById('video-viewport-container');

    // Reset base classes
    this.threeContainer.className = 'relative transition-all duration-200';
    this.videoWrapper.className = 'relative transition-all duration-200';

    if (container) {
      if (mode === 'pip') {
        container.classList.add('pip-active');
      } else {
        container.classList.remove('pip-active');
      }
    }

    if (mode === '3d') {
      this.threeContainer.classList.add('w-full', 'h-full', 'block');
      this.videoWrapper.classList.add('hidden');
      if (pipControls) pipControls.classList.add('hidden');
    } else if (mode === 'split') {
      this.threeContainer.classList.add('view-split-3d');
      this.videoWrapper.classList.add('view-split-video');
      if (pipControls) pipControls.classList.add('hidden');
    } else if (mode === 'pip') {
      this.threeContainer.classList.add('w-full', 'h-full', 'block');
      this.videoWrapper.classList.add('view-pip-video');
      if (pipControls) pipControls.classList.remove('hidden');
    } else if (mode === 'full') {
      this.threeContainer.classList.add('hidden');
      this.videoWrapper.classList.add('view-full-video');
      if (pipControls) pipControls.classList.add('hidden');
    }

    // Trigger Three.js Camera Resizing to match split/full aspect ratio immediately and after animation
    if (this.threeViewer) {
      this.threeViewer.onResize();
    }
    setTimeout(() => {
      if (this.threeViewer) {
        this.threeViewer.onResize();
      }
    }, 60);
    setTimeout(() => {
      if (this.threeViewer) {
        this.threeViewer.onResize();
      }
    }, 250);
  }

  loadSampleVideo(switchToPip = true) {
    this.playMechanicalClick();
    this.isYouTubeActive = false;

    // Hide YouTube, show HTML5 video
    if (this.ytContainer) this.ytContainer.classList.add('hidden');
    if (this.videoElement) this.videoElement.classList.remove('hidden');

    if (window.setHawkviewMatch) {
      window.setHawkviewMatch('popov');
    }

    const samplePath = 'assets/LZJvPopov.mp4';
    this.loadVideoSource(samplePath, 'BWF ARCTIC OPEN // QF (LEE ZII JIA vs CHRISTO POPOV)', true);

    // Jump to Rally #4 (LZJ 408km/h smash) or Rally 1
    const smashIdx = this.rallies.findIndex(r => r.max_smash_kmh >= 400);
    const targetIdx = smashIdx !== -1 ? smashIdx : 0;
    this.selectRally(targetIdx);

    if (switchToPip && this.currentViewMode === '3d') {
      this.setDualViewMode('pip');
    }
  }

  loadCustomVideoFile(file) {
    this.playMechanicalClick();
    if (!this.videoElement) return;

    this.isYouTubeActive = false;
    if (this.ytContainer) this.ytContainer.classList.add('hidden');
    if (this.videoElement) this.videoElement.classList.remove('hidden');

    const url = URL.createObjectURL(file);
    const label = `USER FEED: ${file.name.toUpperCase()} (${(file.size / (1024 * 1024)).toFixed(1)}MB)`;
    this.loadVideoSource(url, label, false);

    if (this.currentViewMode === '3d') {
      this.setDualViewMode('pip');
    }
  }

  loadVideoSource(src, labelText, isSample = false) {
    if (!this.videoElement) return;

    this.isSampleVideoLoaded = isSample;
    this.videoElement.src = src;
    this.videoElement.load();

    const labelEl = document.getElementById('video-feed-label');
    if (labelEl) {
      labelEl.textContent = labelText;
    }

    this.videoElement.onloadedmetadata = () => {
      this.hasVideo = true;
      if (src.includes('sample_rally.mp4')) {
        this.videoOffset = 312.1;
      } else {
        this.videoOffset = 0;
      }

      // Seek video to current match time
      const targetTime = Math.max(0, Math.min(this.videoElement.duration, this.currentTime - (this.videoOffset || 0)));
      this.videoElement.currentTime = targetTime;

      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      }
    };
  }

  togglePlay() {
    this.playMechanicalClick();
    this.isPlaying = !this.isPlaying;
    this.updatePlayBtnIcon();

    // YouTube playback control
    if (this.isYouTubeActive && this.ytPlayer) {
      try {
        if (this.isPlaying && typeof this.ytPlayer.playVideo === 'function') {
          this.ytPlayer.playVideo();
        } else if (!this.isPlaying && typeof this.ytPlayer.pauseVideo === 'function') {
          this.ytPlayer.pauseVideo();
        }
      } catch (e) {}
    }
    // Local video playback control
    else if (this.hasVideo && this.videoElement) {
      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      } else {
        this.videoElement.pause();
      }
    }
  }

  updatePlayBtnIcon() {
    if (!this.playBtn) return;
    if (this.isPlaying) {
      this.playBtn.classList.add('active-pusher');
      this.playBtn.title = "Pause Match Telemetry (SPACE)";
    } else {
      this.playBtn.classList.remove('active-pusher');
      this.playBtn.title = "Start Match Telemetry (SPACE)";
    }
  }

  selectRally(index) {
    this.playMechanicalClick();
    if (index < 0 || index >= this.rallies.length) return;
    this.currentRallyIndex = index;
    this.currentRally = this.rallies[index];
    this.currentTime = this.currentRally.seconds_start;
    this.activeShotIndex = 0;

    // Direct YouTube seek to rally start timecode (e.g. 312.1 for LZJ smash)
    if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      this.ytPlayer.seekTo(this.currentRally.seconds_start, true);
    }
    // Local video sync on rally selection
    else if (this.hasVideo && this.videoElement) {
      const isRally18Clip = this.videoElement.src && this.videoElement.src.includes('sample_rally.mp4');
      if (isRally18Clip && this.currentRally.rally_id === 18) {
        this.videoOffset = 312.1;
        this.videoElement.currentTime = 0;
      } else {
        this.videoOffset = 0;
        this.videoElement.currentTime = this.currentRally.seconds_start;
      }

      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      }
    }

    if (this.timelineSlider) {
      this.timelineSlider.value = this.currentTime;
    }
    this.updateTimecodeUI();

    if (this.threeViewer) {
      this.threeViewer.clearTrail();
    }

    // Trigger radar flash on high-speed rally select
    if (this.currentRally.max_smash_kmh >= 380) {
      this.triggerRadarFlash(`⚡ ${this.currentRally.max_smash_kmh} KM/H`, this.currentRally.max_smash_kmh);
    }

    this.updateScorebugUI();
    this.syncRallyState(true);
    this.onRallyChange(this.currentRally);
  }

  triggerRadarFlash(text, speed) {
    const banner = document.getElementById('speed-radar-overlay');
    const valueEl = document.getElementById('speed-radar-value');
    const titleEl = document.getElementById('speed-radar-title');

    if (banner && valueEl) {
      valueEl.textContent = text;
      const isRecord = speed >= 400;
      if (titleEl) {
        titleEl.textContent = isRecord ? '🔥 RECORD SMASH VELOCITY' : '⚡ BWF SMASH RADAR';
      }
      banner.classList.remove('opacity-0', 'pointer-events-none');
      banner.classList.add('opacity-100');

      if (this.radarTimer) clearTimeout(this.radarTimer);
      this.radarTimer = setTimeout(() => {
        banner.classList.remove('opacity-100');
        banner.classList.add('opacity-0', 'pointer-events-none');
      }, 2400);
    }

    this.playSmashSound(speed);
  }

  updateScorebugUI() {
    if (!this.currentRally) return;
    const p1 = window.HAWKVIEW_TELEMETRY?.players?.player_1;
    const p2 = window.HAWKVIEW_TELEMETRY?.players?.player_2;

    const p1ScoreEl = document.getElementById('overlay-p1-score');
    const p2ScoreEl = document.getElementById('overlay-p2-score');
    const p1FlagEl = document.getElementById('overlay-p1-flag');
    const p1CountryEl = document.getElementById('overlay-p1-country');
    const p1NameEl = document.getElementById('overlay-p1-name');
    const p2FlagEl = document.getElementById('overlay-p2-flag');
    const p2CountryEl = document.getElementById('overlay-p2-country');
    const p2NameEl = document.getElementById('overlay-p2-name');
    const matchLabelEl = document.getElementById('overlay-match-label');

    const p1Score = this.currentRally.score_after.player_1.toString().padStart(2, '0');
    const p2Score = this.currentRally.score_after.player_2.toString().padStart(2, '0');

    if (p1ScoreEl) p1ScoreEl.textContent = p1Score;
    if (p2ScoreEl) {
      p2ScoreEl.textContent = p2Score;
      const isRed = (p2?.jersey_color || '#ff2a55') === '#ff2a55';
      p2ScoreEl.className = isRed
        ? "font-lcd text-red-400 font-black text-xs sm:text-sm tabular-nums leading-none"
        : "font-lcd text-orange-400 font-black text-xs sm:text-sm tabular-nums leading-none";
    }

    if (p1FlagEl && p1?.flag) p1FlagEl.textContent = p1.flag;
    if (p1CountryEl && p1?.country) p1CountryEl.textContent = p1.country;
    if (p1NameEl && p1?.id) p1NameEl.textContent = p1.id;

    if (p2FlagEl && p2?.flag) p2FlagEl.textContent = p2.flag;
    if (p2CountryEl && p2?.country) {
      p2CountryEl.textContent = p2.country;
      p2CountryEl.className = (p2?.jersey_color === '#ff2a55') ? "font-bold text-[10px] text-red-400 font-mono" : "font-bold text-[10px] text-orange-400 font-mono";
    }
    if (p2NameEl) p2NameEl.textContent = p2?.id || p2?.display_name || 'POPOV';

    if (matchLabelEl && window.HAWKVIEW_TELEMETRY?.match_metadata) {
      const round = window.HAWKVIEW_TELEMETRY.match_metadata.round || 'QF';
      matchLabelEl.textContent = `BWF ARCTIC // ${round.includes('Quarter') ? 'QF' : 'R16'}`;
    }

    const lcdMAS = document.getElementById('lcd-score-mas');
    const lcdTPE = document.getElementById('lcd-score-tpe');
    if (lcdMAS) lcdMAS.textContent = p1Score;
    if (lcdTPE) lcdTPE.textContent = p2Score;

    const lcdBadge = document.getElementById('lcd-rally-badge');
    const lcdKeyMoment = document.getElementById('lcd-key-moment');
    if (lcdBadge) lcdBadge.textContent = `${this.currentRally.badge} [${this.currentRally.shot_count} SHOTS]`;
    if (lcdKeyMoment) lcdKeyMoment.textContent = this.currentRally.key_moment.toUpperCase();
  }

  syncRallyState(instant = false) {
    // Dynamic lookup of rally spanning currentTime (or closest/last completed)
    const state = this.getRallyAtTime(this.currentTime);
    if (!state) return;

    const { rally, index, isDowntime } = state;

    // Check if active rally transitioned
    if (index !== this.currentRallyIndex || rally !== this.currentRally) {
      this.currentRallyIndex = index;
      this.currentRally = rally;
      this.updateScorebugUI();
      this.onRallyChange(rally);
    }

    // Update timeline slider if user is not actively scrubbing it
    if (!this.isUserScrubbing && this.timelineSlider) {
      this.timelineSlider.value = this.currentTime;
    }

    this.updateTimecodeUI();
    this.updateActiveTickUI(index, isDowntime);

    let telemetryPacket;

    if (isDowntime) {
      // In downtime between rallies (or before/after points)
      telemetryPacket = {
        time: this.currentTime,
        elapsed: Math.max(0, this.currentTime - rally.seconds_start),
        rally: rally,
        shotIndex: -1,
        shot: null,
        isDowntime: true,
        instant: instant
      };
    } else {
      // Inside active rally: determine active shot
      const elapsed = Math.max(0, this.currentTime - rally.seconds_start);
      let foundIndex = 0;

      if (rally.shots && rally.shots.length > 0) {
        for (let i = 0; i < rally.shots.length; i++) {
          if (this.currentTime >= rally.shots[i].time) {
            foundIndex = i;
          } else {
            break;
          }
        }
        if (foundIndex !== this.activeShotIndex) {
          this.activeShotIndex = foundIndex;
          const shot = rally.shots[foundIndex];
          if (shot && shot.speed_kmh >= 350) {
            this.triggerRadarFlash(`⚡ ${shot.speed_kmh} KM/H`, shot.speed_kmh);
          }
        }
      }

      telemetryPacket = {
        time: this.currentTime,
        elapsed: elapsed,
        rally: rally,
        shotIndex: foundIndex,
        shot: rally.shots ? rally.shots[foundIndex] : null,
        isDowntime: false,
        instant: instant
      };
    }

    // Forward to Three.js 3D Viewer
    if (this.threeViewer) {
      this.threeViewer.updateTelemetryState(telemetryPacket, instant);
    }

    // Update live broadcast HUD status badge, LED, and video feed label
    const hudBadge = document.getElementById('hud-status-badge');
    const hudLed = document.getElementById('hud-status-led');
    const feedLabel = document.getElementById('video-feed-label');

    if (isDowntime) {
      if (hudBadge) hudBadge.textContent = 'REPLAY / TRANSITION // READY';
      if (hudLed) hudLed.className = 'status-led status-led-amber';
      if (feedLabel && !this.isYouTubeActive) {
        feedLabel.textContent = 'BWF BROADCAST CAM 01 // REPLAY / TRANSITION // READY';
      }
    } else {
      if (hudBadge) hudBadge.textContent = `LIVE 60FPS // RALLY #${rally.rally_id}`;
      if (hudLed) hudLed.className = 'status-led status-led-red';
      if (feedLabel && !this.isYouTubeActive) {
        feedLabel.textContent = `BWF BROADCAST CAM 01 // LIVE // RALLY #${rally.rally_id}`;
      }
    }

    // Callback to update sub-dials, LCD, and 2D court
    this.onTimeUpdate(telemetryPacket);
  }

  startPlaybackLoop() {
    let lastTimestamp = performance.now();

    const loop = (timestamp) => {
      const deltaSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      // 1. YouTube active synchronization (Master-Slave Clock)
      if (this.isYouTubeActive && this.ytPlayer) {
        const ytState = (typeof this.ytPlayer.getPlayerState === 'function') 
          ? this.ytPlayer.getPlayerState() 
          : -1;

        // Detect player duration dynamically
        if (typeof this.ytPlayer.getDuration === 'function') {
          try {
            const dur = this.ytPlayer.getDuration();
            if (dur > 0 && Math.abs(dur - this.totalDuration) > 1) {
              this.totalDuration = dur;
              this.updateTimecodeUI();
              this.renderTimelineTicks();
            }
          } catch (e) {}
        }

        // Lockstep time update when PLAYING or if user scrubbed YouTube directly while PAUSED
        if (typeof this.ytPlayer.getCurrentTime === 'function' && !this.isUserScrubbing) {
          try {
            const ytSec = this.ytPlayer.getCurrentTime();
            if (ytSec >= 0) {
              if (ytState === 1 || Math.abs(ytSec - this.currentTime) > 0.4) {
                this.currentTime = ytSec;
                this.syncRallyState();
              }
            }
          } catch (e) {}
        }
      }
      // 2. HTML5 video active synchronization
      else if (this.hasVideo && this.videoElement && !this.videoElement.paused) {
        if (!this.isUserScrubbing) {
          const isRally18Clip = this.videoElement.src && this.videoElement.src.includes('sample_rally.mp4');
          const vidSec = this.videoElement.currentTime;
          this.currentTime = (isRally18Clip ? 312.1 : (this.videoOffset || 0)) + vidSec;
          this.syncRallyState();
        }
      }
      // 3. Pure telemetry synthetic progression (no video or paused video)
      else if (this.isPlaying && !this.isYouTubeActive && !this.hasVideo) {
        if (!this.isUserScrubbing) {
          this.currentTime += deltaSec * this.playbackRate;
          const maxD = this.getDuration();
          if (this.currentTime > maxD) {
            this.currentTime = 0;
          }
          this.syncRallyState();
        }
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

window.BroadcastPlayer = BroadcastPlayer;
