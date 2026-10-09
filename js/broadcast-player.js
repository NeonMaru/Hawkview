/**
 * Broadcast Video Player & Synchronized Match Engine (Hawkview)
 * Orchestrates:
 * - Real Three.js 3D Court Viewport integration with free tilt/orbit
 * - Web Audio API synthesized mechanical watch clicks and supersonic smash cracks
 * - Frame-accurate timecode scrubbing synchronized with dials & court
 * - Real-time BWF TV Scorebug and Speed Radar Banner overlays
 */

class BroadcastPlayer {
  constructor(options = {}) {
    this.timelineSlider = document.getElementById('rally-timeline-slider');
    this.playBtn = document.getElementById('btn-play-pause');
    this.videoElement = document.getElementById('real-video-player');

    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onRallyChange = options.onRallyChange || (() => {});

    this.isPlaying = false;
    this.currentTime = 312.1; // Start at Rally #18 (LZJ 412km/h smash)
    this.playbackRate = 1.0;
    this.currentRallyIndex = 1; // Rally #18
    this.activeShotIndex = 0;

    this.rallies = window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : [];
    this.currentRally = this.rallies[this.currentRallyIndex] || null;

    this.radarTimer = null;
    this.audioCtx = null;

    // Initialize Real Three.js 3D Viewer
    this.initThreeViewer();

    this.bindEvents();
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
      // Thunder crack noise burst
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
          this.syncRallyState();
        }
      });
    }

    // Video file drag & drop handler for custom files
    const dropZone = document.getElementById('video-viewport-container');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('ring-2', 'ring-cyan-400');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('ring-2', 'ring-cyan-400');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('ring-2', 'ring-cyan-400');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
          this.loadCustomVideoFile(file);
        }
      });
    }
  }

  loadCustomVideoFile(file) {
    if (!this.videoElement) return;
    const url = URL.createObjectURL(file);
    this.videoElement.src = url;
    this.videoElement.classList.remove('hidden');
    const threeContainer = document.getElementById('three-viewport-container');
    if (threeContainer) threeContainer.classList.add('hidden');
    this.videoElement.play();
    this.isPlaying = true;
    this.updatePlayBtnIcon();
  }

  togglePlay() {
    this.playMechanicalClick();
    this.isPlaying = !this.isPlaying;
    this.updatePlayBtnIcon();
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

    if (this.threeViewer) {
      this.threeViewer.clearTrail();
    }

    // Trigger radar flash on high-speed rally select
    if (this.currentRally.max_smash_kmh >= 380) {
      this.triggerRadarFlash(`⚡ ${this.currentRally.max_smash_kmh} KM/H`, this.currentRally.max_smash_kmh);
    }

    this.updateScorebugUI();
    this.syncRallyState();
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
    if (p1ScoreEl) p1ScoreEl.textContent = this.currentRally.score_after.player_1;
    if (p2ScoreEl) p2ScoreEl.textContent = this.currentRally.score_after.player_2;
  }

  syncRallyState() {
    if (!this.currentRally) return;

    // Check if time passed rally end
    if (this.currentTime > this.currentRally.seconds_end) {
      this.currentTime = this.currentRally.seconds_start;
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
      shot: this.currentRally.shots ? this.currentRally.shots[this.activeShotIndex] : null
    };

    // Forward to Three.js 3D Viewer
    if (this.threeViewer) {
      this.threeViewer.updateTelemetryState(telemetryPacket);
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
        this.currentTime += deltaSec * this.playbackRate;
        this.syncRallyState();
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

window.BroadcastPlayer = BroadcastPlayer;
