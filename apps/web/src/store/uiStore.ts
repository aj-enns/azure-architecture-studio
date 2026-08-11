import { create } from 'zustand';

const STORAGE_KEY = 'aar.ui';

/** Analysis panels share the right-hand rail, so only one is open at a time. */
export type PanelId = 'ai' | 'validation' | 'cost' | 'resiliency' | 'review' | 'iac';

const PANEL_IDS: PanelId[] = ['ai', 'validation', 'cost', 'resiliency', 'review', 'iac'];

interface PersistedUiState {
  showProperties: boolean;
  showGrid: boolean;
  /** Overlays SLA badges and a weakest-link ring on the canvas. */
  slaOverlay: boolean;
  activePanel: PanelId | null;
}

interface UiState extends PersistedUiState {
  toggleProperties: () => void;
  toggleGrid: () => void;
  toggleSlaOverlay: () => void;
  togglePanel: (panel: PanelId) => void;
  closePanel: () => void;
}

const defaults: PersistedUiState = {
  showProperties: true,
  showGrid: true,
  slaOverlay: false,
  activePanel: null,
};

function loadPersisted(): PersistedUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
    return {
      showProperties: typeof parsed.showProperties === 'boolean' ? parsed.showProperties : defaults.showProperties,
      showGrid: typeof parsed.showGrid === 'boolean' ? parsed.showGrid : defaults.showGrid,
      slaOverlay: typeof parsed.slaOverlay === 'boolean' ? parsed.slaOverlay : defaults.slaOverlay,
      activePanel: PANEL_IDS.includes(parsed.activePanel as PanelId)
        ? (parsed.activePanel as PanelId)
        : defaults.activePanel,
    };
  } catch {
    return defaults;
  }
}

function persist(state: PersistedUiState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private mode/quota) — non-fatal.
  }
}

function snapshot(s: UiState, patch: Partial<PersistedUiState>): PersistedUiState {
  const next: PersistedUiState = {
    showProperties: s.showProperties,
    showGrid: s.showGrid,
    slaOverlay: s.slaOverlay,
    activePanel: s.activePanel,
    ...patch,
  };
  persist(next);
  return next;
}

export const useUiStore = create<UiState>((set) => ({
  ...loadPersisted(),

  toggleProperties: () => set((s) => snapshot(s, { showProperties: !s.showProperties })),
  toggleGrid: () => set((s) => snapshot(s, { showGrid: !s.showGrid })),
  toggleSlaOverlay: () => set((s) => snapshot(s, { slaOverlay: !s.slaOverlay })),
  togglePanel: (panel) =>
    set((s) => snapshot(s, { activePanel: s.activePanel === panel ? null : panel })),
  closePanel: () => set((s) => snapshot(s, { activePanel: null })),
}));
