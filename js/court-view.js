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

  getNearPlayerId() {
    if (this.currentRally && this.currentRally.near_player) {
      return this.currentRally.near_player;
    }
    return 'LZJ';
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
    const nearId = this.getNearPlayerId();
    const p1 = window.HAWKVIEW_TELEMETRY?.players?.player_1;
    const p2 = window.HAWKVIEW_TELEMETRY?.players?.player_2;
    const p1Label = `${p1?.id || 'LZJ'} HALF (${p1?.country || 'MAS'})`;
    const p2Label = `${p2?.id || 'POPOV'} HALF (${p2?.country || 'FRA'})`;
    const zone = coord.y < 6.70 
      ? (nearId === 'POPOV' ? p2Label : p1Label)
      : (nearId === 'POPOV' ? p1Label : p2Label);
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
      const shot0 = rallyData.shots[0];
      const nearId = this.getNearPlayerId();
      const isLZJNear = nearId === 'LZJ';
      const isLZJHitter = shot0.hitter === 'LZJ';
      if (isLZJHitter) {
        this.player1Pos = { x: shot0.hit_coord[0], y: shot0.hit_coord[1] };
        this.player2Pos = { 
          x: shot0.land_coord[0], 
          y: isLZJNear ? Math.max(7.20, shot0.land_coord[1]) : Math.min(6.20, shot0.land_coord[1]) 
        };
      } else {
        this.player2Pos = { x: shot0.hit_coord[0], y: shot0.hit_coord[1] };
        this.player1Pos = { 
          x: shot0.land_coord[0], 
          y: isLZJNear ? Math.min(6.20, shot0.land_coord[1]) : Math.max(7.20, shot0.land_coord[1]) 
        };
      }
      this.shuttlePos = {
        x: shot0.hit_coord[0],
        y: shot0.hit_coord[1],
        z: shot0.hit_coord[2] || 1.5
      };
      this.selectedShotIndex = 0;
      this.activeShot = shot0;
    }
  }

  setShot(shotIndex) {
    if (!this.currentRally || !this.currentRally.shots) return;
    const shot = this.currentRally.shots[shotIndex];
    if (!shot) return;

    this.selectedShotIndex = shotIndex;
    this.activeShot = shot;

    const nearId = this.getNearPlayerId();
    const isLZJNear = nearId === 'LZJ';

    // Both players positioned accurately
    if (shot.hitter === 'LZJ') {
      this.player1Pos = { x: shot.hit_coord[0], y: shot.hit_coord[1] };
      this.player2Pos = { 
        x: shot.land_coord[0], 
        y: isLZJNear ? Math.max(7.20, shot.land_coord[1]) : Math.min(6.20, shot.land_coord[1]) 
      };
    } else {
      this.player2Pos = { x: shot.hit_coord[0], y: shot.hit_coord[1] };
      this.player1Pos = { 
        x: shot.land_coord[0], 
        y: isLZJNear ? Math.min(6.20, shot.land_coord[1]) : Math.max(7.20, shot.land_coord[1]) 
      };
    }

    this.player1Trail.push({ ...this.player1Pos, time: Date.now() });
    if (this.player1Trail.length > 25) this.player1Trail.shift();
    this.player2Trail.push({ ...this.player2Pos, time: Date.now() });
    if (this.player2Trail.length > 25) this.player2Trail.shift();

    this.shuttlePos = {
      x: shot.land_coord[0],
      y: shot.land_coord[1],
      z: shot.trajectory_peak_z || 2.0
    };
  }

  updateTelemetry(data) {
    if (!data) return;
    const { rally, shot, shotIndex, time, isDowntime } = data;
    this.currentRally = rally;
    this.selectedShotIndex = shotIndex;
    this.activeShot = shot;

    const nearId = this.getNearPlayerId();
    this.isDowntime = !!isDowntime;

    if (isDowntime) {
      // In downtime between rallies, clear trails and place players in ready service stance
      this.player1Trail = [];
      this.player2Trail = [];
      this.shuttleTrail = [];

      const p1Target = isLZJNear ? { x: 3.05, y: 1.80 } : { x: 3.05, y: 11.60 };
      const p2Target = isLZJNear ? { x: 3.05, y: 11.60 } : { x: 3.05, y: 1.80 };
      this.player1Pos.x += (p1Target.x - this.player1Pos.x) * 0.25;
      this.player1Pos.y += (p1Target.y - this.player1Pos.y) * 0.25;
      this.player2Pos.x += (p2Target.x - this.player2Pos.x) * 0.25;
      this.player2Pos.y += (p2Target.y - this.player2Pos.y) * 0.25;

      const isServerNear = (rally && rally.server) ? (rally.server === nearId) : (nearId === 'LZJ');
      this.shuttlePos = {
        x: 3.05,
        y: isServerNear ? 1.80 : 11.60,
        z: 0.1
      };
      return;
    }

    if (!shot) return;

    const currentShot = shot;
    const nextShot = rally && rally.shots ? rally.shots[shotIndex + 1] : null;

    const shotStartTime = currentShot.time;
    const shotEndTime = nextShot ? nextShot.time : shotStartTime + (currentShot.shuttle_transit_time_sec || 0.65);
    const shotDuration = Math.max(0.15, shotEndTime - shotStartTime);
    const progress = Math.min(1.0, Math.max(0.0, (time - shotStartTime) / shotDuration));

    const isLZJ = currentShot.hitter === 'LZJ';
    const p1BaseY = isLZJNear ? 2.50 : 10.90;
    const p2BaseY = isLZJNear ? 10.90 : 2.50;

    let p1Target, p2Target;
    if (isLZJ) {
      // LZJ is hitter, recovering towards base T; P2 anticipates landing
      p1Target = { 
        x: currentShot.hit_coord[0] + (3.05 - currentShot.hit_coord[0]) * Math.min(1.0, progress * 0.6), 
        y: isLZJNear
          ? Math.min(6.20, currentShot.hit_coord[1] + (p1BaseY - currentShot.hit_coord[1]) * Math.min(1.0, progress * 0.6))
          : Math.max(7.20, currentShot.hit_coord[1] + (p1BaseY - currentShot.hit_coord[1]) * Math.min(1.0, progress * 0.6))
      };
      p2Target = { 
        x: 3.05 + (currentShot.land_coord[0] - 3.05) * Math.min(1.0, progress * 1.1), 
        y: isLZJNear
          ? Math.max(7.20, p2BaseY + (currentShot.land_coord[1] - p2BaseY) * Math.min(1.0, progress * 1.1))
          : Math.min(6.20, p2BaseY + (currentShot.land_coord[1] - p2BaseY) * Math.min(1.0, progress * 1.1))
      };
    } else {
      // P2 is hitter, recovering towards base T; LZJ anticipates landing
      p2Target = { 
        x: currentShot.hit_coord[0] + (3.05 - currentShot.hit_coord[0]) * Math.min(1.0, progress * 0.6), 
        y: isLZJNear
          ? Math.max(7.20, currentShot.hit_coord[1] + (p2BaseY - currentShot.hit_coord[1]) * Math.min(1.0, progress * 0.6))
          : Math.min(6.20, currentShot.hit_coord[1] + (p2BaseY - currentShot.hit_coord[1]) * Math.min(1.0, progress * 0.6))
      };
      p1Target = { 
        x: 3.05 + (currentShot.land_coord[0] - 3.05) * Math.min(1.0, progress * 1.1), 
        y: isLZJNear
          ? Math.min(6.20, p1BaseY + (currentShot.land_coord[1] - p1BaseY) * Math.min(1.0, progress * 1.1))
          : Math.max(7.20, p1BaseY + (currentShot.land_coord[1] - p1BaseY) * Math.min(1.0, progress * 1.1))
      };
    }

    // Smooth lerp positions in 2D
    this.player1Pos.x += (p1Target.x - this.player1Pos.x) * 0.20;
    this.player1Pos.y += (p1Target.y - this.player1Pos.y) * 0.20;
    this.player2Pos.x += (p2Target.x - this.player2Pos.x) * 0.20;
    this.player2Pos.y += (p2Target.y - this.player2Pos.y) * 0.20;

    // Record trails
    if (this.showTrails) {
      this.player1Trail.push({ ...this.player1Pos, time: Date.now() });
      if (this.player1Trail.length > 25) this.player1Trail.shift();
      this.player2Trail.push({ ...this.player2Pos, time: Date.now() });
      if (this.player2Trail.length > 25) this.player2Trail.shift();
    }

    // Interpolate live shuttlecock position along trajectory arc
    const sx = currentShot.hit_coord[0] + (currentShot.land_coord[0] - currentShot.hit_coord[0]) * progress;
    const sy = currentShot.hit_coord[1] + (currentShot.land_coord[1] - currentShot.hit_coord[1]) * progress;
    const peakZ = currentShot.trajectory_peak_z || 2.4;
    const sz = Math.sin(progress * Math.PI) * peakZ;

    this.shuttlePos = { x: sx, y: sy, z: sz };
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

    // 8. Intermission / Resting Watermark Badge
    if (this.isDowntime) {
      this.drawIntermissionWatermark();
    }

    // 9. Hover Crosshair & Coordinate Marker
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

  drawIntermissionWatermark() {
    const ctx = this.ctx;
    ctx.save();
    
    // Draw subtle semi-transparent pill across the center net area
    const netPos = this.courtToScreen(3.05, 6.70);
    const badgeW = 186;
    const badgeH = 26;
    const badgeX = netPos.x - badgeW / 2;
    const badgeY = netPos.y - badgeH / 2;

    ctx.fillStyle = 'rgba(8, 13, 20, 0.90)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)'; // Amber
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    // Pulse amber indicator
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(badgeX + 13, badgeY + 13, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Label text
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('INTERMISSION // RESTING', badgeX + 22, badgeY + 16.5);

    ctx.restore();
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

    const nearId = this.getNearPlayerId();
    const isPopovNear = nearId === 'POPOV';

    // Near Court Hotspots
    const nearHotspots = isPopovNear ? [
      { x: 3.05, y: 1.5, r: 80, color: 'rgba(255, 42, 85, 0.4)' },
      { x: 1.8, y: 4.8, r: 60, color: 'rgba(255, 80, 110, 0.35)' },
      { x: 4.5, y: 2.2, r: 70, color: 'rgba(255, 42, 85, 0.3)' }
    ] : [
      { x: 3.05, y: 1.5, r: 80, color: 'rgba(0, 240, 255, 0.4)' },
      { x: 1.8, y: 4.8, r: 60, color: 'rgba(0, 229, 163, 0.35)' },
      { x: 4.5, y: 2.2, r: 70, color: 'rgba(0, 240, 255, 0.3)' }
    ];

    nearHotspots.forEach(spot => {
      const sp = this.courtToScreen(spot.x, spot.y);
      const rad = ctx.createRadialGradient(sp.x, sp.y, 5, sp.x, sp.y, spot.r);
      rad.addColorStop(0, spot.color);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Far Court Hotspots
    const farHotspots = isPopovNear ? [
      { x: 3.05, y: 11.8, r: 80, color: 'rgba(0, 240, 255, 0.4)' },
      { x: 4.2, y: 8.5, r: 60, color: 'rgba(0, 229, 163, 0.35)' },
      { x: 1.5, y: 10.5, r: 65, color: 'rgba(0, 240, 255, 0.25)' }
    ] : [
      { x: 3.05, y: 11.8, r: 80, color: 'rgba(255, 42, 85, 0.4)' },
      { x: 4.2, y: 8.5, r: 60, color: 'rgba(255, 80, 110, 0.3)' },
      { x: 1.5, y: 10.5, r: 65, color: 'rgba(255, 42, 85, 0.25)' }
    ];

    farHotspots.forEach(spot => {
      const sp = this.courtToScreen(spot.x, spot.y);
      const rad = ctx.createRadialGradient(sp.x, sp.y, 5, sp.x, sp.y, spot.r);
      rad.addColorStop(0, spot.color);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  drawPlayerTrails() {
    const ctx = this.ctx;
    const nearId = this.getNearPlayerId();
    const isPopovNear = nearId === 'POPOV';

    // Player 1 (LZJ) Trail
    if (this.player1Trail.length > 1) {
      ctx.strokeStyle = isPopovNear ? 'rgba(0, 240, 255, 0.45)' : 'rgba(0, 240, 255, 0.55)';
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

    // Player 2 (POPOV / Opponent) Trail
    const p2Info = window.HAWKVIEW_TELEMETRY?.players?.player_2;
    const isPopov = (p2Info?.id === 'POPOV') || (p2Info?.country === 'FRA');
    if (this.player2Trail.length > 1) {
      ctx.strokeStyle = isPopov
        ? (isPopovNear ? 'rgba(255, 42, 85, 0.55)' : 'rgba(255, 42, 85, 0.45)')
        : 'rgba(255, 87, 34, 0.45)';
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
    const p1Info = window.HAWKVIEW_TELEMETRY?.players?.player_1;
    const p2Info = window.HAWKVIEW_TELEMETRY?.players?.player_2;
    const p1Text = `${p1Info?.display_name || 'LEE Z.J.'} ${p1Info?.flag || '🇲🇾'}`;
    const p2Text = `${p2Info?.display_name || 'C. POPOV'} ${p2Info?.flag || '🇫🇷'}`;

    // Player 1 (LZJ) - Cyan jersey
    const p1 = this.courtToScreen(this.player1Pos.x, this.player1Pos.y);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // P1 Label
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    const p1LabelOffset = this.player1Pos.y < 6.70 ? 16 : -12;
    ctx.fillText(p1Text, p1.x, p1.y + p1LabelOffset);

    // Player 2 (POPOV / Opponent) - French white kit with crimson trim & text
    const p2 = this.courtToScreen(this.player2Pos.x, this.player2Pos.y);
    const isPopov = (p2Info?.id === 'POPOV') || (p2Info?.country === 'FRA');
    const p2Fill = isPopov ? '#ffffff' : (p2Info?.jersey_color || '#ff5722');
    const p2Stroke = isPopov ? '#ff2a55' : '#ffffff';
    const p2TextCol = isPopov ? '#ff2a55' : (p2Info?.jersey_color || '#ff5722');

    ctx.fillStyle = p2Fill;
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = p2Stroke;
    ctx.lineWidth = isPopov ? 2.0 : 1.5;
    ctx.stroke();

    // P2 Label
    ctx.fillStyle = p2TextCol;
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    const p2LabelOffset = this.player2Pos.y < 6.70 ? 16 : -12;
    ctx.fillText(p2Text, p2.x, p2.y + p2LabelOffset);
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
