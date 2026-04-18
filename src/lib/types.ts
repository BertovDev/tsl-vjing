export type AppMode = 'studio' | 'received' | 'present';

export type ViewMode = 'local' | 'remote' | 'mix';

export type SyncState = {
  localCode: string;
  remoteCode: string;
  mixAmount: number;
  viewMode: ViewMode;
};

export type ControlPayload = {
  mixAmount?: number;
  viewMode?: ViewMode;
};

export type TabMessage =
  | { type: 'state'; state: SyncState; originId: string }
  | { type: 'request-state'; originId: string }
  | { type: 'control'; payload: ControlPayload; originId: string };

export type LiveProgramContext = {
  THREE: typeof import('three/webgpu');
  TSL: typeof import('three/tsl');
  material: import('three/webgpu').MeshBasicNodeMaterial;
  params: Record<string, unknown>;
  utils: Record<string, unknown>;
};

export type LiveProgram = (ctx: LiveProgramContext) => { sketch?: () => unknown };
