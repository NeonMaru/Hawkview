/**
 * Hawkview 3D Badminton Shot Explorer (Spec Section 3.1)
 * Renders all 223 reconstructed 3D shots from Phase E/F telemetry:
 * - Mid-rally shots: 3D arc from contact to next_contact + contact ring + vertical height stem
 * - Rally-ending shots: 3D arc to floor landing + filled landing disc (blue winner / red error_out)
 *   + hollow outer ring when close_call === true, or net termination for error_net
 * - Low-confidence fits (low_confidence || fit_rmse_px > 8): dashed line at 40% opacity
 * - Playback mode (follows video: current 100%, earlier in rally 30%, later hidden)
 * - Explorer mode (filtered set at 100% + merged LineSegments per color for background performance)
 * - Raycast hover tooltip & click-to-seek (shot.time - 1.0 s) with --shot-selected highlight
 */

class ShotExplorer {
  constructor(threeViewer, broadcastPlayer) {
    this.viewer = threeViewer;
    this.player = broadcastPlayer;
    if (this.viewer) {
      this.viewer.shotExplorer = this;
    }

    this.mode = 'playback'; // 'playback' | 'explorer' — switches automatically on filter or via mode pill
    this.userForcedMode = null;

    this.filters = {
      game: 'all',
      rallyId: 'all',
      player: 'all',
      shotType: 'all',     // exact type or family ('clear', 'serve')
      outcome: 'all',
      contactZone: 'all',  // 'all' | 'front' | 'mid' | 'rear'
      lateralZone: 'all',  // 'all' | 'forehand' | 'centre' | 'backhand'
      minSpeed: 0,
      terminalOnly: false
    };

    this.selectedShotId = null;
    this.hoveredShotId = null;
    this.shotRecords = []; // Flat list of { shot, rally, group, arcLine, stemLine, contactRing, landDisc, closeRing, hitables }
    this.shotById = new Map();

    // Merged LineSegments per outcome category for Explorer performance
    this.mergedGroup = new THREE.Group();
    this.shotsRoot = new THREE.Group();
    this.shuttleAnimGroup = new THREE.Group();
    if (this.viewer && this.viewer.scene) {
      this.viewer.scene.add(this.mergedGroup);
      this.viewer.scene.add(this.shotsRoot);
      this.viewer.scene.add(this.shuttleAnimGroup);
    }

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.22;
    this.mouse = new THREE.Vector2();
    this.pointerDownPos = { x: 0, y: 0 };

    this.tooltipEl = document.getElementById('shot-hover-tooltip');
    this.dirTextEl = document.getElementById('court-shot-dir-text');
    this.modePlaybackBtn = document.getElementById('mode-btn-playback');
    this.modeExplorerBtn = document.getElementById('mode-btn-explorer');
    this.clearClutterBtn = document.getElementById('btn-clear-3d-clutter');

    // Bottom 3D Court Rally Scrubber & Full-Rally Hover/Toggle controls
    this.fullRallyBtn = document.getElementById('btn-show-full-rally');
    this.rallyLabelEl = document.getElementById('court-rally-label');
    this.rallySliderEl = document.getElementById('court-rally-slider');
    this.rallyTicksEl = document.getElementById('court-rally-shot-ticks');
    this.rallyTimeEl = document.getElementById('court-rally-time');
    this._renderedRallyTicksId = null;
    this.isScrubbingRallyBar = false;

    // Fading trail state: show last 3-4 shots by default; hover or toggle #btn-show-full-rally to reveal entire rally
    this.showFullRallyHover = false;
    this.showFullRallyPinned = false;

    this.lastPlaybackState = null;
    this.activeAnimRec = null;
    this._lastSingleFlightShotId = null;
    this._singleFlightStartMs = 0;

    this.buildAnimatedShuttle();
    this.buildSceneShots();
    this.bindEvents();
    this.refreshVisibility();

    if (this.viewer && Array.isArray(this.viewer.onBeforeRenderCallbacks)) {
      this.viewer.onBeforeRenderCallbacks.push(() => this.updateAnimatedShuttle());
    }
  }

  buildAnimatedShuttle() {
    if (!this.viewer || this.viewer.webglFailed) return;

    // Authentic 3D Badminton Shuttlecock (cork nose at +Z, 16-feather skirt flaring backward toward -Z)
    this.shuttleMarker = new THREE.Group();
    this.shuttleMarker.scale.set(0.82, 0.82, 0.82); // 18% smaller per user feedback

    // 1. Rounded white polyurethane/leather cork tip pointing in flight direction (+Z)
    const corkTipGeo = new THREE.SphereGeometry(0.082, 18, 18);
    this.shuttleCorkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const corkTipMesh = new THREE.Mesh(corkTipGeo, this.shuttleCorkMat);
    corkTipMesh.position.set(0, 0, 0.085);
    this.shuttleMarker.add(corkTipMesh);

    const corkBaseGeo = new THREE.CylinderGeometry(0.082, 0.072, 0.075, 18);
    corkBaseGeo.rotateX(Math.PI / 2);
    const corkBaseMesh = new THREE.Mesh(corkBaseGeo, this.shuttleCorkMat);
    corkBaseMesh.position.set(0, 0, 0.045);
    this.shuttleMarker.add(corkBaseMesh);

    // 2. Classic BWF royal-blue/gold collar ribbon at cork-to-skirt junction
    const collarGeo = new THREE.CylinderGeometry(0.077, 0.079, 0.032, 18);
    collarGeo.rotateX(Math.PI / 2);
    const collarMat = new THREE.MeshBasicMaterial({ color: 0x2563eb });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.position.set(0, 0, 0.004);
    this.shuttleMarker.add(collarMesh);

    // 3. Flared white feathered skirt frustum flaring backward (-Z) behind the cork
    const rNeck = 0.072;
    const rCrown = 0.205;
    const skirtLen = 0.34;
    // CylinderGeometry(radiusTop at +Y, radiusBottom at -Y). After rotateX(PI/2), +Y becomes +Z (neck) and -Y becomes -Z (crown)
    const skirtGeo = new THREE.CylinderGeometry(rNeck, rCrown, skirtLen, 16, 2, true);
    skirtGeo.rotateX(Math.PI / 2);
    this.shuttleSkirtMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, this.shuttleSkirtMat);
    skirtMesh.position.set(0, 0, -skirtLen * 0.5);
    this.shuttleMarker.add(skirtMesh);

    // 4. 16 individual feather quills + 2 horizontal thread binding rings (crisp wireframe detail)
    const quillCoords = [];
    const numFeathers = 16;
    for (let i = 0; i < numFeathers; i++) {
      const a0 = (i / numFeathers) * Math.PI * 2;
      const a1 = ((i + 1) / numFeathers) * Math.PI * 2;
      // Quill shaft from collar (z = 0) to feather tip crown (z = -skirtLen)
      quillCoords.push(
        Math.cos(a0) * rNeck, Math.sin(a0) * rNeck, 0,
        Math.cos(a0) * rCrown, Math.sin(a0) * rCrown, -skirtLen
      );
      // Crown tip zig-zag rim
      quillCoords.push(
        Math.cos(a0) * rCrown, Math.sin(a0) * rCrown, -skirtLen,
        Math.cos(a1) * rCrown, Math.sin(a1) * rCrown, -skirtLen
      );
      // Mid-skirt thread binding ring at z = -0.14
      const rMid = rNeck + (rCrown - rNeck) * (0.14 / skirtLen);
      quillCoords.push(
        Math.cos(a0) * rMid, Math.sin(a0) * rMid, -0.14,
        Math.cos(a1) * rMid, Math.sin(a1) * rMid, -0.14
      );
    }
    const quillGeo = new THREE.BufferGeometry();
    quillGeo.setAttribute('position', new THREE.Float32BufferAttribute(quillCoords, 3));
    const quillMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.85
    });
    const quillLines = new THREE.LineSegments(quillGeo, quillMat);
    this.shuttleMarker.add(quillLines);

    this.shuttleAnimGroup.add(this.shuttleMarker);

    // 6. Trailing comet tail (16 points along the recent segment of the arc)
    this.cometTailCount = 16;
    const tailPositions = new Float32Array(this.cometTailCount * 3);
    this.cometTailGeo = new THREE.BufferGeometry();
    this.cometTailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
    this.cometTailMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.90
    });
    this.cometTailLine = new THREE.Line(this.cometTailGeo, this.cometTailMat);
    this.shuttleAnimGroup.add(this.cometTailLine);

    this.shuttleAnimGroup.visible = false;
  }

  /**
   * Computes lateral contact zone ('forehand' | 'centre' | 'backhand')
   * accounting for court side ('near' vs 'far') and player handedness ('Right' vs 'Left').
   */
  static getLateralZone(shot, telemetry) {
    const contact = shot.contact || shot.start_3d || [3.05, 6.70, 1.0];
    const x = contact[0];
    const side = shot.side || (contact[1] < 6.70 ? 'near' : 'far');
    const players = (telemetry && telemetry.players) || {};
    const pMeta = (players[shot.hitter] && players[shot.hitter].metadata) || {};
    const handedness = (pMeta.handedness || pMeta.dominant_hand || 'Right').toLowerCase();
    const isLeftHanded = handedness.startsWith('l');

    // Singles court width 0.46..5.64 split into 3 bands at 2.19m and 3.91m
    if (x >= 2.19 && x <= 3.91) {
      return 'centre';
    }
    // From hitter's perspective facing the net:
    // Near player faces +Y: right side of body is x > 3.91, left side is x < 2.19
    // Far player faces -Y: right side of body is x < 2.19, left side is x > 3.91
    const isPlayerRightSide = (side === 'near') ? (x > 3.91) : (x < 2.19);
    if (!isLeftHanded) {
      return isPlayerRightSide ? 'forehand' : 'backhand';
    } else {
      return isPlayerRightSide ? 'backhand' : 'forehand';
    }
  }

  static matchesShotTypeFilter(shotType, filterValue) {
    if (!filterValue || filterValue === 'all') return true;
    if (filterValue === 'clear') {
      return shotType === 'clear' || shotType === 'attacking_clear' || shotType === 'defensive_clear';
    }
    if (filterValue === 'serve') {
      return shotType && shotType.startsWith('serve');
    }
    return shotType === filterValue;
  }

  static formatShotType(type) {
    if (!type) return '—';
    return type.replace(/_/g, ' ');
  }

  getThemeColors() {
    const tokens = this.viewer ? this.viewer.getThemeTokens() : {
      shotContinue: '#5fae3a',
      shotWinner: '#2563eb',
      shotError: '#d93025',
      shotSelected: '#f59e0b',
      muted: '#6b7280'
    };
    return {
      continue: new THREE.Color(tokens.shotContinue),
      winner: new THREE.Color(tokens.shotWinner),
      error: new THREE.Color(tokens.shotError),
      selected: new THREE.Color(tokens.shotSelected),
      muted: new THREE.Color(tokens.muted)
    };
  }

  getShotBaseColorKey(shot) {
    if (shot.outcome === 'winner') return 'winner';
    if (shot.outcome === 'error_out' || shot.outcome === 'error_net') return 'error';
    return 'continue';
  }

  isLowConfidence(shot) {
    return Boolean(shot.low_confidence) || (typeof shot.fit_rmse_px === 'number' && shot.fit_rmse_px > 8.0);
  }

  clearSceneShots() {
    while (this.shotsRoot.children.length > 0) {
      this.shotsRoot.remove(this.shotsRoot.children[0]);
    }
    while (this.mergedGroup.children.length > 0) {
      this.mergedGroup.remove(this.mergedGroup.children[0]);
    }
    this.shotRecords = [];
    this.shotById.clear();
  }

  /**
   * Builds Blender 3D NURBS-style skinny hairline chevron arrows (`THREE.LineSegments`)
   * directly on the trajectory curve.
   * Faster shots (e.g. 330+ km/h smash) incur fewer, widely-spaced hairline arrows (2-3),
   * while slower shots (e.g. 70-130 km/h drop/lift/clear) incur more, closely-spaced arrows (7-13).
   */
  buildNurbsArrowCoords(worldPts, speedKmh) {
    const coords = [];
    if (!worldPts || worldPts.length < 2) return coords;

    const spd = Math.max(55, Number(speedKmh) || 140);
    // Fast smash (350 km/h) -> 3 arrows; Drive (220 km/h) -> 4 arrows; Clear (135 km/h) -> 7 arrows; Net/Drop (75 km/h) -> 12 arrows
    const numArrows = Math.max(2, Math.min(13, Math.round(920 / spd)));
    const barbLen = 0.21;
    const barbSpread = 0.064; // Sleek ~17° Blender NURBS normal chevron angle
    const worldUp = new THREE.Vector3(0, 1, 0);
    const fallbackAxis = new THREE.Vector3(1, 0, 0);

    const n = worldPts.length;
    for (let m = 0; m < numArrows; m++) {
      // Distribute arrows cleanly along [0.14 .. 0.88] of the curve
      const u = 0.14 + ((m + 0.5) / numArrows) * 0.74;
      const exactIdx = u * (n - 1);
      const i0 = Math.min(n - 2, Math.max(0, Math.floor(exactIdx)));
      const i1 = i0 + 1;
      const frac = exactIdx - i0;

      const tip = worldPts[i0].clone().lerp(worldPts[i1], frac);
      const tangent = worldPts[i1].clone().sub(worldPts[i0]);
      if (tangent.lengthSq() < 1e-7) continue;
      tangent.normalize();

      // Orthogonal wing axes B1 (horizontal court plane) and B2 (vertical elevation plane)
      let b1 = new THREE.Vector3().crossVectors(tangent, worldUp);
      if (b1.lengthSq() < 1e-5) {
        b1 = new THREE.Vector3().crossVectors(tangent, fallbackAxis);
      }
      b1.normalize();
      const b2 = new THREE.Vector3().crossVectors(tangent, b1).normalize();

      const baseCenter = tip.clone().addScaledVector(tangent, -barbLen);

      // 4 skinny hairline chevron barbs (2 horizontal + 2 vertical so the '>' chevron reads from every 3D/Top/Side camera angle)
      const wLeft = baseCenter.clone().addScaledVector(b1, barbSpread);
      const wRight = baseCenter.clone().addScaledVector(b1, -barbSpread);
      const wUp = baseCenter.clone().addScaledVector(b2, barbSpread * 0.85);
      const wDown = baseCenter.clone().addScaledVector(b2, -barbSpread * 0.85);

      coords.push(
        tip.x, tip.y, tip.z, wLeft.x, wLeft.y, wLeft.z,
        tip.x, tip.y, tip.z, wRight.x, wRight.y, wRight.z,
        tip.x, tip.y, tip.z, wUp.x, wUp.y, wUp.z,
        tip.x, tip.y, tip.z, wDown.x, wDown.y, wDown.z
      );
    }
    return coords;
  }

  buildSceneShots() {
    this.clearSceneShots();

    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;

    const colors = this.getThemeColors();

    // Shared small geometries for contact rings and landing discs
    const contactRingGeo = new THREE.RingGeometry(0.055, 0.095, 20);
    contactRingGeo.rotateX(-Math.PI / 2);

    const destTargetRingGeo = new THREE.RingGeometry(0.09, 0.145, 24);
    destTargetRingGeo.rotateX(-Math.PI / 2);

    const landDiscGeo = new THREE.CircleGeometry(0.11, 24);
    landDiscGeo.rotateX(-Math.PI / 2);

    const closeCallRingGeo = new THREE.RingGeometry(0.145, 0.185, 24);
    closeCallRingGeo.rotateX(-Math.PI / 2);

    const netImpactGeo = new THREE.RingGeometry(0.06, 0.11, 20);

    telemetry.rallies.forEach((rally) => {
      const shots = rally.shots || [];
      shots.forEach((shot, idx) => {
        const path = shot.path || [];
        if (path.length < 2) return;

        shot._lateralZone = ShotExplorer.getLateralZone(shot, telemetry);
        shot._rallyId = rally.rally_id;
        shot._game = rally.game;

        const colorKey = this.getShotBaseColorKey(shot);
        const baseColor = colors[colorKey];
        const lowConf = this.isLowConfidence(shot);

        const group = new THREE.Group();
        const hitables = [];

        // 1. 3D Arc sampled directly from shot.path (Phase E fit, never synthesized)
        const worldPts = path.map((pt) => this.viewer.courtToWorld(pt[0], pt[1], pt[2]));
        const arcGeo = new THREE.BufferGeometry().setFromPoints(worldPts);

        let arcMat;
        if (lowConf) {
          arcMat = new THREE.LineDashedMaterial({
            color: baseColor.clone(),
            dashSize: 0.22,
            gapSize: 0.14,
            transparent: true,
            opacity: 0.40
          });
        } else {
          arcMat = new THREE.LineBasicMaterial({
            color: baseColor.clone(),
            transparent: true,
            opacity: 1.0
          });
        }

        const arcLine = new THREE.Line(arcGeo, arcMat);
        if (lowConf) {
          arcLine.computeLineDistances();
        }
        arcLine.userData = { shotId: shot.shot_id };
        group.add(arcLine);
        hitables.push(arcLine);

        // 1b. Blender 3D NURBS-style skinny hairline chevron arrows along the curve (speed-dependent count)
        const nurbsCoords = this.buildNurbsArrowCoords(worldPts, shot.speed_kmh);
        const nurbsGeo = new THREE.BufferGeometry();
        nurbsGeo.setAttribute('position', new THREE.Float32BufferAttribute(nurbsCoords, 3));
        const nurbsMat = new THREE.LineBasicMaterial({
          color: baseColor.clone(),
          transparent: true,
          opacity: lowConf ? 0.40 : 0.95
        });
        const nurbsArrows = new THREE.LineSegments(nurbsGeo, nurbsMat);
        nurbsArrows.userData = { shotId: shot.shot_id };
        group.add(nurbsArrows);

        // 2. Contact Ring + Thin Vertical Stem to Floor (z = 0)
        const contactPt = shot.contact || shot.start_3d || path[0];
        const cWorld = this.viewer.courtToWorld(contactPt[0], contactPt[1], contactPt[2]);
        const cFloor = this.viewer.courtToWorld(contactPt[0], contactPt[1], 0.005);

        const stemGeo = new THREE.BufferGeometry().setFromPoints([cFloor, cWorld]);
        const stemMat = new THREE.LineBasicMaterial({
          color: baseColor.clone(),
          transparent: true,
          opacity: lowConf ? 0.28 : 0.45
        });
        const stemLine = new THREE.Line(stemGeo, stemMat);
        group.add(stemLine);

        const ringMat = new THREE.MeshBasicMaterial({
          color: baseColor.clone(),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: lowConf ? 0.40 : 0.90
        });
        const contactRing = new THREE.Mesh(contactRingGeo, ringMat);
        contactRing.position.copy(cWorld);
        contactRing.userData = { shotId: shot.shot_id };
        group.add(contactRing);
        hitables.push(contactRing);

        // 2b. Ground Direction Shadow Line (cFloor -> endFloor) + Destination Target Floor Ring
        const endPt = shot.end_3d || shot.next_contact || path[path.length - 1];
        const endWorld = worldPts[worldPts.length - 1];
        const endFloor = this.viewer.courtToWorld(endPt[0], endPt[1], 0.005);

        const floorDirGeo = new THREE.BufferGeometry().setFromPoints([cFloor, endFloor]);
        const floorDirMat = new THREE.LineDashedMaterial({
          color: baseColor.clone(),
          dashSize: 0.18,
          gapSize: 0.12,
          transparent: true,
          opacity: 0.35
        });
        const floorDirLine = new THREE.Line(floorDirGeo, floorDirMat);
        floorDirLine.computeLineDistances();
        group.add(floorDirLine);

        // Destination drop stem + target bullseye ring on floor so user always sees where the shot went
        const destStemLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([endFloor, endWorld]),
          stemMat.clone()
        );
        group.add(destStemLine);

        const destTargetRing = new THREE.Mesh(destTargetRingGeo, ringMat.clone());
        destTargetRing.position.set(endFloor.x, 0.006, endFloor.z);
        destTargetRing.userData = { shotId: shot.shot_id };
        group.add(destTargetRing);
        hitables.push(destTargetRing);

        let nextContactObjects = { floorDirLine, destStemLine, destTargetRing };

        // 3. Rally-ending shot floor landing disc (or net termination marker)
        let landDisc = null;
        let closeRing = null;

        if (shot.is_terminal) {
          if (shot.outcome === 'error_net') {
            // Arc ends at the net; place a small ring on the net plane
            const lastPt = worldPts[worldPts.length - 1];
            const netMat = new THREE.MeshBasicMaterial({
              color: colors.error.clone(),
              side: THREE.DoubleSide,
              transparent: true,
              opacity: lowConf ? 0.40 : 0.95
            });
            landDisc = new THREE.Mesh(netImpactGeo, netMat);
            landDisc.position.copy(lastPt);
            landDisc.userData = { shotId: shot.shot_id };
            group.add(landDisc);
            hitables.push(landDisc);
          } else if (shot.land && shot.land.length >= 2) {
            const landWorld = this.viewer.courtToWorld(shot.land[0], shot.land[1], 0.007);
            const discColor = (shot.outcome === 'winner') ? colors.winner : colors.error;
            const discMat = new THREE.MeshBasicMaterial({
              color: discColor.clone(),
              side: THREE.DoubleSide,
              transparent: true,
              opacity: lowConf ? 0.40 : 0.95
            });
            landDisc = new THREE.Mesh(landDiscGeo, discMat);
            landDisc.position.copy(landWorld);
            landDisc.userData = { shotId: shot.shot_id };
            group.add(landDisc);
            hitables.push(landDisc);

            // Hollow outer ring if close_call === true (within 0.15m of boundary line)
            if (shot.close_call) {
              const closeMat = new THREE.MeshBasicMaterial({
                color: discColor.clone(),
                side: THREE.DoubleSide,
                transparent: true,
                opacity: lowConf ? 0.40 : 0.95
              });
              closeRing = new THREE.Mesh(closeCallRingGeo, closeMat);
              closeRing.position.set(landWorld.x, 0.008, landWorld.z);
              closeRing.userData = { shotId: shot.shot_id };
              group.add(closeRing);
              hitables.push(closeRing);
            }
          }
        }

        this.shotsRoot.add(group);

        const rec = {
          shotId: shot.shot_id,
          shot,
          rally,
          shotIndexInRally: idx,
          colorKey,
          lowConf,
          worldPts,
          nurbsCoords,
          group,
          arcLine,
          nurbsArrows,
          stemLine,
          contactRing,
          nextContactObjects,
          landDisc,
          closeRing,
          hitables
        };
        this.shotRecords.push(rec);
        this.shotById.set(shot.shot_id, rec);
      });
    });

    this.rebuildMergedLineSegments();
  }

  /**
   * Builds merged THREE.LineSegments per outcome color for unselected high-confidence
   * arcs in Explorer mode (Spec Section 3.1 performance requirement).
   */
  rebuildMergedLineSegments() {
    while (this.mergedGroup.children.length > 0) {
      const child = this.mergedGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.mergedGroup.remove(child);
    }

    if (this.getEffectiveMode() !== 'explorer') {
      this.mergedGroup.visible = false;
      return;
    }

    const colors = this.getThemeColors();
    const buckets = {
      continue: [],
      winner: [],
      error: []
    };

    for (let i = 0; i < this.shotRecords.length; i++) {
      const rec = this.shotRecords[i];
      if (!rec.visibleInExplorer) continue;
      if (rec.lowConf) continue;
      if (rec.shotId === this.selectedShotId || rec.shotId === this.hoveredShotId) continue;

      const pts = rec.worldPts;
      const arr = buckets[rec.colorKey];
      for (let k = 0; k < pts.length - 1; k++) {
        arr.push(pts[k].x, pts[k].y, pts[k].z);
        arr.push(pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
      }
      if (rec.nurbsCoords && rec.nurbsCoords.length > 0) {
        for (let c = 0; c < rec.nurbsCoords.length; c++) {
          arr.push(rec.nurbsCoords[c]);
        }
      }
    }

    Object.entries(buckets).forEach(([key, flatCoords]) => {
      if (flatCoords.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(flatCoords, 3));
      const mat = new THREE.LineBasicMaterial({
        color: colors[key],
        transparent: true,
        opacity: 0.92
      });
      const segs = new THREE.LineSegments(geo, mat);
      this.mergedGroup.add(segs);
    });

    this.mergedGroup.visible = true;
  }

  hasActiveFilters() {
    const f = this.filters;
    return (
      f.game !== 'all' ||
      f.rallyId !== 'all' ||
      f.player !== 'all' ||
      f.shotType !== 'all' ||
      f.outcome !== 'all' ||
      f.contactZone !== 'all' ||
      f.lateralZone !== 'all' ||
      Number(f.minSpeed) > 0 ||
      Boolean(f.terminalOnly)
    );
  }

  getEffectiveMode() {
    if (this.hasActiveFilters()) return 'explorer';
    if (this.userForcedMode) return this.userForcedMode;
    return this.mode;
  }

  setMode(modeName, userInitiated = false) {
    this.mode = modeName;
    if (userInitiated) {
      this.userForcedMode = modeName;
    }
    this.updateModeButtonsUI();
    this.refreshVisibility();
  }

  updateModeButtonsUI() {
    const effective = this.getEffectiveMode();
    if (this.modePlaybackBtn) {
      this.modePlaybackBtn.classList.toggle('active', effective === 'playback');
    }
    if (this.modeExplorerBtn) {
      this.modeExplorerBtn.classList.toggle('active', effective === 'explorer');
    }
    if (this.clearClutterBtn) {
      const showClear = (effective === 'explorer') || this.hasActiveFilters() || this.showFullRallyPinned;
      this.clearClutterBtn.classList.toggle('hidden', !showClear);
    }
  }

  shotMatchesFilters(rec) {
    const { shot, rally } = rec;
    const f = this.filters;

    if (f.game !== 'all' && String(rally.game) !== String(f.game)) return false;
    if (f.rallyId !== 'all' && String(rally.rally_id) !== String(f.rallyId)) return false;
    if (f.player !== 'all' && shot.hitter !== f.player) return false;
    if (!ShotExplorer.matchesShotTypeFilter(shot.type, f.shotType)) return false;
    if (f.outcome !== 'all' && shot.outcome !== f.outcome) return false;
    if (f.contactZone !== 'all' && shot.contact_zone !== f.contactZone) return false;
    if (f.lateralZone !== 'all' && shot._lateralZone !== f.lateralZone) return false;
    if (Number(f.minSpeed) > 0 && (shot.speed_kmh || 0) < Number(f.minSpeed)) return false;
    if (f.terminalOnly && !shot.is_terminal) return false;

    return true;
  }

  setFilters(partialFilters) {
    Object.assign(this.filters, partialFilters);
    if (this.hasActiveFilters()) {
      this.userForcedMode = null;
    }
    this.updateModeButtonsUI();
    this.refreshVisibility();

    window.dispatchEvent(new CustomEvent('hawkview:filtersChanged', {
      detail: { filters: { ...this.filters }, matchingCount: this.getMatchingShotsCount() }
    }));
  }

  clearFilters() {
    this.filters = {
      game: 'all',
      rallyId: 'all',
      player: 'all',
      shotType: 'all',
      outcome: 'all',
      contactZone: 'all',
      lateralZone: 'all',
      minSpeed: 0,
      terminalOnly: false
    };
    this.selectedShotId = null;
    this.userForcedMode = 'playback';
    this.mode = 'playback';
    this.updateModeButtonsUI();
    this.refreshVisibility();

    window.dispatchEvent(new CustomEvent('hawkview:filtersChanged', {
      detail: { filters: { ...this.filters }, matchingCount: this.getMatchingShotsCount() }
    }));
  }

  getMatchingShotsCount() {
    let count = 0;
    for (let i = 0; i < this.shotRecords.length; i++) {
      if (this.shotMatchesFilters(this.shotRecords[i])) count++;
    }
    return count;
  }

  applyRecStyle(rec, visible, opacity, isHighlighted, isPrimaryActive = false) {
    rec.group.visible = visible;
    if (!visible) return;

    const colors = this.getThemeColors();
    const targetColor = isHighlighted ? colors.selected : colors[rec.colorKey];
    const effOpacity = rec.lowConf ? Math.min(0.40, opacity) : opacity;

    rec.arcLine.material.color.copy(targetColor);
    rec.arcLine.material.opacity = isHighlighted ? 1.0 : effOpacity;

    if (rec.nurbsArrows) {
      rec.nurbsArrows.material.color.copy(targetColor);
      rec.nurbsArrows.material.opacity = isHighlighted ? 1.0 : Math.min(1.0, effOpacity * 1.05);
    }

    rec.stemLine.material.color.copy(targetColor);
    rec.stemLine.material.opacity = isHighlighted ? 0.85 : Math.min(0.45, effOpacity * 0.6);

    rec.contactRing.material.color.copy(targetColor);
    rec.contactRing.material.opacity = isHighlighted ? 1.0 : effOpacity;

    if (rec.nextContactObjects) {
      const { floorDirLine, destStemLine, destTargetRing } = rec.nextContactObjects;
      const showDest = isHighlighted || isPrimaryActive;
      if (floorDirLine) {
        floorDirLine.visible = showDest;
        floorDirLine.material.color.copy(targetColor);
        floorDirLine.material.opacity = isHighlighted ? 0.75 : 0.50;
      }
      if (destStemLine) {
        destStemLine.visible = showDest;
        destStemLine.material.color.copy(targetColor);
        destStemLine.material.opacity = isHighlighted ? 0.75 : 0.45;
      }
      if (destTargetRing) {
        destTargetRing.visible = showDest || (this.getEffectiveMode() === 'playback' && effOpacity >= 0.30);
        destTargetRing.material.color.copy(targetColor);
        destTargetRing.material.opacity = isHighlighted ? 1.0 : effOpacity;
      }
    }

    if (rec.landDisc) {
      const discColor = isHighlighted
        ? colors.selected
        : (rec.shot.outcome === 'winner' ? colors.winner : colors.error);
      rec.landDisc.material.color.copy(discColor);
      rec.landDisc.material.opacity = isHighlighted ? 1.0 : effOpacity;
    }
    if (rec.closeRing) {
      const ringColor = isHighlighted
        ? colors.selected
        : (rec.shot.outcome === 'winner' ? colors.winner : colors.error);
      rec.closeRing.material.color.copy(ringColor);
      rec.closeRing.material.opacity = isHighlighted ? 1.0 : effOpacity;
    }
  }

  refreshVisibility() {
    const effectiveMode = this.getEffectiveMode();
    this.updateModeButtonsUI();

    if (effectiveMode === 'explorer') {
      let matchingCount = 0;
      let candidateAnim = null;
      let firstMatch = null;
      for (let i = 0; i < this.shotRecords.length; i++) {
        const rec = this.shotRecords[i];
        const matches = this.shotMatchesFilters(rec);
        rec.visibleInExplorer = matches;
        if (matches) {
          matchingCount++;
          if (!firstMatch) firstMatch = rec;
        }

        const isHighlighted = (rec.shotId === this.selectedShotId) || (rec.shotId === this.hoveredShotId);
        if (isHighlighted && matches) {
          candidateAnim = rec;
        }
        const baseOpacity = rec.lowConf ? 0.40 : 1.0;
        this.applyRecStyle(rec, matches, baseOpacity, isHighlighted, isHighlighted);
      }
      this.activeAnimRec = candidateAnim || firstMatch;
      this.updateDirectionPill(this.activeAnimRec);
      this.rebuildMergedLineSegments();
      this.updateCountBadge(matchingCount, this.shotRecords.length);
      if (this.activeAnimRec && this.activeAnimRec.rally) {
        this.syncRallyBarUI(this.activeAnimRec.rally, this.activeAnimRec.shotIndexInRally, null);
      }
    } else {
      this.mergedGroup.visible = false;
      this.applyPlaybackVisibility(this.lastPlaybackState);
    }
  }

  applyPlaybackVisibility(packet) {
    const activeRally = (packet && packet.rally) || (this.player && this.player.currentRally) || null;
    const activeRallyId = activeRally ? activeRally.rally_id : 1;
    const isDowntime = packet ? Boolean(packet.isDowntime) : false;
    const shotIndex = (packet && typeof packet.shotIndex === 'number') ? packet.shotIndex : -1;

    const totalInRally = activeRally && activeRally.shots ? activeRally.shots.length : 0;
    const effectiveShotIdx = (isDowntime || shotIndex < 0)
      ? Math.max(0, totalInRally - 1)
      : shotIndex;

    const showFullRally = Boolean(this.showFullRallyHover || this.showFullRallyPinned);
    // Progressive 4-shot fading trail: [current: 100%, -1: 62%, -2: 34%, -3: 16%], older shots hidden unless Full Rally is hovered/pinned
    const fadeWeights = [1.0, 0.62, 0.34, 0.16];

    let visibleCount = 0;
    let primaryRec = null;
    let hoveredOrSelectedRec = null;

    for (let i = 0; i < this.shotRecords.length; i++) {
      const rec = this.shotRecords[i];
      rec.visibleInExplorer = false;

      if (rec.rally.rally_id !== activeRallyId) {
        this.applyRecStyle(rec, false, 0, false, false);
        continue;
      }

      const isHighlighted = (rec.shotId === this.selectedShotId) || (rec.shotId === this.hoveredShotId);
      if (isHighlighted) hoveredOrSelectedRec = rec;

      const delta = effectiveShotIdx - rec.shotIndexInRally;
      if (rec.shotIndexInRally === effectiveShotIdx) {
        primaryRec = rec;
      }

      if (showFullRally) {
        // Show all shots in the active rally when Full Rally is hovered or toggled
        visibleCount++;
        const isCurrent = rec.shotIndexInRally === effectiveShotIdx;
        this.applyRecStyle(rec, true, isCurrent ? 1.0 : 0.48, isHighlighted, isCurrent);
      } else if (delta >= 0 && delta < fadeWeights.length) {
        // Show only the last 3-4 shots with smooth progressive opacity fade
        visibleCount++;
        const fadeOp = fadeWeights[delta];
        this.applyRecStyle(rec, true, fadeOp, isHighlighted, delta === 0);
      } else if (isHighlighted) {
        visibleCount++;
        this.applyRecStyle(rec, true, 1.0, true, true);
      } else {
        this.applyRecStyle(rec, false, 0, false, false);
      }
    }

    this.activeAnimRec = hoveredOrSelectedRec || primaryRec;
    this.updateDirectionPill(this.activeAnimRec);
    this.updateCountBadge(visibleCount, totalInRally, `R${activeRallyId}`);
    if (activeRally) {
      this.syncRallyBarUI(activeRally, effectiveShotIdx, packet ? packet.time : null);
    }
  }

  renderRallyBarTicks(rally) {
    if (!this.rallyTicksEl || !rally) return;
    if (this._renderedRallyTicksId === rally.rally_id) return;
    this._renderedRallyTicksId = rally.rally_id;

    this.rallyTicksEl.innerHTML = '';
    const shots = rally.shots || [];
    if (shots.length === 0) return;

    const rStart = typeof rally.start_sec === 'number' ? rally.start_sec : (shots[0].time || 0);
    const rEnd = typeof rally.end_sec === 'number'
      ? rally.end_sec
      : ((shots[shots.length - 1].time || rStart) + (shots[shots.length - 1].duration_sec || 0.8));
    const rDur = Math.max(0.5, rEnd - rStart);

    shots.forEach((shot, idx) => {
      const rel = Math.max(0, Math.min(1, ((shot.time || rStart) - rStart) / rDur));
      const tick = document.createElement('div');
      let cls = 'hv-crb-tick';
      if (shot.outcome === 'winner') cls += ' tick-winner';
      else if (shot.outcome === 'error_out' || shot.outcome === 'error_net') cls += ' tick-error';
      tick.className = cls;
      tick.style.left = `${(rel * 100).toFixed(1)}%`;
      tick.setAttribute('data-shot-idx', String(idx));
      this.rallyTicksEl.appendChild(tick);
    });
  }

  syncRallyBarUI(rally, activeShotIdx, currentTimeSec) {
    if (!rally) return;
    this.renderRallyBarTicks(rally);

    if (this.rallyLabelEl) {
      this.rallyLabelEl.textContent = `R${rally.rally_id}`;
    }

    const shots = rally.shots || [];
    const rStart = typeof rally.start_sec === 'number' ? rally.start_sec : (shots[0] ? shots[0].time : 0);
    const rEnd = typeof rally.end_sec === 'number'
      ? rally.end_sec
      : (shots.length > 0 ? (shots[shots.length - 1].time + (shots[shots.length - 1].duration_sec || 0.8)) : rStart + 4.0);
    const rDur = Math.max(0.5, rEnd - rStart);

    let elapsed = 0;
    if (typeof currentTimeSec === 'number' && currentTimeSec >= rStart && currentTimeSec <= rEnd + 0.25) {
      elapsed = Math.max(0, Math.min(rDur, currentTimeSec - rStart));
    } else if (shots[activeShotIdx]) {
      elapsed = Math.max(0, Math.min(rDur, (shots[activeShotIdx].time || rStart) - rStart));
    }

    if (this.rallySliderEl && !this.isScrubbingRallyBar) {
      this.rallySliderEl.value = String(Math.round((elapsed / rDur) * 1000));
    }

    if (this.rallyTimeEl) {
      const shotBadge = shots.length > 0 ? ` · #${Math.min(shots.length, Math.max(1, activeShotIdx + 1))}/${shots.length}` : '';
      this.rallyTimeEl.textContent = `${elapsed.toFixed(1)}s / ${rDur.toFixed(1)}s${shotBadge}`;
    }

    if (this.rallyTicksEl) {
      const ticks = this.rallyTicksEl.querySelectorAll('.hv-crb-tick');
      ticks.forEach((t) => {
        const idx = parseInt(t.getAttribute('data-shot-idx'), 10);
        t.classList.toggle('active-tick', idx === activeShotIdx);
      });
    }
  }

  updateDirectionPill(rec) {
    if (!this.dirTextEl) return;
    if (!rec) {
      this.dirTextEl.textContent = 'Hover or click any 3D shot arc (or scrub the rally bar) to watch shuttle flight';
      return;
    }
    const { shot, rally, shotIndexInRally } = rec;
    const totalShots = (rally.shots && rally.shots.length) || 1;
    const fromSide = (shot.side || 'near').toUpperCase();
    const toSide = fromSide === 'NEAR' ? 'FAR' : 'NEAR';
    const receiver = shot.hitter === rally.near_player
      ? (rally.far_player || 'P2')
      : (rally.near_player || (shot.hitter === 'LZJ' ? 'POPOV' : 'LZJ'));

    const formatTag = (pid) => {
      if (pid === 'LZJ') return '🇲🇾 LZJ';
      if (pid === 'POPOV') return '🇫🇷 POPOV';
      return `🏸 ${pid || 'Player'}`;
    };
    const flagFrom = formatTag(shot.hitter);
    const flagTo = formatTag(receiver);
    const typeStr = ShotExplorer.formatShotType(shot.type);
    const spdStr = typeof shot.speed_kmh === 'number' ? `${shot.speed_kmh.toFixed(0)} km/h est.` : '';

    this.dirTextEl.textContent =
      `🏸 R${rally.rally_id} · Shot #${shotIndexInRally + 1}/${totalShots}: ${flagFrom} (${fromSide}) ──► ${flagTo} (${toSide}) · ${typeStr} ${spdStr}`;
  }

  updateAnimatedShuttle() {
    if (!this.shuttleAnimGroup || !this.shuttleMarker) return;
    const rec = this.activeAnimRec;
    if (!rec || !rec.worldPts || rec.worldPts.length < 2) {
      this.shuttleAnimGroup.visible = false;
      return;
    }

    this.shuttleAnimGroup.visible = true;
    const pts = rec.worldPts;
    const n = pts.length;

    // Trigger a single one-shot flight whenever the active shot changes (NO looping!)
    if (rec.shotId !== this._lastSingleFlightShotId) {
      this._lastSingleFlightShotId = rec.shotId;
      this._singleFlightStartMs = performance.now();
    }

    let u = 1.0;
    const isPlayingOrScrubbing = Boolean(
      this.getEffectiveMode() === 'playback' &&
      this.player &&
      (this.player.isPlaying || this.isScrubbingRallyBar || this.player.isUserScrubbing)
    );
    const isHoverOrSelected = (rec.shotId === this.hoveredShotId) || (rec.shotId === this.selectedShotId);

    if (isPlayingOrScrubbing && !isHoverOrSelected) {
      const nowT = this.player.currentTime || 0;
      const tStart = rec.shot.time || 0;
      const dur = Math.max(0.25, rec.shot.duration_sec || 0.85);
      // Strictly clamped [0, 1] — once the shot finishes, the shuttlecock rests at u = 1.0 without looping
      u = Math.min(1.0, Math.max(0.0, (nowT - tStart) / dur));
    } else {
      // Single one-shot flight from 0 -> 1 over the shot's duration, then holds at 1.0 (no loop)
      const durMs = Math.max(400, Math.min(1150, (rec.shot.duration_sec || 0.75) * 1000));
      const elapsedMs = performance.now() - (this._singleFlightStartMs || 0);
      u = Math.min(1.0, Math.max(0.0, elapsedMs / durMs));
    }

    const exactIdx = u * (n - 1);
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(exactIdx)));
    const i1 = i0 + 1;
    const frac = exactIdx - i0;

    const pos = pts[i0].clone().lerp(pts[i1], frac);
    this.shuttleMarker.position.copy(pos);

    // Orient 3D shuttlecock cork nose (+Z) toward tangent direction and feather skirt (-Z) trailing behind
    const tangentTarget = pos.clone().add(pts[i1].clone().sub(pts[i0]));
    this.shuttleMarker.lookAt(tangentTarget);

    // Update trailing comet tail while in flight; hide comet tail once resting at destination (u >= 0.995)
    if (this.cometTailLine && this.cometTailGeo) {
      if (u >= 0.995) {
        this.cometTailLine.visible = false;
      } else {
        this.cometTailLine.visible = true;
        const posAttr = this.cometTailGeo.attributes.position;
        const tailSpan = 0.24;
        for (let k = 0; k < this.cometTailCount; k++) {
          const uk = Math.max(0, u - (k / (this.cometTailCount - 1)) * tailSpan);
          const fIdx = uk * (n - 1);
          const ti0 = Math.min(n - 2, Math.max(0, Math.floor(fIdx)));
          const ti1 = ti0 + 1;
          const tFrac = fIdx - ti0;
          const tp = pts[ti0].clone().lerp(pts[ti1], tFrac);
          posAttr.setXYZ(k, tp.x, tp.y, tp.z);
        }
        posAttr.needsUpdate = true;
      }
    }
  }

  updateCountBadge(shown, total, prefix = '') {
    const el = document.getElementById('explorer-shot-count-badge');
    if (!el) return;
    if (prefix) {
      el.textContent = `${prefix}: ${shown} / ${total} shots`;
    } else {
      el.textContent = `${shown} / ${total} shots`;
    }
  }

  onPlaybackUpdate(packet) {
    this.lastPlaybackState = packet;
    if (packet && packet.isPlaying && !this.hasActiveFilters() && this.userForcedMode !== 'explorer') {
      this.mode = 'playback';
      this.updateModeButtonsUI();
    }
    if (this.getEffectiveMode() === 'playback') {
      this.applyPlaybackVisibility(packet);
    }
  }

  selectShot(shotId, seekVideo = true) {
    this.selectedShotId = shotId;
    this._lastSingleFlightShotId = null; // trigger fresh single-shot flight
    const rec = this.shotById.get(shotId);
    this.refreshVisibility();

    if (rec && seekVideo && this.player) {
      const targetTime = Math.max(0, (rec.shot.time || 0) - 1.0);
      this.player.seekTo(targetTime, true);
      if (!this.player.isPlaying) {
        this.player.togglePlay();
      }
    }

    if (rec) {
      window.dispatchEvent(new CustomEvent('hawkview:shotSelected', {
        detail: { shot: rec.shot, rally: rec.rally }
      }));
    }
  }

  bindEvents() {
    if (this.modePlaybackBtn) {
      this.modePlaybackBtn.addEventListener('click', () => {
        if (this.hasActiveFilters()) {
          this.clearFilters();
        } else {
          this.setMode('playback', true);
        }
      });
    }
    if (this.modeExplorerBtn) {
      this.modeExplorerBtn.addEventListener('click', () => this.setMode('explorer', true));
    }
    if (this.clearClutterBtn) {
      this.clearClutterBtn.addEventListener('click', () => {
        this.showFullRallyPinned = false;
        this.showFullRallyHover = false;
        if (this.fullRallyBtn) this.fullRallyBtn.classList.remove('active');
        this.clearFilters();
      });
    }

    // Hover or click '👁 Full Rally' button to reveal all shots of the rally vs last 3-4 fading trail
    if (this.fullRallyBtn) {
      this.fullRallyBtn.addEventListener('mouseenter', () => {
        this.showFullRallyHover = true;
        this.refreshVisibility();
      });
      this.fullRallyBtn.addEventListener('mouseleave', () => {
        this.showFullRallyHover = false;
        this.refreshVisibility();
      });
      this.fullRallyBtn.addEventListener('click', () => {
        this.showFullRallyPinned = !this.showFullRallyPinned;
        this.fullRallyBtn.classList.toggle('active', this.showFullRallyPinned);
        this.refreshVisibility();
      });
    }

    // Dedicated 3D Court Rally Scrubber slider
    if (this.rallySliderEl) {
      const handleRallyScrub = (val) => {
        const rally = (this.lastPlaybackState && this.lastPlaybackState.rally) ||
          (this.player && this.player.currentRally) ||
          (this.activeAnimRec && this.activeAnimRec.rally);
        if (!rally || !this.player) return;

        const shots = rally.shots || [];
        const rStart = typeof rally.start_sec === 'number' ? rally.start_sec : (shots[0] ? shots[0].time : 0);
        const rEnd = typeof rally.end_sec === 'number'
          ? rally.end_sec
          : (shots.length > 0 ? (shots[shots.length - 1].time + (shots[shots.length - 1].duration_sec || 0.8)) : rStart + 4.0);
        const rDur = Math.max(0.5, rEnd - rStart);

        const frac = Math.max(0, Math.min(1, Number(val) / 1000));
        const targetSec = rStart + frac * rDur;

        // Ensure we are in Playback mode so the 4-shot fading rally scrubber updates live
        if (this.getEffectiveMode() !== 'playback') {
          this.userForcedMode = 'playback';
          this.mode = 'playback';
          this.updateModeButtonsUI();
        }
        this.player.seekTo(targetSec, true);
      };

      this.rallySliderEl.addEventListener('input', (e) => {
        this.isScrubbingRallyBar = true;
        handleRallyScrub(e.target.value);
      });
      this.rallySliderEl.addEventListener('change', (e) => {
        handleRallyScrub(e.target.value);
        setTimeout(() => {
          this.isScrubbingRallyBar = false;
        }, 80);
      });
    }

    window.addEventListener('hawkview:rallyChanged', (e) => {
      if (e.detail && e.detail.rally) {
        this.syncRallyBarUI(e.detail.rally, 0, e.detail.rally.start_sec);
      }
    });

    window.addEventListener('hawkview:themeChanged', () => {
      this.refreshVisibility();
    });

    window.addEventListener('hawkview:matchChanged', () => {
      this._renderedRallyTicksId = null;
      this.buildSceneShots();
      this.refreshVisibility();
    });

    window.addEventListener('hawkview:ralliesStreamUpdated', () => {
      this._renderedRallyTicksId = null;
      this.buildSceneShots();
      this.refreshVisibility();
    });

    if (!this.viewer || !this.viewer.renderer) return;
    const dom = this.viewer.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    dom.addEventListener('pointermove', (e) => {
      this.handlePointerMove(e);
    });

    dom.addEventListener('pointerleave', () => {
      if (this.hoveredShotId !== null) {
        this.hoveredShotId = null;
        this.refreshVisibility();
      }
      if (this.tooltipEl) {
        this.tooltipEl.classList.add('hidden');
      }
    });

    dom.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 5) return; // Ignore orbit drag
      this.handlePointerClick(e);
    });
  }

  pickShotAtEvent(e) {
    if (!this.viewer || !this.viewer.renderer || !this.viewer.camera) return null;
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.viewer.camera);

    const candidates = [];
    for (let i = 0; i < this.shotRecords.length; i++) {
      const rec = this.shotRecords[i];
      if (rec.group.visible) {
        for (let k = 0; k < rec.hitables.length; k++) {
          candidates.push(rec.hitables[k]);
        }
      }
    }

    if (candidates.length === 0) return null;
    const hits = this.raycaster.intersectObjects(candidates, false);
    if (hits.length === 0) return null;

    const hitObj = hits[0].object;
    const shotId = hitObj.userData && hitObj.userData.shotId;
    return shotId ? this.shotById.get(shotId) : null;
  }

  handlePointerMove(e) {
    const rec = this.pickShotAtEvent(e);
    const newHoverId = rec ? rec.shotId : null;

    if (newHoverId !== this.hoveredShotId) {
      this.hoveredShotId = newHoverId;
      this.refreshVisibility();
    }

    if (rec && this.tooltipEl) {
      this.viewer.renderer.domElement.style.cursor = 'pointer';
      this.renderTooltip(rec, e);
    } else {
      if (this.viewer && this.viewer.renderer) {
        this.viewer.renderer.domElement.style.cursor = 'grab';
      }
      if (this.tooltipEl) {
        this.tooltipEl.classList.add('hidden');
      }
    }
  }

  handlePointerClick(e) {
    const rec = this.pickShotAtEvent(e);
    if (rec) {
      this.selectShot(rec.shotId, true);
    }
  }

  renderTooltip(rec, e) {
    if (!this.tooltipEl || !this.viewer || !this.viewer.container) return;
    const { shot, rally } = rec;

    const speedStr = (typeof shot.speed_kmh === 'number')
      ? `${shot.speed_kmh.toFixed(1)} km/h est.`
      : '—';
    const contactZ = (shot.contact && typeof shot.contact[2] === 'number')
      ? `${shot.contact[2].toFixed(2)} m`
      : '—';
    const netClear = (typeof shot.net_clearance_m === 'number')
      ? `${shot.net_clearance_m >= 0 ? '+' : ''}${shot.net_clearance_m.toFixed(2)} m`
      : '—';
    const timeStr = (typeof shot.time === 'number')
      ? `${Math.floor(shot.time / 60).toString().padStart(2, '0')}:${(shot.time % 60).toFixed(1).padStart(4, '0')}`
      : '—';

    this.tooltipEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px; display:flex; justify-content:space-between; gap:8px;">
        <span style="text-transform:capitalize;">${ShotExplorer.formatShotType(shot.type)}</span>
        <span class="hv-badge">${shot.outcome}</span>
      </div>
      <div class="hv-tooltip-row">
        <span class="hv-tooltip-label">Hitter</span>
        <span class="hv-tooltip-val">${shot.hitter || '—'} (${shot.contact_zone || '—'})</span>
      </div>
      <div class="hv-tooltip-row">
        <span class="hv-tooltip-label">Speed</span>
        <span class="hv-tooltip-val">${speedStr}</span>
      </div>
      <div class="hv-tooltip-row">
        <span class="hv-tooltip-label">Contact height</span>
        <span class="hv-tooltip-val">${contactZ}</span>
      </div>
      <div class="hv-tooltip-row">
        <span class="hv-tooltip-label">Net clearance</span>
        <span class="hv-tooltip-val">${netClear}</span>
      </div>
      <div class="hv-tooltip-row">
        <span class="hv-tooltip-label">Time</span>
        <span class="hv-tooltip-val">${timeStr} (R${rally.rally_id} #${shot.shot_num})</span>
      </div>
      ${shot.close_call ? '<div style="margin-top:4px; font-size:10.5px; color:var(--shot-selected); font-weight:600;">Close call (≤ 0.15 m to line)</div>' : ''}
      ${this.isLowConfidence(shot) ? '<div style="margin-top:2px; font-size:10.5px; color:var(--muted);">Low-confidence fit (dashed)</div>' : ''}
    `;

    this.tooltipEl.classList.remove('hidden');

    const stageRect = this.viewer.container.getBoundingClientRect();
    let left = e.clientX - stageRect.left + 14;
    let top = e.clientY - stageRect.top + 14;
    if (left + 210 > stageRect.width) left = Math.max(8, left - 220);
    if (top + 165 > stageRect.height) top = Math.max(8, top - 170);

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }
}

window.ShotExplorer = ShotExplorer;
