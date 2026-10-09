/**
 * Casio Edifice Chronograph Sub-Dials Renderer
 * High-DPI 60FPS Canvas dials for:
 * 1. Smash Speedometer (0 - 500 km/h with 412 km/h Redline Indicator)
 * 2. Rally Shot Counter (0 - 60 Shots Mechanical Register)
 * 3. Sprint & Court Coverage Meter (0 - 5.0 km & Sprint Velocity)
 */

class SubDialManager {
  constructor() {
    this.speedometerCanvas = document.getElementById('speedometer-canvas');
    this.shotCounterCanvas = document.getElementById('shotcounter-canvas');
    this.coverageCanvas = document.getElementById('coverage-canvas');

    // Current animated values (for smooth spring physics)
    this.currentSpeed = 0;
    this.targetSpeed = 412; // Start highlighting LZJ's 412 km/h smash
    this.peakSpeed = 412;

    this.currentShots = 0;
    this.targetShots = 24;
    this.avgShots = 21.5;

    this.currentSprintKm = 0;
    this.targetSprintKm = 2.84;
    this.currentSprintKmh = 0;
    this.targetSprintKmh = 22.4;

    this.activePlayer = 'LZJ';

    this.initCanvases();
    this.bindEvents();
    this.startRenderLoop();
  }

  initCanvases() {
    [this.speedometerCanvas, this.shotCounterCanvas, this.coverageCanvas].forEach(canvas => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const size = rect.width || 220;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.initCanvases();
    });

    if (this.speedometerCanvas) {
      this.speedometerCanvas.addEventListener('click', () => {
        // Toggle test speed pulse
        const testSpeeds = [412, 388, 365, 342, 395, 404, 180];
        const nextSpeed = testSpeeds[Math.floor(Math.random() * testSpeeds.length)];
        this.setSpeed(nextSpeed);
      });
    }
  }

  setSpeed(speedKmh, isSmash = false) {
    this.targetSpeed = Math.min(500, Math.max(0, speedKmh));
    if (this.targetSpeed > this.peakSpeed) {
      this.peakSpeed = this.targetSpeed;
    }
    const lcdVal = document.getElementById('subdial-speed-lcd');
    if (lcdVal) {
      lcdVal.textContent = `${this.targetSpeed.toFixed(0)} KM/H`;
    }
    const peakLcd = document.getElementById('subdial-speed-peak');
    if (peakLcd) {
      peakLcd.textContent = `PEAK ${this.peakSpeed.toFixed(0)}`;
    }
  }

  setShotCount(shots, totalInRally = 24) {
    this.targetShots = Math.min(60, Math.max(0, shots));
    const lcdVal = document.getElementById('subdial-shots-lcd');
    if (lcdVal) {
      lcdVal.textContent = `${shots} / ${totalInRally}`;
    }
  }

  setCoverage(km, burstKmh = 18.5) {
    this.targetSprintKm = km;
    this.targetSprintKmh = burstKmh;
    const lcdVal = document.getElementById('subdial-coverage-lcd');
    if (lcdVal) {
      lcdVal.textContent = `${km.toFixed(2)} KM`;
    }
  }

  startRenderLoop() {
    const render = () => {
      // Damped spring physics
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * 0.12;
      this.currentShots += (this.targetShots - this.currentShots) * 0.14;
      this.currentSprintKm += (this.targetSprintKm - this.currentSprintKm) * 0.1;
      this.currentSprintKmh += (this.targetSprintKmh - this.currentSprintKmh) * 0.12;

      this.drawSpeedometer();
      this.drawShotCounter();
      this.drawCoverageGauge();

      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  /**
   * 1. SMASH SPEEDOMETER (0 - 500 KM/H)
   * Arc spans 220 degrees (from 160 deg to 380/20 deg)
   */
  drawSpeedometer() {
    const canvas = this.speedometerCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 12;

    ctx.clearRect(0, 0, w, h);

    // Outer Beveled Steel Ring
    const gradRing = ctx.createLinearGradient(0, 0, w, h);
    gradRing.addColorStop(0, '#2e3748');
    gradRing.addColorStop(0.5, '#161922');
    gradRing.addColorStop(1, '#3b455b');
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = gradRing;
    ctx.fill();
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Concentric Guilloché Grooves Background
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#080a0f';
    ctx.fill();

    // Subtle vinyl rings
    ctx.lineWidth = 0.5;
    for (let r = radius - 8; r > 20; r -= 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.stroke();
    }

    // Gauge Arc Angles: from 140° (left bottom) to 400° / 40° (right bottom) = 260° sweep
    const startAngle = (140 * Math.PI) / 180;
    const endAngle = (400 * Math.PI) / 180;
    const totalAngle = endAngle - startAngle;

    // Track Background
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, startAngle, endAngle);
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Colored Velocity Zones:
    // Green Zone: 0 - 200 km/h (0 to 40% of arc)
    const angle200 = startAngle + totalAngle * (200 / 500);
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, startAngle, angle200);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Yellow / Amber Zone: 200 - 350 km/h (40% to 70% of arc)
    const angle350 = startAngle + totalAngle * (350 / 500);
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, angle200, angle350);
    ctx.strokeStyle = '#ffb703';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Redline Zone: 350 - 500 km/h (70% to 100% of arc)
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, angle350, endAngle);
    ctx.strokeStyle = '#ff2a55';
    ctx.lineWidth = 9;
    ctx.shadowColor = '#ff2a55';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset

    // Numbered Ticks & Markings
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let speed = 0; speed <= 500; speed += 50) {
      const pct = speed / 500;
      const angle = startAngle + pct * totalAngle;
      const isMajor = speed % 100 === 0;

      const tickInner = radius - (isMajor ? 28 : 24);
      const tickOuter = radius - 20;

      const x1 = cx + Math.cos(angle) * tickInner;
      const y1 = cy + Math.sin(angle) * tickInner;
      const x2 = cx + Math.cos(angle) * tickOuter;
      const y2 = cy + Math.sin(angle) * tickOuter;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? (speed >= 350 ? '#ff2a55' : '#e2e8f0') : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      if (isMajor) {
        const textR = radius - 38;
        const tx = cx + Math.cos(angle) * textR;
        const ty = cy + Math.sin(angle) * textR;
        ctx.fillStyle = speed >= 350 ? '#ff2a55' : '#cbd5e1';
        ctx.fillText(speed.toString(), tx, ty);
      }
    }

    // 412 km/h Peak Hold Notch & Label
    const peakPct = 412 / 500;
    const peakAngle = startAngle + peakPct * totalAngle;
    const px1 = cx + Math.cos(peakAngle) * (radius - 12);
    const py1 = cy + Math.sin(peakAngle) * (radius - 12);
    const px2 = cx + Math.cos(peakAngle) * (radius - 24);
    const py2 = cy + Math.sin(peakAngle) * (radius - 24);

    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Subdial Brand / Header Text
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('SMASH VELOCITY', cx, cy - 32);
    ctx.font = '7px "Share Tech Mono", monospace';
    ctx.fillStyle = '#ff2a55';
    ctx.fillText('REDLINE > 350 KM/H', cx, cy - 22);

    // Primary Animated Metallic Needle
    const currentPct = Math.min(1, Math.max(0, this.currentSpeed / 500));
    const needleAngle = startAngle + currentPct * totalAngle;
    const needleLen = radius - 20;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    // Drop shadow
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;

    // Needle body (Tapered titanium with red tip)
    ctx.beginPath();
    ctx.moveTo(-14, -2);
    ctx.lineTo(needleLen - 18, -1.5);
    ctx.lineTo(needleLen, 0);
    ctx.lineTo(needleLen - 18, 1.5);
    ctx.lineTo(-14, 2);
    ctx.closePath();
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();

    // Red luminous tip
    ctx.beginPath();
    ctx.moveTo(needleLen - 26, -1.5);
    ctx.lineTo(needleLen, 0);
    ctx.lineTo(needleLen - 26, 1.5);
    ctx.closePath();
    ctx.fillStyle = '#ff2a55';
    ctx.fill();

    // Center Hub (Dual-stage knurled screw cap)
    ctx.restore();
    ctx.shadowBlur = 0;

    // Hub rim
    const hubGrad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 14);
    hubGrad.addColorStop(0, '#64748b');
    hubGrad.addColorStop(0.5, '#1e293b');
    hubGrad.addColorStop(1, '#0f172a');
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center Gold/Cyan Accent Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.fill();
  }

  /**
   * 2. RALLY SHOT COUNTER (0 - 60 SHOTS REGISTER)
   * 360-degree precision watch register
   */
  drawShotCounter() {
    const canvas = this.shotCounterCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 12;

    ctx.clearRect(0, 0, w, h);

    // Bezel
    const gradRing = ctx.createLinearGradient(0, 0, w, h);
    gradRing.addColorStop(0, '#2e3748');
    gradRing.addColorStop(0.5, '#161922');
    gradRing.addColorStop(1, '#3b455b');
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = gradRing;
    ctx.fill();
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dial background
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#080a0f';
    ctx.fill();

    // Vinyl grooves
    ctx.lineWidth = 0.5;
    for (let r = radius - 8; r > 18; r -= 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.stroke();
    }

    // 60-shot markings (from top -90° clockwise)
    ctx.font = 'bold 9px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let shot = 0; shot < 60; shot += 2) {
      const angle = (shot / 60) * Math.PI * 2 - Math.PI / 2;
      const isMajor = shot % 10 === 0;
      const isSemiMajor = shot % 5 === 0;

      const tickInner = radius - (isMajor ? 24 : isSemiMajor ? 20 : 16);
      const tickOuter = radius - 12;

      const x1 = cx + Math.cos(angle) * tickInner;
      const y1 = cy + Math.sin(angle) * tickInner;
      const x2 = cx + Math.cos(angle) * tickOuter;
      const y2 = cy + Math.sin(angle) * tickOuter;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? '#00f0ff' : isSemiMajor ? '#94a3b8' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      if (isMajor) {
        const textR = radius - 34;
        const tx = cx + Math.cos(angle) * textR;
        const ty = cy + Math.sin(angle) * textR;
        ctx.fillStyle = shot === 0 ? '#00f0ff' : '#cbd5e1';
        ctx.fillText(shot === 0 ? '60' : shot.toString(), tx, ty);
      }
    }

    // Dial text
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('SHOT REGISTER', cx, cy - 28);
    ctx.font = '7px "Share Tech Mono", monospace';
    ctx.fillStyle = '#00e5a3';
    ctx.fillText('AVG: 21.5 SHOTS', cx, cy + 30);

    // Needle: Current Shot Count (Cyan tip)
    const shotPct = Math.min(1, Math.max(0, this.currentShots / 60));
    const needleAngle = shotPct * Math.PI * 2 - Math.PI / 2;
    const needleLen = radius - 16;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    ctx.beginPath();
    ctx.moveTo(-12, -2);
    ctx.lineTo(needleLen - 16, -1);
    ctx.lineTo(needleLen, 0);
    ctx.lineTo(needleLen - 16, 1);
    ctx.lineTo(-12, 2);
    ctx.closePath();
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(needleLen - 20, -1);
    ctx.lineTo(needleLen, 0);
    ctx.lineTo(needleLen - 20, 1);
    ctx.closePath();
    ctx.fillStyle = '#00f0ff';
    ctx.fill();

    ctx.restore();

    // Center Hub
    const hubGrad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 12);
    hubGrad.addColorStop(0, '#475569');
    hubGrad.addColorStop(1, '#0f172a');
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00e5a3';
    ctx.fill();
  }

  /**
   * 3. SPRINT & COURT COVERAGE METER (KM COVERED & VELOCITY)
   */
  drawCoverageGauge() {
    const canvas = this.coverageCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 12;

    ctx.clearRect(0, 0, w, h);

    // Bezel
    const gradRing = ctx.createLinearGradient(0, 0, w, h);
    gradRing.addColorStop(0, '#2e3748');
    gradRing.addColorStop(0.5, '#161922');
    gradRing.addColorStop(1, '#3b455b');
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = gradRing;
    ctx.fill();
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dial background
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#080a0f';
    ctx.fill();

    // Concentric arc tracks:
    // Outer Arc: Total Distance (0 - 5.0 km)
    // Inner Arc: Sprint Burst Speed (0 - 30 km/h)
    const startAngle = (135 * Math.PI) / 180;
    const endAngle = (405 * Math.PI) / 180;
    const totalAngle = endAngle - startAngle;

    // Track 1 (Outer: Distance)
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, startAngle, endAngle);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 6;
    ctx.stroke();

    const distPct = Math.min(1, Math.max(0, this.currentSprintKm / 5.0));
    const distAngle = startAngle + distPct * totalAngle;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 16, startAngle, distAngle);
    ctx.strokeStyle = '#00e5a3';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#00e5a3';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Track 2 (Inner: Sprint Burst Velocity)
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 30, startAngle, endAngle);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 5;
    ctx.stroke();

    const sprintPct = Math.min(1, Math.max(0, this.currentSprintKmh / 30.0));
    const sprintAngle = startAngle + sprintPct * totalAngle;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 30, startAngle, sprintAngle);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Markings
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('COVERAGE & SPRINT', cx, cy - 34);

    ctx.font = 'bold 8px "Rajdhani", sans-serif';
    ctx.fillStyle = '#00e5a3';
    ctx.fillText(`DIST: ${this.currentSprintKm.toFixed(2)} KM`, cx, cy + 26);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`BURST: ${this.currentSprintKmh.toFixed(1)} KM/H`, cx, cy + 38);

    // Indicator Needle for Sprint Burst
    const needleAngle = startAngle + sprintPct * totalAngle;
    const needleLen = radius - 30;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    ctx.beginPath();
    ctx.moveTo(-10, -1.5);
    ctx.lineTo(needleLen, 0);
    ctx.lineTo(-10, 1.5);
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 4;
    ctx.fill();

    ctx.restore();

    // Center Hub
    const hubGrad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 10);
    hubGrad.addColorStop(0, '#475569');
    hubGrad.addColorStop(1, '#0f172a');
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
  }
}

window.SubDialManager = SubDialManager;
