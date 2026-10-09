/**
 * Three.js 3D Badminton Court Viewport (Hawkview)
 * Real-time 3D Graphics Engine with:
 * - Regulation BWF Court Dimensions (13.4m x 6.1m, 1.55m net, 40mm official lines)
 * - Official BWF Arctic Open blue arena surround & stadium lighting
 * - OrbitControls for free tilt, rotation, pan, and zoom
 * - 5 Camera Presets (BWF Broadcast, Behind Server, Side Angle, Bird's-Eye, Reset)
 * - 3D Ballistic Shuttlecock with cork/feather geometry, orientation, and glowing supersonic vapor trail
 * - 3D Animated Player Models (Lee Zii Jia & Su Li Yang) with jump smash elevation
 */

class ThreeCourtViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Container #${containerId} not found`);
      return;
    }

    // Regulation BWF Court Metrics (Meters)
    this.BWF = {
      length: 13.40,
      width: 6.10,
      singlesWidth: 5.18,
      tramline: 0.46,
      netHeightPosts: 1.55,
      netHeightCenter: 1.524,
      shortServiceDist: 1.98,
      doublesLongServiceDist: 0.76,
      lineWidth: 0.04
    };

    // Camera presets definitions
    this.presets = {
      broadcast: {
        pos: new THREE.Vector3(0, 8.8, -14.8),
        target: new THREE.Vector3(0, 1.2, 0.8),
        fov: 44
      },
      server: {
        pos: new THREE.Vector3(0, 3.2, -9.6),
        target: new THREE.Vector3(0, 1.6, 2.0),
        fov: 52
      },
      side: {
        pos: new THREE.Vector3(12.5, 4.2, 0),
        target: new THREE.Vector3(0, 1.4, 0),
        fov: 45
      },
      top: {
        pos: new THREE.Vector3(0, 18.5, -0.001),
        target: new THREE.Vector3(0, 0, 0),
        fov: 40
      }
    };

    this.activePreset = 'broadcast';
    this.animatingCamera = false;
    this.camAnimStartTime = 0;
    this.camAnimDuration = 700; // ms
    this.camStartPos = new THREE.Vector3();
    this.camStartTarget = new THREE.Vector3();
    this.camEndPos = new THREE.Vector3();
    this.camEndTarget = new THREE.Vector3();

    // Player state
    this.p1Pos = new THREE.Vector3(0, 0, -4.8); // LZJ (near)
    this.p2Pos = new THREE.Vector3(0, 0, 4.8);  // SLY (far)
    this.p1Jump = 0;
    this.p2Jump = 0;

    // Shuttle state
    this.shuttlePos = new THREE.Vector3(0, 2.5, 0);
    this.shuttleVel = new THREE.Vector3(0, 0, 1);
    this.trailPoints = [];
    this.maxTrailPoints = 40;
    this.isSmashActive = false;

    this.initScene();
    this.buildLighting();
    this.buildArenaAndCourt();
    this.buildNet();
    this.buildShuttlecock();
    this.buildPlayers();
    this.setupEvents();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080d);
    this.scene.fog = new THREE.FogExp2(0x06080d, 0.02);

    const rect = this.container.getBoundingClientRect();
    const width = rect.width || 720;
    const height = rect.height || 450;

    this.camera = new THREE.PerspectiveCamera(
      this.presets.broadcast.fov,
      width / height,
      0.1,
      100
    );
    this.camera.position.copy(this.presets.broadcast.pos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Canvas element
    this.renderer.domElement.id = 'three-canvas';
    this.renderer.domElement.className = 'w-full h-full block cursor-grab active:cursor-grabbing';
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls
    if (THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.04; // Don't clip beneath court floor
      this.controls.minDistance = 3.0;
      this.controls.maxDistance = 32.0;
      this.controls.target.copy(this.presets.broadcast.target);
      this.controls.update();

      this.controls.addEventListener('start', () => {
        this.renderer.domElement.classList.remove('cursor-grab');
        this.renderer.domElement.classList.add('cursor-grabbing');
      });
      this.controls.addEventListener('end', () => {
        this.renderer.domElement.classList.remove('cursor-grabbing');
        this.renderer.domElement.classList.add('cursor-grab');
      });
    }
  }

  buildLighting() {
    // Ambient Stadium Fill
    const ambient = new THREE.AmbientLight(0x1a2638, 0.85);
    this.scene.add(ambient);

    // Overhead Key Floodlight (Simulating TV Arena Lights)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(0, 16, 2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    // Cyan & Emerald Subtle Accent Rim Lights
    const cyanRim = new THREE.DirectionalLight(0x00f0ff, 0.35);
    cyanRim.position.set(-10, 8, -12);
    this.scene.add(cyanRim);

    const amberRim = new THREE.DirectionalLight(0xffa726, 0.25);
    amberRim.position.set(10, 8, 12);
    this.scene.add(amberRim);
  }

  buildArenaAndCourt() {
    // 1. Dark outer stadium arena floor
    const outerFloorGeo = new THREE.PlaneGeometry(60, 60);
    const outerFloorMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.95,
      metalness: 0.1
    });
    const outerFloor = new THREE.Mesh(outerFloorGeo, outerFloorMat);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.position.y = -0.01;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    // 2. BWF Arctic Open Blue Arena Surround Mat (14.5m x 22.0m)
    const blueSurroundGeo = new THREE.PlaneGeometry(14.5, 22.0);
    const blueSurroundMat = new THREE.MeshStandardMaterial({
      color: 0x0d1a2d,
      roughness: 0.75,
      metalness: 0.15
    });
    const blueSurround = new THREE.Mesh(blueSurroundGeo, blueSurroundMat);
    blueSurround.rotation.x = -Math.PI / 2;
    blueSurround.position.y = 0.0;
    blueSurround.receiveShadow = true;
    this.scene.add(blueSurround);

    // 3. Official Regulation Court Mat (Yonex Emerald Green: 6.10m x 13.40m)
    const courtGeo = new THREE.PlaneGeometry(this.BWF.width, this.BWF.length);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      roughness: 0.65,
      metalness: 0.1
    });
    const courtMesh = new THREE.Mesh(courtGeo, courtMat);
    courtMesh.rotation.x = -Math.PI / 2;
    courtMesh.position.y = 0.002; // Prevent z-fighting
    courtMesh.receiveShadow = true;
    this.scene.add(courtMesh);

    // 4. Official White BWF Court Lines (40mm thickness = 0.04m)
    this.buildBWFLines();

    // 5. Perimeter A-Frame Advertising Boards (Arctic Open / Hawkview / Casio Edifice)
    this.buildPerimeterBoards();
  }

  buildBWFLines() {
    const linesGroup = new THREE.Group();
    linesGroup.position.y = 0.005;

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lw = this.BWF.lineWidth; // 0.04m

    const createQuad = (w, l, cx, cz) => {
      const geo = new THREE.PlaneGeometry(w, l);
      const mesh = new THREE.Mesh(geo, lineMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0, cz);
      linesGroup.add(mesh);
    };

    const halfW = this.BWF.width / 2;   // 3.05m
    const halfL = this.BWF.length / 2;  // 6.70m

    // --- Outer Doubles Boundary ---
    // Baselines (Z = -6.7m and Z = +6.7m)
    createQuad(this.BWF.width, lw, 0, -halfL + lw / 2);
    createQuad(this.BWF.width, lw, 0, halfL - lw / 2);
    // Doubles Sidelines (X = -3.05m and X = +3.05m)
    createQuad(lw, this.BWF.length, -halfW + lw / 2, 0);
    createQuad(lw, this.BWF.length, halfW - lw / 2, 0);

    // --- Singles Sidelines (0.46m inside each side) ---
    const singlesX = halfW - this.BWF.tramline; // 3.05 - 0.46 = 2.59m
    createQuad(lw, this.BWF.length, -singlesX, 0);
    createQuad(lw, this.BWF.length, singlesX, 0);

    // --- Short Service Lines (1.98m from net) ---
    const sslZ = this.BWF.shortServiceDist; // 1.98m
    createQuad(this.BWF.width, lw, 0, -sslZ);
    createQuad(this.BWF.width, lw, 0, sslZ);

    // --- Doubles Long Service Lines (0.76m inside back lines) ---
    const dlslZ = halfL - this.BWF.doublesLongServiceDist; // 6.70 - 0.76 = 5.94m
    createQuad(this.BWF.width, lw, 0, -dlslZ);
    createQuad(this.BWF.width, lw, 0, dlslZ);

    // --- Center Lines (Splits right and left service courts) ---
    // Near side: from back baseline (Z = -6.70) to short service line (Z = -1.98)
    const centerLen = halfL - sslZ; // 4.72m
    const centerNearZ = -(sslZ + centerLen / 2);
    createQuad(lw, centerLen, 0, centerNearZ);

    // Far side: from short service line (Z = +1.98) to back baseline (Z = +6.70)
    const centerFarZ = sslZ + centerLen / 2;
    createQuad(lw, centerLen, 0, centerFarZ);

    this.scene.add(linesGroup);
  }

  buildPerimeterBoards() {
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.5
    });
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const createBoard = (w, h, x, z, rotY) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), boardMat);
      body.position.y = h / 2;
      body.castShadow = true;
      g.add(body);

      // Top glowing cyan LED strip
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.27), stripMat);
      strip.position.y = h + 0.015;
      g.add(strip);

      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };

    // Far back boards
    createBoard(12.0, 0.75, 0, 9.8, 0);
    // Near back boards
    createBoard(12.0, 0.75, 0, -9.8, Math.PI);
    // Left side boards
    createBoard(18.0, 0.75, -5.8, 0, Math.PI / 2);
    // Right side boards
    createBoard(18.0, 0.75, 5.8, 0, -Math.PI / 2);
  }

  buildNet() {
    const netGroup = new THREE.Group();

    // 1. Posts (Regulation height 1.55m, placed 0.15m outside doubles sidelines at X = ±3.20m)
    const postGeo = new THREE.CylinderGeometry(0.025, 0.025, this.BWF.netHeightPosts, 16);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.8,
      roughness: 0.2
    });

    const postLeft = new THREE.Mesh(postGeo, postMat);
    postLeft.position.set(-3.20, this.BWF.netHeightPosts / 2, 0);
    postLeft.castShadow = true;
    netGroup.add(postLeft);

    const postRight = new THREE.Mesh(postGeo, postMat);
    postRight.position.set(3.20, this.BWF.netHeightPosts / 2, 0);
    postRight.castShadow = true;
    netGroup.add(postRight);

    // 2. Net Mesh (Spans 6.10m court width + post margins, height 0.76m, from Y = 0.76m to 1.524m)
    const netWidth = 6.40;
    const meshHeight = 0.76;
    const netMeshGeo = new THREE.PlaneGeometry(netWidth, meshHeight);
    
    // Procedural grid texture for net mesh
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const netCtx = netCanvas.getContext('2d');
    netCtx.fillStyle = 'rgba(15, 23, 42, 0.0)';
    netCtx.fillRect(0, 0, 64, 64);
    netCtx.strokeStyle = 'rgba(240, 240, 240, 0.65)';
    netCtx.lineWidth = 2;
    netCtx.strokeRect(0, 0, 64, 64);
    netCtx.beginPath();
    netCtx.moveTo(32, 0); netCtx.lineTo(32, 64);
    netCtx.moveTo(0, 32); netCtx.lineTo(64, 32);
    netCtx.stroke();

    const netTexture = new THREE.CanvasTexture(netCanvas);
    netTexture.wrapS = THREE.RepeatWrapping;
    netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(120, 15);

    const netMeshMat = new THREE.MeshStandardMaterial({
      map: netTexture,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      roughness: 0.8
    });

    const netMesh = new THREE.Mesh(netMeshGeo, netMeshMat);
    netMesh.position.set(0, 0.76 + meshHeight / 2, 0);
    netGroup.add(netMesh);

    // 3. Official 75mm White Top Tape
    const tapeGeo = new THREE.BoxGeometry(netWidth, 0.075, 0.015);
    const tapeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.1
    });
    const tapeMesh = new THREE.Mesh(tapeGeo, tapeMat);
    tapeMesh.position.set(0, this.BWF.netHeightCenter, 0);
    tapeMesh.castShadow = true;
    netGroup.add(tapeMesh);

    this.scene.add(netGroup);
  }

  buildShuttlecock() {
    this.shuttleGroup = new THREE.Group();

    // 1. White Rounded Cork Base (Hemisphere / Sphere)
    const corkGeo = new THREE.SphereGeometry(0.014, 16, 16);
    const corkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.05
    });
    const corkMesh = new THREE.Mesh(corkGeo, corkMat);
    corkMesh.position.set(0, 0, 0.02);
    this.shuttleGroup.add(corkMesh);

    // 2. 16 Feather Skirt Cone
    const skirtGeo = new THREE.ConeGeometry(0.034, 0.065, 16, 1, true);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.5,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.rotation.x = -Math.PI / 2;
    skirtMesh.position.set(0, 0, -0.015);
    this.shuttleGroup.add(skirtMesh);

    // 3. Supersonic Glow Core
    const glowGeo = new THREE.SphereGeometry(0.022, 12, 12);
    this.shuttleGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.7
    });
    this.shuttleGlow = new THREE.Mesh(glowGeo, this.shuttleGlowMat);
    this.shuttleGroup.add(this.shuttleGlow);

    this.scene.add(this.shuttleGroup);

    // 4. Ground Shadow for Ballistic Height
    const shadowGeo = new THREE.PlaneGeometry(0.2, 0.12);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45
    });
    this.shuttleShadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shuttleShadow.rotation.x = -Math.PI / 2;
    this.shuttleShadow.position.y = 0.003;
    this.scene.add(this.shuttleShadow);

    // 5. Dynamic Vapor Trail Geometry & Line
    this.trailMax = 50;
    const trailPositions = new Float32Array(this.trailMax * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));

    this.trailMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      linewidth: 3,
      transparent: true,
      opacity: 0.8
    });
    this.trailLine = new THREE.Line(trailGeo, this.trailMat);
    this.scene.add(this.trailLine);
  }

  buildPlayers() {
    // Player 1: Lee Zii Jia (MAS - Cyan Jersey #00f0ff)
    this.player1 = this.createPlayerFigure(0x00f0ff, 0x111827, 'LEE ZII JIA (MAS)', true);
    this.scene.add(this.player1.group);

    // Player 2: Su Li Yang (TPE - Orange Jersey #ff5722)
    this.player2 = this.createPlayerFigure(0xff5722, 0x0f172a, 'SU LI YANG (TPE)', false);
    this.scene.add(this.player2.group);
  }

  createPlayerFigure(jerseyHex, shortsHex, name, isNearSide) {
    const group = new THREE.Group();

    // Torso (Jersey)
    const torsoGeo = new THREE.BoxGeometry(0.44, 0.62, 0.24);
    const torsoMat = new THREE.MeshStandardMaterial({
      color: jerseyHex,
      roughness: 0.4,
      metalness: 0.1
    });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.25;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const headGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.8 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.70;
    head.castShadow = true;
    group.add(head);

    // Shorts
    const shortsGeo = new THREE.BoxGeometry(0.42, 0.35, 0.23);
    const shortsMat = new THREE.MeshStandardMaterial({ color: shortsHex, roughness: 0.7 });
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.86;
    shorts.castShadow = true;
    group.add(shorts);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.70, 12);
    const legMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.8 });

    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.13, 0.42, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.13, 0.42, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    // Shoes
    const shoeGeo = new THREE.BoxGeometry(0.12, 0.10, 0.26);
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(-0.13, 0.05, 0.04);
    group.add(leftShoe);

    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0.13, 0.05, 0.04);
    group.add(rightShoe);

    // Racket Arm & Badminton Racket (Right arm holding racket)
    const armGroup = new THREE.Group();
    armGroup.position.set(-0.24, 1.45, 0);

    const armGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.55, 12);
    const arm = new THREE.Mesh(armGeo, legMat);
    arm.rotation.z = Math.PI / 4;
    arm.position.set(-0.15, -0.15, 0);
    armGroup.add(arm);

    // Racket Shaft & Head
    const shaftGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.65, 8);
    const racketMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.8,
      roughness: 0.2
    });
    const shaft = new THREE.Mesh(shaftGeo, racketMat);
    shaft.position.set(-0.40, 0.15, 0);
    shaft.rotation.z = Math.PI / 3;
    armGroup.add(shaft);

    const headFrameGeo = new THREE.TorusGeometry(0.13, 0.008, 8, 24);
    const headFrame = new THREE.Mesh(headFrameGeo, racketMat);
    headFrame.position.set(-0.64, 0.35, 0);
    headFrame.rotation.y = Math.PI / 2;
    armGroup.add(headFrame);

    group.add(armGroup);

    // Player Ground Shadow
    const shadowGeo = new THREE.PlaneGeometry(0.85, 0.55);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    group.add(shadow);

    // Initial position
    group.position.set(0, 0, isNearSide ? -4.5 : 4.5);
    if (!isNearSide) {
      group.rotation.y = Math.PI; // Face the net
    }

    return {
      group,
      torso,
      armGroup,
      shadow,
      baseY: 0,
      targetPos: group.position.clone()
    };
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onResize());

    // Connect Camera Preset Buttons
    const btnBroadcast = document.getElementById('cam-preset-broadcast');
    const btnServer = document.getElementById('cam-preset-server');
    const btnSide = document.getElementById('cam-preset-side');
    const btnTop = document.getElementById('cam-preset-top');
    const btnReset = document.getElementById('cam-preset-reset');

    if (btnBroadcast) btnBroadcast.addEventListener('click', () => this.setPreset('broadcast'));
    if (btnServer) btnServer.addEventListener('click', () => this.setPreset('server'));
    if (btnSide) btnSide.addEventListener('click', () => this.setPreset('side'));
    if (btnTop) btnTop.addEventListener('click', () => this.setPreset('top'));
    if (btnReset) btnReset.addEventListener('click', () => this.resetOrbit());
  }

  setPreset(name) {
    const p = this.presets[name];
    if (!p) return;

    this.activePreset = name;
    this.updatePresetButtonsUI(name);

    // Smoothly animate camera to preset
    this.animatingCamera = true;
    this.camAnimStartTime = performance.now();
    this.camStartPos.copy(this.camera.position);
    this.camStartTarget.copy(this.controls ? this.controls.target : new THREE.Vector3());
    this.camEndPos.copy(p.pos);
    this.camEndTarget.copy(p.target);

    // Play click sound if broadcast player exists
    if (window.broadcastPlayerInstance && window.broadcastPlayerInstance.playMechanicalClick) {
      window.broadcastPlayerInstance.playMechanicalClick();
    }
  }

  resetOrbit() {
    this.setPreset('broadcast');
  }

  cyclePreset() {
    const presetKeys = ['broadcast', 'server', 'side', 'top'];
    const currIdx = presetKeys.indexOf(this.activePreset);
    const nextIdx = (currIdx + 1) % presetKeys.length;
    this.setPreset(presetKeys[nextIdx]);
  }

  updatePresetButtonsUI(activeName) {
    const btns = [
      { id: 'cam-preset-broadcast', name: 'broadcast' },
      { id: 'cam-preset-server', name: 'server' },
      { id: 'cam-preset-side', name: 'side' },
      { id: 'cam-preset-top', name: 'top' }
    ];

    btns.forEach(b => {
      const el = document.getElementById(b.id);
      if (el) {
        if (b.name === activeName) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || 720;
    const height = rect.height || 450;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // Convert telemetry 2D/3D court coordinates (0..6.1m, 0..13.4m, z) to Three.js coordinates
  courtToWorld(cx, cy, cz = 0) {
    // cx: 0..6.1 -> X: +3.05 to -3.05 (Inverted so court-left cx=0 maps to screen-left from TV camera)
    // cy: 0..13.4 -> Z: -6.70 to +6.70 (0 is near baseline, 13.4 is far baseline)
    // cz: altitude -> Y: cz
    const wx = -(cx - 3.05);
    const wz = cy - 6.70;
    const wy = Math.max(0, cz);
    return new THREE.Vector3(wx, wy, wz);
  }

  /**
   * Updates state on each playback frame from telemetry engine
   */
  updateTelemetryState(data, instant = false) {
    if (!data) return;

    const { rally, shot, shotIndex, time, elapsed } = data;
    this.isSmashActive = shot && shot.speed_kmh >= 350;

    // 1. Calculate Ballistic Trajectory & Shuttle Position
    if (rally && rally.shots && rally.shots.length > 0) {
      const currentShot = rally.shots[shotIndex] || rally.shots[0];
      const nextShot = rally.shots[shotIndex + 1] || null;

      const hitW = this.courtToWorld(
        currentShot.hit_coord[0],
        currentShot.hit_coord[1],
        currentShot.hit_coord[2] || 1.8
      );
      const landW = this.courtToWorld(
        currentShot.land_coord[0],
        currentShot.land_coord[1],
        0.02
      );

      // Trajectory cycle based on time progression within current shot
      const shotStartTime = currentShot.time;
      const shotEndTime = nextShot ? nextShot.time : shotStartTime + (currentShot.shuttle_transit_time_sec || 0.65);
      const shotDuration = Math.max(0.15, shotEndTime - shotStartTime);
      const progress = Math.min(1.0, Math.max(0.0, (time - shotStartTime) / shotDuration));

      // Parabolic ballistic arc: X/Z linear lerp, Y quadratic arch
      const currPos = new THREE.Vector3().lerpVectors(hitW, landW, progress);
      const peakZ = currentShot.trajectory_peak_z || 2.4;
      const arcHeight = Math.sin(progress * Math.PI) * peakZ;
      currPos.y = (1 - progress) * hitW.y + progress * landW.y + arcHeight;

      // Update shuttlecock position & orientation
      const prevPos = this.shuttleGroup.position.clone();
      this.shuttleGroup.position.copy(currPos);

      const vel = new THREE.Vector3().subVectors(currPos, prevPos);
      if (vel.lengthSq() > 0.0001) {
        this.shuttleVel.copy(vel.normalize());
        // Orient shuttlecock cork-first
        const targetLook = currPos.clone().add(this.shuttleVel);
        this.shuttleGroup.lookAt(targetLook);
      }

      // Dynamic ground shadow
      this.shuttleShadow.position.x = currPos.x;
      this.shuttleShadow.position.z = currPos.z;
      const shadowScale = Math.max(0.4, 1.0 - currPos.y * 0.12);
      this.shuttleShadow.scale.set(shadowScale, shadowScale, shadowScale);
      this.shadowMat.opacity = Math.max(0.12, 0.45 - currPos.y * 0.05);

      // Trail update
      this.addTrailPoint(currPos.clone());

      // Update shuttle glow color (blazing red on smashes >380km/h)
      if (currentShot.speed_kmh >= 380) {
        this.shuttleGlowMat.color.setHex(0xff2a55);
        this.trailMat.color.setHex(0xff2a55);
      } else {
        this.shuttleGlowMat.color.setHex(0x00f0ff);
        this.trailMat.color.setHex(0x00f0ff);
      }

      // 2. Animate Player Positions & Smash Mechanics
      this.updatePlayerPositions(currentShot, progress, instant);
    }
  }

  updatePlayerPositions(currentShot, progress, instant = false) {
    if (!currentShot) return;

    const isLZJ = currentShot.hitter === 'LZJ';
    const isSmash = currentShot.stroke && currentShot.stroke.includes('Smash');

    // Player 1 (Lee Zii Jia - Near side)
    let p1Target = new THREE.Vector3(0, 0, -4.6);
    if (isLZJ) {
      p1Target = this.courtToWorld(currentShot.hit_coord[0], currentShot.hit_coord[1], 0);
    } else {
      // Counter positioning
      p1Target = this.courtToWorld(currentShot.land_coord[0], currentShot.land_coord[1], 0);
      p1Target.z = Math.min(-1.5, p1Target.z); // Stay on near court
    }

    // Player 2 (Su Li Yang - Far side)
    let p2Target = new THREE.Vector3(0, 0, 4.6);
    if (!isLZJ) {
      p2Target = this.courtToWorld(currentShot.hit_coord[0], currentShot.hit_coord[1], 0);
    } else {
      p2Target = this.courtToWorld(currentShot.land_coord[0], currentShot.land_coord[1], 0);
      p2Target.z = Math.max(1.5, p2Target.z); // Stay on far court
    }

    if (instant) {
      this.player1.group.position.copy(p1Target);
      this.player2.group.position.copy(p2Target);
    } else {
      this.player1.group.position.lerp(p1Target, 0.18);
      this.player2.group.position.lerp(p2Target, 0.18);
    }

    // Jump smash animation for LZJ
    if (isLZJ && isSmash && progress < 0.6) {
      const jumpProgress = Math.sin((progress / 0.6) * Math.PI);
      this.player1.torso.position.y = 1.25 + jumpProgress * 0.85; // Elevate 0.85m in air
      this.player1.armGroup.rotation.x = -jumpProgress * 0.6; // Cock racket overhead
      this.player1.shadow.scale.set(1 - jumpProgress * 0.4, 1 - jumpProgress * 0.4, 1);
    } else {
      this.player1.torso.position.y = 1.25;
      this.player1.armGroup.rotation.x = 0;
      this.player1.shadow.scale.set(1, 1, 1);
    }
  }

  addTrailPoint(pt) {
    this.trailPoints.push(pt);
    if (this.trailPoints.length > this.trailMax) {
      this.trailPoints.shift();
    }

    const posAttr = this.trailLine.geometry.attributes.position;
    for (let i = 0; i < this.trailMax; i++) {
      const p = this.trailPoints[i] || (this.trailPoints.length > 0 ? this.trailPoints[0] : new THREE.Vector3());
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;
  }

  clearTrail() {
    this.trailPoints = [];
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Camera preset transition interpolation
    if (this.animatingCamera) {
      const now = performance.now();
      const t = Math.min(1.0, (now - this.camAnimStartTime) / this.camAnimDuration);
      // Smooth cubic ease out
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

    this.renderer.render(this.scene, this.camera);
  }
}

window.ThreeCourtViewer = ThreeCourtViewer;
