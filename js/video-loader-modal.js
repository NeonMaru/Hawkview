/**
 * Hawkview True "Load MP4" & Interactive Court Calibration Wizard (js/video-loader-modal.js)
 * Supports:
 * 1. Uploading any MP4 / MOV / WebM match video (BWF telecasts up to 1h+ OR iPhone / recreational recordings)
 * 2. Interactive 6-Point Court & Net Calibrator (4 Court Corners + 2 Net Post Tops) with live 60 FPS
 *    homography-projected BWF regulation line wireframe + touch magnifier loupe for weird camera angles
 * 3. Progressive Rally-by-Rally 3D Analysis streaming completed rallies into the 3D Court live as they finish
 */

class VideoLoaderModal {
  constructor(broadcastPlayer) {
    this.player = broadcastPlayer;
    this.modal = document.getElementById('video-loader-modal');
    this.bannerEl = document.getElementById('live-analysis-banner');
    this.bannerStageEl = document.getElementById('lab-stage-text');
    this.bannerDetailEl = document.getElementById('lab-detail-text');
    this.bannerFillEl = document.getElementById('lab-progress-fill');
    this.bannerStopBtn = document.getElementById('btn-stop-live-analysis');

    // Preview video & interactive calibration canvas inside modal
    this.previewVideo = document.createElement('video');
    this.previewVideo.muted = true;
    this.previewVideo.playsInline = true;
    this.previewVideo.preload = 'auto';

    this.canvas = document.getElementById('calib-court-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.frameSlider = document.getElementById('calib-frame-slider');
    this.frameTimeEl = document.getElementById('calib-frame-time');
    this.statusPillEl = document.getElementById('calib-status-pill');

    // Video metadata state
    this.videoPath = 'assets/LZJvPopov.mp4';
    this.matchId = 'lzj_popov';
    this.videoWidth = 1920;
    this.videoHeight = 1080;
    this.videoFps = 25.0;
    this.videoDuration = 498.44;
    this.isUploading = false;

    // 6 Draggable Calibration Handles in video pixel coordinates [u, v]
    this.keypoints = {
      corner_near_left: [323.8, 963.2],
      corner_near_right: [1592.0, 968.7],
      corner_far_right: [1293.6, 427.7],
      corner_far_left: [627.7, 423.4],
      net_post_left: [516.5, 390.5],
      net_post_right: [1404.5, 396.0]
    };

    this.handleDefs = [
      { key: 'corner_near_left', short: '1 · Near-L', label: 'Near-Left Corner (0, 0)', color: '#16a34a' },
      { key: 'corner_near_right', short: '2 · Near-R', label: 'Near-Right Corner (6.1m, 0)', color: '#16a34a' },
      { key: 'corner_far_right', short: '3 · Far-R', label: 'Far-Right Corner (6.1m, 13.4m)', color: '#2563eb' },
      { key: 'corner_far_left', short: '4 · Far-L', label: 'Far-Left Corner (0, 13.4m)', color: '#2563eb' },
      { key: 'net_post_left', short: '5 · Net-L', label: 'Left Net Post Top (1.55m)', color: '#d97706' },
      { key: 'net_post_right', short: '6 · Net-R', label: 'Right Net Post Top (1.55m)', color: '#d97706' }
    ];

    this.draggingKey = null;
    this.hoveredKey = null;
    this.activePollTimer = null;
    this.activeJobMatchId = null;
    this.lastStreamedRallyCount = -1;

    // Floating YouTube -> 3D Converter Bubble state (2-decimal live progress + idle fade)
    this.fabEl = document.getElementById('hv-yt-fab');
    this.fabFillEl = document.getElementById('hv-yt-fab-fill');
    this.fabIconEl = document.getElementById('hv-yt-fab-icon');
    this.fabPctEl = document.getElementById('hv-yt-fab-pct');
    this.fabSubEl = document.getElementById('hv-yt-fab-sub');
    this._fabMode = 'idle';
    this._fabDisplayPct = 0;
    this._fabTargetPct = 0;
    this._fabLastUpdateMs = 0;
    this._fabTicker = null;
    this._fabIdleTimer = null;
    this._fabDoneTimer = null;
    this._fabLastStage = '';
    this._fabLastDetail = '';

    this.bindEvents();
    this.initFloatingConverterBubble();
    this.resumeSavedCloudJob();
    if (window.location && window.location.search.includes('openCalib=1')) {
      setTimeout(() => this.open(), 250);
    }
  }

  bindEvents() {
    const topOpenBtn = document.getElementById('btn-topbar-load-mp4');
    const closeBtn = document.getElementById('btn-close-video-loader');
    const pickFileBtn = document.getElementById('btn-calib-pick-file');
    const modalFileInput = document.getElementById('calib-file-input');
    const dropZone = document.getElementById('calib-drop-zone');
    const autoDetectBtn = document.getElementById('btn-calib-auto-detect');
    const presetBroadcastBtn = document.getElementById('btn-preset-broadcast');
    const presetTripodBtn = document.getElementById('btn-preset-tripod');
    const presetAngledBtn = document.getElementById('btn-preset-angled');
    const startBtn = document.getElementById('btn-start-3d-analysis');
    const nearInputEl = document.getElementById('calib-near-player');
    const farInputEl = document.getElementById('calib-far-player');
    const swapNearFarBtn = document.getElementById('btn-swap-near-far');
    const ytUrlInput = document.getElementById('calib-youtube-url');
    const ytAutoBtn = document.getElementById('btn-yt-auto-convert');
    const ytPreviewBtn = document.getElementById('btn-yt-preview');
    const topbarYtInput = document.getElementById('topbar-yt-url');
    const topbarYtGoBtn = document.getElementById('btn-topbar-yt-go');
    const sheetYtInput = document.getElementById('sheet-yt-url');
    const sheetYtGoBtn = document.getElementById('btn-sheet-yt-go');

    if (ytAutoBtn) {
      ytAutoBtn.addEventListener('click', () => this.importYouTubeUrl(true));
    }
    if (ytPreviewBtn) {
      ytPreviewBtn.addEventListener('click', () => {
        const adv = document.getElementById('calib-advanced-local-section');
        if (adv) adv.open = true;
        this.importYouTubeUrl(false);
      });
    }
    if (ytUrlInput) {
      ytUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.importYouTubeUrl(true);
        }
      });
    }
    const triggerQuickYt = (inputEl) => {
      const urlVal = inputEl ? String(inputEl.value || '').trim() : '';
      const closeQuickSheet = () => {
        if (window.thumbStatsSheetInstance) {
          if (typeof window.thumbStatsSheetInstance.closeSheet === 'function') {
            window.thumbStatsSheetInstance.closeSheet();
          } else if (typeof window.thumbStatsSheetInstance.close === 'function') {
            window.thumbStatsSheetInstance.close();
          }
        }
      };
      if (!urlVal) {
        closeQuickSheet();
        this.open();
        if (ytUrlInput) ytUrlInput.focus();
        return;
      }
      if (ytUrlInput) ytUrlInput.value = urlVal;
      closeQuickSheet();
      this.importYouTubeUrl(true, urlVal);
    };
    if (topbarYtGoBtn) {
      topbarYtGoBtn.addEventListener('click', () => triggerQuickYt(topbarYtInput));
    }
    if (topbarYtInput) {
      topbarYtInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerQuickYt(topbarYtInput);
        }
      });
    }
    if (sheetYtGoBtn) {
      sheetYtGoBtn.addEventListener('click', () => triggerQuickYt(sheetYtInput));
    }
    if (sheetYtInput) {
      sheetYtInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerQuickYt(sheetYtInput);
        }
      });
    }

    // Wire 2-Mode Loader Tabs (Upload MP4 vs YouTube Link) + Direct Phone MP4 -> Cloud GPU Upload
    const tabMp4 = document.getElementById('tab-loader-mp4');
    const tabYt = document.getElementById('tab-loader-yt');
    const panelMp4 = document.getElementById('loader-panel-mp4');
    const panelYt = document.getElementById('loader-panel-yt');
    const setLoaderTab = (which) => {
      const isMp4 = which === 'mp4';
      if (tabMp4) {
        tabMp4.classList.toggle('active', isMp4);
        tabMp4.setAttribute('aria-selected', isMp4 ? 'true' : 'false');
      }
      if (tabYt) {
        tabYt.classList.toggle('active', !isMp4);
        tabYt.setAttribute('aria-selected', !isMp4 ? 'true' : 'false');
      }
      if (panelMp4) panelMp4.classList.toggle('hidden', !isMp4);
      if (panelYt) panelYt.classList.toggle('hidden', isMp4);
    };
    this._setLoaderTab = setLoaderTab;
    if (tabMp4) tabMp4.addEventListener('click', () => setLoaderTab('mp4'));
    if (tabYt) tabYt.addEventListener('click', () => setLoaderTab('yt'));

    const cloudMp4Input = document.getElementById('cloud-mp4-input');
    const cloudPickBtn = document.getElementById('btn-cloud-pick-mp4');
    const cloudConvertBtn = document.getElementById('btn-cloud-mp4-convert');
    const pickedNameEl = document.getElementById('cloud-mp4-picked-name');
    const pickedMetaEl = document.getElementById('cloud-mp4-picked-meta');

    if (cloudPickBtn && cloudMp4Input) {
      cloudPickBtn.addEventListener('click', () => cloudMp4Input.click());
      cloudMp4Input.addEventListener('change', () => {
        const f = cloudMp4Input.files && cloudMp4Input.files[0];
        if (!f) return;
        this._selectedCloudMp4File = f;
        const mb = (f.size / (1024 * 1024)).toFixed(1);
        if (pickedNameEl) pickedNameEl.textContent = f.name;
        if (pickedMetaEl) pickedMetaEl.textContent = `${mb} MB selected · Tap Convert MP4 to 3D`;
        cloudPickBtn.classList.add('has-file');
        this.setStatusPill(`Ready to upload ${f.name} (${mb} MB) to Cloud GPU`, true);
      });
    }
    if (cloudConvertBtn) {
      cloudConvertBtn.addEventListener('click', () => {
        if (!this._selectedCloudMp4File) {
          if (cloudMp4Input) cloudMp4Input.click();
          return;
        }
        this.startCloudMp4Upload(this._selectedCloudMp4File);
      });
    }

    if (nearInputEl) {
      nearInputEl.addEventListener('input', () => { this._userEditedPlayers = true; });
    }
    if (farInputEl) {
      farInputEl.addEventListener('input', () => { this._userEditedPlayers = true; });
    }
    if (swapNearFarBtn && nearInputEl && farInputEl) {
      swapNearFarBtn.addEventListener('click', () => {
        const tmp = nearInputEl.value;
        nearInputEl.value = farInputEl.value;
        farInputEl.value = tmp;
        this._userEditedPlayers = true;
      });
    }

    if (topOpenBtn) topOpenBtn.addEventListener('click', () => this.open());
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }

    if (pickFileBtn && modalFileInput) {
      pickFileBtn.addEventListener('click', () => modalFileInput.click());
      modalFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this.uploadFileToServer(file);
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) this.uploadFileToServer(file);
      });
    }

    if (this.frameSlider) {
      this.frameSlider.addEventListener('input', (e) => {
        const t = parseFloat(e.target.value) || 0;
        this.seekPreviewTo(t);
      });
    }

    this.previewVideo.addEventListener('loadedmetadata', () => {
      const newW = this.previewVideo.videoWidth || 1920;
      const newH = this.previewVideo.videoHeight || 1080;
      this.rescaleKeypointsToDimensions(newW, newH);
      this.videoWidth = newW;
      this.videoHeight = newH;
      this.videoDuration = this.previewVideo.duration || 60;
      if (this.canvas) {
        this.canvas.width = this.videoWidth;
        this.canvas.height = this.videoHeight;
      }
      if (this.frameSlider) {
        this.frameSlider.max = Math.max(1, Math.floor(this.videoDuration));
      }
      const fileLabelEl = document.getElementById('calib-active-filename');
      if (fileLabelEl && this.uploadedFileName && !this._serverCalibApplied) {
        const mins = Math.floor(this.videoDuration / 60);
        const secs = Math.round(this.videoDuration % 60).toString().padStart(2, '0');
        fileLabelEl.textContent = `${this.uploadedFileName} · ${this.videoWidth}×${this.videoHeight} (${mins}:${secs})`;
      }
      // Seek slightly into the video so mobile browsers decode & paint the frame immediately
      const targetSample = Math.min(15.0, Math.max(0.5, this.videoDuration * 0.2));
      if (Math.abs((this.previewVideo.currentTime || 0) - targetSample) > 0.1) {
        try {
          this.previewVideo.currentTime = targetSample;
          if (this.frameSlider) this.frameSlider.value = targetSample;
        } catch (e) {}
      }
      this.drawCalibrationCanvas();
    });

    this.previewVideo.addEventListener('loadeddata', () => {
      const newW = this.previewVideo.videoWidth || 1920;
      const newH = this.previewVideo.videoHeight || 1080;
      this.rescaleKeypointsToDimensions(newW, newH);
      this.videoWidth = newW;
      this.videoHeight = newH;
      this.videoDuration = this.previewVideo.duration || 60;
      if (this.canvas) {
        this.canvas.width = this.videoWidth;
        this.canvas.height = this.videoHeight;
      }
      if (this.frameSlider) {
        this.frameSlider.max = Math.max(1, Math.floor(this.videoDuration));
      }
      if (this._pendingBrowserAutoCalib && !this._serverCalibApplied && this.previewVideo.readyState >= 2) {
        this._pendingBrowserAutoCalib = false;
        this.autoDetectCourtInBrowser(true);
      } else {
        this.drawCalibrationCanvas();
      }
    });

    this.previewVideo.addEventListener('seeked', () => {
      if (this._pendingBrowserAutoCalib && !this._serverCalibApplied && this.previewVideo.readyState >= 2) {
        this._pendingBrowserAutoCalib = false;
        this.autoDetectCourtInBrowser(true);
      } else {
        this.drawCalibrationCanvas();
      }
    });

    if (autoDetectBtn) {
      autoDetectBtn.addEventListener('click', () => this.runServerAutoCalibrate());
    }
    if (presetBroadcastBtn) {
      presetBroadcastBtn.addEventListener('click', () => this.applyAnglePreset('broadcast'));
    }
    if (presetTripodBtn) {
      presetTripodBtn.addEventListener('click', () => this.applyAnglePreset('tripod'));
    }
    if (presetAngledBtn) {
      presetAngledBtn.addEventListener('click', () => this.applyAnglePreset('angled'));
    }
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startFullAnalysis());
    }
    if (this.bannerStopBtn) {
      this.bannerStopBtn.addEventListener('click', () => this.stopActiveAnalysis());
    }

    this.bindCanvasPointerEvents();
  }

  initFloatingConverterBubble() {
    const fab = this.fabEl;
    if (!fab) return;

    const EDGE_MARGIN = 12;
    const clampTop = (y) => {
      const maxTop = Math.max(70, window.innerHeight - 96);
      return Math.max(64, Math.min(maxTop, y));
    };

    const applySavedPos = () => {
      try {
        const raw = localStorage.getItem('hawkview_yt_fab_pos');
        if (raw) {
          const saved = JSON.parse(raw);
          const side = saved.side === 'left' ? 'left' : 'right';
          const topPx = clampTop(Number(saved.top) || 120);
          fab.style.top = `${topPx}px`;
          if (side === 'left') {
            fab.style.left = `${EDGE_MARGIN}px`;
            fab.style.right = 'auto';
          } else {
            fab.style.left = `${Math.max(EDGE_MARGIN, window.innerWidth - fab.offsetWidth - EDGE_MARGIN)}px`;
            fab.style.right = 'auto';
          }
          return;
        }
      } catch (e) {}
      fab.style.top = `${clampTop(116)}px`;
      fab.style.left = `${Math.max(EDGE_MARGIN, window.innerWidth - 62 - EDGE_MARGIN)}px`;
      fab.style.right = 'auto';
    };

    applySavedPos();
    window.addEventListener('resize', () => {
      if (!fab.classList.contains('is-dragging')) applySavedPos();
    });

    const armIdleFade = () => {
      if (this._fabIdleTimer) clearTimeout(this._fabIdleTimer);
      fab.classList.remove('is-idle');
      if (this._fabMode === 'idle') {
        this._fabIdleTimer = setTimeout(() => {
          if (this._fabMode === 'idle' && (!this.modal || this.modal.classList.contains('hidden'))) {
            fab.classList.add('is-idle');
          }
        }, 3500);
      }
    };
    this._armFabIdleFade = armIdleFade;
    armIdleFade();

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    fab.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      armIdleFade();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = fab.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    });

    fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 6) {
        moved = true;
        fab.classList.add('is-dragging');
      }
      if (!moved) return;
      const nextLeft = Math.max(6, Math.min(window.innerWidth - fab.offsetWidth - 6, origLeft + dx));
      const nextTop = Math.max(52, Math.min(window.innerHeight - fab.offsetHeight - 16, origTop + dy));
      fab.style.left = `${Math.round(nextLeft)}px`;
      fab.style.top = `${Math.round(nextTop)}px`;
    });

    const finishDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      fab.classList.remove('is-dragging');
      try { if (e && e.pointerId !== undefined) fab.releasePointerCapture(e.pointerId); } catch (err) {}

      if (moved) {
        const rect = fab.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const side = centerX < window.innerWidth / 2 ? 'left' : 'right';
        const snappedLeft = side === 'left' ? EDGE_MARGIN : Math.max(EDGE_MARGIN, window.innerWidth - fab.offsetWidth - EDGE_MARGIN);
        const snappedTop = clampTop(rect.top);
        fab.style.left = `${Math.round(snappedLeft)}px`;
        fab.style.top = `${Math.round(snappedTop)}px`;
        try {
          localStorage.setItem('hawkview_yt_fab_pos', JSON.stringify({ side, top: Math.round(snappedTop) }));
        } catch (err) {}
        armIdleFade();
      } else {
        // Pure tap -> open clean YouTube -> 3D converter modal
        if (window.thumbStatsSheetInstance && typeof window.thumbStatsSheetInstance.closeSheet === 'function') {
          window.thumbStatsSheetInstance.closeSheet();
        }
        this.open();
      }
    };

    fab.addEventListener('pointerup', finishDrag);
    fab.addEventListener('pointercancel', finishDrag);
    fab.addEventListener('mouseenter', () => armIdleFade());
  }

  _fabPhaseShortLabel(stageText = '') {
    const s = String(stageText || '').toLowerCase();
    if (s.includes('upload')) return 'UP';
    if (s.includes('download') || s.includes('stream') || s.includes('youtube')) return 'DL';
    if (s.includes('gpu') || s.includes('blackwell') || s.includes('colab') || s.includes('tracknet')) return 'GPU';
    if (s.includes('rally') || s.includes('physics') || s.includes('3d') || s.includes('calib')) return '3D';
    if (s.includes('runner') || s.includes('boot') || s.includes('dispatch') || s.includes('connect')) return 'Cloud';
    return 'Live';
  }

  _renderFabProgressRing(pctVal) {
    const clamped = Math.max(0, Math.min(100, Number(pctVal) || 0));
    const CIRC = 175.93;
    if (this.fabFillEl) {
      this.fabFillEl.style.strokeDashoffset = (CIRC * (1 - clamped / 100)).toFixed(2);
    }
    if (this.fabPctEl) {
      this.fabPctEl.textContent = `${clamped.toFixed(2)}%`;
    }
    const modalPctEl = document.getElementById('calib-upload-progress-text');
    const modalFillEl = document.getElementById('calib-upload-progress-fill');
    if (this._fabMode === 'converting' && modalPctEl && this.modal && !this.modal.classList.contains('hidden')) {
      modalPctEl.textContent = `${clamped.toFixed(2)}%`;
      if (modalFillEl) modalFillEl.style.width = `${clamped.toFixed(2)}%`;
    }
  }

  setFabState(mode, pct = 0, stageText = '', detailText = '') {
    const fab = this.fabEl;
    this._fabMode = mode;
    if (stageText) this._fabLastStage = stageText;
    if (detailText) this._fabLastDetail = detailText;

    if (this._fabDoneTimer) {
      clearTimeout(this._fabDoneTimer);
      this._fabDoneTimer = null;
    }

    if (!fab) return;
    fab.classList.remove('is-converting', 'is-done', 'is-error');

    if (mode === 'idle') {
      if (this._fabTicker) { clearInterval(this._fabTicker); this._fabTicker = null; }
      this._fabDisplayPct = 0;
      this._fabTargetPct = 0;
      if (this.fabIconEl) this.fabIconEl.classList.remove('hidden');
      if (this.fabPctEl) this.fabPctEl.classList.add('hidden');
      if (this.fabSubEl) this.fabSubEl.textContent = '+ 3D';
      this._renderFabProgressRing(0);
      if (this._armFabIdleFade) this._armFabIdleFade();
      return;
    }

    fab.classList.remove('is-idle');

    if (mode === 'converting') {
      fab.classList.add('is-converting');
      const incoming = Math.max(0.5, Math.min(99.5, Number(pct) || 1));
      if (incoming > this._fabTargetPct + 0.05 || this._fabTargetPct === 0) {
        this._fabTargetPct = incoming;
        this._fabLastUpdateMs = Date.now();
      }
      if (this._fabDisplayPct < 0.25) {
        this._fabDisplayPct = Math.max(0.5, incoming - 0.8);
      }
      if (this.fabIconEl) this.fabIconEl.classList.add('hidden');
      if (this.fabPctEl) this.fabPctEl.classList.remove('hidden');
      if (this.fabSubEl) this.fabSubEl.textContent = this._fabPhaseShortLabel(stageText);
      this._renderFabProgressRing(this._fabDisplayPct);

      if (!this._fabTicker) {
        this._fabTicker = setInterval(() => {
          if (this._fabMode !== 'converting') {
            clearInterval(this._fabTicker);
            this._fabTicker = null;
            return;
          }
          const silentMs = Date.now() - this._fabLastUpdateMs;
          // Smoothly catch up to real backend target, then gently creep up to +4.5% cap while backend is alive
          const creepCap = Math.min(99.4, this._fabTargetPct + 4.5);
          if (this._fabDisplayPct < this._fabTargetPct) {
            const step = Math.max(0.08, (this._fabTargetPct - this._fabDisplayPct) * 0.14);
            this._fabDisplayPct = Math.min(this._fabTargetPct, this._fabDisplayPct + step);
          } else if (silentMs < 90000 && this._fabDisplayPct < creepCap) {
            this._fabDisplayPct = Math.min(creepCap, this._fabDisplayPct + 0.03);
          } else if (silentMs >= 90000 && this.fabSubEl) {
            this.fabSubEl.textContent = 'Wait';
          }
          this._renderFabProgressRing(this._fabDisplayPct);
        }, 120);
      }
      return;
    }

    if (this._fabTicker) { clearInterval(this._fabTicker); this._fabTicker = null; }

    if (mode === 'done' || mode === 'cached') {
      fab.classList.add('is-done');
      this._fabDisplayPct = 100;
      this._fabTargetPct = 100;
      if (this.fabIconEl) this.fabIconEl.classList.add('hidden');
      if (this.fabPctEl) {
        this.fabPctEl.classList.remove('hidden');
        this.fabPctEl.textContent = mode === 'cached' ? 'Cached' : '100.00%';
      }
      if (this.fabSubEl) this.fabSubEl.textContent = mode === 'cached' ? 'Instant' : 'Done';
      if (this.fabFillEl) this.fabFillEl.style.strokeDashoffset = '0.00';
      this._fabDoneTimer = setTimeout(() => {
        if (this._fabMode === 'done' || this._fabMode === 'cached') this.setFabState('idle');
      }, mode === 'cached' ? 2600 : 4500);
      return;
    }

    if (mode === 'error') {
      fab.classList.add('is-error');
      if (this.fabIconEl) this.fabIconEl.classList.add('hidden');
      if (this.fabPctEl) {
        this.fabPctEl.classList.remove('hidden');
        this.fabPctEl.textContent = 'Error';
      }
      if (this.fabSubEl) this.fabSubEl.textContent = 'Tap';
    }
  }

  async startCloudMp4Upload(file) {
    if (!file) return;
    if (this._cloudMp4Uploading) return;

    const maxBytes = 320 * 1024 * 1024;
    if (file.size > maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(0);
      this.setStatusPill(`File is ${mb} MB (max 320 MB for cloud upload). Trim to a shorter clip or 720p/1080p.`, false);
      this.setFabState('error', 100, 'File Too Large', `Max 320 MB (got ${mb} MB)`);
      return;
    }

    const convertBtn = document.getElementById('btn-cloud-mp4-convert');
    const maxRalliesEl = document.getElementById('cloud-mp4-max-rallies');
    const parsedMax = maxRalliesEl ? parseInt(maxRalliesEl.value, 10) : 6;
    const reqMaxRallies = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 6;

    this._cloudMp4Uploading = true;
    if (convertBtn) convertBtn.disabled = true;

    // Keep local Blob URL so the uploaded phone/Mac MP4 plays 1:1 synced right when Cloud GPU finishes!
    try {
      if (this._localBlobUrl) URL.revokeObjectURL(this._localBlobUrl);
    } catch (e) {}
    this._localBlobUrl = URL.createObjectURL(file);
    this.pendingVideoSrc = this._localBlobUrl;

    const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB binary chunks (safely below 6 MB Lambda limit)
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const randPart = Math.random().toString(36).slice(2, 8);
    const uploadId = `mp4_${Date.now().toString(36)}_${randPart}`;

    this.close();
    this.setFabState('converting', 1.5, 'Uploading MP4', `Uploading ${file.name} (0/${totalChunks})...`);
    this.setYouTubeProgressUI(true, 1.5, `Uploading ${file.name}...`, '1.50%');

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const slice = file.slice(start, end);
        const chunkUrl = this.getApiUrl(
          `/api/cloud-upload-chunk?upload_id=${encodeURIComponent(uploadId)}&chunk_index=${i}&total_chunks=${totalChunks}`
        );

        let uploaded = false;
        let lastErr = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const resp = await fetch(chunkUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: slice
            });
            if (resp.ok) {
              uploaded = true;
              break;
            }
            const errBody = await resp.json().catch(() => ({}));
            lastErr = errBody.error || `HTTP ${resp.status}`;
          } catch (netErr) {
            lastErr = (netErr && netErr.message) || 'Network error';
          }
          await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
        }

        if (!uploaded) {
          throw new Error(`Upload failed on chunk ${i + 1}/${totalChunks}: ${lastErr}`);
        }

        const upPct = 1.5 + 17.5 * ((i + 1) / totalChunks); // 1.50% -> 19.00%
        this.setFabState('converting', upPct, 'Uploading MP4', `Uploaded ${i + 1}/${totalChunks} chunks (${file.name})`);
        this.setYouTubeProgressUI(true, upPct, `Uploading MP4 (${i + 1}/${totalChunks})...`, `${upPct.toFixed(2)}%`);
      }

      // Dispatch Cloud GPU runner
      this.setFabState('converting', 19.5, 'Dispatching Cloud GPU', `Starting 3D reconstruction for ${file.name}...`);
      const startResp = await fetch(this.getApiUrl('/api/cloud-upload-start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_id: uploadId,
          total_chunks: totalChunks,
          filename: file.name,
          max_rallies: reqMaxRallies
        })
      });
      const startData = await startResp.json().catch(() => ({}));
      if (!startResp.ok || !startData.job_id) {
        throw new Error(startData.error || `Cloud GPU dispatch failed (HTTP ${startResp.status})`);
      }

      this.saveActiveCloudJob({
        job_id: startData.job_id,
        video_id: '',
        match_id: startData.match_id || '',
        filename: file.name,
        started_at: Date.now()
      });
      this.startCloudJobPolling(startData.job_id, '', startData.match_id || '');
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'MP4 cloud upload failed.';
      this.setFabState('error', 100, 'Upload Failed', msg);
      this.setYouTubeProgressUI(true, 100, 'Upload Failed', 'Error', true);
      this.setStatusPill(msg, false);
    } finally {
      this._cloudMp4Uploading = false;
      if (convertBtn) convertBtn.disabled = false;
    }
  }

  saveActiveCloudJob(info) {
    try {
      if (info) localStorage.setItem('hawkview_active_cloud_job', JSON.stringify(info));
      else localStorage.removeItem('hawkview_active_cloud_job');
    } catch (e) {}
  }

  resumeSavedCloudJob() {
    let saved = null;
    try {
      const raw = localStorage.getItem('hawkview_active_cloud_job');
      if (raw) saved = JSON.parse(raw);
    } catch (e) {}
    if (!saved || !saved.job_id) return;
    // Ignore stale jobs older than 18 minutes
    if (Date.now() - Number(saved.started_at || 0) > 18 * 60 * 1000) {
      this.saveActiveCloudJob(null);
      return;
    }
    this.startCloudJobPolling(saved.job_id, saved.video_id || '', saved.match_id || '');
  }

  startCloudJobPolling(jobId, videoId, matchIdHint = '') {
    if (!jobId) return;
    const token = ++this._loadToken;
    if (this._ytPollTimer) {
      clearInterval(this._ytPollTimer);
      this._ytPollTimer = null;
    }
    this.hasSwitchedToNewMatch = false;
    this.lastStreamedRallyCount = -1;
    this.setFabState('converting', 5.0, 'Dispatching Cloud Runner', `Converting ${videoId}...`);

    const poll = async () => {
      if (token !== this._loadToken) {
        clearInterval(this._ytPollTimer);
        this._ytPollTimer = null;
        return;
      }
      try {
        const rSt = await fetch(this.getApiUrl(`/api/import-youtube-status?job_id=${encodeURIComponent(jobId)}`), { cache: 'no-store' });
        if (rSt.status === 404) {
          this.saveActiveCloudJob(null);
          clearInterval(this._ytPollTimer);
          this._ytPollTimer = null;
          this.setFabState('idle');
          return;
        }
        const st = await rSt.json().catch(() => null);
        if (!st) return;

        if (st.status === 'error') {
          this.saveActiveCloudJob(null);
          clearInterval(this._ytPollTimer);
          this._ytPollTimer = null;
          const msg = st.error || st.message || 'Cloud conversion failed.';
          this.setFabState('error', 100, st.stage || 'Conversion Error', msg);
          this.setYouTubeProgressUI(true, 100, st.stage || 'Conversion Error', 'Failed', true);
          this.setStatusPill(msg, false);
          this.showBanner(st.stage || 'Conversion Error', msg, 100, false);
          return;
        }

        const pctNow = Number(st.percent) || 8;
        this.setFabState('converting', pctNow, st.stage || 'Converting in Cloud', st.message || '');
        this.setYouTubeProgressUI(true, pctNow, st.stage || 'Converting in Cloud', `${pctNow.toFixed(2)}%`);
        this.showBanner(
          st.stage || 'Converting in Cloud',
          st.message || `Processing ${videoId}...`,
          pctNow,
          st.status !== 'completed' && st.status !== 'ready'
        );

        if (st.telemetry) {
          const matchId = st.match_id || matchIdHint || `yt_${videoId}`;
          const tel = st.telemetry;
          if (tel.source && videoId && !tel.source.yt_video_id) {
            tel.source.yt_video_id = videoId;
          }
          const rDone = Number(st.rallies_completed || (tel.rallies || []).length);
          if (rDone >= 1 && rDone !== this.lastStreamedRallyCount) {
            this.lastStreamedRallyCount = rDone;
            if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
            window.HAWKVIEW_MATCHES[matchId] = tel;
            if (window.cacheStoreInstance) {
              window.cacheStoreInstance.saveMatchTelemetry(matchId, tel);
              window.cacheStoreInstance.updateTopbarHeader(matchId, tel);
            }
            if (!this.hasSwitchedToNewMatch) {
              this.activateNewMatchInWorkspace(matchId, tel);
            } else {
              window.HAWKVIEW_TELEMETRY = tel;
              window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;
              window.dispatchEvent(new CustomEvent('hawkview:ralliesStreamUpdated', {
                detail: { matchKey: matchId, telemetry: tel, ralliesCompleted: rDone, ralliesTotal: st.rallies_total || rDone }
              }));
            }
          }
        }

        if (st.status === 'completed' || st.status === 'ready') {
          this.saveActiveCloudJob(null);
          clearInterval(this._ytPollTimer);
          this._ytPollTimer = null;
          this.setFabState('done', 100, '3D Match Ready', st.message || '');
          this.setYouTubeProgressUI(false);
          if (window.cacheStoreInstance) {
            window.cacheStoreInstance.refreshMatchesAndQuota(false);
          }
          this.showBanner(
            'Cloud 3D Conversion Complete',
            st.message || 'Synced with YouTube player',
            100,
            false
          );
        }
      } catch (e) {}
    };

    poll();
    this._ytPollTimer = setInterval(poll, 2200);
  }

  open() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');

    // Keep live conversion / error details visible if a cloud job is running or just errored;
    // otherwise reset stale progress bar so the modal opens calm & clean
    if (this._fabMode === 'error') {
      this.setYouTubeProgressUI(true, 100, this._fabLastStage || 'Conversion Error', 'Failed', true);
      if (this._fabLastDetail) this.setStatusPill(this._fabLastDetail, false);
    } else if (this._fabMode === 'converting') {
      this.setYouTubeProgressUI(true, this._fabDisplayPct, this._fabLastStage || 'Converting in Cloud...', `${this._fabDisplayPct.toFixed(2)}%`);
      if (this._fabLastDetail) this.setStatusPill(this._fabLastDetail, true);
    } else if (!this._ytPollTimer && !this.isUploading) {
      this.setYouTubeProgressUI(false);
      this.setStatusPill('Upload any MP4 from your phone or paste a cached YouTube link · Runs on Cloud GPU', true);
    }
    if (this.bannerEl && !this.activePollTimer && !this._ytPollTimer) {
      this.bannerEl.classList.add('hidden');
    }

    // Only load a local MP4 preview if an actual local video src exists (prevents 404 on Netlify cloud)
    const currentSrc = this.player && this.player.videoElement ? this.player.videoElement.getAttribute('src') : null;
    if (currentSrc && !this.previewVideo.getAttribute('src')) {
      this.loadServerVideoIntoPreview(currentSrc, 15.0);
    } else if (this.previewVideo.getAttribute('src')) {
      this.drawCalibrationCanvas();
    }
  }

  openWithFile(file) {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    if (file) {
      this.uploadFileToServer(file);
    } else {
      this.open();
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    if (this._armFabIdleFade) this._armFabIdleFade();
  }

  setStatusPill(text, isGood = true) {
    if (!this.statusPillEl) return;
    this.statusPillEl.textContent = text;
    this.statusPillEl.style.color = isGood ? 'var(--shot-continue)' : 'var(--shot-selected)';
  }

  getApiUrl(path) {
    const base = window.HAWKVIEW_API_BASE;
    if (
      typeof base === 'string' &&
      base.length > 0 &&
      !base.includes('.trycloudflare.com') &&
      !base.includes('.lhr.life')
    ) {
      return `${base}${path}`;
    }
    return path;
  }

  async refreshTunnelUrl() {
    // Cloud-native: Netlify uses same-origin Netlify Functions, never a local Mac tunnel
    return '';
  }

  parsePlayersFromFilenameClient(filename) {
    const stem = String(filename || '').replace(/\.[^.]+$/, '');
    const lower = stem.toLowerCase();
    if (lower.includes('an se young') && (lower.includes('sindhu') || lower.includes('pusarla'))) {
      return { near: 'AN S.Y.', far: 'P.V. SINDHU', isDoubles: false };
    }
    if (lower.includes('iwanaga') && (lower.includes('tan') || lower.includes('muralitharan') || lower.includes('thinaah'))) {
      return { near: 'IWANAGA / NAKANISHI', far: 'TAN / THINAAH', isDoubles: true };
    }
    // Check Doubles pattern: "PlayerA1_PlayerA2 vs PlayerB1_PlayerB2" or "PlayerA1 / PlayerA2 vs PlayerB1 / PlayerB2"
    const cleanStem = stem.split(/\s+[_|—–-]\s+/)[0].replace(/\s*-\s*\(\d+p\).*$/i, '').trim();
    const vsParts = cleanStem.split(/\s+(?:vs\.?|v\.?)\s+/i);
    if (vsParts.length >= 2) {
      const formatSide = (raw) => {
        const s = raw.trim();
        if (/[\/&_]/.test(s)) {
          const pair = s.split(/[\/&_]+/).map((p) => {
            const toks = p.trim().split(/\s+/).filter(Boolean);
            return (toks[toks.length - 1] || p.trim()).toUpperCase();
          }).filter(Boolean);
          if (pair.length >= 2) {
            return { label: `${pair[0]} / ${pair[1]}`, isDoubles: true };
          }
        }
        const toks = s.split(/\s+/).filter(Boolean);
        return { label: (toks[toks.length - 1] || s).toUpperCase(), isDoubles: false };
      };
      const sideA = formatSide(vsParts[0]);
      const sideB = formatSide(vsParts[1]);
      return {
        near: sideA.label || 'NEAR PLAYER',
        far: sideB.label || 'FAR PLAYER',
        isDoubles: Boolean(sideA.isDoubles || sideB.isDoubles)
      };
    }
    const looksLikeDoubles = /(doubles|2v2|\bmd\b|\bwd\b|\bxd\b|&)/.test(lower);
    return {
      near: looksLikeDoubles ? 'NEAR PAIR' : 'NEAR PLAYER',
      far: looksLikeDoubles ? 'FAR PAIR' : 'FAR PLAYER',
      isDoubles: looksLikeDoubles
    };
  }

  setYouTubeProgressUI(visible, pct = 0, stageText = '', detailText = '', isError = false) {
    const wrapEl = document.getElementById('calib-upload-progress-wrap');
    const fillEl = document.getElementById('calib-upload-progress-fill');
    const textEl = document.getElementById('calib-upload-progress-text');
    const labelEl = document.getElementById('calib-upload-progress-label');
    if (!wrapEl) return;
    if (!visible) {
      wrapEl.classList.add('hidden');
      return;
    }
    wrapEl.classList.remove('hidden');
    const clampedPct = Math.max(0.5, Math.min(100, Number(pct) || 0));
    if (fillEl) {
      fillEl.style.width = `${clampedPct.toFixed(2)}%`;
      fillEl.style.background = isError
        ? 'var(--shot-error)'
        : 'linear-gradient(90deg, #2563eb, #10b981)';
    }
    if (labelEl) {
      labelEl.textContent = stageText || 'Importing YouTube Video...';
    }
    if (textEl) {
      textEl.textContent = detailText || `${clampedPct.toFixed(2)}%`;
      textEl.style.color = isError ? 'var(--shot-error)' : 'var(--shot-continue)';
    }
  }

  async importYouTubeUrl(autoStart = true, overrideUrl = null) {
    if (this._ytRequestInFlight) return;
    const urlInput = document.getElementById('calib-youtube-url');
    const topbarYtInput = document.getElementById('topbar-yt-url');
    const autoBtn = document.getElementById('btn-yt-auto-convert');
    const prevBtn = document.getElementById('btn-yt-preview');
    const topbarGoBtn = document.getElementById('btn-topbar-yt-go');
    const rawUrl = String(
      overrideUrl !== null ? overrideUrl : (urlInput ? urlInput.value : '')
    ).trim();
    if (!rawUrl) {
      this.setStatusPill('⚠️ Paste a BWF YouTube URL first (e.g. https://youtu.be/hiUDiIaQjxA)', false);
      if (urlInput) urlInput.focus();
      return;
    }

    if (this._ytPollTimer) {
      clearInterval(this._ytPollTimer);
      this._ytPollTimer = null;
    }

    this._loadToken = (this._loadToken || 0) + 1;
    const token = this._loadToken;
    this._serverCalibApplied = false;
    this._pendingBrowserAutoCalib = false;
    this._userEditedPlayers = false;
    this.selectedFile = null;
    this.localBlobUrl = null;
    this.isKnownBundledMatch = false;

    const maxRalliesEl = document.getElementById('calib-max-rallies');
    const parsedMax = maxRalliesEl ? parseInt(maxRalliesEl.value, 10) : 6;
    const reqMaxRallies = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 6;

    const sheetYtGoBtn = document.getElementById('btn-sheet-yt-go');
    const setBtnsDisabled = (disabled) => {
      this._ytRequestInFlight = disabled;
      if (autoBtn) autoBtn.disabled = disabled;
      if (prevBtn) prevBtn.disabled = disabled;
      if (topbarGoBtn) topbarGoBtn.disabled = disabled;
      if (sheetYtGoBtn) sheetYtGoBtn.disabled = disabled;
    };
    setBtnsDisabled(true);
    this.setFabState('converting', 2.5, 'Checking Cloud Cache', 'Validating YouTube URL...');
    this.setYouTubeProgressUI(true, 2.5, 'Checking Cloud Cache...', '2.50%');
    this.setStatusPill('Checking cloud cache & connecting...', true);
    this.showBanner('Checking Cloud Cache...', 'Validating YouTube URL...', 2.5, true);

    try {
      const resp = await fetch(this.getApiUrl('/api/import-youtube'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, max_rallies: reqMaxRallies })
      });

      const startData = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errMsg = startData.error || `Server rejected YouTube URL (HTTP ${resp.status})`;
        setBtnsDisabled(false);
        this.setFabState('error', 100, 'Invalid YouTube URL', errMsg);
        this.setYouTubeProgressUI(true, 100, 'Invalid YouTube URL', startData.error_code || 'Error', true);
        this.setStatusPill(errMsg, false);
        this.showBanner('YouTube URL Error', errMsg, 100, false);
        return;
      }

      // MODE 1: Instant Cloud Cache Hit (Netlify Blobs / Static CDN -> <0.5s 3D + YouTube IFrame!)
      if (startData.instant && startData.telemetry) {
        setBtnsDisabled(false);
        this.saveActiveCloudJob(null);
        const matchId = startData.match_id || `yt_${startData.video_id}`;
        const tel = startData.telemetry;
        if (tel.source && startData.video_id && !tel.source.yt_video_id) {
          tel.source.yt_video_id = startData.video_id;
        }
        this.pendingVideoSrc = (tel.source && tel.source.video) || '';
        this.close();
        if (topbarYtInput) topbarYtInput.value = '';
        if (window.cacheStoreInstance) {
          window.cacheStoreInstance.saveMatchTelemetry(matchId, tel);
          window.cacheStoreInstance.updateTopbarHeader(matchId, tel);
        }
        this.setYouTubeProgressUI(false);
        this.setFabState('cached', 100, 'Loaded from Cloud Cache', '');
        this.activateNewMatchInWorkspace(matchId, tel);
        const rCnt = (tel.rallies || []).length;
        const sCnt = (tel.rallies || []).reduce((a, r) => a + ((r.shots || []).length), 0);
        this.showBanner(
          'Loaded from Cloud Cache',
          `${rCnt} rallies · ${sCnt} shots synced with YouTube`,
          100,
          false
        );
        setTimeout(() => {
          if (this.bannerEl && !this.activePollTimer && !this._ytPollTimer) this.bannerEl.classList.add('hidden');
        }, 3200);
        return;
      }

      if (!startData.job_id) {
        const errMsg = startData.error || 'Server did not return a job ID.';
        setBtnsDisabled(false);
        this.setFabState('error', 100, 'YouTube Import Error', errMsg);
        this.setYouTubeProgressUI(true, 100, 'YouTube Import Error', 'Error', true);
        this.setStatusPill(errMsg, false);
        this.showBanner('YouTube Import Error', errMsg, 100, false);
        return;
      }

      const jobId = startData.job_id;
      const isCloudAsync = startData.mode === 'cloud_async';
      if (isCloudAsync) {
        this.close();
        setBtnsDisabled(false);
        this.pendingVideoSrc = '';
        const switchReadyBtn = document.getElementById('btn-banner-switch-ready');
        if (switchReadyBtn) switchReadyBtn.classList.add('hidden');
        this.saveActiveCloudJob({
          job_id: jobId,
          video_id: startData.video_id || '',
          match_id: startData.match_id || `yt_${startData.video_id || ''}`,
          url: rawUrl,
          started_at: Date.now()
        });
        this.startCloudJobPolling(jobId, startData.video_id || '', startData.match_id || '');
        return;
      }

      const pollStatus = async () => {
        if (token !== this._loadToken) {
          clearInterval(this._ytPollTimer);
          this._ytPollTimer = null;
          return;
        }
        try {
          const stPath = `/api/import-youtube-status?job_id=${encodeURIComponent(jobId)}`;
          const rSt = await fetch(this.getApiUrl(stPath), { cache: 'no-store' });
          const st = await rSt.json().catch(() => null);
          if (!st) return;

          if (st.status === 'error') {
            clearInterval(this._ytPollTimer);
            this._ytPollTimer = null;
            setBtnsDisabled(false);
            const msg = st.error || st.message || 'YouTube download failed.';
            const shortTag = st.error_code === 'youtube_auth_required'
              ? 'Sign-in / cookies required'
              : (st.error_code || 'Download error');
            this.setYouTubeProgressUI(true, 100, `❌ ${st.stage || 'YouTube Import Error'}`, shortTag, true);
            this.setStatusPill(`❌ ${msg}`, false);
            this.showBanner(`❌ ${st.stage || 'Cloud Conversion Error'}`, msg, 100, false);
            return;
          }

          const pctNow = Number(st.percent) || 10;
          this.setYouTubeProgressUI(true, pctNow, st.stage || 'Importing YouTube...', st.message || '');
          if (isCloudAsync) {
            this.showBanner(
              st.stage || '☁️ Converting YouTube in Cloud...',
              st.message || `Processing ${startData.video_id}...`,
              pctNow,
              st.status !== 'completed' && st.status !== 'ready'
            );
          }

          // MODE 2: Cloud Async (GitHub Actions -> Netlify Blobs streaming telemetry!)
          if (isCloudAsync && st.telemetry) {
            const matchId = st.match_id || startData.match_id;
            const tel = st.telemetry;
            if (tel.source && startData.video_id && !tel.source.yt_video_id) {
              tel.source.yt_video_id = startData.video_id;
            }
            const rDone = Number(st.rallies_completed || (tel.rallies || []).length);
            if (rDone >= 1 && rDone !== this.lastStreamedRallyCount) {
              this.lastStreamedRallyCount = rDone;
              if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
              window.HAWKVIEW_MATCHES[matchId] = tel;
              if (window.cacheStoreInstance) {
                window.cacheStoreInstance.saveMatchTelemetry(matchId, tel);
                window.cacheStoreInstance.updateTopbarHeader(matchId, tel);
              }
              if (!this.hasSwitchedToNewMatch) {
                this.activateNewMatchInWorkspace(matchId, tel);
              } else {
                window.HAWKVIEW_TELEMETRY = tel;
                window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;
                window.dispatchEvent(new CustomEvent('hawkview:ralliesStreamUpdated', {
                  detail: { matchKey: matchId, telemetry: tel, ralliesCompleted: rDone, ralliesTotal: st.rallies_total || rDone }
                }));
              }
            }
            if (st.status === 'completed' || st.status === 'ready') {
              clearInterval(this._ytPollTimer);
              this._ytPollTimer = null;
              setBtnsDisabled(false);
              if (topbarYtInput) topbarYtInput.value = '';
              if (window.cacheStoreInstance) {
                window.cacheStoreInstance.refreshMatchesAndQuota(false);
              }
              this.showBanner(
                '✅ Cloud 3D Conversion Complete',
                st.message || `${rDone} rallies synced with YouTube player`,
                100,
                false
              );
              return;
            }
            return;
          }

          // MODE 3: Local Server (`server.py` downloaded MP4 & probed keypoints -> launch local analysis!)
          if (st.status === 'ready' && st.probe_info) {
            clearInterval(this._ytPollTimer);
            this._ytPollTimer = null;
            setBtnsDisabled(false);

            const info = st.probe_info;
            const displayTitle = info.yt_title || info.video_path.split('/').pop();
            this.uploadedFileName = displayTitle;
            this.videoPath = info.video_path;
            this.matchId = info.match_id || startData.match_id;
            this.serverFrameImg = null;
            this.previewVideo.src = info.video_path;
            this.previewVideo.load();
            this.applyProbedVideoInfo(info, displayTitle);

            const cal = info.calibration_preview || {};
            const cachedTag = info.yt_cached ? 'cached 1080p' : 'downloaded 1080p';
            this.setYouTubeProgressUI(
              true,
              100,
              `✓ Imported (${cachedTag})`,
              `${displayTitle} · ${info.width}×${info.height} @ ${info.fps}fps`,
              false
            );

            if (autoStart) {
              if (cal.auto_refined) {
                this.setStatusPill(
                  `✓ Auto-calibrated ${info.width}×${info.height} BWF court (RMSE ${cal.line_sample_rmse_px}px) — launching 3D pipeline...`,
                  true
                );
                setTimeout(() => {
                  if (token === this._loadToken) {
                    this.startFullAnalysis();
                  }
                }, 350);
              } else {
                this.setStatusPill(
                  `⚠️ Downloaded ${info.width}×${info.height}, but court auto-calibration needs review (possible replay/non-standard angle). Scrub to a clear court frame, click Auto-Detect Lines, then Start.`,
                  false
                );
              }
            }
          }
        } catch (ePoll) {}
      };

      await pollStatus();
      if (token === this._loadToken && !this._serverCalibApplied && (!isCloudAsync || !this.hasSwitchedToNewMatch || this._ytPollTimer === null)) {
        this._ytPollTimer = setInterval(pollStatus, isCloudAsync ? 2500 : 600);
      }
    } catch (err) {
      setBtnsDisabled(false);
      const errMsg = (err && err.message) ? err.message : 'Cannot reach Hawkview API for YouTube import.';
      this.setYouTubeProgressUI(true, 100, '❌ Backend Unreachable', errMsg, true);
      this.setStatusPill(`❌ ${errMsg}`, false);
      this.showBanner('❌ YouTube Import Failed', errMsg, 100, false);
    }
  }

  setUploadProgressUI(visible, pct = 0, curChunk = 0, totalChunks = 0, speedMBps = null, doneText = null) {
    const wrapEl = document.getElementById('calib-upload-progress-wrap');
    const fillEl = document.getElementById('calib-upload-progress-fill');
    const textEl = document.getElementById('calib-upload-progress-text');
    const labelEl = document.getElementById('calib-upload-progress-label');
    if (!wrapEl) return;
    if (!visible) {
      wrapEl.classList.add('hidden');
      return;
    }
    wrapEl.classList.remove('hidden');
    const clampedPct = Math.max(0, Math.min(100, Math.round(pct)));
    if (fillEl) {
      fillEl.style.width = `${clampedPct}%`;
    }
    if (labelEl) {
      labelEl.textContent = doneText ? '✓ Upload Complete' : 'Uploading MP4 to Local Engine...';
    }
    if (textEl) {
      if (doneText) {
        textEl.textContent = doneText;
      } else {
        const speedStr = (typeof speedMBps === 'number' && speedMBps > 0.05) ? ` · ${speedMBps.toFixed(1)} MB/s` : '';
        textEl.textContent = `${clampedPct}% (${curChunk}/${totalChunks} chunks${speedStr})`;
      }
    }
  }

  async uploadFileChunked(file, onProgress = null) {
    if (!file) return null;
    const fileKey = `${file.name}::${file.size || 0}::${this.matchId || ''}`;
    if (onProgress) {
      this._uploadProgressListeners = this._uploadProgressListeners || [];
      this._uploadProgressListeners.push(onProgress);
    }
    if (this._activeUploadPromise && this._activeUploadFileKey === fileKey) {
      return this._activeUploadPromise;
    }

    this._activeUploadFileKey = fileKey;
    if (!onProgress) {
      this._uploadProgressListeners = [];
    } else {
      this._uploadProgressListeners = [onProgress];
    }

    const notifyProgress = (pct, cur, total, info) => {
      const listeners = this._uploadProgressListeners || [];
      for (const fn of listeners) {
        try { fn(pct, cur, total, info); } catch (e) {}
      }
    };

    const runUpload = async () => {
      const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks for fast, resilient mobile + Cloudflare tunnel streaming
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      await this.refreshTunnelUrl();

      // Check resumable/idempotent upload status on server first
      let startChunk = 0;
      try {
        const qs = `match_id=${encodeURIComponent(this.matchId || '')}&file_size=${encodeURIComponent(file.size || 0)}&chunk_size=${CHUNK_SIZE}&filename=${encodeURIComponent(file.name)}`;
        const statusResp = await fetch(this.getApiUrl(`/api/upload-status?${qs}`), { cache: 'no-store' });
        if (statusResp && statusResp.ok) {
          const st = await statusResp.json();
          if (st && st.match_id && !this.isKnownBundledMatch) {
            this.matchId = st.match_id;
          }
          if (st && st.already_uploaded && st.probe_info) {
            notifyProgress(100, totalChunks, totalChunks, st.probe_info);
            return st.probe_info;
          }
          if (st && typeof st.next_chunk === 'number' && st.next_chunk > 0 && st.next_chunk < totalChunks) {
            startChunk = st.next_chunk;
          }
        }
      } catch (eStatus) {}

      let lastInfo = null;
      const backoffMs = [0, 300, 900, 2000];
      for (let idx = startChunk; idx < totalChunks; idx++) {
        const start = idx * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkLen = end - start;
        let chunkBuf = null;
        try {
          chunkBuf = await file.slice(start, end).arrayBuffer();
        } catch (eSlice) {
          chunkBuf = file.slice(start, end);
        }

        const headers = {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Size': String(file.size || 0),
          'X-Match-Id': String(this.matchId || ''),
          'X-Chunk-Index': String(idx),
          'X-Total-Chunks': String(totalChunks),
          'X-Chunk-Offset': String(start),
          'X-Chunk-Size': String(chunkLen)
        };

        let resp = null;
        let lastErr = '';
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt > 0) {
            const waitMs = backoffMs[attempt] || 1500;
            await new Promise((r) => setTimeout(r, waitMs));
            await this.refreshTunnelUrl();
          }
          try {
            const targetUrl = attempt === 3 ? '/api/upload-chunk' : this.getApiUrl('/api/upload-chunk');
            resp = await fetch(targetUrl, {
              method: 'POST',
              headers,
              body: chunkBuf
            });
            if (resp && resp.ok) break;
            lastErr = resp ? `HTTP ${resp.status}` : 'Network error';
          } catch (e) {
            resp = null;
            lastErr = (e && e.message) ? e.message : 'Connection dropped';
          }
        }

        if (!resp || !resp.ok) {
          throw new Error(`Chunk ${idx + 1}/${totalChunks} upload failed (${lastErr || 'Tunnel unreachable'})`);
        }

        lastInfo = await resp.json();
        if (lastInfo && lastInfo.error) {
          throw new Error(lastInfo.error);
        }

        const pct = Math.round(((idx + 1) / totalChunks) * 100);
        notifyProgress(pct, idx + 1, totalChunks, lastInfo);
      }
      return lastInfo;
    };

    this._activeUploadPromise = runUpload().finally(() => {
      this._activeUploadPromise = null;
      this._uploadProgressListeners = [];
    });
    return this._activeUploadPromise;
  }

  loadServerVideoIntoPreview(videoPath, initialTimeSec = 15.0) {
    this._loadToken = (this._loadToken || 0) + 1;
    const token = this._loadToken;
    this.videoPath = videoPath;
    this.previewVideo.src = videoPath;
    this.previewVideo.load();

    const fileLabelEl = document.getElementById('calib-active-filename');
    if (fileLabelEl) {
      fileLabelEl.textContent = videoPath.split('/').pop();
    }

    fetch(this.getApiUrl('/api/upload-video'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: videoPath, sample_time_sec: initialTimeSec })
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (token !== this._loadToken) return;
        if (info && !info.error) {
          this.applyProbedVideoInfo(info);
        }
      })
      .catch(() => {});
  }

  rescaleKeypointsToDimensions(newW, newH) {
    const prevW = this.videoWidth || 1920;
    const prevH = this.videoHeight || 1080;
    if (!newW || !newH || (newW === prevW && newH === prevH)) {
      return;
    }
    const sx = newW / prevW;
    const sy = newH / prevH;
    Object.keys(this.keypoints).forEach((k) => {
      const pt = this.keypoints[k];
      if (pt && pt.length >= 2) {
        this.keypoints[k] = [
          Math.round(pt[0] * sx * 10) / 10,
          Math.round(pt[1] * sy * 10) / 10
        ];
      }
    });
    this.videoWidth = newW;
    this.videoHeight = newH;
  }

  uploadFileToServer(file) {
    if (!file || this.isUploading) return;
    this._loadToken = (this._loadToken || 0) + 1;
    const token = this._loadToken;
    this.isUploading = true;
    this._serverCalibApplied = false;
    this._pendingBrowserAutoCalib = true;
    this._userEditedPlayers = false;
    this.serverFrameImg = null;

    const fileLabelEl = document.getElementById('calib-active-filename');
    if (fileLabelEl) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      fileLabelEl.textContent = `${file.name} (${mb} MB) — Loading...`;
    }
    this.setStatusPill('Loading MP4 into interactive court calibrator...', false);

    // Immediately preview locally via blob URL for instant responsiveness
    const localBlobUrl = URL.createObjectURL(file);
    this.localBlobUrl = localBlobUrl;
    this.videoPath = localBlobUrl;
    this.previewVideo.src = localBlobUrl;
    this.previewVideo.load();

    // Auto-fill player names, unique matchId & Singles/Doubles format hints
    this.uploadedFileName = file.name;
    const fnLower = file.name.toLowerCase();
    const nearInput = document.getElementById('calib-near-player');
    const farInput = document.getElementById('calib-far-player');
    const matchTypeSelect = document.getElementById('calib-match-type');

    if (fnLower.includes('antonsen') && (fnLower.includes('zii_jia') || fnLower.includes('lzj'))) {
      this.matchId = 'anders_antonsen_vs_lee_zii_jia___non-stop_action_from_beginning_to_end_-_1080p_66946';
      this.isKnownBundledMatch = true;
      if (nearInput) nearInput.value = 'LZJ';
      if (farInput) farInput.value = 'ANTONSEN';
      if (matchTypeSelect) matchTypeSelect.value = 'singles';
    } else if (fnLower.includes('lzj') && fnLower.includes('popov')) {
      this.matchId = 'lzj_popov';
      this.isKnownBundledMatch = true;
      if (nearInput) nearInput.value = 'POPOV';
      if (farInput) farInput.value = 'LZJ';
      if (matchTypeSelect) matchTypeSelect.value = 'singles';
    } else {
      // NEVER reuse 'lzj_popov' for a custom uploaded file! Generate a deterministic unique matchId.
      const baseSlug = fnLower
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'custom_match';
      this.matchId = `${baseSlug}_${Math.abs(file.size || 0) % 100000}`;
      this.isKnownBundledMatch = false;
      const parsedPlayers = this.parsePlayersFromFilenameClient(file.name);
      if (matchTypeSelect) {
        matchTypeSelect.value = parsedPlayers.isDoubles ? 'doubles' : 'auto';
      }
      if (nearInput) {
        nearInput.value = parsedPlayers.near;
      }
      if (farInput) {
        farInput.value = parsedPlayers.far;
      }
    }

    const modeSelect = document.getElementById('calib-camera-mode');
    if (modeSelect && !fnLower.includes('bwf') && !fnLower.includes('lzj')) {
      modeSelect.value = 'auto';
    }

    this.selectedFile = file;

    const handleBrowserFallback = () => {
      if (token !== this._loadToken) return;
      this.setUploadProgressUI(false);
      this.videoPath = localBlobUrl;
      if (this.previewVideo && this.previewVideo.videoWidth > 0) {
        this.rescaleKeypointsToDimensions(this.previewVideo.videoWidth, this.previewVideo.videoHeight);
      }
      if (fileLabelEl) {
        const mins = Math.floor((this.videoDuration || 0) / 60);
        const secs = Math.round((this.videoDuration || 0) % 60).toString().padStart(2, '0');
        fileLabelEl.textContent = `${file.name} · ${this.videoWidth}×${this.videoHeight} (${mins}:${secs})`;
      }
      if (this.previewVideo && this.previewVideo.readyState >= 2) {
        this._pendingBrowserAutoCalib = false;
        this.autoDetectCourtInBrowser(true);
      } else {
        this.setStatusPill(`✓ Loaded ${this.videoWidth}×${this.videoHeight} in browser mode — drag any of the 6 handles to calibrate court`, true);
        this.drawCalibrationCanvas();
      }
    };

    const uploadStartMs = performance.now();
    const totalChunksEst = Math.max(1, Math.ceil((file.size || 1) / (1024 * 1024)));
    this.setUploadProgressUI(true, 0, 0, totalChunksEst);

    this.uploadFileChunked(file, (pct, curChunk, totalChunks) => {
      if (token !== this._loadToken) return;
      const elapsedSec = Math.max(0.05, (performance.now() - uploadStartMs) / 1000);
      const speedMBps = curChunk / elapsedSec;
      this.setUploadProgressUI(true, pct, curChunk, totalChunks, speedMBps);
      if (fileLabelEl) {
        fileLabelEl.textContent = `Uploading ${file.name} (${pct}% · ${curChunk}/${totalChunks} chunks)...`;
      }
    })
      .then((info) => {
        this.isUploading = false;
        if (token !== this._loadToken) return;
        const totalChunksDone = Math.max(1, Math.ceil((file.size || 1) / (1024 * 1024)));
        this.setUploadProgressUI(true, 100, totalChunksDone, totalChunksDone, null, `100% (${totalChunksDone}/${totalChunksDone} chunks)`);
        setTimeout(() => {
          if (token === this._loadToken) {
            this.setUploadProgressUI(false);
          }
        }, 1800);
        if (info && !info.error) {
          this.applyProbedVideoInfo(info, file.name);
        } else {
          handleBrowserFallback();
        }
      })
      .catch(() => {
        this.isUploading = false;
        if (token !== this._loadToken) return;
        this.setUploadProgressUI(false);
        handleBrowserFallback();
      });
  }

  applyProbedVideoInfo(info, displayFilename = null) {
    this._serverCalibApplied = true;
    this._pendingBrowserAutoCalib = false;
    this.videoPath = info.video_path || this.videoPath;
    this.matchId = info.match_id || this.matchId;
    const newW = info.width || this.previewVideo.videoWidth || 1920;
    const newH = info.height || this.previewVideo.videoHeight || 1080;
    this.rescaleKeypointsToDimensions(newW, newH);
    this.videoWidth = newW;
    this.videoHeight = newH;
    this.videoFps = info.fps || 25.0;
    this.videoDuration = info.duration_sec || 60.0;

    if (this.canvas) {
      this.canvas.width = this.videoWidth;
      this.canvas.height = this.videoHeight;
    }

    const fileLabelEl = document.getElementById('calib-active-filename');
    if (fileLabelEl) {
      const nameStr = displayFilename || this.videoPath.split('/').pop();
      const mins = Math.floor(this.videoDuration / 60);
      const secs = Math.round(this.videoDuration % 60).toString().padStart(2, '0');
      fileLabelEl.textContent = `${nameStr} · ${this.videoWidth}×${this.videoHeight} @ ${this.videoFps}fps (${mins}:${secs})`;
    }

    if (info.frame_jpeg_b64) {
      const img = new Image();
      img.onload = () => {
        this.serverFrameImg = img;
        this.drawCalibrationCanvas();
      };
      img.src = info.frame_jpeg_b64;
    }

    const cal = info.calibration_preview;
    if (cal && cal.keypoints) {
      Object.keys(this.keypoints).forEach((k) => {
        if (cal.keypoints[k] && cal.keypoints[k].length >= 2) {
          this.keypoints[k] = [Number(cal.keypoints[k][0]), Number(cal.keypoints[k][1])];
        }
      });
      if (cal.auto_refined) {
        this.setStatusPill(`✓ Auto-calibrated ${this.videoWidth}×${this.videoHeight} BWF court (RMSE ${cal.line_sample_rmse_px}px) — drag any point to adjust`, true);
      } else {
        this.setStatusPill(`Calibrated for ${this.videoWidth}×${this.videoHeight} — drag the 4 Court Corners + 2 Net Posts to align with your court`, false);
      }
    }

    const nearInput = document.getElementById('calib-near-player');
    const farInput = document.getElementById('calib-far-player');
    const matchTypeSelect = document.getElementById('calib-match-type');
    if (!this._userEditedPlayers) {
      if (nearInput && info.suggested_near_player) {
        nearInput.value = info.suggested_near_player;
      }
      if (farInput && info.suggested_far_player) {
        farInput.value = info.suggested_far_player;
      }
      if (matchTypeSelect) {
        const isDbl = info.suggested_match_type === 'doubles' ||
          (info.suggested_near_player && /[\/&]/.test(info.suggested_near_player)) ||
          (info.suggested_far_player && /[\/&]/.test(info.suggested_far_player));
        if (isDbl) {
          matchTypeSelect.value = 'doubles';
        } else if (info.suggested_match_type === 'singles') {
          matchTypeSelect.value = 'singles';
        } else {
          matchTypeSelect.value = 'auto';
        }
      }
    }

    if (info.colab_quota && window.cacheStoreInstance) {
      window.cacheStoreInstance.renderQuotaStatmeter(info.colab_quota);
    }

    const sampleTime = typeof info.sample_time_sec === 'number' ? info.sample_time_sec : Math.min(15.0, this.videoDuration * 0.2);
    if (this.frameSlider) {
      this.frameSlider.max = Math.max(1, Math.floor(this.videoDuration));
      this.frameSlider.value = sampleTime;
    }
    this.seekPreviewTo(sampleTime);
  }

  seekPreviewTo(seconds) {
    const clamped = Math.max(0, Math.min(this.videoDuration || 600, seconds));
    if (this.frameTimeEl) {
      const m = Math.floor(clamped / 60).toString().padStart(2, '0');
      const s = (clamped % 60).toFixed(1).padStart(4, '0');
      this.frameTimeEl.textContent = `${m}:${s}`;
    }
    try {
      this.previewVideo.currentTime = clamped;
    } catch (e) {}
    this.drawCalibrationCanvas();
  }

  /**
   * Client-side HTML5 Canvas White-Line Court Auto-Detector for 720p / 1080p / 4K videos.
   * Uses 1D Top-Hat White-Line Ridge + Chroma filtering, Theil-Sen Median-Slope robust regression,
   * and BWF Broadcast Trapezoid Invariants so player shoes/shirts or floor logos never distort the court.
   */
  autoDetectCourtInBrowser(isSilent = false) {
    const w = this.videoWidth || (this.previewVideo && this.previewVideo.videoWidth) || 1920;
    const h = this.videoHeight || (this.previewVideo && this.previewVideo.videoHeight) || 1080;

    const defaultPreset = {
      corner_near_left: [Math.round(w * 0.1687 * 10) / 10, Math.round(h * 0.8918 * 10) / 10],
      corner_near_right: [Math.round(w * 0.8292 * 10) / 10, Math.round(h * 0.8970 * 10) / 10],
      corner_far_right: [Math.round(w * 0.6737 * 10) / 10, Math.round(h * 0.3960 * 10) / 10],
      corner_far_left: [Math.round(w * 0.3269 * 10) / 10, Math.round(h * 0.3920 * 10) / 10],
      net_post_left: [Math.round(w * 0.2690 * 10) / 10, Math.round(h * 0.3616 * 10) / 10],
      net_post_right: [Math.round(w * 0.7315 * 10) / 10, Math.round(h * 0.3667 * 10) / 10]
    };

    const anyOutOfBounds = Object.values(this.keypoints).some(
      (pt) => !pt || pt[0] < 0 || pt[0] > w || pt[1] < 0 || pt[1] > h
    );
    const prevKeypoints = JSON.parse(JSON.stringify(this.keypoints));
    if (anyOutOfBounds) {
      this.keypoints = JSON.parse(JSON.stringify(defaultPreset));
    }

    let frameSource = null;
    if (this.previewVideo && this.previewVideo.readyState >= 2) {
      frameSource = this.previewVideo;
    } else if (this.serverFrameImg && this.serverFrameImg.complete && this.serverFrameImg.naturalWidth > 0) {
      frameSource = this.serverFrameImg;
    }
    if (!frameSource) {
      this.drawCalibrationCanvas();
      return false;
    }

    try {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = w;
      offCanvas.height = h;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      offCtx.drawImage(frameSource, 0, 0, w, h);
      const imgData = offCtx.getImageData(0, 0, w, h).data;

      const pixelStatsAt = (ix, iy) => {
        const x = Math.max(0, Math.min(w - 1, Math.round(ix)));
        const y = Math.max(0, Math.min(h - 1, Math.round(iy)));
        const idx = (y * w + x) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        return { luma, chroma };
      };

      // Theil-Sen Median-Slope + Inlier-Trimmed Least Squares (rejects player shoes/shirts/logos)
      const fitLineRobust = (pts, inlierTolPx) => {
        if (!pts || pts.length < 5) return null;
        const slopes = [];
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dx = pts[j][0] - pts[i][0];
            if (Math.abs(dx) > 1e-3) {
              slopes.push((pts[j][1] - pts[i][1]) / dx);
            }
          }
        }
        if (slopes.length === 0) return null;
        slopes.sort((a, b) => a - b);
        const mMed = slopes[Math.floor(slopes.length / 2)];

        const intercepts = pts.map((p) => p[1] - mMed * p[0]).sort((a, b) => a - b);
        const bMed = intercepts[Math.floor(intercepts.length / 2)];

        const inliers = pts.filter((p) => Math.abs(p[1] - (mMed * p[0] + bMed)) <= inlierTolPx);
        if (inliers.length < Math.max(4, Math.floor(pts.length * 0.45))) {
          return null;
        }

        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        const n = inliers.length;
        for (let i = 0; i < n; i++) {
          sx += inliers[i][0];
          sy += inliers[i][1];
          sxx += inliers[i][0] * inliers[i][0];
          sxy += inliers[i][0] * inliers[i][1];
        }
        const denom = n * sxx - sx * sx;
        if (Math.abs(denom) < 1e-6) return [mMed, bMed];
        const m = (n * sxy - sx * sy) / denom;
        const b = (sy - m * sx) / n;
        return [m, b];
      };

      const searchR = Math.max(12, Math.round(h * 0.032));
      const flankStep = Math.max(2, Math.round(h * 0.0042));
      const inlierTol = Math.max(2.2, h * 0.0045);

      // Step 0: Zero-Prior 1D Projective Cross-Ratio + 5-Line Vanishing Point Global Detector
      // Finds the true Near/Far baselines and Outer Doubles Sidelines regardless of BWF camera elevation
      try {
        const xc1 = Math.round(0.28 * w);
        const xc2 = Math.round(0.72 * w);
        const hProf = new Float64Array(h);
        for (let y = flankStep + 2; y < h - flankStep - 2; y++) {
          let sumR = 0;
          let countX = 0;
          for (let x = xc1; x < xc2; x += 2) {
            const cur = pixelStatsAt(x, y);
            if (cur.luma >= 135 && cur.chroma <= 65) {
              const fUp = pixelStatsAt(x, y - flankStep).luma;
              const fDn = pixelStatsAt(x, y + flankStep).luma;
              const rVal = cur.luma - 0.5 * (fUp + fDn);
              if (rVal >= 10) sumR += rVal;
            }
            countX++;
          }
          hProf[y] = countX > 0 ? sumR / countX : 0;
        }
        const hSmooth = new Float64Array(h);
        for (let y = 2; y < h - 2; y++) {
          hSmooth[y] = 0.25 * hProf[y - 1] + 0.5 * hProf[y] + 0.25 * hProf[y + 1];
        }
        const rawPeaks = [];
        const yMin = Math.round(0.28 * h);
        const yMax = Math.round(0.965 * h);
        for (let y = yMin + 2; y < yMax - 2; y++) {
          if (hSmooth[y] >= hSmooth[y - 1] && hSmooth[y] >= hSmooth[y + 1] && hSmooth[y] > 2.8) {
            rawPeaks.push([y, hSmooth[y]]);
          }
        }
        rawPeaks.sort((a, b) => b[1] - a[1]);
        const minSep = Math.max(4, 6.0 * (w / 1920));
        const nmsPeaks = [];
        for (const pk of rawPeaks) {
          if (nmsPeaks.every((q) => Math.abs(pk[0] - q[0]) >= minSep)) {
            nmsPeaks.push(pk);
          }
        }
        nmsPeaks.sort((a, b) => a[0] - b[0]);

        const yM = [0.0, 0.76, 4.72, 8.68, 12.64, 13.40];
        const nearCands = nmsPeaks.filter((p) => p[0] >= 0.72 * h && p[0] <= 0.965 * h);
        const midCands = nmsPeaks.filter((p) => p[0] >= 0.44 * h && p[0] <= 0.80 * h);
        const farCands = nmsPeaks.filter((p) => p[0] >= 0.28 * h && p[0] <= 0.58 * h);

        let bestHScore = -1e9;
        let bestH = null;
        for (const [v0] of nearCands) {
          for (const [v2] of midCands) {
            if (v0 - v2 < 0.14 * h || v0 - v2 > 0.38 * h) continue;
            for (const [v4] of farCands) {
              if (v2 - v4 < 0.12 * h || v2 - v4 > 0.36 * h) continue;
              for (const yFarM of [12.64, 13.40]) {
                const b = v0;
                const m00 = 4.72, m01 = -4.72 * v2;
                const m10 = yFarM, m11 = -yFarM * v4;
                const det = m00 * m11 - m01 * m10;
                if (Math.abs(det) < 1e-6) continue;
                const r0 = v2 - b, r1 = v4 - b;
                const a = (r0 * m11 - m01 * r1) / det;
                const c = (m00 * r1 - r0 * m10) / det;
                if (c <= 0.005 || c >= 0.15) continue;
                const vPred = yM.map((ym) => (a * ym + b) / (c * ym + 1.0));
                if (vPred[5] < 0.22 * h || vPred[0] > 0.968 * h) continue;
                let score = 0, hits = 0;
                for (let idxL = 0; idxL < 6; idxL++) {
                  const iy = Math.round(vPred[idxL]);
                  let lmax = 0;
                  for (let dy = -2; dy <= 2; dy++) {
                    if (iy + dy >= 2 && iy + dy < h - 2 && hSmooth[iy + dy] > lmax) {
                      lmax = hSmooth[iy + dy];
                    }
                  }
                  if (lmax > 2.6) hits++;
                  score += (idxL === 3 ? 1.0 : 1.5) * lmax;
                }
                if (hits >= 5 && score > bestHScore) {
                  bestHScore = score;
                  bestH = { a, b, c, vPred };
                }
              }
            }
          }
        }

        if (bestH) {
          const vNear = bestH.vPred[0];
          const vFar = bestH.vPred[5];
          const vInf = bestH.a / bestH.c;
          const xOffsets = [-3.05 / 6.10, -2.59 / 6.10, 0.0, 2.59 / 6.10, 3.05 / 6.10];
          let bestVScore = -1e9;
          let bestUInf = 0.5 * w;
          let bestWNear = 0.65 * w;

          for (let ui = 0; ui < 21; ui++) {
            const uInf = (0.44 + (0.12 * ui) / 20) * w;
            for (let wi = 0; wi < 37; wi++) {
              const wNear = (0.46 + (0.42 * wi) / 36) * w;
              let s = 0;
              for (let si = 0; si < 24; si++) {
                const sv = Math.round(vFar + 6 + ((vNear - vFar - 12) * si) / 23);
                const scaleV = (sv - vInf) / (vNear - vInf);
                for (const xi of xOffsets) {
                  const su = Math.round(uInf + xi * wNear * scaleV);
                  if (su > flankStep + 2 && su < w - flankStep - 2) {
                    const cur = pixelStatsAt(su, sv);
                    if (cur.luma >= 135 && cur.chroma <= 65) {
                      const rv = cur.luma - 0.5 * (pixelStatsAt(su - flankStep, sv).luma + pixelStatsAt(su + flankStep, sv).luma);
                      if (rv >= 10) s += rv;
                    }
                  }
                }
              }
              if (s > bestVScore) {
                bestVScore = s;
                bestUInf = uInf;
                bestWNear = wNear;
              }
            }
          }

          const scaleFar = (vFar - vInf) / (vNear - vInf);
          const wFar = bestWNear * scaleFar;
          const vNetG = (bestH.a * 6.70 + bestH.b) / (bestH.c * 6.70 + 1.0);
          const wNet = bestWNear * ((vNetG - vInf) / (vNear - vInf));
          const uNetL = bestUInf - 0.5 * wNet;
          const uNetR = bestUInf + 0.5 * wNet;
          const bestNetV = vFar - 0.015 * h;

          this.keypoints = {
            corner_near_left: [Math.round((bestUInf - 0.5 * bestWNear) * 10) / 10, Math.round(vNear * 10) / 10],
            corner_near_right: [Math.round((bestUInf + 0.5 * bestWNear) * 10) / 10, Math.round(vNear * 10) / 10],
            corner_far_right: [Math.round((bestUInf + 0.5 * wFar) * 10) / 10, Math.round(vFar * 10) / 10],
            corner_far_left: [Math.round((bestUInf - 0.5 * wFar) * 10) / 10, Math.round(vFar * 10) / 10],
            net_post_left: [Math.round(uNetL * 10) / 10, Math.round(bestNetV * 10) / 10],
            net_post_right: [Math.round(uNetR * 10) / 10, Math.round(bestNetV * 10) / 10]
          };
        }
      } catch (e0) {}

      const cNL = this.keypoints.corner_near_left;
      const cNR = this.keypoints.corner_near_right;
      const cFR = this.keypoints.corner_far_right;
      const cFL = this.keypoints.corner_far_left;

      // 1D Top-Hat White-Line Ridge Sampler (requires neutral white peak + darker green/blue court mat on both sides)
      const sampleHorizontal = (pL, pR) => {
        const hits = [];
        for (let i = 0; i <= 24; i++) {
          const t = 0.12 + (0.76 * i) / 24;
          const u = pL[0] + t * (pR[0] - pL[0]);
          const v0 = pL[1] + t * (pR[1] - pL[1]);
          let bestV = v0, bestScore = -1e9;
          for (let dv = -searchR; dv <= searchR; dv++) {
            const cur = pixelStatsAt(u, v0 + dv);
            if (cur.luma < 145 || cur.chroma > 58) continue;
            const f1 = pixelStatsAt(u, v0 + dv - flankStep).luma;
            const f2 = pixelStatsAt(u, v0 + dv + flankStep).luma;
            const ridge = cur.luma - 0.5 * (f1 + f2);
            if (ridge >= 15) {
              const score = ridge + 0.25 * cur.luma - Math.abs(dv) * 0.35;
              if (score > bestScore) {
                bestScore = score;
                bestV = v0 + dv;
              }
            }
          }
          if (bestScore > -1e8) {
            hits.push([u, bestV]);
          }
        }
        return fitLineRobust(hits, inlierTol);
      };

      const sampleVertical = (pNear, pFar) => {
        const hits = [];
        for (let i = 0; i <= 24; i++) {
          const t = 0.12 + (0.76 * i) / 24;
          const u0 = pNear[0] + t * (pFar[0] - pNear[0]);
          const v = pNear[1] + t * (pFar[1] - pNear[1]);
          let bestU = u0, bestScore = -1e9;
          for (let du = -searchR; du <= searchR; du++) {
            const cur = pixelStatsAt(u0 + du, v);
            if (cur.luma < 145 || cur.chroma > 58) continue;
            const f1 = pixelStatsAt(u0 + du - flankStep, v).luma;
            const f2 = pixelStatsAt(u0 + du + flankStep, v).luma;
            const ridge = cur.luma - 0.5 * (f1 + f2);
            if (ridge >= 15) {
              const score = ridge + 0.25 * cur.luma - Math.abs(du) * 0.35;
              if (score > bestScore) {
                bestScore = score;
                bestU = u0 + du;
              }
            }
          }
          if (bestScore > -1e8) {
            hits.push([v, bestU]); // fit u = m*v + b
          }
        }
        return fitLineRobust(hits, inlierTol);
      };

      const nearLine = sampleHorizontal(cNL, cNR); // v = mH * u + bH
      const farLine = sampleHorizontal(cFL, cFR);
      const leftLine = sampleVertical(cNL, cFL);   // u = mV * v + bV
      const rightLine = sampleVertical(cNR, cFR);

      const intersectHV = (hLine, vLine) => {
        if (!hLine || !vLine) return null;
        const [mH, bH] = hLine;
        const [mV, bV] = vLine;
        const denom = 1.0 - mH * mV;
        if (Math.abs(denom) < 1e-6) return null;
        const v = (mH * bV + bH) / denom;
        const u = mV * v + bV;
        return [Math.round(u * 10) / 10, Math.round(v * 10) / 10];
      };

      const refNL = intersectHV(nearLine, leftLine);
      const refNR = intersectHV(nearLine, rightLine);
      const refFR = intersectHV(farLine, rightLine);
      const refFL = intersectHV(farLine, leftLine);

      const maxShift = w * 0.075;
      if (refNL && refNR && refFR && refFL) {
        const mH_near = nearLine[0];
        const mH_far = farLine[0];
        const mV_left = leftLine[0];
        const mV_right = rightLine[0];
        const nearW = refNR[0] - refNL[0];
        const farW = refFR[0] - refFL[0];
        const ratio = farW / Math.max(1, nearW);

        // Enforce strict BWF broadcast trapezoid invariants so false lines never distort the court wireframe
        const validHoriz = Math.abs(mH_near) <= 0.032 && Math.abs(mH_far) <= 0.032 && Math.abs(mH_near - mH_far) <= 0.024;
        const validVert = mV_left >= -0.80 && mV_left <= -0.15 && mV_right >= 0.15 && mV_right <= 0.80 && Math.abs(mV_left + mV_right) <= 0.16;
        const validRatio = nearW >= w * 0.42 && ratio >= 0.40 && ratio <= 0.70;
        const validShift =
          Math.hypot(refNL[0] - cNL[0], refNL[1] - cNL[1]) <= maxShift &&
          Math.hypot(refNR[0] - cNR[0], refNR[1] - cNR[1]) <= maxShift &&
          Math.hypot(refFR[0] - cFR[0], refFR[1] - cFR[1]) <= maxShift &&
          Math.hypot(refFL[0] - cFL[0], refFL[1] - cFL[1]) <= maxShift;

        if (validHoriz && validVert && validRatio && validShift) {
          // Projective net-line fraction along the sideline (in BWF perspective, y=6.70m sits at ~61.5% from near to far baseline in image v)
          const tNet = 0.615;
          const oldNetGroundL = [cNL[0] + tNet * (cFL[0] - cNL[0]), cNL[1] + tNet * (cFL[1] - cNL[1])];
          const newNetGroundL = [refNL[0] + tNet * (refFL[0] - refNL[0]), refNL[1] + tNet * (refFL[1] - refNL[1])];
          const oldNetGroundR = [cNR[0] + tNet * (cFR[0] - cNR[0]), cNR[1] + tNet * (cFR[1] - cNR[1])];
          const newNetGroundR = [refNR[0] + tNet * (refFR[0] - refNR[0]), refNR[1] + tNet * (refFR[1] - refNR[1])];

          this.keypoints.corner_near_left = refNL;
          this.keypoints.corner_near_right = refNR;
          this.keypoints.corner_far_right = refFR;
          this.keypoints.corner_far_left = refFL;
          this.keypoints.net_post_left = [
            Math.round((this.keypoints.net_post_left[0] + (newNetGroundL[0] - oldNetGroundL[0])) * 10) / 10,
            Math.round((this.keypoints.net_post_left[1] + (newNetGroundL[1] - oldNetGroundL[1])) * 10) / 10
          ];
          this.keypoints.net_post_right = [
            Math.round((this.keypoints.net_post_right[0] + (newNetGroundR[0] - oldNetGroundR[0])) * 10) / 10,
            Math.round((this.keypoints.net_post_right[1] + (newNetGroundR[1] - oldNetGroundR[1])) * 10) / 10
          ];
          this.setStatusPill(`✓ Snapped to ${w}×${h} white court lines — drag any of the 6 handles to fine-tune`, true);
          this.drawCalibrationCanvas();
          return true;
        }
      }
    } catch (e) {}

    if (!anyOutOfBounds && prevKeypoints) {
      this.keypoints = prevKeypoints;
    }
    this.setStatusPill(`✓ Aligned undistorted ${w}×${h} BWF court preset — drag any of the 6 handles to fine-tune`, true);
    this.drawCalibrationCanvas();
    return false;
  }

  runServerAutoCalibrate() {
    const curTime = parseFloat(this.frameSlider ? this.frameSlider.value : 15.0) || 15.0;
    this.setStatusPill('Detecting white court lines on current frame...', false);
    if (!this.videoPath || String(this.videoPath).startsWith('blob:')) {
      this.autoDetectCourtInBrowser(false);
      return;
    }
    fetch(this.getApiUrl('/api/auto-calibrate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: this.videoPath, time_sec: curTime })
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((info) => {
        if (info && info.frame_jpeg_b64) {
          const img = new Image();
          img.onload = () => {
            this.serverFrameImg = img;
            this.drawCalibrationCanvas();
          };
          img.src = info.frame_jpeg_b64;
        }
        if (info && info.calibration_preview && info.calibration_preview.keypoints) {
          const cal = info.calibration_preview;
          if (cal.auto_refined) {
            Object.keys(this.keypoints).forEach((k) => {
              if (cal.keypoints[k]) {
                this.keypoints[k] = [Number(cal.keypoints[k][0]), Number(cal.keypoints[k][1])];
              }
            });
            this.drawCalibrationCanvas();
            this.setStatusPill(`✓ Snapped to white court lines (RMSE ${cal.line_sample_rmse_px}px)`, true);
          } else {
            this.autoDetectCourtInBrowser(false);
          }
        } else {
          this.autoDetectCourtInBrowser(false);
        }
      })
      .catch(() => {
        this.autoDetectCourtInBrowser(false);
      });
  }

  applyAnglePreset(presetName) {
    const w = this.videoWidth || 1920;
    const h = this.videoHeight || 1080;
    if (presetName === 'broadcast') {
      this.keypoints = {
        corner_near_left: [w * 0.1687, h * 0.8918],
        corner_near_right: [w * 0.8292, h * 0.8970],
        corner_far_right: [w * 0.6737, h * 0.3960],
        corner_far_left: [w * 0.3269, h * 0.3920],
        net_post_left: [w * 0.2690, h * 0.3616],
        net_post_right: [w * 0.7315, h * 0.3667]
      };
      this.setStatusPill('Loaded Standard Broadcast Angle preset — fine-tune handles if needed', true);
    } else if (presetName === 'tripod') {
      // Lower iPhone eye/chest tripod behind near baseline: wider near corners, compressed far court, higher net posts
      this.keypoints = {
        corner_near_left: [w * 0.08, h * 0.93],
        corner_near_right: [w * 0.92, h * 0.93],
        corner_far_right: [w * 0.69, h * 0.48],
        corner_far_left: [w * 0.31, h * 0.48],
        net_post_left: [w * 0.23, h * 0.37],
        net_post_right: [w * 0.77, h * 0.37]
      };
      this.setStatusPill('Loaded Low Baseline / iPhone Tripod preset — drag handles to match your court corners', true);
    } else if (presetName === 'angled') {
      // Corner / Diagonal recreational gym tripod (camera positioned off to the front-left corner)
      this.keypoints = {
        corner_near_left: [w * 0.07, h * 0.86],
        corner_near_right: [w * 0.78, h * 0.95],
        corner_far_right: [w * 0.88, h * 0.47],
        corner_far_left: [w * 0.42, h * 0.42],
        net_post_left: [w * 0.27, h * 0.36],
        net_post_right: [w * 0.83, h * 0.43]
      };
      this.setStatusPill('Loaded Corner / Angled Gym Tripod preset — drag handles to match your court corners', true);
    }
    this.drawCalibrationCanvas();
  }

  /**
   * Solves exact 3x3 Planar Homography H mapping BWF court (x, y) meters -> image (u, v) pixels
   * from the 4 outer court corners in < 0.05ms so the full BWF grid updates at 60 FPS while dragging.
   */
  solveCourtHomography() {
    const src = [
      [0.0, 0.0],
      [6.10, 0.0],
      [6.10, 13.40],
      [0.0, 13.40]
    ];
    const dst = [
      this.keypoints.corner_near_left,
      this.keypoints.corner_near_right,
      this.keypoints.corner_far_right,
      this.keypoints.corner_far_left
    ];

    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i][0];
      const y = src[i][1];
      const u = dst[i][0];
      const v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }

    // Gaussian elimination with partial pivoting (8x8)
    const n = 8;
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
      }
      const tmpA = A[col]; A[col] = A[maxRow]; A[maxRow] = tmpA;
      const tmpB = b[col]; b[col] = b[maxRow]; b[maxRow] = tmpB;

      const pivot = A[col][col];
      if (Math.abs(pivot) < 1e-10) return null;

      for (let row = col + 1; row < n; row++) {
        const factor = A[row][col] / pivot;
        b[row] -= factor * b[col];
        for (let k = col; k < n; k++) {
          A[row][k] -= factor * A[col][k];
        }
      }
    }

    const h = new Array(8).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = b[i];
      for (let j = i + 1; j < n; j++) {
        sum -= A[i][j] * h[j];
      }
      h[i] = sum / A[i][i];
    }

    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1.0]
    ];
  }

  projectCourtPoint(H, cx, cy) {
    if (!H) return [0, 0];
    const w = H[2][0] * cx + H[2][1] * cy + H[2][2];
    const u = (H[0][0] * cx + H[0][1] * cy + H[0][2]) / (w || 1e-6);
    const v = (H[1][0] * cx + H[1][1] * cy + H[1][2]) / (w || 1e-6);
    return [u, v];
  }

  drawCalibrationCanvas() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw current video frame (with server-decoded JPEG fallback for iOS/Safari & initial load)
    let frameSource = null;
    if (this.previewVideo && this.previewVideo.readyState >= 2) {
      frameSource = this.previewVideo;
    } else if (this.serverFrameImg && this.serverFrameImg.complete && this.serverFrameImg.naturalWidth > 0) {
      frameSource = this.serverFrameImg;
    } else if (this.player && this.player.videoElement && this.player.videoElement.readyState >= 2) {
      frameSource = this.player.videoElement;
    }

    if (frameSource) {
      ctx.drawImage(frameSource, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, w, h);
    }

    // Subtle dark vignette for crisp handle contrast
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, w, h);

    // 2. Compute Homography H from the 4 court corners and project full BWF court wireframe
    const H = this.solveCourtHomography();
    if (H) {
      // Translucent court polygon fill
      const cNL = this.projectCourtPoint(H, 0.0, 0.0);
      const cNR = this.projectCourtPoint(H, 6.10, 0.0);
      const cFR = this.projectCourtPoint(H, 6.10, 13.40);
      const cFL = this.projectCourtPoint(H, 0.0, 13.40);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cNL[0], cNL[1]);
      ctx.lineTo(cNR[0], cNR[1]);
      ctx.lineTo(cFR[0], cFR[1]);
      ctx.lineTo(cFL[0], cFL[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(22, 163, 74, 0.15)';
      ctx.fill();
      ctx.restore();

      // Official BWF regulation lines in meters
      const bwfLines = [
        // Outer boundaries
        [[0.0, 0.0], [6.10, 0.0], true],
        [[0.0, 13.40], [6.10, 13.40], true],
        [[0.0, 0.0], [0.0, 13.40], true],
        [[6.10, 0.0], [6.10, 13.40], true],
        // Inner singles sidelines (0.46m tramline)
        [[0.46, 0.0], [0.46, 13.40], false],
        [[5.64, 0.0], [5.64, 13.40], false],
        // Doubles long service lines (0.76m from back)
        [[0.0, 0.76], [6.10, 0.76], false],
        [[0.0, 12.64], [6.10, 12.64], false],
        // Short service lines (1.98m from net y=6.70)
        [[0.0, 4.72], [6.10, 4.72], false],
        [[0.0, 8.68], [6.10, 8.68], false],
        // Center service lines
        [[3.05, 0.0], [3.05, 4.72], false],
        [[3.05, 8.68], [3.05, 13.40], false]
      ];

      const scaleLine = Math.max(1.5, w / 640);
      bwfLines.forEach(([p1, p2, isOuter]) => {
        const uv1 = this.projectCourtPoint(H, p1[0], p1[1]);
        const uv2 = this.projectCourtPoint(H, p2[0], p2[1]);
        ctx.beginPath();
        ctx.moveTo(uv1[0], uv1[1]);
        ctx.lineTo(uv2[0], uv2[1]);
        ctx.strokeStyle = isOuter ? 'rgba(74, 222, 128, 0.95)' : 'rgba(255, 255, 255, 0.82)';
        ctx.lineWidth = isOuter ? 2.6 * scaleLine : 1.6 * scaleLine;
        ctx.stroke();
      });

      // Net ground line (y = 6.70m) + 3D Net Posts & Top Tape
      const netGroundL = this.projectCourtPoint(H, 0.0, 6.70);
      const netGroundR = this.projectCourtPoint(H, 6.10, 6.70);
      const netPostL = this.keypoints.net_post_left;
      const netPostR = this.keypoints.net_post_right;
      const sagPx = Math.max(2.0, 0.0035 * h);
      const netTapeC = [
        0.5 * (netPostL[0] + netPostR[0]),
        0.5 * (netPostL[1] + netPostR[1]) + sagPx
      ];

      // Net mesh translucent quad
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(netGroundL[0], netGroundL[1]);
      ctx.lineTo(netPostL[0], netPostL[1]);
      ctx.lineTo(netTapeC[0], netTapeC[1]);
      ctx.lineTo(netPostR[0], netPostR[1]);
      ctx.lineTo(netGroundR[0], netGroundR[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
      ctx.fill();
      ctx.restore();

      // Net ground dashed line
      ctx.save();
      ctx.setLineDash([8 * scaleLine, 6 * scaleLine]);
      ctx.beginPath();
      ctx.moveTo(netGroundL[0], netGroundL[1]);
      ctx.lineTo(netGroundR[0], netGroundR[1]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 1.8 * scaleLine;
      ctx.stroke();
      ctx.restore();

      // Net posts & top cord
      ctx.beginPath();
      ctx.moveTo(netGroundL[0], netGroundL[1]);
      ctx.lineTo(netPostL[0], netPostL[1]);
      ctx.lineTo(netTapeC[0], netTapeC[1]);
      ctx.lineTo(netPostR[0], netPostR[1]);
      ctx.lineTo(netGroundR[0], netGroundR[1]);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.6 * scaleLine;
      ctx.stroke();
    }

    // 3. Draw the 6 draggable keypoint handles
    const rHandle = Math.max(10, Math.round(w / 95));
    const fontPx = Math.max(12, Math.round(w / 82));

    this.handleDefs.forEach((def) => {
      const pt = this.keypoints[def.key];
      if (!pt) return;
      const isDrag = this.draggingKey === def.key;
      const isHover = this.hoveredKey === def.key;
      const rad = isDrag ? rHandle * 1.35 : (isHover ? rHandle * 1.18 : rHandle);

      // Outer halo
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], rad + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fill();

      // Colored handle circle
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], rad, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Crosshair dot inside handle
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Pill label next to handle
      ctx.font = `700 ${fontPx}px -apple-system, Inter, sans-serif`;
      const textW = ctx.measureText(def.short).width;
      const lx = pt[0] < w * 0.5 ? pt[0] + rad + 8 : pt[0] - rad - textW - 18;
      const ly = pt[1] - fontPx * 0.7;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, textW + 12, fontPx + 8, 5);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.short, lx + 6, ly + (fontPx + 8) / 2);
    });

    // 4. If dragging a handle, draw a precision 2.6x Magnifier Loupe in the top corner
    if (this.draggingKey && frameSource) {
      const pt = this.keypoints[this.draggingKey];
      const def = this.handleDefs.find((d) => d.key === this.draggingKey);
      const loupeR = Math.round(Math.min(w, h) * 0.13);
      const pad = 20;
      // Place loupe on top-left or top-right opposite the dragged point
      const cx = pt[0] < w * 0.45 ? w - loupeR - pad : loupeR + pad;
      const cy = loupeR + pad;
      const zoom = 2.6;
      const srcSpan = (loupeR * 2) / zoom;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, loupeR, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#000';
      ctx.fillRect(cx - loupeR, cy - loupeR, loupeR * 2, loupeR * 2);
      ctx.drawImage(
        frameSource,
        pt[0] - srcSpan / 2,
        pt[1] - srcSpan / 2,
        srcSpan,
        srcSpan,
        cx - loupeR,
        cy - loupeR,
        loupeR * 2,
        loupeR * 2
      );

      // Crosshair inside loupe
      ctx.strokeStyle = (def && def.color) || '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - loupeR, cy);
      ctx.lineTo(cx + loupeR, cy);
      ctx.moveTo(cx, cy - loupeR);
      ctx.lineTo(cx, cy + loupeR);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, loupeR, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  canvasCoordsFromEvent(e) {
    if (!this.canvas) return [0, 0];
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(1, rect.width);
    const scaleY = this.canvas.height / Math.max(1, rect.height);
    const u = Math.max(0, Math.min(this.canvas.width, (e.clientX - rect.left) * scaleX));
    const v = Math.max(0, Math.min(this.canvas.height, (e.clientY - rect.top) * scaleY));
    return [u, v];
  }

  findClosestHandle(u, v) {
    const hitRadius = Math.max(28, this.canvas.width / 32);
    let bestKey = null;
    let bestDist = hitRadius;
    this.handleDefs.forEach((def) => {
      const pt = this.keypoints[def.key];
      if (!pt) return;
      const d = Math.hypot(u - pt[0], v - pt[1]);
      if (d <= bestDist) {
        bestDist = d;
        bestKey = def.key;
      }
    });
    return bestKey;
  }

  bindCanvasPointerEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('pointerdown', (e) => {
      const [u, v] = this.canvasCoordsFromEvent(e);
      const hitKey = this.findClosestHandle(u, v);
      if (hitKey) {
        e.preventDefault();
        this.draggingKey = hitKey;
        if (this.canvas.setPointerCapture) {
          try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
        }
        this.drawCalibrationCanvas();
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const [u, v] = this.canvasCoordsFromEvent(e);
      if (this.draggingKey) {
        e.preventDefault();
        this.keypoints[this.draggingKey] = [Math.round(u * 10) / 10, Math.round(v * 10) / 10];
        this.drawCalibrationCanvas();
      } else {
        const hover = this.findClosestHandle(u, v);
        if (hover !== this.hoveredKey) {
          this.hoveredKey = hover;
          this.canvas.style.cursor = hover ? 'grab' : 'crosshair';
          this.drawCalibrationCanvas();
        }
      }
    });

    const endDrag = (e) => {
      if (this.draggingKey) {
        const def = this.handleDefs.find((d) => d.key === this.draggingKey);
        const pt = this.keypoints[this.draggingKey];
        if (def && pt) {
          this.setStatusPill(`Updated ${def.short} → (${Math.round(pt[0])}, ${Math.round(pt[1])}) px`, true);
        }
        this.draggingKey = null;
        if (this.canvas.releasePointerCapture && e && e.pointerId !== undefined) {
          try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        this.drawCalibrationCanvas();
      }
    };

    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  startFullAnalysis() {
    if (this.isUploading) {
      this.setStatusPill('Please wait for video upload to finish...', false);
      return;
    }

    const nearNameInput = document.getElementById('calib-near-player');
    const farNameInput = document.getElementById('calib-far-player');
    const modeSelect = document.getElementById('calib-camera-mode');
    const matchTypeSelect = document.getElementById('calib-match-type');
    const maxRalliesSelect = document.getElementById('calib-max-rallies');
    const computeSelect = document.getElementById('calib-compute-backend');

    const nearRaw = (nearNameInput && nearNameInput.value.trim()) || 'Player 1';
    const farRaw = (farNameInput && farNameInput.value.trim()) || 'Player 2';
    const nearId = nearRaw.length <= 24 ? nearRaw.toUpperCase() : nearRaw.slice(0, 24).toUpperCase();
    const farId = farRaw.length <= 24 ? farRaw.toUpperCase() : farRaw.slice(0, 24).toUpperCase();
    const mode = (modeSelect && modeSelect.value) || 'auto';
    const matchType = (matchTypeSelect && matchTypeSelect.value) || 'auto';
    const maxRallies = parseInt((maxRalliesSelect && maxRalliesSelect.value) || '0', 10) || 0;
    const computeBackend = (computeSelect && computeSelect.value) || 'blackwell_g4';

    const payload = {
      match_id: this.matchId,
      video_path: this.videoPath,
      keypoints: this.keypoints,
      near_player: { id: nearId, name: nearRaw, country: 'NEAR', dominant_hand: 'Right' },
      far_player: { id: farId, name: farRaw, country: 'FAR', dominant_hand: 'Right' },
      mode,
      match_type: matchType,
      max_rallies: maxRallies,
      compute_backend: computeBackend
    };

    // CRITICAL UX GUARD: Do NOT load the new video into the right-hand BroadcastPlayer yet!
    // Keep the old video + old 3D telemetry paired together until Rally 1 of the new video is ready,
    // and lock the workspace with the Sync Lock Shield (with an option to continue watching the previous match in the background).
    this.pendingVideoSrc = this.localBlobUrl || this.videoPath;
    this.pendingMatchLabel = `${nearRaw} vs ${farRaw}`;
    this.backgroundMode = false;
    this.hasSwitchedToNewMatch = false;

    if (this.player && this.player.videoElement) {
      try { this.player.videoElement.pause(); } catch (e) {}
    }

    this.close();
    this.showSyncLock(
      `⏳ Syncing New Video: ${nearRaw} vs ${farRaw}`,
      'STAGE 1: Calibrating Court & Segmenting Rallies...',
      'Preparing 3D aerodynamic trajectory solver...',
      6
    );
    this.showBanner('STAGE 1: Calibrating Court & Segmenting Rallies...', `Syncing ${nearRaw} vs ${farRaw} in 3D...`, 6, true);

    const launchAnalyzeRequest = async (resolvedVideoPath) => {
      payload.video_path = resolvedVideoPath || this.videoPath;
      await this.refreshTunnelUrl();
      let r = null;
      try {
        r = await fetch(this.getApiUrl('/api/analyze-start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        r = null;
      }
      if (!r || !r.ok) {
        try {
          r = await fetch('/api/analyze-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (e2) {
          r = null;
        }
      }
      if (r && r.ok) {
        try {
          const res = await r.json();
          if (res && res.match_id) {
            this.activeJobMatchId = res.match_id;
            this.lastStreamedRallyCount = -1;
            try {
              localStorage.setItem('hawkview_active_job', JSON.stringify({
                matchId: res.match_id,
                videoSrc: this.pendingVideoSrc,
                label: this.pendingMatchLabel
              }));
            } catch (e) {}
            this.startPollingStatus(res.match_id);
            return;
          }
        } catch (e3) {}
      }
      this.runStaticStreamingFallback(this.matchId);
    };

    if (this.selectedFile && (!this.videoPath || this.videoPath.startsWith('blob:'))) {
      this.showSyncLock(
        `⏳ Uploading Video to CV Server: ${this.selectedFile.name}`,
        'STAGE 0: Streaming MP4 Chunks to Hawkview Blackwell Server...',
        'Preparing court calibration & TrackNetV3 + RTMPose pipeline...',
        4
      );
      this.uploadFileChunked(this.selectedFile, (pct, curChunk, totalChunks, chunkInfo) => {
        const speedStr = (chunkInfo && chunkInfo.mb_per_sec) ? ` · ${chunkInfo.mb_per_sec} MB/s` : '';
        this.showSyncLock(
          `⏳ Uploading Video to CV Server: ${this.selectedFile.name}`,
          `STAGE 0: Uploading MP4 (${pct}% · Chunk ${curChunk}/${totalChunks}${speedStr})...`,
          `Streaming 1 MB chunks over Cloudflare Edge Tunnel to Hawkview Blackwell Server...`,
          Math.max(4, Math.min(20, Math.round(pct * 0.2)))
        );
      })
        .then((info) => {
          if (info && info.video_path) {
            this.videoPath = info.video_path;
            if (info.match_id) {
              this.matchId = info.match_id;
              payload.match_id = info.match_id;
            }
          }
          launchAnalyzeRequest(this.videoPath);
        })
        .catch((err) => {
          const errMsg = (err && err.message) ? err.message : 'Network connection interrupted during chunk upload.';
          this.showSyncLockError(
            `❌ Video Upload Interrupted: ${this.selectedFile.name}`,
            `STAGE 0 ERROR: ${errMsg}`,
            'The MP4 chunk stream was interrupted before reaching the CV server. Click "Retry Upload" or open "Server Logs & Diagnostics" to inspect live server & tunnel telemetry.'
          );
          this.showBanner(
            `❌ Upload Error: ${errMsg}`,
            'Open Server Logs & Diagnostics to inspect tunnel throughput and server state.',
            100,
            false
          );
        });
    } else {
      launchAnalyzeRequest(this.videoPath);
    }
  }

  showSyncLockError(titleText, stageText, detailText) {
    const lockEl = document.getElementById('workspace-sync-lock');
    if (!lockEl) return;
    lockEl.classList.remove('hidden');
    const tEl = document.getElementById('sync-lock-title');
    const sEl = document.getElementById('sync-lock-stage');
    const dEl = document.getElementById('sync-lock-detail');
    const fEl = document.getElementById('sync-lock-fill');
    const bgBtn = document.getElementById('btn-sync-lock-bg');
    const diagBtn = document.getElementById('btn-sync-lock-diag');

    if (tEl && titleText) tEl.textContent = titleText;
    if (sEl && stageText) sEl.textContent = stageText;
    if (dEl && detailText) dEl.textContent = detailText;
    if (fEl) {
      fEl.style.width = '100%';
      fEl.style.background = 'var(--shot-error)';
    }
    if (bgBtn) {
      bgBtn.textContent = '🔄 Retry Upload & 3D Analysis';
      bgBtn.onclick = () => {
        if (fEl) fEl.style.background = '';
        bgBtn.textContent = '↩ Keep Watching Previous Match While Processing in Background';
        this.startFullAnalysis();
      };
    }
    if (diagBtn) {
      diagBtn.onclick = () => {
        if (window.antiLagModalInstance) {
          window.antiLagModalInstance.open('diagnostics');
        }
      };
    }
  }

  showSyncLock(titleText, stageText, detailText, pct) {
    const lockEl = document.getElementById('workspace-sync-lock');
    if (!lockEl) return;
    if (!this.backgroundMode && !this.hasSwitchedToNewMatch) {
      lockEl.classList.remove('hidden');
    }
    const tEl = document.getElementById('sync-lock-title');
    const sEl = document.getElementById('sync-lock-stage');
    const dEl = document.getElementById('sync-lock-detail');
    const fEl = document.getElementById('sync-lock-fill');
    const bgBtn = document.getElementById('btn-sync-lock-bg');
    const cancelBtn = document.getElementById('btn-sync-lock-cancel');
    const diagBtn = document.getElementById('btn-sync-lock-diag');

    if (tEl && titleText) tEl.textContent = titleText;
    if (sEl && stageText) sEl.textContent = stageText;
    if (dEl && detailText) dEl.textContent = detailText;
    if (fEl) {
      fEl.style.background = '';
      fEl.style.width = `${Math.max(4, Math.min(100, pct))}%`;
    }

    if (bgBtn) {
      bgBtn.textContent = '↩ Keep Watching Previous Match While Processing in Background';
      bgBtn.onclick = () => {
        this.backgroundMode = true;
        lockEl.classList.add('hidden');
        this.showBanner(
          `🔄 Background Processing: ${this.pendingMatchLabel || 'New Match'}`,
          'You are viewing the previous match while your new video reconstructs in the background.',
          pct,
          true
        );
      };
    }
    if (diagBtn) {
      diagBtn.onclick = () => {
        if (window.antiLagModalInstance) {
          window.antiLagModalInstance.open('diagnostics');
        }
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        lockEl.classList.add('hidden');
        this.stopActiveAnalysis();
        if (this.bannerEl) this.bannerEl.classList.add('hidden');
      };
    }
  }

  hideSyncLock() {
    const lockEl = document.getElementById('workspace-sync-lock');
    if (lockEl) lockEl.classList.add('hidden');
  }

  activateNewMatchInWorkspace(matchId, telemetry) {
    this.hasSwitchedToNewMatch = true;
    this.hideSyncLock();

    const switchReadyBtn = document.getElementById('btn-banner-switch-ready');
    if (switchReadyBtn) switchReadyBtn.classList.add('hidden');

    const videoToLoad = this.pendingVideoSrc || (telemetry && telemetry.source && telemetry.source.video);
    const ytId = this.player && typeof this.player.extractYouTubeIdFromTelemetry === 'function'
      ? this.player.extractYouTubeIdFromTelemetry(telemetry, matchId)
      : null;
    if (this.player) {
      if (videoToLoad) {
        this.player.loadVideoSource(videoToLoad, ytId);
      } else if (ytId) {
        this.player.loadYouTubeVideo(ytId);
      }
    }

    window.HAWKVIEW_TELEMETRY = telemetry;
    if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
    window.HAWKVIEW_MATCHES[matchId] = telemetry;
    window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;

    window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {
      detail: { matchKey: matchId, telemetry }
    }));
  }

  async runStaticStreamingFallback(matchId) {
    this.hideSyncLock();

    // ZERO-HORSESHIT VERIFICATION GUARD:
    // Check if `matchId` is GENUINELY present in bundled memory or browser IndexedDB cache.
    // NEVER silently fall back to 'lzj_popov' or fake a "1s cache load" when the user uploaded an uncached custom video!
    let cachedTelemetry = (window.HAWKVIEW_MATCHES && window.HAWKVIEW_MATCHES[matchId]) || null;
    if (!cachedTelemetry && window.cacheStoreInstance && typeof window.cacheStoreInstance.loadFromIdb === 'function') {
      try {
        cachedTelemetry = await window.cacheStoreInstance.loadFromIdb(matchId);
      } catch (e) {
        cachedTelemetry = null;
      }
    }

    if (!cachedTelemetry) {
      // Uncached custom video on a static host where /api/analyze-start is offline!
      const label = this.uploadedFileName || this.pendingMatchLabel || matchId;
      this.open();
      this.setStatusPill(
        `⚠️ Live Python/GPU Server Offline — Cannot run TrackNetV3 + RTMPose on uncached video "${label}" from static host. Run on local server (:8123) or connect backend.`,
        false
      );
      this.showBanner(
        '⚠️ Live CV / GPU Backend Not Connected (Static Host)',
        `Refused to load fake cached telemetry for uncached video "${label}". Connect the Hawkview Python/Blackwell server (:8123) to reconstruct new videos.`,
        100,
        false
      );
      return;
    }

    if (window.cacheStoreInstance) {
      await window.cacheStoreInstance.switchActiveMatch(matchId, true);
      if (this.player && this.pendingVideoSrc && this.pendingVideoSrc.startsWith('blob:')) {
        this.player.loadVideoSource(this.pendingVideoSrc);
      }
      window.cacheStoreInstance.renderEtaStatmeter({
        percent: 100,
        eta_formatted: '0s',
        elapsed_formatted: '1s',
        accelerator_label: '⚡ Browser IndexedDB Cache'
      }, false);
    }
    this.showBanner('COMPLETE: 3D Telemetry Loaded from Cache', 'Synced player names, court sides & 3D trajectories.', 100, false);
  }

  showBanner(stageText, detailText, pct, isRunning = true) {
    if (!this.bannerEl) return;
    this.bannerEl.classList.remove('hidden');
    this.bannerEl.classList.toggle('is-complete', !isRunning);
    if (this.bannerStageEl) this.bannerStageEl.textContent = stageText;
    if (this.bannerDetailEl) this.bannerDetailEl.textContent = detailText;
    if (this.bannerFillEl) this.bannerFillEl.style.width = `${Math.max(2, Math.min(100, pct))}%`;
    const trackEl = document.getElementById('lab-progress-track');
    if (trackEl) trackEl.classList.toggle('hidden', !isRunning);
    const etaPill = document.getElementById('lab-eta-pill');
    if (etaPill) {
      if (!isRunning) {
        etaPill.classList.add('hidden');
      } else if (etaPill.textContent && etaPill.textContent.trim().length > 0) {
        etaPill.classList.remove('hidden');
      }
    }
    const switchReadyBtn = document.getElementById('btn-banner-switch-ready');
    if (switchReadyBtn && !isRunning && this.hasSwitchedToNewMatch) {
      switchReadyBtn.classList.add('hidden');
    }
    if (this.bannerStopBtn) {
      this.bannerStopBtn.textContent = isRunning ? 'Stop' : 'Dismiss';
      this.bannerStopBtn.onclick = () => {
        if (isRunning) {
          this.stopActiveAnalysis();
        } else {
          this.bannerEl.classList.add('hidden');
        }
      };
    }
  }

  stopActiveAnalysis() {
    this.hideSyncLock();
    this.saveActiveCloudJob(null);
    if (this._ytPollTimer) {
      clearInterval(this._ytPollTimer);
      this._ytPollTimer = null;
    }
    this.setFabState('idle');
    try { localStorage.removeItem('hawkview_active_job'); } catch (e) {}
    if (!this.activeJobMatchId) {
      if (this.bannerEl) this.bannerEl.classList.add('hidden');
      return;
    }
    fetch(this.getApiUrl('/api/analyze-stop'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: this.activeJobMatchId })
    }).catch(() => {});
  }

  startPollingStatus(matchId) {
    if (this.activePollTimer) {
      clearInterval(this.activePollTimer);
    }

    const poll = () => {
      const statusPath = `/api/analyze-status?match_id=${encodeURIComponent(matchId)}`;
      fetch(this.getApiUrl(statusPath))
        .catch(() => {
          this.refreshTunnelUrl();
          return fetch(statusPath);
        })
        .then((r) => r.json())
        .then((job) => {
          if (!job || (!job.status && job.error)) return;

          if (job.status === 'error') {
            try { localStorage.removeItem('hawkview_active_job'); } catch (e) {}
            clearInterval(this.activePollTimer);
            this.activePollTimer = null;
            const errStr = job.error || 'Unknown pipeline error';
            this.showSyncLockError(
              `❌ Server Pipeline Error (${matchId})`,
              `ERROR: ${errStr}`,
              'Click "🩺 Server Logs & Diagnostics" below to inspect the live Python stack trace, chunk upload session, and server event logs.'
            );
            this.showBanner(
              `❌ Pipeline Error: ${errStr}`,
              'Open Server Logs & Diagnostics to inspect the full Python stack trace.',
              100,
              false
            );
            return;
          }

          const pct = Number(job.percent) || 5;
          const rDone = Number(job.rallies_completed) || 0;
          const rTotal = Number(job.rallies_total) || 0;
          const isRunning = job.status === 'running';

          this.showBanner(
            job.stage || 'Analyzing Video...',
            job.message || `${rDone} / ${rTotal} rallies ready`,
            pct,
            isRunning
          );

          if (!this.backgroundMode && !this.hasSwitchedToNewMatch && rDone === 0 && isRunning) {
            this.showSyncLock(
              `⏳ Syncing New Video: ${this.pendingMatchLabel || matchId}`,
              job.stage || 'Calibrating Court & Segmenting Rallies...',
              job.message || 'Preparing 3D trajectories...',
              pct
            );
          }

          if (window.cacheStoreInstance) {
            if (job.eta) {
              window.cacheStoreInstance.renderEtaStatmeter(job.eta, isRunning);
            }
            if (job.colab_quota) {
              window.cacheStoreInstance.renderQuotaStatmeter(job.colab_quota);
            }
          }

          // Only switch or stream into the 3D UI once at least 1 rally is reconstructed (or job is completed)!
          if (job.telemetry && (rDone >= 1 || job.status === 'completed') && rDone !== this.lastStreamedRallyCount) {
            this.lastStreamedRallyCount = rDone;

            if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
            window.HAWKVIEW_MATCHES[matchId] = job.telemetry;
            if (window.cacheStoreInstance) {
              window.cacheStoreInstance.saveMatchTelemetry(matchId, job.telemetry);
              window.cacheStoreInstance.updateTopbarHeader(matchId, job.telemetry);
            }

            if (this.backgroundMode && !this.hasSwitchedToNewMatch) {
              // User asked to keep watching previous match in background — show 1-click switch button!
              const switchReadyBtn = document.getElementById('btn-banner-switch-ready');
              if (switchReadyBtn) {
                switchReadyBtn.classList.remove('hidden');
                switchReadyBtn.textContent = `✅ ${this.pendingMatchLabel || 'New Match'} Ready (${rDone}/${rTotal || rDone} Rallies) — Click to Switch Now`;
                switchReadyBtn.onclick = () => {
                  this.backgroundMode = false;
                  this.activateNewMatchInWorkspace(matchId, job.telemetry);
                };
              }
            } else if (!this.hasSwitchedToNewMatch) {
              this.activateNewMatchInWorkspace(matchId, job.telemetry);
            } else {
              window.HAWKVIEW_TELEMETRY = job.telemetry;
              window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;
              window.dispatchEvent(new CustomEvent('hawkview:ralliesStreamUpdated', {
                detail: { matchKey: matchId, telemetry: job.telemetry, ralliesCompleted: rDone, ralliesTotal: rTotal }
              }));
            }
          }

          if (job.status === 'completed' || job.status === 'stopped') {
            this.hideSyncLock();
            try { localStorage.removeItem('hawkview_active_job'); } catch (e) {}
            if (window.cacheStoreInstance) {
              if (job.telemetry) {
                window.cacheStoreInstance.updateTopbarHeader(matchId, job.telemetry);
              }
              window.cacheStoreInstance.refreshMatchesAndQuota(false);
            }
            clearInterval(this.activePollTimer);
            this.activePollTimer = null;
          }
        })
        .catch(() => {});
    };

    poll();
    this.activePollTimer = setInterval(poll, 1000);
  }
}

window.VideoLoaderModal = VideoLoaderModal;
