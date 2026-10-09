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
    this.currentTime = 312.1; // Start at Rally #18 (LZJ 412km/h smash)
    this.playbackRate = 1.0;
    this.currentRallyIndex = 1; // Rally #18
    this.activeShotIndex = 0;

    this.rallies = window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : [];
    this.currentRally = this.rallies[this.currentRallyIndex] || null;

    // Dual-View State
    this.currentViewMode = '3d'; // '3d', 'split', 'pip', 'full'
    this.hasVideo = false;
    this.videoOffset = 312.1; // Match timestamp corresponding to video time 0.0s
    this.isSampleVideoLoaded = false;

    // YouTube Player State
    this.isYouTubeActive = false;
    this.ytPlayer = null;
    this.ytVideoId = null;

    this.radarTimer = null;
    this.audioCtx = null;

    // Initialize Real Three.js 3D Viewer
    this.initThreeViewer();

    this.bindEvents();
    this.bindDualViewControls();
    this.bindYouTubeModalEvents();

    // Prime sample video if present in DOM
    if (this.videoElement && this.videoElement.getAttribute('src')) {
      this.loadVideoSource(this.videoElement.getAttribute('src'), 'BWF ARCTIC OPEN // QF (MAS vs TPE)', true);
    }

    this.startPlaybackLoop();

    window.broadcastPlayerInstance = this;
  }

  initThreeViewer() {
    if (window.ThreeCourtViewer) {
      this.threeViewer = new window.ThreeCourtViewer('three-viewport-container');
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

  bindEvents() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => {
        this.togglePlay();
      });
    }

    if (this.timelineSlider) {
      this.timelineSlider.addEventListener('input', (e) => {
        const pct = parseFloat(e.target.value) / 100;
        if (this.currentRally) {
          const duration = this.currentRally.seconds_end - this.currentRally.seconds_start;
          this.currentTime = this.currentRally.seconds_start + duration * pct;

          // Sync YouTube time
          if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
            const targetYtTime = Math.max(0, this.currentTime - this.videoOffset);
            this.ytPlayer.seekTo(targetYtTime, true);
          }
          // Sync local video time
          else if (this.hasVideo && this.videoElement) {
            const videoDuration = this.videoElement.duration || duration;
            const targetVidTime = Math.max(0, Math.min(videoDuration, this.currentTime - this.videoOffset));
            this.videoElement.currentTime = targetVidTime;
          }

          this.syncRallyState(true);
        }
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

    // PiP Expand & Close Buttons
    const btnPipExpand = document.getElementById('btn-pip-expand');
    const btnPipClose = document.getElementById('btn-pip-close');

    if (btnPipExpand) {
      btnPipExpand.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDualViewMode('split');
      });
    }

    if (btnPipClose) {
      btnPipClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDualViewMode('3d');
      });
    }

    // Clicking PiP window expands to split view
    if (this.videoWrapper) {
      this.videoWrapper.addEventListener('click', (e) => {
        if (this.currentViewMode === 'pip' && e.target.closest('#pip-controls-bar') === null) {
          this.setDualViewMode('split');
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
    container.innerHTML = `
      <div class="w-full h-full bg-[#080c12] p-4 flex flex-col items-center justify-center text-center font-mono border border-red-500/40 rounded-lg">
        <div class="w-8 h-8 rounded-full bg-red-950/80 border border-red-500/50 flex items-center justify-center text-red-400 mb-2 text-base">
          ⚠️
        </div>
        <div class="text-xs font-bold text-red-300 uppercase tracking-wider mb-1">
          YOUTUBE EMBED RESTRICTION (ERROR ${errorCode})
        </div>
        <p class="text-[10px] text-slate-400 max-w-sm mb-3">
          ${isFileProto 
            ? "YouTube blocks embedding when opened directly from disk (file:// protocol) due to missing referrer headers." 
            : "The video publisher restricted external embedding or requires playback directly on YouTube."}
        </p>

        <div class="flex flex-wrap items-center justify-center gap-2">
          ${isFileProto ? `
          <a href="http://localhost:8123/index.html" class="px-3 py-1.5 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 hover:border-cyan-400 text-[10px] font-bold tracking-wider transition-all">
            🚀 OPEN VIA LOCAL SERVER (PORT 8123)
          </a>` : ''}
          <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" 
             class="px-3 py-1.5 rounded bg-red-950/80 border border-red-500/50 text-red-300 hover:border-red-400 text-[10px] font-bold tracking-wider transition-all flex items-center space-x-1">
            <span>WATCH ON YOUTUBE ↗</span>
          </a>
          <button id="btn-fallback-sample" class="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-slate-500 text-[10px] font-bold tracking-wider transition-all">
            ▶ LOAD SAMPLE RALLY
          </button>
        </div>
      </div>
    `;

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
              enablejsapi: 1
            },
            events: {
              onReady: () => {
                try {
                  this.ytPlayer.playVideo();
                } catch (e) {}
              },
              onStateChange: (event) => {
                if (window.YT) {
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

    // Set to Split Dual View
    this.setDualViewMode('split');
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

    // Reset base classes
    this.threeContainer.className = 'relative transition-all duration-200';
    this.videoWrapper.className = 'relative transition-all duration-200';

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

    // Trigger Three.js Camera Resizing to match split/full aspect ratio
    setTimeout(() => {
      if (this.threeViewer) {
        this.threeViewer.onResize();
      }
    }, 60);
  }

  loadSampleVideo(switchToSplit = true) {
    this.playMechanicalClick();
    this.isYouTubeActive = false;

    // Hide YouTube, show HTML5 video
    if (this.ytContainer) this.ytContainer.classList.add('hidden');
    if (this.videoElement) this.videoElement.classList.remove('hidden');

    const samplePath = 'assets/sample_rally.mp4';
    this.loadVideoSource(samplePath, 'BWF ARCTIC OPEN // QF (MAS vs TPE)', true);

    // Jump to Rally #18 (LZJ 412km/h smash)
    const r18Idx = this.rallies.findIndex(r => r.rally_id === 18);
    if (r18Idx !== -1) {
      this.selectRally(r18Idx);
    }

    if (switchToSplit && this.currentViewMode === '3d') {
      this.setDualViewMode('split');
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
      this.setDualViewMode('split');
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
      if (isSample) {
        this.videoOffset = 312.1;
      } else {
        this.videoOffset = this.currentRally ? this.currentRally.seconds_start : 0;
      }

      // Seek video to current match time
      const targetTime = Math.max(0, Math.min(this.videoElement.duration, this.currentTime - this.videoOffset));
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

    // YouTube sync on rally selection
    if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      this.ytPlayer.seekTo(this.currentRally.seconds_start, true);
    }
    // Local video sync on rally selection
    else if (this.hasVideo && this.videoElement) {
      if (this.isSampleVideoLoaded && this.currentRally.rally_id === 18) {
        this.videoOffset = 312.1;
        this.videoElement.currentTime = 0;
      } else {
        this.videoOffset = this.currentRally.seconds_start;
        this.videoElement.currentTime = 0;
      }

      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      }
    }

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
    const p1ScoreEl = document.getElementById('overlay-p1-score');
    const p2ScoreEl = document.getElementById('overlay-p2-score');
    if (p1ScoreEl) p1ScoreEl.textContent = this.currentRally.score_after.player_1.toString().padStart(2, '0');
    if (p2ScoreEl) p2ScoreEl.textContent = this.currentRally.score_after.player_2.toString().padStart(2, '0');
  }

  syncRallyState(instant = false) {
    if (!this.currentRally) return;

    // Check if time passed rally end
    if (this.currentTime > this.currentRally.seconds_end) {
      this.currentTime = this.currentRally.seconds_start;
      if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
        this.ytPlayer.seekTo(this.currentRally.seconds_start, true);
      } else if (this.hasVideo && this.videoElement) {
        this.videoElement.currentTime = 0;
      }
      if (this.threeViewer) {
        this.threeViewer.clearTrail();
      }
    }

    const elapsed = this.currentTime - this.currentRally.seconds_start;
    const duration = this.currentRally.seconds_end - this.currentRally.seconds_start;
    const pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));

    if (this.timelineSlider) {
      this.timelineSlider.value = pct;
    }

    // Determine active shot based on timestamp
    if (this.currentRally.shots && this.currentRally.shots.length > 0) {
      let foundIndex = 0;
      for (let i = 0; i < this.currentRally.shots.length; i++) {
        if (this.currentTime >= this.currentRally.shots[i].time) {
          foundIndex = i;
        } else {
          break;
        }
      }
      if (foundIndex !== this.activeShotIndex) {
        this.activeShotIndex = foundIndex;
        const shot = this.currentRally.shots[foundIndex];
        if (shot && shot.speed_kmh >= 350) {
          this.triggerRadarFlash(`⚡ ${shot.speed_kmh} KM/H`, shot.speed_kmh);
        }
      }
    }

    const telemetryPacket = {
      time: this.currentTime,
      elapsed: elapsed,
      rally: this.currentRally,
      shotIndex: this.activeShotIndex,
      shot: this.currentRally.shots ? this.currentRally.shots[this.activeShotIndex] : null,
      instant: instant
    };

    // Forward to Three.js 3D Viewer
    if (this.threeViewer) {
      this.threeViewer.updateTelemetryState(telemetryPacket, instant);
    }

    // Callback to update sub-dials, LCD, and 2D court
    this.onTimeUpdate(telemetryPacket);
  }

  startPlaybackLoop() {
    let lastTimestamp = performance.now();

    const loop = (timestamp) => {
      const deltaSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (this.isPlaying && this.currentRally) {
        // 1. YouTube active synchronization
        if (this.isYouTubeActive && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
          try {
            const ytSec = this.ytPlayer.getCurrentTime();
            if (ytSec > 0) {
              this.currentTime = this.videoOffset + ytSec;
            } else {
              this.currentTime += deltaSec * this.playbackRate;
            }
          } catch (e) {
            this.currentTime += deltaSec * this.playbackRate;
          }
        }
        // 2. HTML5 video active synchronization
        else if (this.hasVideo && this.videoElement && !this.videoElement.paused) {
          this.currentTime = this.videoOffset + this.videoElement.currentTime;
        }
        // 3. Pure telemetry synthetic progression
        else {
          this.currentTime += deltaSec * this.playbackRate;
        }

        this.syncRallyState();
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

window.BroadcastPlayer = BroadcastPlayer;
