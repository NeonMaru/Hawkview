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
    this.dirPillEl = document.getElementById('court-shot-direction-pill');
    this.dirTextEl = document.getElementById('court-shot-dir-text');
    this.modePlaybackBtn = document.getElementById('mode-btn-playback');
    this.modeExplorerBtn = document.getElementById('mode-btn-explorer');

    this.lastPlaybackState = null;
    this.activeAnimRec = null;

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

    // 1. Bright glowing shuttlecock head (cork + skirt cone)
    this.shuttleMarker = new THREE.Group();

    const corkGeo = new THREE.SphereGeometry(0.11, 16, 16);
    this.shuttleCorkMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const corkMesh = new THREE.Mesh(corkGeo, this.shuttleCorkMat);
    this.shuttleMarker.add(corkMesh);

    // Outer halo ring so human eye tracks the moving shuttle effortlessly
    const haloGeo = new THREE.RingGeometry(0.14, 0.21, 20);
    this.shuttleHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    this.shuttleHaloMesh = new THREE.Mesh(haloGeo, this.shuttleHaloMat);
    this.shuttleMarker.add(this.shuttleHaloMesh);

    // Forward directional cone pointing in flight direction
    const noseConeGeo = new THREE.ConeGeometry(0.12, 0.34, 12);
    noseConeGeo.rotateX(Math.PI / 2); // align cone tip with +Z for lookAt()
    this.shuttleConeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.shuttleNoseCone = new THREE.Mesh(noseConeGeo, this.shuttleConeMat);
    this.shuttleNoseCone.position.set(0, 0, 0.14);
    this.shuttleMarker.add(this.shuttleNoseCone);

    this.shuttleAnimGroup.add(this.shuttleMarker);

    // 2. Trailing comet tail (16 points along the recent segment of the arc)
    this.cometTailCount = 16;
    const tailPositions = new Float32Array(this.cometTailCount * 3);
    this.cometTailGeo = new THREE.BufferGeometry();
    this.cometTailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
    this.cometTailMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95
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

  buildSceneShots() {
    this.clearSceneShots();

    const telemetry = window.HAWKVIEW_TELEMETRY;
    if (!telemetry || !Array.isArray(telemetry.rallies)) return;

    const webglReady = Boolean(this.viewer && !this.viewer.webglFailed);
    const colors = this.getThemeColors();

    // Shared small geometries for contact rings, directional arrow cones, and landing discs
    const contactRingGeo = new THREE.RingGeometry(0.055, 0.095, 20);
    contactRingGeo.rotateX(-Math.PI / 2);

    const destTargetRingGeo = new THREE.RingGeometry(0.09, 0.145, 24);
    destTargetRingGeo.rotateX(-Math.PI / 2);

    const arrowConeGeo = new THREE.ConeGeometry(0.095, 0.28, 10);
    arrowConeGeo.rotateX(Math.PI / 2); // tip points along +Z when lookAt() is used

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

        // 1b. 3D Directional Arrow Cone at ~65% along the trajectory pointing toward destination
        const arrowIdx = Math.min(worldPts.length - 2, Math.max(0, Math.floor(worldPts.length * 0.65)));
        const pFrom = worldPts[arrowIdx];
        const pTo = worldPts[Math.min(worldPts.length - 1, arrowIdx + 1)];
        const arrowMat = new THREE.MeshBasicMaterial({
          color: baseColor.clone(),
          transparent: true,
          opacity: lowConf ? 0.40 : 0.95
        });
        const arrowCone = new THREE.Mesh(arrowConeGeo, arrowMat);
        arrowCone.position.copy(pFrom).lerp(pTo, 0.5);
        arrowCone.lookAt(pTo);
        arrowCone.userData = { shotId: shot.shot_id };
        group.add(arrowCone);
        hitables.push(arrowCone);

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
          group,
          arcLine,
          arrowCone,
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

    if (rec.arrowCone) {
      rec.arrowCone.material.color.copy(targetColor);
      rec.arrowCone.material.opacity = isHighlighted ? 1.0 : effOpacity;
      const scale = (isHighlighted || isPrimaryActive) ? 1.35 : 0.95;
      rec.arrowCone.scale.set(scale, scale, scale);
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
        destTargetRing.visible = showDest || (this.getEffectiveMode() === 'playback');
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

      const effectiveShotIdx = (isDowntime || shotIndex < 0)
        ? (rec.rally.shots ? rec.rally.shots.length - 1 : 0)
        : shotIndex;

      if (rec.shotIndexInRally < effectiveShotIdx) {
        visibleCount++;
        this.applyRecStyle(rec, true, 0.30, isHighlighted, false);
      } else if (rec.shotIndexInRally === effectiveShotIdx) {
        visibleCount++;
        primaryRec = rec;
        this.applyRecStyle(rec, true, 1.0, isHighlighted, true);
      } else {
        this.applyRecStyle(rec, false, 0, false, false);
      }
    }

    this.activeAnimRec = hoveredOrSelectedRec || primaryRec;
    this.updateDirectionPill(this.activeAnimRec);

    const totalInRally = activeRally && activeRally.shots ? activeRally.shots.length : 0;
    this.updateCountBadge(visibleCount, totalInRally, `R${activeRallyId}`);
  }

  updateDirectionPill(rec) {
    if (!this.dirPillEl || !this.dirTextEl) return;
    if (!rec) {
      this.dirTextEl.textContent = 'Hover or click any 3D shot arc (or switch to Playback) to watch shuttle flight direction';
      return;
    }
    const { shot, rally, shotIndexInRally } = rec;
    const totalShots = (rally.shots && rally.shots.length) || 1;
    const fromSide = (shot.side || 'near').toUpperCase();
    const toSide = fromSide === 'NEAR' ? 'FAR' : 'NEAR';
    const receiver = shot.hitter === 'LZJ' ? 'POPOV' : 'LZJ';
    const flagFrom = shot.hitter === 'LZJ' ? '🇲🇾 LZJ' : '🇫🇷 POPOV';
    const flagTo = receiver === 'LZJ' ? '🇲🇾 LZJ' : '🇫🇷 POPOV';
    const typeStr = ShotExplorer.formatShotType(shot.type);
    const spdStr = typeof shot.speed_kmh === 'number' ? `${shot.speed_kmh.toFixed(0)} km/h est.` : '';

    this.dirTextEl.textContent =
      `▶ R${rally.rally_id} · Shot #${shotIndexInRally + 1}/${totalShots}: ${flagFrom} (${fromSide}) ──► ${flagTo} (${toSide}) · ${typeStr} ${spdStr}`;
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

    // Determine normalized flight progress u in [0, 1]
    let u = 0;
    const isPlayingVideo = Boolean(this.player && this.player.isPlaying && this.getEffectiveMode() === 'playback');
    const isHoverOrSelected = (rec.shotId === this.hoveredShotId) || (rec.shotId === this.selectedShotId);

    if (isPlayingVideo && !isHoverOrSelected) {
      const nowT = this.player.currentTime || 0;
      const tStart = rec.shot.time || 0;
      const dur = Math.max(0.25, rec.shot.duration_sec || 0.85);
      const rawU = (nowT - tStart) / dur;
      if (rawU >= 0 && rawU <= 1.05) {
        u = Math.min(1.0, Math.max(0.0, rawU));
      } else {
        // When between shots, loop gently so direction is always visible
        u = ((performance.now() * 0.00085) % 1.0);
      }
    } else {
      // Smooth repeating flight loop (0 -> 1 over ~1.18s) so human eye immediately sees travel direction
      u = ((performance.now() * 0.00085) % 1.0);
    }

    const exactIdx = u * (n - 1);
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(exactIdx)));
    const i1 = i0 + 1;
    const frac = exactIdx - i0;

    const pos = pts[i0].clone().lerp(pts[i1], frac);
    this.shuttleMarker.position.copy(pos);

    // Orient shuttle cone toward tangent direction and billboard halo toward camera
    this.shuttleMarker.lookAt(pts[i1]);
    if (this.viewer && this.viewer.camera && this.shuttleHaloMesh) {
      this.shuttleHaloMesh.lookAt(this.viewer.camera.position);
    }

    // Update trailing comet tail behind the flying shuttle
    if (this.cometTailLine && this.cometTailGeo) {
      const posAttr = this.cometTailGeo.attributes.position;
      const tailSpan = 0.28; // 28% of arc length behind shuttle head
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
      this.modePlaybackBtn.addEventListener('click', () => this.setMode('playback', true));
    }
    if (this.modeExplorerBtn) {
      this.modeExplorerBtn.addEventListener('click', () => this.setMode('explorer', true));
    }

    window.addEventListener('hawkview:themeChanged', () => {
      this.refreshVisibility();
    });

    window.addEventListener('hawkview:matchChanged', () => {
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
