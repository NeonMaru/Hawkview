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
        pos: new THREE.Vector3(0, 12.2, -21.8),
        target: new THREE.Vector3(0, 0.72, -0.45),
        fov: 46,
        ortho: false
      },
      'top': {
        pos: new THREE.Vector3(0, 22.0, -0.001),
        target: new THREE.Vector3(0, 0, 0),
        fov: 40,
        ortho: true
      },
      'side': {
        pos: new THREE.Vector3(14.8, 1.65, 0),
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
    this._userMovedCamera = false;
    this.animatingCamera = false;
    this.camAnimStartTime = 0;
    this.camAnimDuration = 420;
    this.camStartPos = new THREE.Vector3();
    this.camStartTarget = new THREE.Vector3();
    this.camEndPos = new THREE.Vector3();
    this.camEndTarget = new THREE.Vector3();

    // Gyroscope 3D Orbit Clutch state (Default: 'hold' — long-press bottom "Speeds" orb + tilt past deadzone)
    this.gyroMode = 'hold'; // 'hold' | 'always' | 'off'
    this.gyroDeadzoneDeg = 5.0;
    this._gyroPermissionGranted = false;
    this._gyroListenerBound = false;
    this._hasGyroSample = false;
    this._gyroRawBeta = 0;
    this._gyroRawGamma = 0;
    this._gyroSmoothBeta = 0;
    this._gyroSmoothGamma = 0;
    this._gyroBaseBeta = 0;
    this._gyroBaseGamma = 0;
    this._needsGyroBaselineSync = true;
    this._isFingerHeld = false;
    this._isGyroClutched = false;
    this._isOrbHoldActive = false;
    this._clutchPointerId = null;
    this._clutchStartX = 0;
    this._clutchStartY = 0;
    this._clutchDownTime = 0;
    this._clutchDragged = false;
    this._baseSpherical = new THREE.Spherical(18, Math.PI / 3, 0);
    this._currentGyroAzimuth = 0;
    this._currentGyroPolar = 0;
    this._gyroVelAzimuth = 0;
    this._gyroVelPolar = 0;
    this._lastGyroFrameTime = 0;

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
      this.buildPlayerMarkers();
      this.setupEvents();
      this.setupGyroControls();
      this.applyThemeColors();
      this.updateCourtSideHUD(null);
      this.animate();
      // Ensure camera frustum auto-fits after mobile 100dvh flexbox layout settles
      requestAnimationFrame(() => this.onResize(true));
      setTimeout(() => this.onResize(true), 120);
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

  getFramedPreset(name, width, height) {
    const base = this.presets[name] || this.presets['3d'];
    const aspect = Math.max(0.45, (width || 760) / Math.max(100, height || 435));
    const pos = base.pos.clone();
    const target = base.target.clone();

    if (name === '3d') {
      // Exact mathematical frustum bounding-box auto-fitter matching neutral reference framing:
      // Fits the outer floor apron corners (±4.50m x ±8.15m) so Near Apron sits at NDC (±0.88, -0.77)
      // and Far Apron sits at NDC (±0.50, +0.70) with comfortable neutral margin all around for orbiting.
      const fov = 45;
      const tAspect = Math.max(0, Math.min(1, (aspect - 0.82) / 0.75));
      const pitchDeg = 47.5 - tAspect * 8.5; // 47.5° on portrait/tall -> 39° on wide desktop
      const pitchRad = (pitchDeg * Math.PI) / 180;
      const dirY = Math.sin(pitchRad);
      const dirZ = -Math.cos(pitchRad);

      const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 150);
      cam.up.set(0, 1, 0);

      const apronNearL = new THREE.Vector3(-4.50, 0.0, -8.15);
      const apronFarL = new THREE.Vector3(-4.50, 0.0, 8.15);

      let targetZ = -1.8;
      let dist = 16.5;
      const targetY = 0.20;
      const v = new THREE.Vector3();

      for (let iter = 0; iter < 12; iter++) {
        target.set(0, targetY, targetZ);
        cam.position.set(0, targetY + dist * dirY, targetZ + dist * dirZ);
        cam.lookAt(target);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();

        v.copy(apronNearL).project(cam);
        const nearX = Math.abs(v.x);
        const minY = v.y;

        v.copy(apronFarL).project(cam);
        const farX = Math.abs(v.x);
        const maxY = v.y;

        const maxX = Math.max(nearX, farX);
        const midY = 0.5 * (minY + maxY);
        const spanY = maxY - minY;

        // Center vertical projection at -0.035 (leaving clean margin below top Playback/Explorer pill and at bottom)
        targetZ += (midY - (-0.035)) * 2.6;
        const fillRatio = Math.max(maxX / 0.88, spanY / 1.56);
        dist *= fillRatio;
      }

      pos.copy(cam.position);
      target.set(0, targetY, targetZ);
      return { pos, target, fov, ortho: false };
    } else if (name === 'side' && aspect < 1.35) {
      const sideScale = Math.min(1.45, 1.35 / Math.max(0.60, aspect));
      const offset = pos.clone().sub(target).multiplyScalar(sideScale);
      pos.copy(target).add(offset);
    }

    return {
      pos,
      target,
      fov: base.fov,
      ortho: base.ortho
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
    const framed3d = this.getFramedPreset('3d', width, height);

    // Perspective camera
    this.perspCamera = new THREE.PerspectiveCamera(
      framed3d.fov,
      aspect,
      0.1,
      120
    );
    this.perspCamera.position.copy(framed3d.pos);

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
      this.controls.maxDistance = 42.0;
      this.controls.target.copy(framed3d.target);
      this.controls.update();
    }
  }

  updateOrthoFrustum(width, height) {
    if (!this.orthoCamera) return;
    const aspect = (width || 760) / (height || 430);
    // Fit 13.40m length (Z) and 6.10m width (X) with clean margin for embedded top/bottom HUDs
    const minHalfZ = 8.4;
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
    ctx.fillText(`${labelText}${srvTag}`, 46, subText ? h * 0.39 : h * 0.5, w - 230);

    if (subText) {
      ctx.fillStyle = tokens.muted;
      ctx.font = '600 27px -apple-system, Inter, sans-serif';
      ctx.fillText(subText, 48, h * 0.74, w - 230);
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
    const players = (telemetry && telemetry.players) || {};
    const pKeys = Object.keys(players);

    // Ensure activeRallyForHUD belongs to the currently loaded telemetry
    if (this.activeRallyForHUD && rallies.length > 0 && !rallies.includes(this.activeRallyForHUD)) {
      this.activeRallyForHUD = null;
    }

    const r = rally || this.activeRallyForHUD || rallies[0] || null;
    this.activeRallyForHUD = r;

    const defaultNear = pKeys[0] || 'LZJ';
    const defaultFar = pKeys[1] || 'POPOV';
    const nearId = (r && r.near_player) ? r.near_player : defaultNear;
    const farId = (r && r.far_player) ? r.far_player : (nearId === defaultFar ? defaultNear : defaultFar);

    const inferFlag = (pid, nameStr, rawFlag) => {
      if (rawFlag && rawFlag !== '🏸') return rawFlag;
      const u = `${pid || ''} ${nameStr || ''}`.toUpperCase();
      const toks = u.match(/[A-Z]+/g) || [];
      const has = (arr) => arr.some((t) => toks.includes(t));
      if (has(['IWANAGA', 'IWANA', 'NAKANISHI', 'NAKAN', 'NARAOKA', 'MOMOTA', 'YAMAGUCHI', 'SHIDA', 'MATSUYAMA'])) return '🇯🇵';
      if (has(['TAN', 'THINAAH', 'MURALITHARAN', 'LZJ', 'CHIA', 'SOH', 'GOH']) || u.includes('ZII JIA')) return '🇲🇾';
      if (has(['SINDHU', 'PUSARLA', 'PURSARLA', 'SEN', 'PRANNOY', 'RANKIREDDY', 'SHETTY'])) return '🇮🇳';
      if (has(['AN', 'SY', 'SE', 'YOUNG', 'BAEK', 'KIM', 'SEO']) || u.includes('AN S')) return '🇰🇷';
      if (has(['ANTONSEN', 'AXELSEN', 'ASTRUP', 'RASMUSSEN'])) return '🇩🇰';
      if (has(['POPOV', 'LANIER', 'GICQUEL', 'DELRUE'])) return '🇫🇷';
      if (has(['SHI', 'CHEN', 'LIANG', 'WANG', 'ZHENG', 'HUANG', 'LIU'])) return '🇨🇳';
      if (has(['KUNLAVUT', 'VITIDSARN', 'INTANON'])) return '🇹🇭';
      return rawFlag || '🏸';
    };

    const formatFullApron = (pid, sideLabel) => {
      const meta = (players[pid] && players[pid].metadata) || {};
      const flag = inferFlag(pid, meta.name, meta.flag);
      if (meta.name) {
        return `${flag} ${meta.name.toUpperCase()} (${sideLabel})`;
      }
      if (pid === 'LZJ') return `🇲🇾 LEE ZII JIA (${sideLabel})`;
      if (pid === 'POPOV') return `🇫🇷 C. POPOV (${sideLabel})`;
      if (pid === 'ANTONSEN') return `🇩🇰 A. ANTONSEN (${sideLabel})`;
      return `${flag} ${(pid || sideLabel).toUpperCase()} (${sideLabel})`;
    };

    const sb = (r && r.score_before) || {};
    const nearPts = sb[nearId] !== undefined ? sb[nearId] : 0;
    const farPts = sb[farId] !== undefined ? sb[farId] : 0;

    const gameNum = (r && r.game) || 1;
    const rallyNum = (r && r.rally_id) || 1;
    const swapTag = (r && r.side_swapped) ? ' · ⇄ Swapped' : '';
    const nearServing = Boolean(r && r.server === nearId);
    const farServing = Boolean(r && r.server === farId);
    const srvCourt = (r && r.service_court) ? ` (${r.service_court})` : '';

    const farPlate = document.getElementById('court-side-far');
    const nearPlate = document.getElementById('court-side-near');
    if (farPlate) farPlate.classList.add('hidden');
    if (nearPlate) nearPlate.classList.add('hidden');

    const tokens = this.getThemeTokens();
    this.paintApronCanvas(
      this.nearApronCanvas,
      this.nearApronTex,
      formatFullApron(nearId, 'NEAR'),
      r ? `R${rallyNum} · Game ${gameNum}${swapTag}${nearServing ? ' · Serving' + srvCourt : ''}` : 'Calibrating & Streaming Rallies...',
      `${nearPts} PTS`,
      nearServing,
      tokens.shotContinue
    );
    this.paintApronCanvas(
      this.farApronCanvas,
      this.farApronTex,
      formatFullApron(farId, 'FAR'),
      r ? `R${rallyNum} · Game ${gameNum}${swapTag}${farServing ? ' · Serving' + srvCourt : ''}` : 'Calibrating & Streaming Rallies...',
      `${farPts} PTS`,
      farServing,
      tokens.shotWinner
    );
    this.updatePlayersFromTelemetry({ rally: r });
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

  wakeCourtHUD(durationMs = 2600) {
    const card = this.courtCardEl || (this.container && this.container.closest('.hv-court-card'));
    if (!card) return;
    this.courtCardEl = card;
    card.classList.add('hud-awake');
    if (this._hudWakeTimer) {
      clearTimeout(this._hudWakeTimer);
    }
    this._hudWakeTimer = setTimeout(() => {
      if (!this._isInteractingWithCamStack) {
        card.classList.remove('hud-awake');
      }
    }, durationMs);
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
      this.activeRallyForHUD = null;
      this.updateCourtSideHUD(null);
    });
    window.addEventListener('hawkview:ralliesStreamUpdated', () => {
      this.updateCourtSideHUD(this.activeRallyForHUD);
    });

    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }

    // Auto-wake embedded 3D camera pill (.hv-cam-stack) on touch/pointer/wheel/orbit interaction,
    // and auto-hide after 2.6 seconds of inactivity so the 3D view stays 100% clean
    const courtCard = this.container ? this.container.closest('.hv-court-card') : document.querySelector('.hv-court-card');
    this.courtCardEl = courtCard;
    if (this.container) {
      ['pointerdown', 'pointermove', 'touchstart', 'wheel'].forEach((evt) => {
        this.container.addEventListener(evt, () => this.wakeCourtHUD(2600), { passive: true });
      });
    }
    if (this.controls && typeof this.controls.addEventListener === 'function') {
      this.controls.addEventListener('start', () => {
        this._userMovedCamera = true;
        this.wakeCourtHUD(2600);
      });
      this.controls.addEventListener('change', () => this.wakeCourtHUD(2600));
    }
    const camStack = courtCard ? courtCard.querySelector('.hv-cam-stack') : document.querySelector('.hv-cam-stack');
    if (camStack) {
      camStack.addEventListener('pointerenter', () => {
        this._isInteractingWithCamStack = true;
        this.wakeCourtHUD(2600);
      });
      camStack.addEventListener('pointerleave', () => {
        this._isInteractingWithCamStack = false;
        this.wakeCourtHUD(2600);
      });
      camStack.addEventListener('pointerdown', () => this.wakeCourtHUD(2600));
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
        btn.addEventListener('click', () => {
          this.wakeCourtHUD(2600);
          this.setPreset(preset);
        });
      }
    });

    const fsBtn = document.getElementById('cam-btn-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    document.addEventListener('fullscreenchange', () => {
      setTimeout(() => this.onResize(), 60);
    });

    // Vertical court height slider & bottom-right drag resizer (#court-resizable-row)
    const courtRow = document.getElementById('court-resizable-row') || (this.container && this.container.closest('.hv-court-row'));
    const heightSlider = document.getElementById('court-height-slider');
    const resizeHandle = document.getElementById('court-resize-handle');

    const applyCourtHeight = (pxVal, save = false) => {
      if (!courtRow) return;
      const clamped = Math.max(280, Math.min(860, Math.round(Number(pxVal) || 530)));
      courtRow.style.setProperty('--court-height', `${clamped}px`);
      if (heightSlider && Number(heightSlider.value) !== clamped) {
        heightSlider.value = String(clamped);
      }
      if (save) {
        try {
          localStorage.setItem('hawkview_court_height_px', String(clamped));
        } catch (e) {}
      }
      this.onResize();
    };

    try {
      const savedH = localStorage.getItem('hawkview_court_height_px');
      if (savedH) {
        applyCourtHeight(Number(savedH), false);
      }
    } catch (e) {}

    if (heightSlider) {
      heightSlider.addEventListener('input', (e) => applyCourtHeight(e.target.value, false));
      heightSlider.addEventListener('change', (e) => applyCourtHeight(e.target.value, true));
    }

    if (resizeHandle && courtRow) {
      let dragging = false;
      let startY = 0;
      let startH = 440;

      resizeHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startY = e.clientY;
        startH = courtRow.clientHeight || 440;
        if (resizeHandle.setPointerCapture) {
          try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
        }
      });

      resizeHandle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        applyCourtHeight(startH + dy, false);
      });

      const stopDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        const dy = e.clientY - startY;
        applyCourtHeight(startH + dy, true);
      };

      resizeHandle.addEventListener('pointerup', stopDrag);
      resizeHandle.addEventListener('pointercancel', stopDrag);
    }
  }

  /**
   * High-margin deadzone filter (default 5.5°) so natural hand micro-tremors or
   * casual holding angles never trigger accidental 3D camera rotation.
   */
  applyGyroDeadzone(deltaDeg, deadzoneDeg = 5.5) {
    const d = Number(deltaDeg) || 0;
    const dz = Math.max(0, Number(deadzoneDeg) || 5.5);
    if (Math.abs(d) <= dz) return 0;
    return d > 0 ? (d - dz) : (d + dz);
  }

  /**
   * Computes deadzone-filtered, clamped spherical camera orbit offsets (dAzimuth, dPolar)
   * relative to the captured baseline orientation (baseBeta, baseGamma).
   */
  computeGyroOrbitOffset(rawBeta, rawGamma, baseBeta, baseGamma, deadzoneDeg = 5.5) {
    let dGamma = (Number(rawGamma) || 0) - (Number(baseGamma) || 0);
    let dBeta = (Number(rawBeta) || 0) - (Number(baseBeta) || 0);

    // Handle 180/-180 wraparound gracefully
    if (dGamma > 90) dGamma -= 180;
    if (dGamma < -90) dGamma += 180;
    if (dBeta > 180) dBeta -= 360;
    if (dBeta < -180) dBeta += 360;

    const effGamma = Math.max(-36, Math.min(36, this.applyGyroDeadzone(dGamma, deadzoneDeg)));
    const effBeta = Math.max(-32, Math.min(32, this.applyGyroDeadzone(dBeta, deadzoneDeg)));

    // Map effective degrees past deadzone to spherical radians:
    // - Tilting phone left/right (effGamma) rotates camera horizontally around the court (up to ±50°)
    // - Tilting phone up/down (effBeta) pitches camera vertically (inverted for natural window/gimbal feel)
    const dAzimuth = -effGamma * 0.024;
    const dPolar = -effBeta * 0.019;

    return {
      effGamma,
      effBeta,
      dAzimuth,
      dPolar,
      isTilting: Math.abs(effGamma) > 0.01 || Math.abs(effBeta) > 0.01
    };
  }

  _captureBaseSpherical() {
    if (!this.perspCamera) return;
    const target = this.controls ? this.controls.target : new THREE.Vector3(0, 0.2, -2.0);
    const offset = this.perspCamera.position.clone().sub(target);
    this._baseSpherical.setFromVector3(offset);
    this._gyroVelAzimuth = 0;
    this._gyroVelPolar = 0;
  }

  /**
   * Engaged when the user long-presses & holds the bottom-corner "Speeds" orb (#hv-thumb-stats-orb).
   * Locks current smoothed phone posture as zero baseline and enables additive gimbal rotation.
   */
  engageOrbGyroHold() {
    this.requestGyroPermission();
    this._isOrbHoldActive = true;
    this._isGyroClutched = true;
    this._clutchDragged = false;
    this._gyroSmoothBeta = this._gyroRawBeta;
    this._gyroSmoothGamma = this._gyroRawGamma;
    this._gyroBaseBeta = this._gyroRawBeta;
    this._gyroBaseGamma = this._gyroRawGamma;
    this._needsGyroBaselineSync = true;
    this._gyroVelAzimuth = 0;
    this._gyroVelPolar = 0;
    this._lastGyroFrameTime = performance.now();

    const hudEl = document.getElementById('court-gyro-hud');
    const hudTextEl = document.getElementById('court-gyro-hud-text');
    if (hudEl && hudTextEl) {
      if (this._gyroHudHideTimer) clearTimeout(this._gyroHudHideTimer);
      hudTextEl.textContent = '🧭 Hold Active · Tilt phone to rotate 3D';
      hudEl.classList.remove('hidden');
    }
  }

  /**
   * Released when the user lifts their thumb from the bottom-corner "Speeds" orb.
   * Keeps the 3D court at its newly rotated angle (never snaps back!).
   */
  releaseOrbGyroHold() {
    this._isOrbHoldActive = false;
    this._isGyroClutched = false;
    this._gyroVelAzimuth = 0;
    this._gyroVelPolar = 0;

    const hudEl = document.getElementById('court-gyro-hud');
    if (hudEl) {
      if (this._gyroHudHideTimer) clearTimeout(this._gyroHudHideTimer);
      this._gyroHudHideTimer = setTimeout(() => {
        if (!this._isGyroClutched && !this._isOrbHoldActive) {
          hudEl.classList.add('hidden');
        }
      }, 320);
    }
  }

  updateGyroButtonsUI() {
    const modeLabels = {
      hold: '🧭 Hold-Gyro',
      always: '🧭 Free-Gyro',
      off: '🧭 Gyro Off'
    };
    const sheetLabels = {
      hold: '🧭 Gyro: Hold',
      always: '🧭 Gyro: Free',
      off: '🧭 Gyro: Off'
    };
    const courtBtn = document.getElementById('btn-court-gyro-mode');
    if (courtBtn) {
      courtBtn.textContent = modeLabels[this.gyroMode] || '🧭 Hold-Gyro';
      courtBtn.classList.toggle('active', this.gyroMode !== 'off');
    }
    const sheetBtn = document.getElementById('btn-sheet-gyro');
    if (sheetBtn) {
      sheetBtn.textContent = sheetLabels[this.gyroMode] || '🧭 Gyro: Hold';
      sheetBtn.classList.toggle('active', this.gyroMode !== 'off');
    }
  }

  cycleGyroMode() {
    const order = ['hold', 'always', 'off'];
    const idx = order.indexOf(this.gyroMode);
    this.gyroMode = order[(idx + 1) % order.length];
    try {
      localStorage.setItem('hawkview_gyro_mode', this.gyroMode);
    } catch (e) {}
    this.requestGyroPermission();
    // Anchor baseline to current phone posture WITHOUT resetting camera position!
    this._gyroSmoothBeta = this._gyroRawBeta;
    this._gyroSmoothGamma = this._gyroRawGamma;
    this._gyroBaseBeta = this._gyroRawBeta;
    this._gyroBaseGamma = this._gyroRawGamma;
    this._needsGyroBaselineSync = true;
    this._gyroVelAzimuth = 0;
    this._gyroVelPolar = 0;
    this._lastGyroFrameTime = performance.now();
    this.updateGyroButtonsUI();

    const hudEl = document.getElementById('court-gyro-hud');
    const hudTextEl = document.getElementById('court-gyro-hud-text');
    if (hudEl && hudTextEl) {
      if (this.gyroMode === 'hold') {
        hudTextEl.textContent = '🧭 Long-press bottom "Speeds" button + tilt to rotate 3D';
      } else if (this.gyroMode === 'always') {
        hudTextEl.textContent = '🧭 Free Additive Gyro · Tilt phone to rotate 3D';
      } else {
        hudTextEl.textContent = '🧭 Gyro 3D Orbit Off';
      }
      hudEl.classList.remove('hidden');
      if (this._gyroHudHideTimer) clearTimeout(this._gyroHudHideTimer);
      this._gyroHudHideTimer = setTimeout(() => {
        if (!this._isGyroClutched && !this._isOrbHoldActive) hudEl.classList.add('hidden');
      }, 2400);
    }
  }

  requestGyroPermission() {
    if (this._gyroListenerBound) return;

    const bindOrientationStream = () => {
      if (this._gyroListenerBound) return;
      this._gyroListenerBound = true;
      this._gyroPermissionGranted = true;

      const onOrientation = (ev) => {
        if (ev.beta === null && ev.gamma === null) return;
        const rb = Number(ev.beta) || 0;
        const rg = Number(ev.gamma) || 0;
        this._gyroRawBeta = rb;
        this._gyroRawGamma = rg;
        if (!this._hasGyroSample || this._needsGyroBaselineSync) {
          this._hasGyroSample = true;
          this._needsGyroBaselineSync = false;
          this._gyroSmoothBeta = rb;
          this._gyroSmoothGamma = rg;
          this._gyroBaseBeta = rb;
          this._gyroBaseGamma = rg;
        } else {
          // Stage-1 sensor low-pass filter (eliminates raw MEMS accelerometer micro-jitter)
          let db = rb - this._gyroSmoothBeta;
          let dg = rg - this._gyroSmoothGamma;
          if (db > 180) db -= 360;
          if (db < -180) db += 360;
          if (dg > 90) dg -= 180;
          if (dg < -90) dg += 180;
          this._gyroSmoothBeta += db * 0.25;
          this._gyroSmoothGamma += dg * 0.25;
        }
      };

      window.addEventListener('deviceorientation', onOrientation, { passive: true });
    };

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ Safari requires calling requestPermission() inside a user gesture
      try {
        DeviceOrientationEvent.requestPermission()
          .then((state) => {
            if (state === 'granted') {
              bindOrientationStream();
            }
          })
          .catch(() => {});
      } catch (e) {}
    } else if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      // Android Chrome/Brave & non-iOS browsers allow immediate attachment by default on HTTPS
      bindOrientationStream();
    }
  }

  setupGyroControls() {
    try {
      const savedMode = localStorage.getItem('hawkview_gyro_mode');
      if (savedMode === 'hold' || savedMode === 'always' || savedMode === 'off') {
        this.gyroMode = savedMode;
      }
    } catch (e) {}

    this.updateGyroButtonsUI();

    // 1. Legally enable by default on Android/HTTPS immediately, and auto-unlock on iOS on the very first touch/click anywhere
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') {
      this.requestGyroPermission();
    }
    const unlockOnFirstGesture = () => {
      this.requestGyroPermission();
      window.removeEventListener('touchend', unlockOnFirstGesture, true);
      window.removeEventListener('pointerup', unlockOnFirstGesture, true);
      window.removeEventListener('click', unlockOnFirstGesture, true);
    };
    window.addEventListener('touchend', unlockOnFirstGesture, { capture: true, passive: true });
    window.addEventListener('pointerup', unlockOnFirstGesture, { capture: true, passive: true });
    window.addEventListener('click', unlockOnFirstGesture, { capture: true, passive: true });

    // 2. Wire Gyro Mode pill buttons (3D Court top bar + Toggle Sheet Control Center)
    ['btn-court-gyro-mode', 'btn-sheet-gyro'].forEach((btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cycleGyroMode();
        });
      }
    });

    // Track finger touch on the 3D canvas so Free-Gyro pauses while manually dragging the court
    if (this.container) {
      this.container.addEventListener('pointerdown', () => {
        this._isFingerHeld = true;
      }, { passive: true });
    }
    const endFingerTouch = () => {
      this._isFingerHeld = false;
      if (this.gyroMode === 'always') {
        // Re-center baseline to current phone posture after manual touch so Free-Gyro stays additive
        this._gyroSmoothBeta = this._gyroRawBeta;
        this._gyroSmoothGamma = this._gyroRawGamma;
        this._gyroBaseBeta = this._gyroRawBeta;
        this._gyroBaseGamma = this._gyroRawGamma;
        this._needsGyroBaselineSync = true;
        this._gyroVelAzimuth = 0;
        this._gyroVelPolar = 0;
      }
    };
    window.addEventListener('pointerup', endFingerTouch, { passive: true });
    window.addEventListener('pointercancel', endFingerTouch, { passive: true });
  }

  /**
   * True Additive Velocity-Damped Gyro Orbit:
   * - Active when holding the bottom "Speeds" orb (this._isOrbHoldActive / this._isGyroClutched)
   *   OR when in Free-Gyro mode (this.gyroMode === 'always').
   * - Tilting past the deadzone produces a smooth gimbal angular velocity that ADDITIVELY
   *   increments the camera's current spherical angles (theta, phi).
   * - Returning the phone to neutral smoothly coasts velocity to 0 and keeps the 3D court at its
   *   newly rotated position (never snaps or forces the 3D view back like a compass!).
   */
  updateGyroCameraOrbit() {
    if (this.webglFailed || !this._hasGyroSample) return;
    if (this.camera !== this.perspCamera || this.animatingCamera) return;

    const holdActive = (this._isOrbHoldActive || (this.gyroMode === 'hold' && this._isGyroClutched)) && !this._clutchDragged;
    const freeActive = (this.gyroMode === 'always' && !this._isFingerHeld);
    if (!holdActive && !freeActive) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this._lastGyroFrameTime > 0
      ? Math.max(0.008, Math.min(0.05, (now - this._lastGyroFrameTime) / 1000))
      : 0.016;
    this._lastGyroFrameTime = now;

    const currBeta = this._gyroSmoothBeta || this._gyroRawBeta;
    const currGamma = this._gyroSmoothGamma || this._gyroRawGamma;

    const { effGamma, effBeta, isTilting } = this.computeGyroOrbitOffset(
      currBeta,
      currGamma,
      this._gyroBaseBeta,
      this._gyroBaseGamma,
      this.gyroDeadzoneDeg
    );

    // Non-linear gimbal angular velocity curve (rad/sec): gentle near deadzone edge, responsive on deeper tilt
    // Up/Down (effBeta -> targetVelPolar) is inverted for natural feel
    const targetVelAzimuth = isTilting
      ? -Math.sign(effGamma) * Math.pow(Math.abs(effGamma), 1.12) * 0.046
      : 0;
    const targetVelPolar = isTilting
      ? -Math.sign(effBeta) * Math.pow(Math.abs(effBeta), 1.12) * 0.034
      : 0;

    // Stage-2 exponential velocity damping (silky gimbal acceleration & coast-to-stop)
    const velLerp = 1 - Math.exp(-8.5 * dt);
    this._gyroVelAzimuth += (targetVelAzimuth - this._gyroVelAzimuth) * velLerp;
    this._gyroVelPolar += (targetVelPolar - this._gyroVelPolar) * velLerp;

    // In Free-Gyro mode, gently adapt neutral posture baseline when stationary inside deadzone
    if (freeActive && !isTilting) {
      this._gyroBaseBeta += (currBeta - this._gyroBaseBeta) * 0.015;
      this._gyroBaseGamma += (currGamma - this._gyroBaseGamma) * 0.015;
    }

    if (Math.abs(this._gyroVelAzimuth) < 0.0015 && Math.abs(this._gyroVelPolar) < 0.0015) {
      return;
    }

    this._userMovedCamera = true;
    const target = this.controls ? this.controls.target : new THREE.Vector3(0, 0.2, -2.0);
    const currentOffset = this.perspCamera.position.clone().sub(target);
    const sph = new THREE.Spherical().setFromVector3(currentOffset);

    // ADDITIVE accumulation directly onto current camera spherical angles:
    // IMPORTANT: Never clamp sph.theta! The default 3D camera behind the near baseline (z < 0)
    // has sph.theta = ±Math.PI (±3.1416 rad), so clamping theta to [-1.48, 1.48] caused an
    // instant 95° snap to the side view! Leaving sph.theta unconstrained allows seamless 360° additive orbit.
    sph.theta += this._gyroVelAzimuth * dt;
    sph.phi = Math.max(0.12, Math.min(1.48, sph.phi + this._gyroVelPolar * dt));

    const newOffset = new THREE.Vector3().setFromSpherical(sph);
    this.perspCamera.position.copy(target).add(newOffset);
    if (this.controls) {
      this.controls.update();
    }

    const hudEl = document.getElementById('court-gyro-hud');
    const hudTextEl = document.getElementById('court-gyro-hud-text');
    if (hudEl && hudTextEl && isTilting) {
      const lr = Math.round(effGamma);
      const ud = Math.round(effBeta);
      const modeTag = this._isOrbHoldActive ? 'Hold+Tilt' : 'Free Tilt';
      hudTextEl.textContent = `🧭 ${modeTag} · L/R ${lr >= 0 ? '+' : ''}${lr}° · U/D ${ud >= 0 ? '+' : ''}${ud}°`;
      hudEl.classList.remove('hidden');
    }
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
    const baseP = this.presets[name];
    if (!baseP || this.webglFailed) return;

    this.activePreset = name;
    this._userMovedCamera = false;
    this.updatePresetButtonsUI(name);

    const width = this._lastW || this.container.clientWidth || 760;
    const height = this._lastH || this.container.clientHeight || 435;
    const p = this.getFramedPreset(name, width, height);

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

  onResize(forceRefit = false) {
    if (this.webglFailed || !this.container || !this.renderer) return;
    const width = Math.max(100, Math.floor(this.container.clientWidth || 320));
    const height = Math.max(100, Math.floor(this.container.clientHeight || 260));

    // Deadband guard: prevents any ResizeObserver feedback loop unless forceRefit is requested
    if (!forceRefit && Math.abs(width - this._lastW) <= 1 && Math.abs(height - this._lastH) <= 1) {
      return;
    }
    this._lastW = width;
    this._lastH = height;

    if (this.perspCamera) {
      this.perspCamera.aspect = width / height;
      if ((forceRefit || !this._userMovedCamera) && !this.animatingCamera && (this.activePreset === '3d' || this.activePreset === 'side')) {
        const framed = this.getFramedPreset(this.activePreset, width, height);
        this.perspCamera.fov = framed.fov || this.perspCamera.fov;
        this.perspCamera.position.copy(framed.pos);
        if (this.controls) {
          this.controls.target.copy(framed.target);
          this.controls.update();
        }
      }
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

  buildPlayerMarkers() {
    if (!this.scene) return;
    this.playerMarkersGroup = new THREE.Group();
    this.playerMarkersGroup.name = 'playerMarkersGroup';
    this.scene.add(this.playerMarkersGroup);

    const createMarker = (hexColor, roleLabel) => {
      const group = new THREE.Group();
      group.name = roleLabel;
      const ringGeo = new THREE.RingGeometry(0.20, 0.30, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.90
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.014;
      group.add(ring);

      const discGeo = new THREE.CircleGeometry(0.14, 24);
      discGeo.rotateX(-Math.PI / 2);
      const discMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.y = 0.015;
      group.add(disc);

      const postGeo = new THREE.CylinderGeometry(0.035, 0.055, 0.32, 16);
      const postMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.85
      });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = 0.16;
      group.add(post);

      group.visible = false;
      this.playerMarkersGroup.add(group);
      return group;
    };

    // 2 Near markers (blue/cyan) + 2 Far markers (amber/coral) for Singles (1+1) or Doubles (2+2)
    this.nearPlayerMarkers = [
      createMarker(0x38bdf8, 'near_player_0'),
      createMarker(0x0284c7, 'near_player_1')
    ];
    this.farPlayerMarkers = [
      createMarker(0xf59e0b, 'far_player_0'),
      createMarker(0xea580c, 'far_player_1')
    ];

    let savedShow = true;
    try {
      const raw = localStorage.getItem('hawkview_show_players');
      if (raw === 'false') savedShow = false;
    } catch (e) {}
    this.setPlayerMarkersVisible(savedShow, false);

    const toggleBtn = document.getElementById('btn-toggle-players');
    if (toggleBtn && !toggleBtn._hvBound) {
      toggleBtn._hvBound = true;
      toggleBtn.addEventListener('click', () => {
        this.setPlayerMarkersVisible(!this.showPlayerMarkers, true);
      });
    }
  }

  setPlayerMarkersVisible(visible, persist = true) {
    this.showPlayerMarkers = Boolean(visible);
    if (this.playerMarkersGroup) {
      this.playerMarkersGroup.visible = this.showPlayerMarkers;
    }
    const toggleBtn = document.getElementById('btn-toggle-players');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this.showPlayerMarkers);
      toggleBtn.textContent = this.showPlayerMarkers ? '👤 Players' : '👤 Players: Off';
      toggleBtn.setAttribute('aria-pressed', this.showPlayerMarkers ? 'true' : 'false');
    }
    if (persist) {
      try {
        localStorage.setItem('hawkview_show_players', this.showPlayerMarkers ? 'true' : 'false');
      } catch (e) {}
    }
  }

  // Compatibility hooks for BroadcastPlayer & 2v2 Doubles / 1v1 Singles court markers
  _extractShotPlayersXY(shot, isDoubles) {
    let nearXYs = (shot && Array.isArray(shot.near_players_xy) && shot.near_players_xy.length > 0)
      ? shot.near_players_xy.slice(0, 2).map((p) => [Number(p[0]), Number(p[1])])
      : [];
    let farXYs = (shot && Array.isArray(shot.far_players_xy) && shot.far_players_xy.length > 0)
      ? shot.far_players_xy.slice(0, 2).map((p) => [Number(p[0]), Number(p[1])])
      : [];

    if (shot && nearXYs.length === 0 && farXYs.length === 0) {
      const hxy = shot.hitter_court_xy;
      const oxy = shot.opponent_court_xy;
      if (shot.side === 'near') {
        if (Array.isArray(hxy) && hxy.length >= 2) nearXYs.push([Number(hxy[0]), Number(hxy[1])]);
        if (Array.isArray(oxy) && oxy.length >= 2) farXYs.push([Number(oxy[0]), Number(oxy[1])]);
      } else {
        if (Array.isArray(oxy) && oxy.length >= 2) nearXYs.push([Number(oxy[0]), Number(oxy[1])]);
        if (Array.isArray(hxy) && hxy.length >= 2) farXYs.push([Number(hxy[0]), Number(hxy[1])]);
      }
    }

    if (isDoubles) {
      if (nearXYs.length === 1) {
        const [nx, ny] = nearXYs[0];
        nearXYs.push([nx < 3.05 ? Math.min(5.1, nx + 1.8) : Math.max(1.0, nx - 1.8), Math.max(1.2, Math.min(5.8, ny))]);
      } else if (nearXYs.length === 0) {
        nearXYs = [[1.85, 3.1], [4.25, 3.1]];
      }
      if (farXYs.length === 1) {
        const [fx, fy] = farXYs[0];
        farXYs.push([fx < 3.05 ? Math.min(5.1, fx + 1.8) : Math.max(1.0, fx - 1.8), Math.max(7.6, Math.min(12.2, fy))]);
      } else if (farXYs.length === 0) {
        farXYs = [[1.85, 10.3], [4.25, 10.3]];
      }
    } else {
      nearXYs = nearXYs.slice(0, 1);
      farXYs = farXYs.slice(0, 1);
    }
    return { nearXYs, farXYs };
  }

  _lerpPlayerList(aList, bList, alpha) {
    if (!aList || aList.length === 0) return bList || [];
    if (!bList || bList.length === 0 || alpha <= 0.001) return aList;
    if (alpha >= 0.999) return bList;

    // 2x2 minimum-distance partner assignment so Doubles partners never swap identities mid-flight
    let matchedB = bList;
    if (aList.length === 2 && bList.length === 2) {
      const dStraight = Math.hypot(aList[0][0] - bList[0][0], aList[0][1] - bList[0][1])
        + Math.hypot(aList[1][0] - bList[1][0], aList[1][1] - bList[1][1]);
      const dCross = Math.hypot(aList[0][0] - bList[1][0], aList[0][1] - bList[1][1])
        + Math.hypot(aList[1][0] - bList[0][0], aList[1][1] - bList[0][1]);
      if (dCross + 0.05 < dStraight) {
        matchedB = [bList[1], bList[0]];
      }
    }

    const out = [];
    const n = Math.min(aList.length, matchedB.length);
    for (let i = 0; i < n; i++) {
      out.push([
        aList[i][0] + (matchedB[i][0] - aList[i][0]) * alpha,
        aList[i][1] + (matchedB[i][1] - aList[i][1]) * alpha
      ]);
    }
    return out;
  }

  updatePlayersFromTelemetry(packet) {
    if (!this.nearPlayerMarkers || !this.farPlayerMarkers) return;
    const store = window.cacheStoreInstance;
    const rally = (packet && packet.rally) || this.activeRallyForHUD || (store && store.getRally(store.activeRallyId));
    const isDoubles = Boolean(
      (store && store.matchMeta && store.matchMeta.match_type === 'doubles') ||
      (rally && (
        (rally.near_player && rally.near_player.includes('/')) ||
        (rally.far_player && rally.far_player.includes('/'))
      ))
    );

    const t = packet && typeof packet.time === 'number'
      ? packet.time
      : (packet && typeof packet.currentTime === 'number' ? packet.currentTime : -1);
    const activeShot = (packet && (packet.shot || packet.activeShot)) || null;

    let nearXYs = [];
    let farXYs = [];

    // 1. Continuous smooth interpolation across consecutive shots in the rally
    if (rally && Array.isArray(rally.shots) && rally.shots.length > 0 && t >= 0) {
      const shots = rally.shots;
      const shotTime = (s) => Number(s.time_sec ?? s.time ?? 0);
      let idxPrev = 0;
      for (let i = 0; i < shots.length; i++) {
        if (shotTime(shots[i]) <= t) {
          idxPrev = i;
        } else {
          break;
        }
      }
      const sPrev = shots[idxPrev];
      const sNext = idxPrev + 1 < shots.length ? shots[idxPrev + 1] : null;
      const pPrev = this._extractShotPlayersXY(sPrev, isDoubles);

      if (sNext) {
        const t0 = shotTime(sPrev);
        const t1 = Math.max(t0 + 0.05, shotTime(sNext));
        const alpha = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
        const pNext = this._extractShotPlayersXY(sNext, isDoubles);
        nearXYs = this._lerpPlayerList(pPrev.nearXYs, pNext.nearXYs, alpha);
        farXYs = this._lerpPlayerList(pPrev.farXYs, pNext.farXYs, alpha);
      } else {
        nearXYs = pPrev.nearXYs;
        farXYs = pPrev.farXYs;
      }
    } else if (activeShot) {
      const extracted = this._extractShotPlayersXY(activeShot, isDoubles);
      nearXYs = extracted.nearXYs;
      farXYs = extracted.farXYs;
    } else if (rally && Array.isArray(rally.shots) && rally.shots.length > 0) {
      const extracted = this._extractShotPlayersXY(rally.shots[0], isDoubles);
      nearXYs = extracted.nearXYs;
      farXYs = extracted.farXYs;
    }

    // Keep consistent marker-to-player pairing across frames so blue/orange markers never jump-swap
    const assignMarkersSmooth = (markers, targetXYs, instant) => {
      if (!markers) return;
      let ordered = targetXYs;
      if (targetXYs.length === 2 && markers[0].visible && markers[1].visible) {
        const w0 = this.courtToWorld(targetXYs[0][0], targetXYs[0][1], 0);
        const w1 = this.courtToWorld(targetXYs[1][0], targetXYs[1][1], 0);
        const dKeep = Math.hypot(markers[0].position.x - w0.x, markers[0].position.z - w0.z)
          + Math.hypot(markers[1].position.x - w1.x, markers[1].position.z - w1.z);
        const dSwap = Math.hypot(markers[0].position.x - w1.x, markers[0].position.z - w1.z)
          + Math.hypot(markers[1].position.x - w0.x, markers[1].position.z - w0.z);
        if (dSwap + 0.15 < dKeep) {
          ordered = [targetXYs[1], targetXYs[0]];
        }
      }
      for (let i = 0; i < 2; i++) {
        const m = markers[i];
        if (!m) continue;
        if (i < ordered.length && Array.isArray(ordered[i]) && ordered[i].length >= 2) {
          const wp = this.courtToWorld(Number(ordered[i][0]), Number(ordered[i][1]), 0);
          if (!m.visible || instant) {
            m.position.set(wp.x, 0, wp.z);
          } else {
            m.position.x += (wp.x - m.position.x) * 0.35;
            m.position.z += (wp.z - m.position.z) * 0.35;
          }
          m.visible = true;
        } else {
          m.visible = false;
        }
      }
    };

    const instant = Boolean(packet && packet.instant);
    assignMarkersSmooth(this.nearPlayerMarkers, nearXYs, instant);
    assignMarkersSmooth(this.farPlayerMarkers, farXYs, instant);
  }

  clearTrail() {}
  updateTelemetryState(packet) {
    if (packet && packet.rally && packet.rally !== this.activeRallyForHUD) {
      this.updateCourtSideHUD(packet.rally);
    }
    this.updatePlayersFromTelemetry(packet);
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
        this._gyroBaseBeta = this._gyroRawBeta;
        this._gyroBaseGamma = this._gyroRawGamma;
        this._captureBaseSpherical();
      }
    } else if (this.controls) {
      this.updateGyroCameraOrbit();
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
