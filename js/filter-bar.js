/**
 * Hawkview Shot Explorer Filter Bar (Spec Section 3.2)
 * Controls:
 * - Game (All, Game 1, Game 2)
 * - Rally (All, R1..R22)
 * - Player (All, LZJ, POPOV)
 * - Shot type (all BWF types from Section 1.6 + families 'clear' and 'serve')
 * - Outcome (All, continue, winner, error_out, error_net)
 * - Contact zone (All, front, mid, rear)
 * - Min speed slider (0–400 km/h)
 * - Rally-ending shots only toggle
 * - Clear filters button
 */

class FilterBar {
  constructor(shotExplorer) {
    this.explorer = shotExplorer;

    this.gameSelect = document.getElementById('filter-game');
    this.rallySelect = document.getElementById('filter-rally');
    this.playerSelect = document.getElementById('filter-player');
    this.typeSelect = document.getElementById('filter-shot-type');
    this.outcomeSelect = document.getElementById('filter-outcome');
    this.zoneSelect = document.getElementById('filter-contact-zone');
    this.speedSlider = document.getElementById('filter-min-speed');
    this.speedValEl = document.getElementById('filter-min-speed-val');
    this.terminalCheckbox = document.getElementById('filter-terminal-only');
    this.clearBtn = document.getElementById('btn-clear-filters');
    this.summaryEl = document.getElementById('filter-active-summary');
    this.mobileSummaryEl = document.getElementById('filter-mobile-summary');
    this.filterContainer = document.getElementById('filter-bar-container');
    this.mobileToggleBtn = document.getElementById('btn-toggle-mobile-filters');

    this.populateRallyOptions();
    this.bindEvents();
    this.syncFromExplorer();
  }

  populateRallyOptions() {
    if (!this.rallySelect) return;
    const telemetry = window.HAWKVIEW_TELEMETRY;
    const rallies = (telemetry && telemetry.rallies) || [];
    const currentVal = this.rallySelect.value || 'all';

    this.rallySelect.innerHTML = '<option value="all">All Rallies</option>';
    rallies.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = String(r.rally_id);
      opt.textContent = `R${r.rally_id} (G${r.game || 1})`;
      this.rallySelect.appendChild(opt);
    });
    if ([...this.rallySelect.options].some((o) => o.value === currentVal)) {
      this.rallySelect.value = currentVal;
    } else {
      this.rallySelect.value = 'all';
    }

    if (this.playerSelect && telemetry && telemetry.players) {
      const pKeys = Object.keys(telemetry.players);
      if (pKeys.length > 0) {
        const curP = this.playerSelect.value || 'all';
        this.playerSelect.innerHTML = '<option value="all">All</option>';
        pKeys.forEach((pid) => {
          const opt = document.createElement('option');
          opt.value = pid;
          opt.textContent = pid;
          this.playerSelect.appendChild(opt);
        });
        if ([...this.playerSelect.options].some((o) => o.value === curP)) {
          this.playerSelect.value = curP;
        } else {
          this.playerSelect.value = 'all';
        }
      }
    }
  }

  bindEvents() {
    if (this.mobileToggleBtn && this.filterContainer) {
      this.mobileToggleBtn.addEventListener('click', () => {
        const isOpen = this.filterContainer.classList.toggle('mobile-open');
        this.updateMobileToggleLabel(isOpen);
      });
    }
    if (this.gameSelect) {
      this.gameSelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ game: e.target.value });
      });
    }
    if (this.rallySelect) {
      this.rallySelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ rallyId: e.target.value });
      });
    }
    if (this.playerSelect) {
      this.playerSelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ player: e.target.value });
      });
    }
    if (this.typeSelect) {
      this.typeSelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ shotType: e.target.value });
      });
    }
    if (this.outcomeSelect) {
      this.outcomeSelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ outcome: e.target.value });
      });
    }
    if (this.zoneSelect) {
      this.zoneSelect.addEventListener('change', (e) => {
        this.explorer.setFilters({ contactZone: e.target.value, lateralZone: 'all' });
      });
    }
    if (this.speedSlider) {
      this.speedSlider.addEventListener('input', (e) => {
        const v = Number(e.target.value) || 0;
        if (this.speedValEl) this.speedValEl.textContent = `${v} km/h`;
        this.explorer.setFilters({ minSpeed: v });
      });
    }
    if (this.terminalCheckbox) {
      this.terminalCheckbox.addEventListener('change', (e) => {
        this.explorer.setFilters({ terminalOnly: Boolean(e.target.checked) });
      });
    }
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        this.explorer.clearFilters();
      });
    }

    window.addEventListener('hawkview:filtersChanged', () => {
      this.syncFromExplorer();
    });

    window.addEventListener('hawkview:matchChanged', () => {
      this.populateRallyOptions();
      this.syncFromExplorer();
    });

    window.addEventListener('hawkview:ralliesStreamUpdated', () => {
      this.populateRallyOptions();
      this.syncFromExplorer();
    });
  }

  updateMobileToggleLabel(isOpen) {
    if (!this.mobileToggleBtn || !this.explorer) return;
    const hasFilter = typeof this.explorer.hasActiveFilters === 'function'
      ? this.explorer.hasActiveFilters()
      : false;
    const arrow = isOpen ? '▴' : '▾';
    this.mobileToggleBtn.textContent = hasFilter ? `Filters (Active) ${arrow}` : `Filters ${arrow}`;
    this.mobileToggleBtn.classList.toggle('active', hasFilter);
  }

  syncFromExplorer() {
    if (!this.explorer) return;
    const f = this.explorer.filters;

    if (this.gameSelect) this.gameSelect.value = f.game;
    if (this.rallySelect) this.rallySelect.value = f.rallyId;
    if (this.playerSelect) this.playerSelect.value = f.player;
    if (this.typeSelect) this.typeSelect.value = f.shotType;
    if (this.outcomeSelect) this.outcomeSelect.value = f.outcome;
    if (this.zoneSelect) this.zoneSelect.value = f.contactZone;
    if (this.speedSlider) this.speedSlider.value = f.minSpeed;
    if (this.speedValEl) this.speedValEl.textContent = `${f.minSpeed} km/h`;
    if (this.terminalCheckbox) this.terminalCheckbox.checked = Boolean(f.terminalOnly);

    const count = this.explorer.getMatchingShotsCount();
    const total = this.explorer.shotRecords.length;
    const lateralTag = f.lateralZone !== 'all' ? ` · ${f.lateralZone}` : '';
    const summaryText = `${count} / ${total} shots${lateralTag}`;
    if (this.summaryEl) this.summaryEl.textContent = summaryText;
    if (this.mobileSummaryEl) this.mobileSummaryEl.textContent = summaryText;

    const isOpen = this.filterContainer ? this.filterContainer.classList.contains('mobile-open') : false;
    this.updateMobileToggleLabel(isOpen);
  }
}

window.FilterBar = FilterBar;
