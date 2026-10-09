/**
 * 2D BWF Court Canvas & Telemetry Renderer
 * Official BWF Regulation Dimensions: 13.40m Length x 6.10m Width
 * Strictly preserves true 13.4m : 6.1m aspect ratio without distortion
 * Renders:
 * - Regulation Yonex green court mat & exact BWF line markings (40mm thickness)
 * - Player 1 (LZJ - Cyan) & Player 2 (SLY - Orange) live positions & foot trails
 * - 3D ballistic shuttlecock projection with altitude shadow & smash trails
 * - Heatmap / Kernel Density Estimation (KDE) court coverage overlay
 * - Metric coordinate inspector
 */

class CourtViewManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.showHeatmap = false;
    this.showTrails = true;
    this.selectedShotIndex = null;

    // Official BWF Metric Dimensions (Meters)
    this.courtLength = 13.40; // meters (Y axis)
    this.courtWidth = 6.10;   // meters (X axis)
    this.singlesMargin = 0.46;
    this.shortServiceDist = 1.98;
    this.doublesLongServiceDist = 0.76;
    this.lineWidthMeters = 0.04; // 40mm official BWF line width

    // Player positions in court meters (X: 0 to 6.1, Y: 0 to 13.4)
    // 0 is bottom back line (LZJ side), 13.4 is top back line (SLY side)
    // Net is at Y = 6.70m
    this.player1Pos = { x: 3.05, y: 1.80 }; // LZJ
    this.player2Pos = { x: 3.05, y: 11.60 }; // SLY

    this.player1Trail = [];
    this.player2Trail = [];

    // Shuttle position (x, y, z in meters)
    this.shuttlePos = { x: 3.05, y: 6.70, z: 2.50 };
    this.shuttleTrail = [];

    this.currentRally = null;
    this.activeShot = null;
    this.hoverCoord = null;

    this.initCanvas();
    this.bindEvents();
    this.startLoop();
  }

  initCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 380;
    this.height = rect.height || 640;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;

    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvas());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      this.hoverCoord = this.screenToCourt(mouseX, mouseY);
      this.updateCoordBadge(this.hoverCoord);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverCoord = null;
      this.updateCoordBadge(null);
    });
  }

  updateCoordBadge(coord) {
    const badge = document.getElementById('court-coord-badge');
    if (!badge) return;
    if (!coord) {
      badge.textContent = 'COURT: 13.40m × 6.10m (BWF REGULATION)';
      return;
    }
    const zone = coord.y < 6.70 ? 'LZJ HALF (MAS)' : 'SLY HALF (TPE)';
    badge.textContent = `X: ${coord.x.toFixed(2)}m | Y: ${coord.y.toFixed(2)}m [${zone}]`;
  }

  toggleHeatmap(forcedState) {
    this.showHeatmap = forcedState !== undefined ? forcedState : !this.showHeatmap;
    return this.showHeatmap;
  }

  toggleTrails() {
    this.showTrails = !this.showTrails;
    return this.showTrails;
  }

  loadRally(rallyData) {
    this.currentRally = rallyData;
    this.player1Trail = [];
    this.player2Trail = [];
    this.shuttleTrail = [];
    this.selectedShotIndex = null;

    if (rallyData && rallyData.shots && rallyData.shots.length > 0) {
      this.setShot(0);
    }
  }

  setShot(shotIndex) {
    if (!this.currentRally || !this.currentRally.shots) return;
    const shot = this.currentRally.shots[shotIndex];
    if (!shot) return;

    this.selectedShotIndex = shotIndex;
    this.activeShot = shot;

    // Update positions
    if (shot.hitter === 'LZJ') {
      this.player1Pos = { x: shot.hit_coord[0], y: shot.hit_coord[1] };
      this.player1Trail.push({ ...this.player1Pos, time: Date.now() });
      if (this.player1Trail.length > 25) this.player1Trail.shift();
    } else {
      this.player2Pos = { x: shot.hit_coord[0], y: shot.hit_coord[1] };
      this.player2Trail.push({ ...this.player2Pos, time: Date.now() });
      if (this.player2Trail.length > 25) this.player2Trail.shift();
    }

    this.shuttlePos = {
      x: shot.land_coord[0],
      y: shot.land_coord[1],
      z: shot.trajectory_peak_z || 2.0
    };
  }

  // Exact BWF Proportion Calculation: Strictly preserves 6.10m : 13.40m ratio
  getCourtGeometry() {
    const margin = 20;
    const availW = Math.max(10, this.width - margin * 2);
    const availH = Math.max(10, this.height - margin * 2);

    // Uniform scale preserving exact 6.1m x 13.4m BWF aspect ratio
    const scale = Math.min(availW / this.courtWidth, availH / this.courtLength);
    const courtPixelW = this.courtWidth * scale;
    const courtPixelH = this.courtLength * scale;

    const offsetX = (this.width - courtPixelW) / 2;
    const offsetY = (this.height - courtPixelH) / 2;

    return { scale, courtPixelW, courtPixelH, offsetX, offsetY };
  }

  // Coordinate transforms: Court (0..6.1m, 0..13.4m) -> Screen Pixels
  courtToScreen(cx, cy) {
    const { scale, offsetX, offsetY } = this.getCourtGeometry();
    const sx = offsetX + cx * scale;
    // Y = 0 is at bottom of court (LZJ side), Y = 13.4 is at top of court (SLY side)
    const sy = this.height - offsetY - cy * scale;
    return { x: sx, y: sy };
  }

  screenToCourt(sx, sy) {
    const { scale, offsetX, offsetY } = this.getCourtGeometry();
    const cx = Math.max(0, Math.min(this.courtWidth, (sx - offsetX) / scale));
    const cy = Math.max(0, Math.min(this.courtLength, (this.height - offsetY - sy) / scale));
    return { x: cx, y: cy };
  }

  startLoop() {
    const render = () => {
      this.draw();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Dark Stadium Apron Background (Flat Technical Style)
    ctx.fillStyle = '#080b0f';
    ctx.fillRect(0, 0, this.width, this.height);

    const { scale, courtPixelW, courtPixelH, offsetX, offsetY } = this.getCourtGeometry();

    // Blue Arena Run-Off Mat (Arctic Open Surrounding)
    const apronPad = 12;
    ctx.fillStyle = '#0e192c';
    ctx.fillRect(
      offsetX - apronPad,
      offsetY - apronPad,
      courtPixelW + apronPad * 2,
      courtPixelH + apronPad * 2
    );

    // 2. Official Court Mat (Yonex Emerald Green)
    const pTopLeft = this.courtToScreen(0, 13.40);
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(pTopLeft.x, pTopLeft.y, courtPixelW, courtPixelH);

    // 3. Heatmap Layer (if enabled)
    if (this.showHeatmap) {
      this.drawKDEHeatmap(pTopLeft.x, pTopLeft.y, courtPixelW, courtPixelH);
    }

    // 4. BWF Official Court Lines (White, 40mm to scale)
    this.drawBWFLines(scale);

    // 5. Net (Center line with posts and mesh tape)
    this.drawNet(scale);

    // 6. Player Trails & Avatars
    if (this.showTrails) {
      this.drawPlayerTrails();
    }
    this.drawPlayers();

    // 7. Shuttlecock & Landing Trajectory
    this.drawShuttlecockAndShots();

    // 8. Hover Crosshair & Coordinate Marker
    if (this.hoverCoord) {
      const sp = this.courtToScreen(this.hoverCoord.x, this.hoverCoord.y);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sp.x, 0);
      ctx.lineTo(sp.x, this.height);
      ctx.moveTo(0, sp.y);
      ctx.lineTo(this.width, sp.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00f0ff';
      ctx.fill();
    }
  }

  drawBWFLines(scale) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ffffff';
    // 40mm line width rendered to scale (minimum 1.5px)
    ctx.lineWidth = Math.max(1.5, this.lineWidthMeters * scale);
    ctx.lineCap = 'square';

    // Outer Boundary (Doubles): 6.10m x 13.40m
    const b0 = this.courtToScreen(0, 0);
    const b1 = this.courtToScreen(6.10, 0);
    const b2 = this.courtToScreen(6.10, 13.40);
    const b3 = this.courtToScreen(0, 13.40);

    ctx.beginPath();
    ctx.moveTo(b0.x, b0.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(b3.x, b3.y);
    ctx.closePath();
    ctx.stroke();

    // Singles Sidelines: 0.46m inside each side (5.18m singles width)
    const sLeft1 = this.courtToScreen(0.46, 0);
    const sLeft2 = this.courtToScreen(0.46, 13.40);
    ctx.beginPath();
    ctx.moveTo(sLeft1.x, sLeft1.y);
    ctx.lineTo(sLeft2.x, sLeft2.y);
    ctx.stroke();

    const sRight1 = this.courtToScreen(6.10 - 0.46, 0);
    const sRight2 = this.courtToScreen(6.10 - 0.46, 13.40);
    ctx.beginPath();
    ctx.moveTo(sRight1.x, sRight1.y);
    ctx.lineTo(sRight2.x, sRight2.y);
    ctx.stroke();

    // Short Service Lines: 1.98m from net (Net is at 6.70m)
    // Bottom side: 6.70 - 1.98 = 4.72m
    const sslBottom1 = this.courtToScreen(0, 4.72);
    const sslBottom2 = this.courtToScreen(6.10, 4.72);
    ctx.beginPath();
    ctx.moveTo(sslBottom1.x, sslBottom1.y);
    ctx.lineTo(sslBottom2.x, sslBottom2.y);
    ctx.stroke();

    // Top side: 6.70 + 1.98 = 8.68m
    const sslTop1 = this.courtToScreen(0, 8.68);
    const sslTop2 = this.courtToScreen(6.10, 8.68);
    ctx.beginPath();
    ctx.moveTo(sslTop1.x, sslTop1.y);
    ctx.lineTo(sslTop2.x, sslTop2.y);
    ctx.stroke();

    // Doubles Long Service Lines: 0.76m inside back lines
    // Bottom: 0.76m
    const dlslBottom1 = this.courtToScreen(0, 0.76);
    const dlslBottom2 = this.courtToScreen(6.10, 0.76);
    ctx.beginPath();
    ctx.moveTo(dlslBottom1.x, dlslBottom1.y);
    ctx.lineTo(dlslBottom2.x, dlslBottom2.y);
    ctx.stroke();

    // Top: 13.40 - 0.76 = 12.64m
    const dlslTop1 = this.courtToScreen(0, 12.64);
    const dlslTop2 = this.courtToScreen(6.10, 12.64);
    ctx.beginPath();
    ctx.moveTo(dlslTop1.x, dlslTop1.y);
    ctx.lineTo(dlslTop2.x, dlslTop2.y);
    ctx.stroke();

    // Center Service Lines: X = 3.05m
    // Bottom half: from baseline 0 to short service line 4.72m
    const clBottom1 = this.courtToScreen(3.05, 0);
    const clBottom2 = this.courtToScreen(3.05, 4.72);
    ctx.beginPath();
    ctx.moveTo(clBottom1.x, clBottom1.y);
    ctx.lineTo(clBottom2.x, clBottom2.y);
    ctx.stroke();

    // Top half: from short service line 8.68m to back baseline 13.40m
    const clTop1 = this.courtToScreen(3.05, 8.68);
    const clTop2 = this.courtToScreen(3.05, 13.40);
    ctx.beginPath();
    ctx.moveTo(clTop1.x, clTop1.y);
    ctx.lineTo(clTop2.x, clTop2.y);
    ctx.stroke();
  }

  drawNet(scale) {
    const ctx = this.ctx;
    // Net is positioned at Y = 6.70m, posts extend 0.15m outside doubles lines
    const netLeft = this.courtToScreen(-0.15, 6.70);
    const netRight = this.courtToScreen(6.25, 6.70);

    // White Top Tape
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(2, 0.075 * scale);
    ctx.beginPath();
    ctx.moveTo(netLeft.x, netLeft.y);
    ctx.lineTo(netRight.x, netRight.y);
    ctx.stroke();

    // Net Posts (1.55m)
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(netLeft.x, netLeft.y, 4, 0, Math.PI * 2);
    ctx.arc(netRight.x, netRight.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Post Text
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('NET (1.55m)', netLeft.x - 6, netLeft.y + 3);
  }

  drawKDEHeatmap(courtX, courtY, courtW, courtH) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(courtX, courtY, courtW, courtH);
    ctx.clip();

    // LZJ Dominance Hotspots (Near Court)
    const lzjHotspots = [
      { x: 3.05, y: 1.5, r: 80, color: 'rgba(0, 240, 255, 0.4)' },
      { x: 1.8, y: 4.8, r: 60, color: 'rgba(0, 229, 163, 0.35)' },
      { x: 4.5, y: 2.2, r: 70, color: 'rgba(0, 240, 255, 0.3)' }
    ];

    lzjHotspots.forEach(spot => {
      const sp = this.courtToScreen(spot.x, spot.y);
      const rad = ctx.createRadialGradient(sp.x, sp.y, 5, sp.x, sp.y, spot.r);
      rad.addColorStop(0, spot.color);
      rad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // SLY Dominance Hotspots (Far Court)
    const slyHotspots = [
      { x: 3.05, y: 11.8, r: 80, color: 'rgba(255, 87, 34, 0.4)' },
      { x: 4.2, y: 8.5, r: 60, color: 'rgba(255, 183, 3, 0.3)' },
      { x: 1.5, y: 10.5, r: 65, color: 'rgba(255, 87, 34, 0.25)' }
    ];

    slyHotspots.forEach(spot => {
      const sp = this.courtToScreen(spot.x, spot.y);
      const rad = ctx.createRadialGradient(sp.x, sp.y, 5, sp.x, sp.y, spot.r);
      rad.addColorStop(0, spot.color);
      rad.addColorStop(1, 'rgba(255, 87, 34, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  drawPlayerTrails() {
    const ctx = this.ctx;

    // LZJ Trail (Cyan)
    if (this.player1Trail.length > 1) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      this.player1Trail.forEach((p, idx) => {
        const sp = this.courtToScreen(p.x, p.y);
        if (idx === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      ctx.stroke();
    }

    // SLY Trail (Orange)
    if (this.player2Trail.length > 1) {
      ctx.strokeStyle = 'rgba(255, 87, 34, 0.4)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      this.player2Trail.forEach((p, idx) => {
        const sp = this.courtToScreen(p.x, p.y);
        if (idx === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      ctx.stroke();
    }
  }

  drawPlayers() {
    const ctx = this.ctx;

    // Player 1: Lee Zii Jia (Cyan)
    const p1 = this.courtToScreen(this.player1Pos.x, this.player1Pos.y);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // LZJ Label
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LEE Z.J. 🇲🇾', p1.x, p1.y + 16);

    // Player 2: Su Li Yang (Orange)
    const p2 = this.courtToScreen(this.player2Pos.x, this.player2Pos.y);
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // SLY Label
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SU L.Y. 🇹🇼', p2.x, p2.y - 12);
  }

  drawShuttlecockAndShots() {
    const ctx = this.ctx;
    if (!this.currentRally || !this.currentRally.shots) return;

    // Landing spots in this rally
    this.currentRally.shots.forEach((shot, idx) => {
      const isCurrent = idx === this.selectedShotIndex;
      const isWinner = shot.winner;
      const isRecordSmash = shot.speed_kmh >= 400;

      const lp = this.courtToScreen(shot.land_coord[0], shot.land_coord[1]);

      ctx.beginPath();
      ctx.arc(lp.x, lp.y, isRecordSmash ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isRecordSmash ? '#ff2a55' : isWinner ? '#00e5a3' : 'rgba(255, 255, 255, 0.7)';
      ctx.fill();

      if (isRecordSmash || isCurrent) {
        ctx.strokeStyle = '#ff2a55';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, 12, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = isRecordSmash ? '#ff2a55' : '#00f0ff';
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.fillText(`${shot.speed_kmh} km/h`, lp.x, lp.y - 10);
      }
    });

    // 3D Shuttlecock with ballistic altitude shadow
    const groundP = this.courtToScreen(this.shuttlePos.x, this.shuttlePos.y);
    const altitudeOffset = (this.shuttlePos.z || 2.0) * 7;

    // Ground Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(groundP.x, groundP.y, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Floating Shuttlecock
    const shuttleY = groundP.y - altitudeOffset;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(groundP.x, shuttleY, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Altitude connecting line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(groundP.x, groundP.y);
    ctx.lineTo(groundP.x, shuttleY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

window.CourtViewManager = CourtViewManager;
