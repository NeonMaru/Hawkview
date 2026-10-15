/**
 * Master Hawkview Application Coordinator (Spec Sections 2 & 3)
 * Wires together:
 * - Light / Dark theme toggle (--bg, --panel, --court-floor, --court-line, etc.)
 * - BroadcastPlayer (1:1 HTML5 video sync)
 * - ThreeCourtViewer + ShotExplorer (3D court & trajectories)
 * - FilterBar (Game, Rally, Player, Shot type, Outcome, Contact zone, Min speed, Terminal-only)
 * - PlayerCard (Summary stats, Speed Table + eye toggles, 3x3 Contact Map)
 * - RallyDeck (22 rallies, shot drawer, Section 1.5 winner correction)
 * - AnalyticsCards (Court coverage KDE, Serve, Rally endings, Attack)
 * - AntiLagModal (Plain pipeline telemetry summary)
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Theme Initialization & Toggle (Light default per PB Vision, Dark toggle supported)
  const themeBtn = document.getElementById('btn-theme-toggle');
  const savedTheme = localStorage.getItem('hawkview_theme') || 'light';

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('hawkview_theme', theme);
    } catch (e) {}
    if (themeBtn) {
      themeBtn.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
    }
    window.dispatchEvent(new CustomEvent('hawkview:themeChanged', { detail: { theme } }));
  }

  applyTheme(savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const curr = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(curr === 'dark' ? 'light' : 'dark');
    });
  }

  // 2. Update Topbar Match Metadata
  const metaEl = document.getElementById('header-match-title');
  const telemetry = window.HAWKVIEW_TELEMETRY;
  if (metaEl && telemetry && telemetry.match_metadata) {
    const mm = telemetry.match_metadata;
    metaEl.textContent = `${mm.tournament || 'BWF Arctic Open 2024'} · ${mm.round || 'QF'} · ${mm.match_type || 'singles'}`;
  }

  // 3. Instantiate Core Subsystems
  const broadcastPlayer = new BroadcastPlayer();
  const shotExplorer = new ShotExplorer(broadcastPlayer.threeViewer, broadcastPlayer);
  const filterBar = new FilterBar(shotExplorer);
  const playerCard = new PlayerCard(shotExplorer, broadcastPlayer);
  const rallyDeck = new RallyDeck(shotExplorer, broadcastPlayer);
  const analyticsCards = new AnalyticsCards();
  const antiLagModal = new AntiLagModal();

  // Expose globally for inspection and testing
  window.shotExplorerInstance = shotExplorer;
  window.filterBarInstance = filterBar;
  window.playerCardInstance = playerCard;
  window.rallyDeckInstance = rallyDeck;
  window.analyticsCardsInstance = analyticsCards;
  window.antiLagModalInstance = antiLagModal;

  // Select Rally 1 initially so video and 3D court are ready
  broadcastPlayer.selectRally(0);

  // 4. Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      broadcastPlayer.togglePlay();
    } else if (e.code === 'KeyC') {
      if (broadcastPlayer.threeViewer) {
        broadcastPlayer.threeViewer.cyclePreset();
      }
    } else if (e.code === 'ArrowRight') {
      broadcastPlayer.seekTo(broadcastPlayer.currentTime + 2.0, true);
    } else if (e.code === 'ArrowLeft') {
      broadcastPlayer.seekTo(broadcastPlayer.currentTime - 2.0, true);
    } else if (e.code === 'Escape') {
      shotExplorer.selectedShotId = null;
      shotExplorer.refreshVisibility();
    }
  });
});
