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

    this.bindEvents();
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

    this.previewVideo.addEventListener('loadeddata', () => {
      this.videoWidth = this.previewVideo.videoWidth || 1920;
      this.videoHeight = this.previewVideo.videoHeight || 1080;
      this.videoDuration = this.previewVideo.duration || 60;
      if (this.canvas) {
        this.canvas.width = this.videoWidth;
        this.canvas.height = this.videoHeight;
      }
      if (this.frameSlider) {
        this.frameSlider.max = Math.max(1, Math.floor(this.videoDuration));
      }
      this.drawCalibrationCanvas();
    });

    this.previewVideo.addEventListener('seeked', () => {
      this.drawCalibrationCanvas();
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

  open() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');

    // Load current active video into the calibration preview if not already loaded
    const currentSrc = (this.player && this.player.videoElement && this.player.videoElement.getAttribute('src')) || 'assets/LZJvPopov.mp4';
    if (!this.previewVideo.getAttribute('src')) {
      this.loadServerVideoIntoPreview(currentSrc, 15.0);
    } else {
      this.drawCalibrationCanvas();
    }
  }

  openWithFile(file) {
    this.open();
    if (file) {
      this.uploadFileToServer(file);
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
  }

  setStatusPill(text, isGood = true) {
    if (!this.statusPillEl) return;
    this.statusPillEl.textContent = text;
    this.statusPillEl.style.color = isGood ? 'var(--shot-continue)' : 'var(--shot-selected)';
  }

  loadServerVideoIntoPreview(videoPath, initialTimeSec = 15.0) {
    this.videoPath = videoPath;
    this.previewVideo.src = videoPath;
    this.previewVideo.load();

    const fileLabelEl = document.getElementById('calib-active-filename');
    if (fileLabelEl) {
      fileLabelEl.textContent = videoPath.split('/').pop();
    }

    fetch('/api/upload-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: videoPath, sample_time_sec: initialTimeSec })
    })
      .then((r) => r.json())
      .then((info) => {
        if (info && !info.error) {
          this.applyProbedVideoInfo(info);
        }
      })
      .catch(() => {});
  }

  uploadFileToServer(file) {
    if (!file || this.isUploading) return;
    this.isUploading = true;

    const fileLabelEl = document.getElementById('calib-active-filename');
    if (fileLabelEl) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      fileLabelEl.textContent = `${file.name} (${mb} MB) — Uploading...`;
    }
    this.setStatusPill('Uploading MP4 to local engine...', false);

    // Immediately preview locally via blob URL for instant responsiveness
    const localBlobUrl = URL.createObjectURL(file);
    this.previewVideo.src = localBlobUrl;
    this.previewVideo.load();

    // Auto-fill player names or mode hints if recreational
    const modeSelect = document.getElementById('calib-camera-mode');
    if (modeSelect && !file.name.toLowerCase().includes('bwf') && !file.name.toLowerCase().includes('lzj')) {
      modeSelect.value = 'auto';
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-video', true);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && fileLabelEl) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        fileLabelEl.textContent = `Uploading ${file.name} (${pct}%)...`;
      }
    };

    xhr.onload = () => {
      this.isUploading = false;
      try {
        const info = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && info && !info.error) {
          this.applyProbedVideoInfo(info, file.name);
        } else {
          this.setStatusPill(`Upload error: ${(info && info.error) || xhr.statusText}`, false);
        }
      } catch (err) {
        this.setStatusPill('Failed to parse server response', false);
      }
    };

    xhr.onerror = () => {
      this.isUploading = false;
      this.setStatusPill('Upload failed — check server connection', false);
    };

    xhr.send(file);
  }

  applyProbedVideoInfo(info, displayFilename = null) {
    this.videoPath = info.video_path || this.videoPath;
    this.matchId = info.match_id || this.matchId;
    this.videoWidth = info.width || 1920;
    this.videoHeight = info.height || 1080;
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
        this.setStatusPill(`✓ Auto-calibrated BWF court (RMSE ${cal.line_sample_rmse_px}px) — drag any point to adjust`, true);
      } else {
        this.setStatusPill('Drag the 4 Court Corners + 2 Net Posts to align the wireframe with your court', false);
      }
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

  runServerAutoCalibrate() {
    const curTime = parseFloat(this.frameSlider ? this.frameSlider.value : 15.0) || 15.0;
    this.setStatusPill('Detecting white court lines on current frame...', false);
    fetch('/api/auto-calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: this.videoPath, time_sec: curTime })
    })
      .then((r) => r.json())
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
          Object.keys(this.keypoints).forEach((k) => {
            if (cal.keypoints[k]) {
              this.keypoints[k] = [Number(cal.keypoints[k][0]), Number(cal.keypoints[k][1])];
            }
          });
          this.drawCalibrationCanvas();
          if (cal.auto_refined) {
            this.setStatusPill(`✓ Snapped to white court lines (RMSE ${cal.line_sample_rmse_px}px)`, true);
          } else {
            this.setStatusPill('Reset handles to standard court — drag the 6 handles onto your court corners', false);
          }
        }
      })
      .catch(() => {
        this.setStatusPill('Could not auto-detect — drag the 6 handles manually', false);
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
    const maxRalliesSelect = document.getElementById('calib-max-rallies');

    const nearRaw = (nearNameInput && nearNameInput.value.trim()) || 'Player 1';
    const farRaw = (farNameInput && farNameInput.value.trim()) || 'Player 2';
    const nearId = nearRaw.length <= 10 ? nearRaw.toUpperCase() : nearRaw.slice(0, 10).toUpperCase();
    const farId = farRaw.length <= 10 ? farRaw.toUpperCase() : farRaw.slice(0, 10).toUpperCase();
    const mode = (modeSelect && modeSelect.value) || 'auto';
    const maxRallies = parseInt((maxRalliesSelect && maxRalliesSelect.value) || '0', 10) || 0;

    const payload = {
      match_id: this.matchId,
      video_path: this.videoPath,
      keypoints: this.keypoints,
      near_player: { id: nearId, name: nearRaw, country: 'NEAR', dominant_hand: 'Right' },
      far_player: { id: farId, name: farRaw, country: 'FAR', dominant_hand: 'Right' },
      mode,
      max_rallies: maxRallies
    };

    // Switch the main broadcast player to this video source immediately
    if (this.player) {
      this.player.loadVideoSource(this.videoPath);
    }

    this.close();
    this.showBanner('STAGE 1: Calibrating Court & Segmenting Rallies...', 'Preparing 3D trajectory solver...', 5, true);

    fetch('/api/analyze-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then((r) => r.json())
      .then((res) => {
        if (res && res.match_id) {
          this.activeJobMatchId = res.match_id;
          this.lastStreamedRallyCount = -1;
          this.startPollingStatus(res.match_id);
        } else {
          this.showBanner('Analysis Error', (res && res.error) || 'Could not start analysis', 100, false);
        }
      })
      .catch((err) => {
        this.showBanner('Analysis Error', String(err), 100, false);
      });
  }

  showBanner(stageText, detailText, pct, isRunning = true) {
    if (!this.bannerEl) return;
    this.bannerEl.classList.remove('hidden');
    if (this.bannerStageEl) this.bannerStageEl.textContent = stageText;
    if (this.bannerDetailEl) this.bannerDetailEl.textContent = detailText;
    if (this.bannerFillEl) this.bannerFillEl.style.width = `${Math.max(2, Math.min(100, pct))}%`;
    if (this.bannerStopBtn) {
      this.bannerStopBtn.textContent = isRunning ? '⏹ Stop & Keep Rallies' : '✕ Dismiss';
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
    if (!this.activeJobMatchId) {
      if (this.bannerEl) this.bannerEl.classList.add('hidden');
      return;
    }
    fetch('/api/analyze-stop', {
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
      fetch(`/api/analyze-status?match_id=${encodeURIComponent(matchId)}`)
        .then((r) => r.json())
        .then((job) => {
          if (!job || job.error) return;

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

          // Progressive live rally streaming into the 3D UI!
          if (job.telemetry && rDone !== this.lastStreamedRallyCount) {
            const isFirstSwitch = this.lastStreamedRallyCount < 0;
            this.lastStreamedRallyCount = rDone;

            window.HAWKVIEW_TELEMETRY = job.telemetry;
            if (!window.HAWKVIEW_MATCHES) window.HAWKVIEW_MATCHES = {};
            window.HAWKVIEW_MATCHES[matchId] = job.telemetry;
            window.HAWKVIEW_ACTIVE_MATCH_KEY = matchId;

            const metaEl = document.getElementById('header-match-title');
            if (metaEl && job.telemetry.match_metadata) {
              const mm = job.telemetry.match_metadata;
              metaEl.textContent = `${mm.tournament || 'Custom Match'} · ${mm.round || 'Singles'} · ${rDone}/${rTotal || '?'} Rallies Ready`;
            }

            if (isFirstSwitch) {
              window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {
                detail: { matchKey: matchId, telemetry: job.telemetry }
              }));
            } else {
              window.dispatchEvent(new CustomEvent('hawkview:ralliesStreamUpdated', {
                detail: { matchKey: matchId, telemetry: job.telemetry, ralliesCompleted: rDone, ralliesTotal: rTotal }
              }));
            }
          }

          if (job.status === 'completed' || job.status === 'stopped' || job.status === 'error') {
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
