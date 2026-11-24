/**
 * Broadcast Video Player & Synchronized Match Engine (Hawkview — Spec Section 3)
 * Provides 1:1 timecode synchronization between:
 * - HTML5 <video> element (assets/LZJvPopov.mp4 or custom file) / YouTube iframe
 * - 3D Shot Explorer (js/shot-explorer.js)
 * - Rally Deck & Player Card
 */

class BroadcastPlayer {
  constructor(options = {}) {
    this.timelineSlider = document.getElementById('rally-timeline-slider');
    this.timecodeElapsedEl = document.getElementById('timeline-timecode-elapsed');
    this.timecodeTotalEl = document.getElementById('timeline-timecode-total');
    this.ticksContainer = document.getElementById('rally-timeline-ticks');

    this.playBtn = document.getElementById('btn-play-pause');
    this.prevRallyBtn = document.getElementById('btn-prev-rally');
    this.nextRallyBtn = document.getElementById('btn-next-rally');
    this.muteBtn = document.getElementById('btn-toggle-video-mute');
    this.loadFileBtn = document.getElementById('btn-load-custom-video');
    this.fileInput = document.getElementById('video-file-input');

    this.videoElement = document.getElementById('real-video-player');
    this.videoStageEl = document.getElementById('video-stage-container') || (this.videoElement && this.videoElement.closest('.hv-video-stage'));
    this.statusBadgeEl = document.getElementById('video-rally-status-badge');

    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onRallyChange = options.onRallyChange || (() => {});

    this.rallies = (window.HAWKVIEW_TELEMETRY && window.HAWKVIEW_TELEMETRY.rallies) || [];
    this.currentRallyIndex = 0;
    this.currentRally = this.rallies[0] || null;
    this.currentTime = this.currentRally ? this.getRallyStart(this.currentRally) : 0;
    this.totalDuration =
      (window.HAWKVIEW_TELEMETRY &&
        window.HAWKVIEW_TELEMETRY.source &&
        window.HAWKVIEW_TELEMETRY.source.duration_sec) ||
      (window.HAWKVIEW_TELEMETRY &&
        window.HAWKVIEW_TELEMETRY.match_metadata &&
        window.HAWKVIEW_TELEMETRY.match_metadata.video_duration_sec) ||
      498.44;

    this.isPlaying = false;
    this.hasVideo = false;
    this.isYouTubeMode = false;
    this.ytVideoId = null;
    this.ytPlayer = null;
    this.ytPlayerReady = false;
    this.ytPendingSeek = null;
    this.videoOffset = 0;
    this.activeShotIndex = 0;
    this.isUserScrubbing = false;

    this.initThreeViewer();
    this.bindEvents();
    this.updateTimecodeUI();
    this.renderTimelineTicks();

    const initYtId = this.extractYouTubeIdFromTelemetry(window.HAWKVIEW_TELEMETRY, window.HAWKVIEW_ACTIVE_MATCH_KEY);
    if (this.shouldPreferYouTube(initYtId)) {
      this.loadYouTubeVideo(initYtId);
    } else if (this.videoElement && this.videoElement.getAttribute('src')) {
      this.loadVideoSource(this.videoElement.getAttribute('src'), initYtId);
    }

    this.startPlaybackLoop();
    window.broadcastPlayerInstance = this;
  }

  isRemoteStaticHost() {
    if (typeof window === 'undefined' || !window.location) return false;
    const h = window.location.hostname || '';
    return h !== 'localhost' && h !== '127.0.0.1' && h !== '';
  }

  shouldPreferYouTube(ytId) {
    return Boolean(ytId && this.isRemoteStaticHost());
  }

  extractYouTubeIdFromTelemetry(telemetry, matchKey = '') {
    const idRe = /^[A-Za-z0-9_-]{11}$/;
    const src = (telemetry && telemetry.source) || {};
    const mm = (telemetry && telemetry.match_metadata) || {};
    for (const cand of [src.yt_video_id, mm.yt_video_id]) {
      if (typeof cand === 'string' && idRe.test(cand.trim())) return cand.trim();
    }
    const ytUrl = src.yt_url || mm.yt_url || '';
    if (typeof ytUrl === 'string' && ytUrl) {
      const m = ytUrl.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
    const keyCandidates = [matchKey, mm.match_id].filter(Boolean);
    for (const k of keyCandidates) {
      const m = String(k).match(/^(?:yt|stress)_([A-Za-z0-9_-]{11})$/);
      if (m) return m[1];
    }
    const vidPath = String(src.video || '');
    const mPath = vidPath.match(/(?:yt_|stress_test\/)([A-Za-z0-9_-]{11})\.mp4$/);
    if (mPath) return mPath[1];
    return null;
  }

  ensureYouTubeIframeApi() {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (window._hvYtApiPromise) return window._hvYtApiPromise;
    window._hvYtApiPromise = new Promise((resolve) => {
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCb === 'function') {
          try { prevCb(); } catch (e) {}
        }
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
      setTimeout(() => {
        if (window.YT && window.YT.Player) resolve(window.YT);
      }, 4000);
    });
    return window._hvYtApiPromise;
  }

  destroyYouTubePlayer() {
    this.isYouTubeMode = false;
    this.ytVideoId = null;
    this.ytPlayerReady = false;
    this.ytPendingSeek = null;
    if (this.ytPlayer) {
      try { this.ytPlayer.destroy(); } catch (e) {}
      this.ytPlayer = null;
    }
    const host = document.getElementById('yt-iframe-host');
    if (host) host.remove();
    if (this.videoElement) {
      this.videoElement.style.display = '';
    }
  }

  loadYouTubeVideo(videoId) {
    if (!videoId || !this.videoStageEl) return;
    if (this.isYouTubeMode && this.ytVideoId === videoId && this.ytPlayer) {
      return;
    }
    this.destroyYouTubePlayer();
    if (this.videoElement) {
      try { this.videoElement.pause(); } catch (e) {}
      this.videoElement.style.display = 'none';
    }
    this.isYouTubeMode = true;
    this.ytVideoId = videoId;
    this.hasVideo = true;
    this.ytPlayerReady = false;

    const host = document.createElement('div');
    host.id = 'yt-iframe-host';
    host.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; z-index:1; background:#000;';
    const inner = document.createElement('div');
    inner.id = 'yt-iframe-player-el';
    inner.style.cssText = 'width:100%; height:100%;';
    host.appendChild(inner);
    this.videoStageEl.insertBefore(host, this.videoStageEl.firstChild);

    this.ensureYouTubeIframeApi().then((YT) => {
      if (!YT || !YT.Player || !this.isYouTubeMode || this.ytVideoId !== videoId) return;
      const startSec = Math.max(0, Math.floor(this.currentTime || 0));
      this.ytPlayer = new YT.Player('yt-iframe-player-el', {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin,
          start: startSec
        },
        events: {
          onReady: () => {
            this.ytPlayerReady = true;
            try {
              const dur = this.ytPlayer.getDuration();
              if (dur && dur > 0) this.totalDuration = dur;
              this.ytPlayer.mute();
              if (this.muteBtn) this.muteBtn.textContent = '🔇 Muted';
              const target = this.ytPendingSeek !== null ? this.ytPendingSeek : this.currentTime;
              this.ytPendingSeek = null;
              if (typeof target === 'number' && target > 0) {
                this.ytPlayer.seekTo(target, true);
              }
            } catch (e) {}
            this.updateTimecodeUI();
            this.renderTimelineTicks();
          },
          onStateChange: (ev) => {
            const playing = ev && YT.PlayerState && ev.data === YT.PlayerState.PLAYING;
            this.isPlaying = Boolean(playing);
            this.updatePlayBtnUI();
          }
        }
      });
    });
  }

  getRallyStart(r) {
    if (!r) return 0;
    return typeof r.start_sec === 'number' ? r.start_sec : (r.seconds_start || 0);
  }

  getRallyEnd(r) {
    if (!r) return 0;
    return typeof r.end_sec === 'number' ? r.end_sec : (r.seconds_end || 0);
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

  playMechanicalClick() {
    // Plain UI per Spec Section 2.1 — no synthetic watch sounds required
  }

  formatTimecode(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${mins}:${secs}`;
  }

  getDuration() {
    if (this.isYouTubeMode && this.ytPlayer && this.ytPlayerReady) {
      try {
        const d = this.ytPlayer.getDuration();
        if (d && d > 0) return d;
      } catch (e) {}
    }
    if (!this.isYouTubeMode && this.hasVideo && this.videoElement && this.videoElement.duration > 0) {
      return this.videoElement.duration;
    }
    return this.totalDuration || 498.44;
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
      if (Number(this.timelineSlider.max) !== ceilDur) {
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
      const s = this.getRallyStart(rally);
      const e = this.getRallyEnd(rally);
      const startPct = Math.max(0, Math.min(100, (s / dur) * 100));
      const endPct = Math.max(0, Math.min(100, (e / dur) * 100));
      const widthPct = Math.max(0.6, endPct - startPct);

      const tick = document.createElement('div');
      tick.className = 'rally-tick-zone';
      tick.style.left = `${startPct.toFixed(2)}%`;
      tick.style.width = `${widthPct.toFixed(2)}%`;
      tick.title = `R${rally.rally_id} (${this.formatTimecode(s)} – ${this.formatTimecode(e)})`;
      tick.setAttribute('data-rally-index', index);

      tick.addEventListener('click', (ev) => {
        ev.stopPropagation();
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
      tick.classList.toggle('active-rally-tick', idx === activeIndex && !isDowntime);
    });
  }

  getRallyAtTime(time) {
    if (!this.rallies || this.rallies.length === 0) return null;

    for (let i = 0; i < this.rallies.length; i++) {
      const r = this.rallies[i];
      const s = this.getRallyStart(r);
      const e = this.getRallyEnd(r);
      if (time >= s - 0.1 && time <= e + 0.1) {
        return { rally: r, index: i, isDowntime: false };
      }
    }

    if (time < this.getRallyStart(this.rallies[0])) {
      return { rally: this.rallies[0], index: 0, isDowntime: true };
    }

    for (let i = 0; i < this.rallies.length - 1; i++) {
      const curr = this.rallies[i];
      const next = this.rallies[i + 1];
      const ce = this.getRallyEnd(curr);
      const ns = this.getRallyStart(next);
      if (time > ce && time < ns) {
        const mid = ce + (ns - ce) * 0.5;
        return {
          rally: time >= mid ? next : curr,
          index: time >= mid ? i + 1 : i,
          isDowntime: true
        };
      }
    }

    const lastIdx = this.rallies.length - 1;
    return {
      rally: this.rallies[lastIdx],
      index: lastIdx,
      isDowntime: true
    };
  }

  loadVideoSource(src, fallbackYtId = null) {
    if (this.shouldPreferYouTube(fallbackYtId)) {
      this.loadYouTubeVideo(fallbackYtId);
      return;
    }
    if (!this.videoElement || !src) {
      if (fallbackYtId) this.loadYouTubeVideo(fallbackYtId);
      return;
    }
    this.destroyYouTubePlayer();
    this.hasVideo = false;
    this.videoElement.src = src;
    this.videoElement.load();

    const syncInitialFrame = () => {
      this.hasVideo = true;
      this.videoOffset = 0;
      this.updateTimecodeUI();
      this.renderTimelineTicks();
      const targetTime = Math.max(0.05, Math.min((this.videoElement.duration || 498) - 0.1, this.currentTime || 0.1));
      try {
        if (Math.abs((this.videoElement.currentTime || 0) - targetTime) > 0.05) {
          this.videoElement.currentTime = targetTime;
        }
      } catch (e) {}
    };

    this.videoElement.onloadedmetadata = syncInitialFrame;
    this.videoElement.onloadeddata = syncInitialFrame;
    this.videoElement.onerror = () => {
      if (fallbackYtId) {
        this.loadYouTubeVideo(fallbackYtId);
      }
    };
  }

  seekTo(targetSeconds, instant = false) {
    const maxDur = this.getDuration();
    const clamped = Math.max(0, Math.min(maxDur, targetSeconds));
    this.currentTime = clamped;

    if (this.timelineSlider) {
      this.timelineSlider.value = clamped;
    }
    this.updateTimecodeUI();

    if (this.isYouTubeMode) {
      if (this.ytPlayer && this.ytPlayerReady) {
        try { this.ytPlayer.seekTo(clamped, true); } catch (e) {}
      } else {
        this.ytPendingSeek = clamped;
      }
    } else if (this.hasVideo && this.videoElement) {
      this.videoElement.currentTime = Math.max(0, Math.min(this.videoElement.duration || maxDur, clamped));
    }

    this.syncRallyState(instant);
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.updatePlayBtnUI();

    if (this.isYouTubeMode) {
      if (this.ytPlayer && this.ytPlayerReady) {
        try {
          if (this.isPlaying) {
            this.ytPlayer.playVideo();
          } else {
            this.ytPlayer.pauseVideo();
          }
        } catch (e) {}
      }
    } else if (this.hasVideo && this.videoElement) {
      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      } else {
        this.videoElement.pause();
      }
    }
  }

  wakeVideoHUD(durationMs = 4000) {
    if (!this.videoStageEl) return;
    this.videoStageEl.classList.add('hud-awake');
    if (this._videoHudWakeTimer) {
      clearTimeout(this._videoHudWakeTimer);
    }
    this._videoHudWakeTimer = setTimeout(() => {
      this.videoStageEl.classList.remove('hud-awake');
    }, durationMs);
  }

  updatePlayBtnUI() {
    if (this.videoStageEl) {
      this.videoStageEl.classList.toggle('is-playing', this.isPlaying);
    }
    if (!this.playBtn) return;
    this.playBtn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
    this.playBtn.classList.toggle('active', this.isPlaying);
  }

  selectRally(index) {
    if (!this.rallies || index < 0 || index >= this.rallies.length) return;
    this.currentRallyIndex = index;
    this.currentRally = this.rallies[index];
    const startSec = this.getRallyStart(this.currentRally);
    this.activeShotIndex = 0;
    this.seekTo(startSec, true);

    this.onRallyChange(this.currentRally);
    window.dispatchEvent(new CustomEvent('hawkview:rallyChanged', {
      detail: { rally: this.currentRally, index }
    }));
  }

  bindEvents() {
    if (this.videoStageEl) {
      // Top video overlay (.hv-video-overlay-top) starts at 10% opacity by default
      // and wakes to 100% opacity for 4 seconds (4000ms) when the user taps/clicks the video view
      ['pointerdown', 'touchstart', 'click'].forEach((evt) => {
        this.videoStageEl.addEventListener(evt, () => this.wakeVideoHUD(4000), { passive: true });
      });
    }
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => this.togglePlay());
    }
    if (this.prevRallyBtn) {
      this.prevRallyBtn.addEventListener('click', () => {
        const prev = (this.currentRallyIndex - 1 + this.rallies.length) % this.rallies.length;
        this.selectRally(prev);
      });
    }
    if (this.nextRallyBtn) {
      this.nextRallyBtn.addEventListener('click', () => {
        const next = (this.currentRallyIndex + 1) % this.rallies.length;
        this.selectRally(next);
      });
    }
    if (this.muteBtn && this.videoElement) {
      this.muteBtn.addEventListener('click', () => {
        if (this.isYouTubeMode && this.ytPlayer && this.ytPlayerReady) {
          try {
            if (this.ytPlayer.isMuted()) {
              this.ytPlayer.unMute();
              this.muteBtn.textContent = '🔊 Audio';
            } else {
              this.ytPlayer.mute();
              this.muteBtn.textContent = '🔇 Muted';
            }
          } catch (e) {}
          return;
        }
        this.videoElement.muted = !this.videoElement.muted;
        this.muteBtn.textContent = this.videoElement.muted ? '🔇 Muted' : '🔊 Audio';
      });
    }
    if (this.loadFileBtn && this.fileInput) {
      this.loadFileBtn.addEventListener('click', () => {
        if (window.videoLoaderModalInstance) {
          window.videoLoaderModalInstance.open();
        } else {
          this.fileInput.click();
        }
      });
      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          if (window.videoLoaderModalInstance) {
            window.videoLoaderModalInstance.openWithFile(file);
          } else {
            const url = URL.createObjectURL(file);
            this.loadVideoSource(url);
          }
        }
      });
    }

    if (this.timelineSlider) {
      this.timelineSlider.addEventListener('input', (e) => {
        this.isUserScrubbing = true;
        const t = parseFloat(e.target.value) || 0;
        this.seekTo(t, true);
      });
      this.timelineSlider.addEventListener('change', (e) => {
        const t = parseFloat(e.target.value) || 0;
        this.seekTo(t, true);
        setTimeout(() => {
          this.isUserScrubbing = false;
        }, 120);
      });
    }

    if (this.videoElement) {
      this.videoElement.addEventListener('play', () => {
        this.isPlaying = true;
        this.updatePlayBtnUI();
      });
      this.videoElement.addEventListener('pause', () => {
        this.isPlaying = false;
        this.updatePlayBtnUI();
      });
    }

    window.addEventListener('hawkview:matchChanged', (e) => {
      const t = (e.detail && e.detail.telemetry) || window.HAWKVIEW_TELEMETRY;
      const mKey = (e.detail && e.detail.matchKey) || window.HAWKVIEW_ACTIVE_MATCH_KEY || '';
      this.rallies = (t && t.rallies) || [];
      const ytId = this.extractYouTubeIdFromTelemetry(t, mKey);
      if (this.shouldPreferYouTube(ytId)) {
        this.loadYouTubeVideo(ytId);
      } else if (t && t.source && t.source.video && this.videoElement) {
        const currentSrc = this.videoElement.getAttribute('src') || '';
        if (currentSrc !== t.source.video && !currentSrc.startsWith('blob:')) {
          this.loadVideoSource(t.source.video, ytId);
        }
      } else if (ytId) {
        this.loadYouTubeVideo(ytId);
      }
      if (t && t.source && t.source.duration_sec) {
        this.totalDuration = t.source.duration_sec;
      }
      this.updateTimecodeUI();
      this.renderTimelineTicks();
      if (this.rallies.length > 0) {
        this.selectRally(0);
      } else if (this.statusBadgeEl) {
        this.statusBadgeEl.textContent = 'Analyzing Rallies...';
      }
    });

    window.addEventListener('hawkview:ralliesStreamUpdated', (e) => {
      const t = (e.detail && e.detail.telemetry) || window.HAWKVIEW_TELEMETRY;
      const prevCount = this.rallies ? this.rallies.length : 0;
      this.rallies = (t && t.rallies) || [];
      if (t && t.source && t.source.duration_sec) {
        this.totalDuration = t.source.duration_sec;
      }
      this.updateTimecodeUI();
      this.renderTimelineTicks();
      if (prevCount === 0 && this.rallies.length > 0) {
        this.selectRally(0);
      } else {
        this.syncRallyState(false);
      }
    });
  }

  syncRallyState(instant = false) {
    const state = this.getRallyAtTime(this.currentTime);
    if (!state) return;

    const { rally, index, isDowntime } = state;

    if (index !== this.currentRallyIndex || rally !== this.currentRally) {
      this.currentRallyIndex = index;
      this.currentRally = rally;
      this.onRallyChange(rally);
      window.dispatchEvent(new CustomEvent('hawkview:rallyChanged', {
        detail: { rally, index }
      }));
    }

    if (!this.isUserScrubbing && this.timelineSlider) {
      this.timelineSlider.value = this.currentTime;
    }

    this.updateTimecodeUI();
    this.updateActiveTickUI(index, isDowntime);

    let foundIndex = -1;
    let activeShot = null;

    if (!isDowntime && rally && Array.isArray(rally.shots) && rally.shots.length > 0) {
      foundIndex = 0;
      for (let i = 0; i < rally.shots.length; i++) {
        if (this.currentTime >= rally.shots[i].time) {
          foundIndex = i;
        } else {
          break;
        }
      }
      activeShot = rally.shots[foundIndex] || null;
      this.activeShotIndex = foundIndex;
    }

    if (this.statusBadgeEl && rally) {
      if (isDowntime) {
        const msg = `R${rally.rally_id} · Next Rally`;
        this.statusBadgeEl.textContent = msg;
        this.statusBadgeEl.title = `Between rallies · Next/Last R${rally.rally_id}`;
      } else if (activeShot) {
        const spd = typeof activeShot.speed_kmh === 'number'
          ? `${Math.round(activeShot.speed_kmh)} km/h`
          : '—';
        const shotTypeShort = (activeShot.type || 'shot').replace(/^serve_/, 'serve ').replace(/_/g, ' ');
        const msg = `R${rally.rally_id} · #${activeShot.shot_num}/${rally.shot_count} · ${activeShot.hitter} ${shotTypeShort} (${spd})`;
        this.statusBadgeEl.textContent = msg;
        this.statusBadgeEl.title = msg;
      } else {
        this.statusBadgeEl.textContent = `R${rally.rally_id} · ${rally.shot_count} shots`;
      }
    }

    const packet = {
      time: this.currentTime,
      elapsed: rally ? Math.max(0, this.currentTime - this.getRallyStart(rally)) : 0,
      rally,
      shotIndex: foundIndex,
      shot: activeShot,
      isDowntime,
      instant
    };

    if (this.threeViewer) {
      this.threeViewer.updateTelemetryState(packet);
    }

    this.onTimeUpdate(packet);
  }

  startPlaybackLoop() {
    let lastTimestamp = performance.now();

    const loop = (timestamp) => {
      const deltaSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (this.isYouTubeMode && this.ytPlayer && this.ytPlayerReady && this.isPlaying) {
        if (!this.isUserScrubbing) {
          try {
            const ytNow = this.ytPlayer.getCurrentTime();
            if (typeof ytNow === 'number' && !isNaN(ytNow)) {
              this.currentTime = ytNow;
              this.syncRallyState();
            }
          } catch (e) {}
        }
      } else if (!this.isYouTubeMode && this.hasVideo && this.videoElement && !this.videoElement.paused) {
        if (!this.isUserScrubbing) {
          this.currentTime = this.videoElement.currentTime;
          this.syncRallyState();
        }
      } else if (this.isPlaying && !this.hasVideo) {
        if (!this.isUserScrubbing) {
          this.currentTime += deltaSec;
          if (this.currentTime > this.getDuration()) {
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
