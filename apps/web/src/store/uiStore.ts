import { create } from 'zustand';

const STORAGE_KEY = 'aar.ui';

interface PersistedUiState {
  showProperties: boolean;
  showGrid: boolean;
}

interface UiState extends PersistedUiState {
  toggleProperties: () => void;
  toggleGrid: () => void;
}

const defaults: PersistedUiState = { showProperties: true, showGrid: true };

function loadPersisted(): PersistedUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
    return {
      showProperties: typeof parsed.showProperties === 'boolean' ? parsed.showProperties : defaults.showProperties,
      showGrid: typeof parsed.showGrid === 'boolean' ? parsed.showGrid : defaults.showGrid,
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

export const useUiStore = create<UiState>((set) => ({
  ...loadPersisted(),

  toggleProperties: () =>
    set((s) => {
      const next = { showProperties: !s.showProperties, showGrid: s.showGrid };
      persist(next);
      return next;
    }),

  toggleGrid: () =>
    set((s) => {
      const next = { showProperties: s.showProperties, showGrid: !s.showGrid };
      persist(next);
      return next;
    }),
}));
