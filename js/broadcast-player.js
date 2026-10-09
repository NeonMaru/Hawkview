/**
 * Broadcast Video Player & Synchronized Match Engine
 * Provides:
 * - High-octane synthetic BWF TV broadcast simulation (or real video fallback)
 * - Dynamic 3D perspective court rendering with animated player actions
 * - Speed gun radar flash overlay on smashes (e.g. 412 KM/H LZJ!)
 * - Web Audio API synthesized mechanical watch clicks and shuttlecock smash cracks
 * - Frame-accurate timecode scrubbing synchronized with dials & court
 */

class BroadcastPlayer {
  constructor(options = {}) {
    this.canvas = document.getElementById('broadcast-canvas');
    this.videoElement = document.getElementById('real-video-player');
    this.timelineSlider = document.getElementById('rally-timeline-slider');
    this.playBtn = document.getElementById('btn-play-pause');

    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onRallyChange = options.onRallyChange || (() => {});

    this.isPlaying = false;
    this.currentTime = 312.1; // Start at Rally #18 (LZJ 412km/h smash)
    this.playbackRate = 1.0;
    this.currentRallyIndex = 1; // Rally #18
    this.activeShotIndex = 0;

    this.rallies = window.HAWKVIEW_TELEMETRY ? window.HAWKVIEW_TELEMETRY.rallies : [];
    this.currentRally = this.rallies[this.currentRallyIndex] || null;

    this.radarFlash = { text: '', alpha: 0, speed: 0 };
    this.audioCtx = null;

    this.initCanvas();
    this.bindEvents();
    this.startAnimationLoop();
  }

  initCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 720;
    this.height = rect.height || 420;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
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
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.04);
    } catch (e) {
      // Audio autoplay policy catch
    }
  }

  playSmashSound(speedKmh) {
    this.initAudio();
    if (!this.audioCtx) return;
    try {
      // Noise burst + low kick for thunder smash
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
    window.addEventListener('resize', () => this.initCanvas());

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
    this.canvas.classList.add('hidden');
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
    const icon = this.playBtn.querySelector('i') || this.playBtn;
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

    // Trigger speed radar flash for top smash in rally
    if (this.currentRally.max_smash_kmh >= 380) {
      this.triggerRadarFlash(`⚡ ${this.currentRally.max_smash_kmh} KM/H`, this.currentRally.max_smash_kmh);
    }

    this.syncRallyState();
    this.onRallyChange(this.currentRally);
  }

  triggerRadarFlash(text, speed) {
    this.radarFlash = {
      text: text,
      alpha: 1.0,
      speed: speed
    };
    this.playSmashSound(speed);
  }

  syncRallyState() {
    if (!this.currentRally) return;

    // Check if time passed rally end
    if (this.currentTime > this.currentRally.seconds_end) {
      this.currentTime = this.currentRally.seconds_start;
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
          this.triggerRadarFlash(`⚡ SMASH: ${shot.speed_kmh} KM/H`, shot.speed_kmh);
        }
      }
    }

    // Callback to update sub-dials, LCD, and court
    this.onTimeUpdate({
      time: this.currentTime,
      elapsed: elapsed,
      rally: this.currentRally,
      shotIndex: this.activeShotIndex,
      shot: this.currentRally.shots ? this.currentRally.shots[this.activeShotIndex] : null
    });
  }

  startAnimationLoop() {
    let lastTimestamp = performance.now();

    const loop = (timestamp) => {
      const deltaSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (this.isPlaying && this.currentRally) {
        this.currentTime += deltaSec * this.playbackRate;
        this.syncRallyState();
      }

      // Fade radar flash
      if (this.radarFlash.alpha > 0) {
        this.radarFlash.alpha -= deltaSec * 0.75;
      }

      this.renderSyntheticBroadcast();
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  /**
   * Renders high-octane 3D perspective simulated BWF TV broadcast
   */
  renderSyntheticBroadcast() {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Stadium Atmosphere (Energia Areena dark arena + overhead floodlights)
    const arenaGrad = ctx.createLinearGradient(0, 0, 0, h);
    arenaGrad.addColorStop(0, '#0c1017');
    arenaGrad.addColorStop(0.5, '#121824');
    arenaGrad.addColorStop(1, '#080a0f');
    ctx.fillStyle = arenaGrad;
    ctx.fillRect(0, 0, w, h);

    // Floodlight beams
    ctx.fillStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(w * 0.2, 0);
    ctx.lineTo(w * 0.4, h);
    ctx.lineTo(w * 0.1, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(0, 229, 163, 0.04)';
    ctx.beginPath();
    ctx.moveTo(w * 0.8, 0);
    ctx.lineTo(w * 0.9, h);
    ctx.lineTo(w * 0.6, h);
    ctx.closePath();
    ctx.fill();

    // 2. 3D Perspective Court Geometry (Simulating elevated main TV broadcast camera)
    // Vanishing point perspective
    const pFarLeft = { x: w * 0.22, y: h * 0.22 };
    const pFarRight = { x: w * 0.78, y: h * 0.22 };
    const pNearRight = { x: w * 0.92, y: h * 0.85 };
    const pNearLeft = { x: w * 0.08, y: h * 0.85 };

    // Court Mat 3D Polygon
    ctx.beginPath();
    ctx.moveTo(pFarLeft.x, pFarLeft.y);
    ctx.lineTo(pFarRight.x, pFarRight.y);
    ctx.lineTo(pNearRight.x, pNearRight.y);
    ctx.lineTo(pNearLeft.x, pNearLeft.y);
    ctx.closePath();

    const courtGrad = ctx.createLinearGradient(0, pFarLeft.y, 0, pNearLeft.y);
    courtGrad.addColorStop(0, '#0a4f47');
    courtGrad.addColorStop(1, '#0f766e');
    ctx.fillStyle = courtGrad;
    ctx.fill();

    // White Court Boundary Lines in 3D
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Mid-court Net line (in perspective at ~45% height)
    const netY = pFarLeft.y + (pNearLeft.y - pFarLeft.y) * 0.45;
    const netLeftX = pFarLeft.x + (pNearLeft.x - pFarLeft.x) * 0.45;
    const netRightX = pFarRight.x + (pNearRight.x - pFarRight.x) * 0.45;

    // Net Mesh
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(netLeftX, netY);
    ctx.lineTo(netRightX, netY);
    ctx.stroke();

    // Net Height Cord
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    for (let x = netLeftX; x <= netRightX; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, netY);
      ctx.lineTo(x, netY - 14);
      ctx.stroke();
    }
    // Net top band
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(netLeftX, netY - 14);
    ctx.lineTo(netRightX, netY - 14);
    ctx.stroke();

    // 3. Perspective Player Avatars & Dynamic Rallies
    const currentShot = this.currentRally && this.currentRally.shots
      ? this.currentRally.shots[this.activeShotIndex]
      : null;

    // Player 2 (Su Li Yang - Far side / Top)
    const p2x = w * 0.5 + Math.sin(this.currentTime * 3) * (w * 0.12);
    const p2y = netY - 35;
    this.renderBroadcastPlayerSprite(ctx, p2x, p2y, '#ff5722', 'SU L.Y.', false);

    // Player 1 (Lee Zii Jia - Near side / Bottom)
    const p1x = w * 0.5 + Math.cos(this.currentTime * 2.5) * (w * 0.16);
    const p1y = netY + 80;
    const isSmashing = currentShot && currentShot.stroke.includes('Smash');
    this.renderBroadcastPlayerSprite(ctx, p1x, p1y, '#00f0ff', 'LEE Z.J.', isSmashing);

    // 4. Supersonic Shuttlecock Ballistic Arc
    const shuttleCycle = (this.currentTime * 2) % 1;
    const sX = isSmashing ? p1x + (p2x - p1x) * shuttleCycle : p2x + (p1x - p2x) * shuttleCycle;
    const sY = isSmashing ? p1y + (p2y - p1y) * shuttleCycle : p2y + (p1y - p2y) * shuttleCycle;
    const sZ = Math.sin(shuttleCycle * Math.PI) * 35;

    // Draw Aerodynamic Vapor Trail
    ctx.strokeStyle = isSmashing ? 'rgba(255, 42, 85, 0.7)' : 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = isSmashing ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(sX - 25, sY - sZ + 10);
    ctx.lineTo(sX, sY - sZ);
    ctx.stroke();

    // Shuttlecock head
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = isSmashing ? '#ff2a55' : '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(sX, sY - sZ, isSmashing ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 5. Official BWF TV Graphics Overlay (Top-Left Scorebug)
    this.renderBWFScorebug(ctx);

    // 6. Speed Gun Radar Banner (When smash triggers)
    if (this.radarFlash.alpha > 0.05) {
      this.renderSpeedRadarBanner(ctx);
    }
  }

  renderBroadcastPlayerSprite(ctx, x, y, color, name, isJumping) {
    ctx.save();
    ctx.translate(x, isJumping ? y - 18 : y);

    // Drop Shadow on court floor
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, isJumping ? 22 : 4, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Athletic Player Body
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    // Torso
    ctx.fillRect(-6, -26, 12, 18);
    // Head
    ctx.beginPath();
    ctx.arc(0, -32, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Racket
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, -22);
    ctx.lineTo(16, isJumping ? -42 : -28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(16, isJumping ? -42 : -28, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Player Nameplate
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(-28, 8, 56, 14);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(-28, 8, 56, 14);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 0, 18);

    ctx.restore();
  }

  renderBWFScorebug(ctx) {
    const p1Score = this.currentRally ? this.currentRally.score_after.player_1 : 5;
    const p2Score = this.currentRally ? this.currentRally.score_after.player_2 : 5;

    // TV Graphics Box
    ctx.save();
    ctx.translate(20, 20);

    // Background Container
    ctx.fillStyle = 'rgba(11, 14, 20, 0.92)';
    ctx.fillRect(0, 0, 240, 52);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, 240, 52);

    // Left Tournament Accent Bar
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(0, 0, 4, 52);

    // Tournament Header
    ctx.font = 'bold 7px "Orbitron", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('BWF ARCTIC OPEN | QF GAME 2', 12, 12);

    // Row 1: MAS LEE Z.J.
    ctx.font = 'bold 10px "Rajdhani", sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('🇲🇾 MAS', 12, 28);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('LEE ZII JIA', 60, 28);

    // Score 1
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 13px "Orbitron", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(p1Score.toString(), 228, 28);

    // Row 2: TPE SU L.Y.
    ctx.font = 'bold 10px "Rajdhani", sans-serif';
    ctx.fillStyle = '#ff5722';
    ctx.textAlign = 'left';
    ctx.fillText('🇹🇼 TPE', 12, 44);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('SU LI YANG', 60, 44);

    // Score 2
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 13px "Orbitron", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(p2Score.toString(), 228, 44);

    ctx.restore();
  }

  renderSpeedRadarBanner(ctx) {
    const alpha = Math.max(0, Math.min(1, this.radarFlash.alpha));
    const isRecord = this.radarFlash.speed >= 400;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Centered or Bottom-Right Radar Display
    const rw = 260;
    const rh = 48;
    const rx = this.width - rw - 20;
    const ry = this.height - rh - 20;

    // Glass panel
    ctx.fillStyle = isRecord ? 'rgba(255, 42, 85, 0.9)' : 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = isRecord ? '#ffffff' : '#00f0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px "Orbitron", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(isRecord ? '🔥 RECORD SMASH VELOCITY' : '⚡ BWF SMASH RADAR', rx + 14, ry + 18);

    ctx.font = '900 18px "Orbitron", monospace';
    ctx.fillStyle = isRecord ? '#ffffff' : '#00f0ff';
    ctx.fillText(this.radarFlash.text, rx + 14, ry + 40);

    ctx.restore();
  }
}

window.BroadcastPlayer = BroadcastPlayer;
