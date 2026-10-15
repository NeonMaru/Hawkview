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

    this.mode = 'explorer'; // 'playback' | 'explorer' — switches automatically or via mode pill
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
    if (this.viewer && this.viewer.scene) {
      this.viewer.scene.add(this.mergedGroup);
      this.viewer.scene.add(this.shotsRoot);
    }

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.22;
    this.mouse = new THREE.Vector2();
    this.pointerDownPos = { x: 0, y: 0 };

    this.tooltipEl = document.getElementById('shot-hover-tooltip');
    this.modePlaybackBtn = document.getElementById('mode-btn-playback');
    this.modeExplorerBtn = document.getElementById('mode-btn-explorer');

    this.lastPlaybackState = null;

    this.buildSceneShots();
    this.bindEvents();
    this.refreshVisibility();
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

    // Shared small geometries for contact rings and landing discs
    const contactRingGeo = new THREE.RingGeometry(0.055, 0.095, 20);
    contactRingGeo.rotateX(-Math.PI / 2);

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

        // If mid-rally shot is the last non-terminal shot before a gap, or has next_contact,
        // the next shot's contact ring marks next_contact; if it's the final shot and mid-rally (partial),
        // also draw next_contact ring + stem.
        let nextContactObjects = null;
        if (!shot.is_terminal && idx === shots.length - 1 && shot.next_contact) {
          const nc = shot.next_contact;
          const ncWorld = this.viewer.courtToWorld(nc[0], nc[1], nc[2]);
          const ncFloor = this.viewer.courtToWorld(nc[0], nc[1], 0.005);
          const ncStem = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([ncFloor, ncWorld]),
            stemMat.clone()
          );
          const ncRing = new THREE.Mesh(contactRingGeo, ringMat.clone());
          ncRing.position.copy(ncWorld);
          group.add(ncStem);
          group.add(ncRing);
          nextContactObjects = { ncStem, ncRing };
        }

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

  applyRecStyle(rec, visible, opacity, isHighlighted) {
    rec.group.visible = visible;
    if (!visible) return;

    const colors = this.getThemeColors();
    const targetColor = isHighlighted ? colors.selected : colors[rec.colorKey];
    const effOpacity = rec.lowConf ? Math.min(0.40, opacity) : opacity;

    rec.arcLine.material.color.copy(targetColor);
    rec.arcLine.material.opacity = isHighlighted ? 1.0 : effOpacity;

    rec.stemLine.material.color.copy(targetColor);
    rec.stemLine.material.opacity = isHighlighted ? 0.85 : Math.min(0.45, effOpacity * 0.6);

    rec.contactRing.material.color.copy(targetColor);
    rec.contactRing.material.opacity = isHighlighted ? 1.0 : effOpacity;

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
      for (let i = 0; i < this.shotRecords.length; i++) {
        const rec = this.shotRecords[i];
        const matches = this.shotMatchesFilters(rec);
        rec.visibleInExplorer = matches;
        if (matches) matchingCount++;

        const isHighlighted = (rec.shotId === this.selectedShotId) || (rec.shotId === this.hoveredShotId);
        const baseOpacity = rec.lowConf ? 0.40 : 1.0;
        this.applyRecStyle(rec, matches, baseOpacity, isHighlighted);
      }
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
    for (let i = 0; i < this.shotRecords.length; i++) {
      const rec = this.shotRecords[i];
      rec.visibleInExplorer = false;

      if (rec.rally.rally_id !== activeRallyId) {
        this.applyRecStyle(rec, false, 0, false);
        continue;
      }

      const isHighlighted = (rec.shotId === this.selectedShotId) || (rec.shotId === this.hoveredShotId);

      // During active rally playback:
      // - current shot: 100% opacity
      // - earlier shots in rally: 30% opacity
      // - later shots: hidden
      // When paused in downtime between rallies (shotIndex < 0), show all shots of active rally
      // with terminal shot at 100% and earlier shots at 30% so the rally remains inspectable.
      const effectiveShotIdx = (isDowntime || shotIndex < 0)
        ? (rec.rally.shots ? rec.rally.shots.length - 1 : 0)
        : shotIndex;

      if (rec.shotIndexInRally < effectiveShotIdx) {
        visibleCount++;
        this.applyRecStyle(rec, true, 0.30, isHighlighted);
      } else if (rec.shotIndexInRally === effectiveShotIdx) {
        visibleCount++;
        this.applyRecStyle(rec, true, 1.0, isHighlighted);
      } else {
        this.applyRecStyle(rec, false, 0, false);
      }
    }

    const totalInRally = activeRally && activeRally.shots ? activeRally.shots.length : 0;
    this.updateCountBadge(visibleCount, totalInRally, `R${activeRallyId}`);
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
