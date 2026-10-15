/**
 * Three.js 3D Badminton Court Scene Setup (Hawkview — Spec Section 3.1)
 * Slimmed down to clean PB-Vision style scene setup:
 * - Flat court floor (--court-floor)
 * - Regulation BWF court lines at true 40 mm width (--court-line)
 * - Translucent net panel (--net at 45% opacity) at y = 6.70 m with posts on
 *   the doubles sidelines (x = 0.0 and x = 6.10, z = 1.55 m at posts, 1.524 m at center)
 * - 6 Camera Presets: 3D, Top (orthographic), Side, Net, Near, Far + Fullscreen (⛶)
 * - Live Light/Dark theme token sync
 */

class ThreeCourtViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Container #${containerId} not found`);
      return;
    }

    // Regulation BWF Court Metrics (Meters, Section 1.1)
    this.BWF = {
      length: 13.40,
      width: 6.10,
      singlesWidth: 5.18,
      tramline: 0.46,
      netY: 6.70,
      netHeightPosts: 1.55,
      netHeightCenter: 1.524,
      shortServiceDist: 1.98,
      doublesLongServiceDist: 0.76,
      lineWidth: 0.04
    };

    // Camera presets (Section 3.1)
    // World coordinates:
    //   X: +3.05 (court x=0 left) to -3.05 (court x=6.10 right)
    //   Y: height above floor (court z)
    //   Z: -6.70 (near baseline y=0) to +6.70 (far baseline y=13.40), net at Z=0
    this.presets = {
      '3d': {
        pos: new THREE.Vector3(0, 9.3, -16.8),
        target: new THREE.Vector3(0, 1.40, -0.20),
        fov: 45,
        ortho: false
      },
      'top': {
        pos: new THREE.Vector3(0, 22.0, -0.001),
        target: new THREE.Vector3(0, 0, 0),
        fov: 40,
        ortho: true
      },
      'side': {
        pos: new THREE.Vector3(14.2, 1.65, 0),
        target: new THREE.Vector3(0, 1.25, 0),
        fov: 42,
        ortho: false
      },
      'net': {
        pos: new THREE.Vector3(3.55, 1.55, -0.25),
        target: new THREE.Vector3(-3.05, 1.40, 0.15),
        fov: 50,
        ortho: false
      },
      'near': {
        pos: new THREE.Vector3(0, 1.75, -9.2),
        target: new THREE.Vector3(0, 1.25, 2.2),
        fov: 50,
        ortho: false
      },
      'far': {
        pos: new THREE.Vector3(0, 1.75, 9.2),
        target: new THREE.Vector3(0, 1.25, -2.2),
        fov: 50,
        ortho: false
      }
    };

    this.activePreset = '3d';
    this.animatingCamera = false;
    this.camAnimStartTime = 0;
    this.camAnimDuration = 420;
    this.camStartPos = new THREE.Vector3();
    this.camStartTarget = new THREE.Vector3();
    this.camEndPos = new THREE.Vector3();
    this.camEndTarget = new THREE.Vector3();

    this.lineMeshes = [];
    this.onBeforeRenderCallbacks = [];
    this._lastW = 0;
    this._lastH = 0;
    this.activeRallyForHUD = null;

    try {
      this.initScene();
      this.buildLighting();
      this.buildCourtFloorAndLines();
      this.buildNet();
      this.buildCourtEndAprons();
      this.setupEvents();
      this.applyThemeColors();
      this.updateCourtSideHUD(null);
      this.animate();
    } catch (e) {
      console.warn('[ThreeCourtViewer] WebGL initialization fallback:', e);
      this.webglFailed = true;
    }
  }

  getThemeTokens() {
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => {
      const v = style.getPropertyValue(name);
      return v ? v.trim() : fallback;
    };
    return {
      bg: read('--bg', '#f5f6f8'),
      panel: read('--panel', '#ffffff'),
      text: read('--text', '#1c1f24'),
      border: read('--border', '#e2e5ea'),
      courtFloor: read('--court-floor', '#dcdfe4'),
      courtLine: read('--court-line', '#2b2f36'),
      netHex: read('--net-hex', '#6b7280'),
      shotContinue: read('--shot-continue', '#5fae3a'),
      shotWinner: read('--shot-winner', '#2563eb'),
      shotError: read('--shot-error', '#d93025'),
      shotSelected: read('--shot-selected', '#f59e0b'),
      muted: read('--muted', '#6b7280')
    };
  }

  initScene() {
    const tokens = this.getThemeTokens();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(tokens.bg);

    const width = Math.max(100, Math.floor(this.container.clientWidth || 760));
    const height = Math.max(100, Math.floor(this.container.clientHeight || 435));
    this._lastW = width;
    this._lastH = height;
    const aspect = width / height;

    // Perspective camera
    this.perspCamera = new THREE.PerspectiveCamera(
      this.presets['3d'].fov,
      aspect,
      0.1,
      120
    );
    this.perspCamera.position.copy(this.presets['3d'].pos);

    // Orthographic camera for Top view
    this.orthoCamera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
    this.updateOrthoFrustum(width, height);
    this.orthoCamera.position.copy(this.presets['top'].pos);
    this.orthoCamera.lookAt(this.presets['top'].target);

    this.camera = this.perspCamera;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, true);

    this.renderer.domElement.id = 'three-canvas';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    if (THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
      this.controls.minDistance = 2.0;
      this.controls.maxDistance = 36.0;
      this.controls.target.copy(this.presets['3d'].target);
      this.controls.update();
    }
  }

  updateOrthoFrustum(width, height) {
    if (!this.orthoCamera) return;
    const aspect = (width || 760) / (height || 430);
    // Fit 13.40m length (Z) and 6.10m width (X) with clean margin
    const minHalfZ = 7.6;
    const minHalfX = 4.2;
    let halfH = minHalfZ;
    let halfW = halfH * aspect;
    if (halfW < minHalfX) {
      halfW = minHalfX;
      halfH = halfW / aspect;
    }
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  buildLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.92);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.25);
    dirLight.position.set(4, 18, -6);
    this.scene.add(dirLight);
  }

  buildCourtFloorAndLines() {
    const tokens = this.getThemeTokens();

    // Flat court floor with 1.45m apron around the 6.10 x 13.40 m boundary for 3D floor-pinned scoreboards
    const apronMargin = 1.45;
    const floorGeo = new THREE.PlaneGeometry(
      this.BWF.width + apronMargin * 2,
      this.BWF.length + apronMargin * 2
    );
    this.courtFloorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.courtFloor),
      side: THREE.DoubleSide
    });
    this.courtFloorMesh = new THREE.Mesh(floorGeo, this.courtFloorMat);
    this.courtFloorMesh.rotation.x = -Math.PI / 2;
    this.courtFloorMesh.position.y = 0.0;
    this.scene.add(this.courtFloorMesh);

    // Inner playable court surface (exact 6.10m x 13.40m)
    const innerGeo = new THREE.PlaneGeometry(this.BWF.width, this.BWF.length);
    this.innerCourtMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.courtFloor),
      side: THREE.DoubleSide
    });
    this.innerCourtMesh = new THREE.Mesh(innerGeo, this.innerCourtMat);
    this.innerCourtMesh.rotation.x = -Math.PI / 2;
    this.innerCourtMesh.position.y = 0.001;
    this.scene.add(this.innerCourtMesh);

    // BWF Regulation Lines (true 40 mm = 0.04 m width, line is part of the area it bounds)
    this.linesGroup = new THREE.Group();
    this.linesGroup.position.y = 0.003;
    this.courtLineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.courtLine),
      side: THREE.DoubleSide
    });

    const lw = this.BWF.lineWidth; // 0.04m
    const halfW = this.BWF.width / 2;  // 3.05m
    const halfL = this.BWF.length / 2; // 6.70m

    const addLineQuad = (w, l, cx, cz) => {
      const geo = new THREE.PlaneGeometry(w, l);
      const mesh = new THREE.Mesh(geo, this.courtLineMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0, cz);
      this.linesGroup.add(mesh);
      this.lineMeshes.push(mesh);
    };

    // 1. Baselines (outer edge at ±6.70m, width 0.04m inside)
    addLineQuad(this.BWF.width, lw, 0, -halfL + lw / 2);
    addLineQuad(this.BWF.width, lw, 0, halfL - lw / 2);

    // 2. Doubles sidelines (outer edge at ±3.05m, width 0.04m inside)
    addLineQuad(lw, this.BWF.length, -halfW + lw / 2, 0);
    addLineQuad(lw, this.BWF.length, halfW - lw / 2, 0);

    // 3. Singles sidelines (0.46m inside doubles sidelines; outer edge at ±2.59m)
    const singlesOuterX = halfW - this.BWF.tramline; // 2.59m
    addLineQuad(lw, this.BWF.length, -(singlesOuterX - lw / 2), 0);
    addLineQuad(lw, this.BWF.length, singlesOuterX - lw / 2, 0);

    // 4. Short service lines (1.98m from net y=6.70m; near edge at ±1.98m)
    const sslZ = this.BWF.shortServiceDist; // 1.98m
    addLineQuad(this.BWF.width, lw, 0, -(sslZ + lw / 2));
    addLineQuad(this.BWF.width, lw, 0, sslZ + lw / 2);

    // 5. Doubles long service lines (0.76m inside back boundary lines)
    const dlslZ = halfL - this.BWF.doublesLongServiceDist; // 5.94m
    addLineQuad(this.BWF.width, lw, 0, -(dlslZ - lw / 2));
    addLineQuad(this.BWF.width, lw, 0, dlslZ - lw / 2);

    // 6. Centre line (splits left and right service courts, from short service line to back boundary)
    const centerLen = halfL - sslZ; // 4.72m
    const centerNearZ = -(sslZ + centerLen / 2);
    const centerFarZ = sslZ + centerLen / 2;
    addLineQuad(lw, centerLen, 0, centerNearZ);
    addLineQuad(lw, centerLen, 0, centerFarZ);

    this.scene.add(this.linesGroup);
  }

  buildNet() {
    const tokens = this.getThemeTokens();
    this.netGroup = new THREE.Group();

    const halfW = this.BWF.width / 2; // 3.05m -> posts stand ON doubles sidelines (x=0.0 and x=6.10)
    const hPost = this.BWF.netHeightPosts;   // 1.55m
    const hCenter = this.BWF.netHeightCenter; // 1.524m

    // 1. Net Posts at x = 0.0 (wx = +3.05) and x = 6.10 (wx = -3.05), y = 6.70 (wz = 0)
    const postGeo = new THREE.CylinderGeometry(0.022, 0.022, hPost, 16);
    this.netPostMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.courtLine)
    });

    const postLeft = new THREE.Mesh(postGeo, this.netPostMat);
    postLeft.position.set(halfW, hPost / 2, 0);
    this.netGroup.add(postLeft);

    const postRight = new THREE.Mesh(postGeo, this.netPostMat);
    postRight.position.set(-halfW, hPost / 2, 0);
    this.netGroup.add(postRight);

    // 2. Translucent Net Panel (--net at 45% opacity) with true sag (1.55m at posts, 1.524m at center)
    const segsX = 24;
    const netGeo = new THREE.PlaneGeometry(this.BWF.width, 1.0, segsX, 1);
    const posAttr = netGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const topH = hCenter + (hPost - hCenter) * (Math.abs(x) / halfW);
      if (y > 0) {
        posAttr.setY(i, topH);
      } else {
        posAttr.setY(i, 0.76); // BWF net mesh bottom is 0.76m above floor
      }
    }
    posAttr.needsUpdate = true;
    netGeo.computeVertexNormals();

    this.netPanelMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.netHex),
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.netPanelMesh = new THREE.Mesh(netGeo, this.netPanelMat);
    this.netGroup.add(this.netPanelMesh);

    // 3. Top Net Tape Line (follows exact sag from 1.55m at posts to 1.524m at center)
    const tapePts = [];
    for (let i = 0; i <= segsX; i++) {
      const t = i / segsX;
      const wx = -halfW + t * this.BWF.width;
      const wy = hCenter + (hPost - hCenter) * (Math.abs(wx) / halfW);
      tapePts.push(new THREE.Vector3(wx, wy, 0));
    }
    const tapeGeo = new THREE.BufferGeometry().setFromPoints(tapePts);
    this.netTapeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(tokens.courtLine)
    });
    this.netTapeLine = new THREE.Line(tapeGeo, this.netTapeMat);
    this.netGroup.add(this.netTapeLine);

    this.scene.add(this.netGroup);
  }

  buildCourtEndAprons() {
    // 3D Floor-Pinned Scoreboards right outside Near Baseline (Z = -7.32) and Far Baseline (Z = +7.32)
    this.nearApronCanvas = document.createElement('canvas');
    this.nearApronCanvas.width = 1024;
    this.nearApronCanvas.height = 168;
    this.nearApronTex = new THREE.CanvasTexture(this.nearApronCanvas);
    if (this.renderer && this.renderer.capabilities) {
      this.nearApronTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }

    this.farApronCanvas = document.createElement('canvas');
    this.farApronCanvas.width = 1024;
    this.farApronCanvas.height = 168;
    this.farApronTex = new THREE.CanvasTexture(this.farApronCanvas);
    if (this.renderer && this.renderer.capabilities) {
      this.farApronTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }

    const apronGeo = new THREE.PlaneGeometry(5.36, 0.92);

    this.nearApronMat = new THREE.MeshBasicMaterial({
      map: this.nearApronTex,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.nearApronMesh = new THREE.Mesh(apronGeo, this.nearApronMat);
    this.nearApronMesh.rotation.x = -Math.PI / 2;
    this.nearApronMesh.rotation.z = Math.PI; // readable from default 3D camera at Z < 0 looking toward +Z
    this.nearApronMesh.position.set(0, 0.004, -7.32);
    this.scene.add(this.nearApronMesh);

    this.farApronMat = new THREE.MeshBasicMaterial({
      map: this.farApronTex,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.farApronMesh = new THREE.Mesh(apronGeo, this.farApronMat);
    this.farApronMesh.rotation.x = -Math.PI / 2;
    this.farApronMesh.rotation.z = Math.PI;
    this.farApronMesh.position.set(0, 0.004, 7.32);
    this.scene.add(this.farApronMesh);
  }

  paintApronCanvas(canvas, tex, labelText, subText, scoreText, isServer, accentHex) {
    if (!canvas || !tex) return;
    const ctx = canvas.getContext('2d');
    const tokens = this.getThemeTokens();
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Pill background on court apron
    ctx.fillStyle = tokens.panel;
    ctx.strokeStyle = accentHex || tokens.courtLine;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 22);
    ctx.fill();
    ctx.stroke();

    // Left accent bar inside floor board
    ctx.fillStyle = accentHex || tokens.shotWinner;
    ctx.beginPath();
    ctx.roundRect(18, 22, 10, h - 44, 5);
    ctx.fill();

    // Player name + side + serve badge
    ctx.fillStyle = tokens.text;
    ctx.font = '800 44px -apple-system, Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const srvTag = isServer ? '  🏸' : '';
    ctx.fillText(`${labelText}${srvTag}`, 46, subText ? h * 0.39 : h * 0.5);

    if (subText) {
      ctx.fillStyle = tokens.muted;
      ctx.font = '600 27px -apple-system, Inter, sans-serif';
      ctx.fillText(subText, 48, h * 0.74);
    }

    // Score pill on right
    ctx.fillStyle = accentHex || tokens.shotWinner;
    ctx.font = '800 54px -apple-system, Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(scoreText, w - 42, h * 0.5);

    tex.needsUpdate = true;
  }

  updateCourtSideHUD(rally) {
    const telemetry = window.HAWKVIEW_TELEMETRY;
    const rallies = (telemetry && telemetry.rallies) || [];
    const r = rally || this.activeRallyForHUD || rallies[0];
    if (!r) return;
    this.activeRallyForHUD = r;

    const nearId = r.near_player || (r.game === 2 ? 'LZJ' : 'POPOV');
    const farId = r.far_player || (nearId === 'LZJ' ? 'POPOV' : 'LZJ');

    const formatFullApron = (pid, sideLabel) =>
      pid === 'LZJ' ? `🇲🇾 LEE ZII JIA (${sideLabel})` : `🇫🇷 C. POPOV (${sideLabel})`;

    // Score before/after for the active rally
    const sb = r.score_before || { LZJ: 0, POPOV: 0 };
    const nearPts = sb[nearId] !== undefined ? sb[nearId] : 0;
    const farPts = sb[farId] !== undefined ? sb[farId] : 0;

    // Sets won before this game (Game 1 was won by LZJ 21-11, so in Game 2 LZJ has 1 set)
    const gameNum = r.game || 1;
    const lzjSets = gameNum >= 2 ? 1 : 0;
    const popovSets = 0;
    const nearSets = nearId === 'LZJ' ? lzjSets : popovSets;
    const farSets = farId === 'LZJ' ? lzjSets : popovSets;

    const nearServing = r.server === nearId;
    const farServing = r.server === farId;
    const srvCourt = r.service_court ? ` (${r.service_court})` : '';

    // Hide redundant floating DOM overlays so only the 3D floor-pinned boards on the court apron are shown
    const farPlate = document.getElementById('court-side-far');
    const nearPlate = document.getElementById('court-side-near');
    if (farPlate) farPlate.classList.add('hidden');
    if (nearPlate) nearPlate.classList.add('hidden');

    // Update 3D Floor Apron Canvases (pinned directly on the court floor apron, Screenshot 3)
    const tokens = this.getThemeTokens();
    this.paintApronCanvas(
      this.nearApronCanvas,
      this.nearApronTex,
      formatFullApron(nearId, 'NEAR'),
      `R${r.rally_id} · Game ${gameNum} · Sets: ${nearSets}${nearServing ? ' · Serving' + srvCourt : ''}`,
      `${nearPts} PTS`,
      nearServing,
      tokens.shotContinue
    );
    this.paintApronCanvas(
      this.farApronCanvas,
      this.farApronTex,
      formatFullApron(farId, 'FAR'),
      `R${r.rally_id} · Game ${gameNum} · Sets: ${farSets}${farServing ? ' · Serving' + srvCourt : ''}`,
      `${farPts} PTS`,
      farServing,
      tokens.shotWinner
    );
  }

  updateCourtSideProjections() {
    if (!this.camera) return;

    // Auto-orient 3D floor-pinned apron boards relative to camera view direction in screen space
    // so as the user rotates the 3D court, the floor boards never appear upside-down
    const target = this.controls ? this.controls.target : new THREE.Vector3(0, 0, 0);
    const dz = this.camera.position.z - target.z;
    const targetRotZ = dz <= 0 ? Math.PI : 0;

    if (this.nearApronMesh && this.nearApronMesh.rotation.z !== targetRotZ) {
      this.nearApronMesh.rotation.z = targetRotZ;
    }
    if (this.farApronMesh && this.farApronMesh.rotation.z !== targetRotZ) {
      this.farApronMesh.rotation.z = targetRotZ;
    }
  }

  applyThemeColors() {
    if (this.webglFailed || !this.scene) return;
    const tokens = this.getThemeTokens();
    this.scene.background = new THREE.Color(tokens.bg);
    if (this.courtFloorMat) this.courtFloorMat.color.set(tokens.courtFloor);
    if (this.innerCourtMat) this.innerCourtMat.color.set(tokens.courtFloor);
    if (this.courtLineMat) this.courtLineMat.color.set(tokens.courtLine);
    if (this.netPostMat) this.netPostMat.color.set(tokens.courtLine);
    if (this.netTapeMat) this.netTapeMat.color.set(tokens.courtLine);
    if (this.netPanelMat) {
      this.netPanelMat.color.set(tokens.netHex);
      this.netPanelMat.opacity = 0.45;
    }
    this.updateCourtSideHUD(this.activeRallyForHUD);
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('hawkview:themeChanged', () => this.applyThemeColors());
    window.addEventListener('hawkview:rallyChanged', (e) => {
      if (e.detail && e.detail.rally) {
        this.updateCourtSideHUD(e.detail.rally);
      }
    });
    window.addEventListener('hawkview:matchChanged', () => {
      this.updateCourtSideHUD(this.activeRallyForHUD);
    });

    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }

    // Bind right-hand vertical camera button stack
    const camButtons = [
      { id: 'cam-btn-3d', preset: '3d' },
      { id: 'cam-btn-top', preset: 'top' },
      { id: 'cam-btn-side', preset: 'side' },
      { id: 'cam-btn-net', preset: 'net' },
      { id: 'cam-btn-near', preset: 'near' },
      { id: 'cam-btn-far', preset: 'far' }
    ];
    camButtons.forEach(({ id, preset }) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => this.setPreset(preset));
      }
    });

    const fsBtn = document.getElementById('cam-btn-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    document.addEventListener('fullscreenchange', () => {
      setTimeout(() => this.onResize(), 60);
    });
  }

  toggleFullscreen() {
    const host = this.container.closest('.hv-court-card') || this.container.closest('.hv-court-row') || this.container;
    if (!document.fullscreenElement) {
      if (host.requestFullscreen) {
        host.requestFullscreen().catch(() => {});
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  setPreset(name) {
    const p = this.presets[name];
    if (!p || this.webglFailed) return;

    this.activePreset = name;
    this.updatePresetButtonsUI(name);

    const width = this._lastW || this.container.clientWidth || 760;
    const height = this._lastH || this.container.clientHeight || 435;

    if (p.ortho) {
      this.updateOrthoFrustum(width, height);
      this.orthoCamera.position.copy(p.pos);
      this.orthoCamera.up.set(0, 0, 1); // Far court (+Z) at top of screen, Near court (-Z) at bottom
      this.orthoCamera.lookAt(p.target);
      this.orthoCamera.updateProjectionMatrix();
      this.camera = this.orthoCamera;
      this.animatingCamera = false;
      if (this.controls) {
        this.controls.object = this.camera;
        this.controls.target.copy(p.target);
        this.controls.enableRotate = false;
        this.controls.update();
      }
    } else {
      const wasOrtho = (this.camera === this.orthoCamera);
      this.camera = this.perspCamera;
      this.perspCamera.fov = p.fov || 42;
      this.perspCamera.aspect = width / height;
      this.perspCamera.up.set(0, 1, 0);
      this.perspCamera.updateProjectionMatrix();

      if (this.controls) {
        this.controls.object = this.camera;
        this.controls.enableRotate = true;
      }

      if (wasOrtho) {
        this.camera.position.copy(p.pos);
        if (this.controls) {
          this.controls.target.copy(p.target);
          this.controls.update();
        }
        this.animatingCamera = false;
      } else {
        this.animatingCamera = true;
        this.camAnimStartTime = performance.now();
        this.camStartPos.copy(this.camera.position);
        this.camStartTarget.copy(this.controls ? this.controls.target : new THREE.Vector3());
        this.camEndPos.copy(p.pos);
        this.camEndTarget.copy(p.target);
      }
    }
  }

  cyclePreset() {
    const keys = ['3d', 'top', 'side', 'net', 'near', 'far'];
    const idx = keys.indexOf(this.activePreset);
    this.setPreset(keys[(idx + 1) % keys.length]);
  }

  updatePresetButtonsUI(activeName) {
    const map = {
      '3d': 'cam-btn-3d',
      'top': 'cam-btn-top',
      'side': 'cam-btn-side',
      'net': 'cam-btn-net',
      'near': 'cam-btn-near',
      'far': 'cam-btn-far'
    };
    Object.entries(map).forEach(([preset, id]) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle('active', preset === activeName);
      }
    });
  }

  onResize() {
    if (this.webglFailed || !this.container || !this.renderer) return;
    const width = Math.max(100, Math.floor(this.container.clientWidth || 320));
    const height = Math.max(100, Math.floor(this.container.clientHeight || 260));

    // Deadband guard: prevents any ResizeObserver feedback loop
    if (Math.abs(width - this._lastW) <= 1 && Math.abs(height - this._lastH) <= 1) {
      return;
    }
    this._lastW = width;
    this._lastH = height;

    if (this.perspCamera) {
      this.perspCamera.aspect = width / height;
      this.perspCamera.updateProjectionMatrix();
    }
    if (this.orthoCamera) {
      this.updateOrthoFrustum(width, height);
    }
    this.renderer.setSize(width, height, true);
  }

  /**
   * Converts BWF metric court coordinates (cx: 0..6.10m, cy: 0..13.40m, cz: height m)
   * into Three.js world space (wx, wy, wz).
   */
  courtToWorld(cx, cy, cz = 0) {
    const wx = -(cx - 3.05);
    const wz = cy - 6.70;
    const wy = Math.max(0, cz);
    return new THREE.Vector3(wx, wy, wz);
  }

  // Compatibility hooks for BroadcastPlayer
  updatePlayersFromTelemetry() {}
  clearTrail() {}
  updateTelemetryState(packet) {
    if (packet && packet.rally && packet.rally !== this.activeRallyForHUD) {
      this.updateCourtSideHUD(packet.rally);
    }
    if (this.shotExplorer) {
      this.shotExplorer.onPlaybackUpdate(packet);
    }
  }

  animate() {
    if (this.webglFailed || !this.renderer) return;
    requestAnimationFrame(() => this.animate());

    if (this.animatingCamera && this.camera === this.perspCamera) {
      const now = performance.now();
      const t = Math.min(1.0, (now - this.camAnimStartTime) / this.camAnimDuration);
      const ease = 1 - Math.pow(1 - t, 3);

      this.camera.position.lerpVectors(this.camStartPos, this.camEndPos, ease);
      if (this.controls) {
        this.controls.target.lerpVectors(this.camStartTarget, this.camEndTarget, ease);
        this.controls.update();
      }
      if (t >= 1.0) {
        this.animatingCamera = false;
      }
    } else if (this.controls) {
      this.controls.update();
    }

    this.updateCourtSideProjections();

    for (let i = 0; i < this.onBeforeRenderCallbacks.length; i++) {
      this.onBeforeRenderCallbacks[i]();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.ThreeCourtViewer = ThreeCourtViewer;
