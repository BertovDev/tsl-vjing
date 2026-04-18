import { create } from 'zustand';

export type PanelId =
  | 'local-code-panel'
  | 'remote-code-panel'
  | 'output-panel'
  | 'local-preview-panel';

export type PanelMode = 'docked' | 'floating' | 'popped' | 'hidden';

export type PanelGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PanelState = {
  mode: PanelMode;
  /** Mode to return to when un-popping. */
  prevMode: 'docked' | 'floating';
  /** Geometry for floating mode. */
  floating: PanelGeometry | null;
  /** Geometry snapshot before popping (so unpop returns to floating spot). */
  prevFloating: PanelGeometry | null;
  /** z-index value. */
  z: number;
};

type PanelStoreState = {
  panels: Record<PanelId, PanelState>;
  zCounter: number;

  setMode: (id: PanelId, mode: PanelMode) => void;
  setFloating: (id: PanelId, geom: PanelGeometry | null) => void;
  bringToFront: (id: PanelId) => void;
  togglePopped: (id: PanelId, fallbackGeom: () => PanelGeometry) => void;
  toggleHidden: (id: PanelId) => void;
  startFloating: (id: PanelId, geom: PanelGeometry) => void;
};

const DEFAULT_PANEL: PanelState = {
  mode: 'docked',
  prevMode: 'docked',
  floating: null,
  prevFloating: null,
  z: 20
};

export const usePanelStore = create<PanelStoreState>((set) => ({
  panels: {
    'local-code-panel': { ...DEFAULT_PANEL, z: 21 },
    'remote-code-panel': { ...DEFAULT_PANEL, z: 22 },
    'output-panel': { ...DEFAULT_PANEL, z: 23 },
    'local-preview-panel': { ...DEFAULT_PANEL, z: 24 }
  },
  zCounter: 24,

  setMode: (id, mode) =>
    set((state) => ({
      panels: { ...state.panels, [id]: { ...state.panels[id], mode } }
    })),

  setFloating: (id, geom) =>
    set((state) => ({
      panels: { ...state.panels, [id]: { ...state.panels[id], floating: geom } }
    })),

  bringToFront: (id) =>
    set((state) => {
      const next = state.zCounter + 1;
      return {
        zCounter: next,
        panels: { ...state.panels, [id]: { ...state.panels[id], z: next } }
      };
    }),

  startFloating: (id, geom) =>
    set((state) => {
      const panel = state.panels[id];
      if (panel.mode === 'floating' || panel.mode === 'popped') return {};
      const nextZ = state.zCounter + 1;
      return {
        zCounter: nextZ,
        panels: {
          ...state.panels,
          [id]: { ...panel, mode: 'floating', floating: geom, z: nextZ }
        }
      };
    }),

  togglePopped: (id, fallbackGeom) =>
    set((state) => {
      const panel = state.panels[id];
      const nextZ = state.zCounter + 1;
      if (panel.mode === 'popped') {
        return {
          zCounter: nextZ,
          panels: {
            ...state.panels,
            [id]: {
              ...panel,
              mode: panel.prevMode,
              floating: panel.prevMode === 'floating' ? panel.prevFloating : null,
              prevFloating: null,
              z: nextZ
            }
          }
        };
      }
      const prevMode = panel.mode === 'floating' ? 'floating' : 'docked';
      return {
        zCounter: nextZ,
        panels: {
          ...state.panels,
          [id]: {
            ...panel,
            mode: 'popped',
            prevMode,
            prevFloating: panel.mode === 'floating' ? panel.floating : null,
            floating: computePoppedGeom(fallbackGeom()),
            z: nextZ
          }
        }
      };
    }),

  toggleHidden: (id) =>
    set((state) => {
      const panel = state.panels[id];
      if (panel.mode === 'hidden') {
        const nextZ = state.zCounter + 1;
        return {
          zCounter: nextZ,
          panels: {
            ...state.panels,
            [id]: { ...panel, mode: panel.floating ? 'floating' : 'docked', z: nextZ }
          }
        };
      }
      return {
        panels: { ...state.panels, [id]: { ...panel, mode: 'hidden' } }
      };
    })
}));

function computePoppedGeom(current: PanelGeometry): PanelGeometry {
  const width = Math.min(window.innerWidth * 0.72, 920);
  const height = Math.min(window.innerHeight * 0.72, 760);
  const left = Math.max(24, Math.round((window.innerWidth - width) / 2));
  const top = Math.max(106, Math.round((window.innerHeight - height) / 2));
  void current;
  return { left, top, width, height };
}
