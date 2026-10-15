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
    this.videoOffset = 0;
    this.activeShotIndex = 0;
    this.isUserScrubbing = false;

    this.initThreeViewer();
    this.bindEvents();
    this.updateTimecodeUI();
    this.renderTimelineTicks();

    if (this.videoElement && this.videoElement.getAttribute('src')) {
      this.loadVideoSource(this.videoElement.getAttribute('src'));
    }

    this.startPlaybackLoop();
    window.broadcastPlayerInstance = this;
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
    if (this.hasVideo && this.videoElement && this.videoElement.duration > 0) {
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

  loadVideoSource(src) {
    if (!this.videoElement) return;
    this.videoElement.src = src;
    this.videoElement.load();

    this.videoElement.onloadedmetadata = () => {
      this.hasVideo = true;
      this.videoOffset = 0;
      this.updateTimecodeUI();
      this.renderTimelineTicks();
      const targetTime = Math.max(0, Math.min(this.videoElement.duration || 498, this.currentTime));
      this.videoElement.currentTime = targetTime;
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

    if (this.hasVideo && this.videoElement) {
      this.videoElement.currentTime = Math.max(0, Math.min(this.videoElement.duration || maxDur, clamped));
    }

    this.syncRallyState(instant);
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.updatePlayBtnUI();

    if (this.hasVideo && this.videoElement) {
      if (this.isPlaying) {
        this.videoElement.play().catch(() => {});
      } else {
        this.videoElement.pause();
      }
    }
  }

  updatePlayBtnUI() {
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
      this.rallies = (t && t.rallies) || [];
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
        this.statusBadgeEl.textContent = `Between rallies · Next/Last R${rally.rally_id}`;
      } else if (activeShot) {
        const spd = typeof activeShot.speed_kmh === 'number'
          ? `${activeShot.speed_kmh.toFixed(1)} km/h est.`
          : '—';
        this.statusBadgeEl.textContent =
          `R${rally.rally_id} · Shot #${activeShot.shot_num}/${rally.shot_count} · ${activeShot.hitter} ${activeShot.type.replace(/_/g, ' ')} (${spd})`;
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

      if (this.hasVideo && this.videoElement && !this.videoElement.paused) {
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
