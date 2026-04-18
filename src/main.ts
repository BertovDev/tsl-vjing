import './style.css';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as TSLUtils from './tsl/utilities';
import { createWebGPUStage } from './webgpu/create_webgpu_stage';
import { B2BPeer } from './network/webrtc_b2b';

const SIGNAL_PORT = 8787;
const SIGNALING_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:${SIGNAL_PORT}`;
const TAB_CHANNEL_NAME = 'tsl-vjing-b2b-tab-sync';
const PANEL_MIN_TOP = 106;

type AppMode = 'studio' | 'received' | 'present';
type ViewMode = 'local' | 'remote' | 'mix';

type LiveUtilities = typeof TSLUtils;
type LiveParams = Record<string, any>;

type LiveProgramContext = {
  THREE: typeof THREE;
  TSL: typeof TSL;
  material: THREE.MeshBasicNodeMaterial;
  params: LiveParams;
  utils: LiveUtilities;
};

type LiveProgram = (ctx: LiveProgramContext) => { sketch?: unknown };

type SyncState = {
  localCode: string;
  remoteCode: string;
  mixAmount: number;
  viewMode: ViewMode;
};

type ControlPayload = {
  mixAmount?: number;
  viewMode?: ViewMode;
};

type TabMessage =
  | {
      type: 'state';
      state: SyncState;
    }
  | {
      type: 'request-state';
    }
  | {
      type: 'control';
      payload: ControlPayload;
    };

const DEFAULT_LIVE_CODE = `export const sketch = Fn(() => {
  const uv = screenAspectUV(screenSize).toVar();
  const t = time.mul(params.speed);

  const bg = cosinePalette(
    float(0.28),
    vec3(0.5),
    vec3(0.5),
    vec3(1.0),
    vec3(params.bgR, params.bgG, params.bgB)
  );

  const finalColor = bg.mul(0.22).toVar();

  const uvR = uv.toVar();
  const repetitions = 5.0;

  const index = domainIndex(uv.y, repetitions);
  const index2 = domainIndex(uv.x, 30);

  const amplitude = params.dispersionFactor.mul(2.0);

  const offset = remap(
    simplexNoise3d(vec3(index2.mul(1.01), 1.1, 0.0)),
    -1.0,
    1.0,
    -1.3,
    1.3
  ).mul(amplitude.mul(params.offsetNoiseMult.mul(0.4).sin()));

  uvR.y.addAssign(offset.mul(0.015).mul(t).add(1.0));
  uvR.x.mul(t).mul(100);

  const scalar = remap(
    simplexNoise3d(vec3(index.mul(10.001), 0.1, 0.0)),
    -1.0,
    1.0,
    0.2,
    params.scalarNoiseMult
  ).mul(sin(amplitude.mul(0.03)));

  Loop({ start: 0, end: 9, type: 'float' }, ({ i }) => {
    const r = i.add(0.2).mul(0.3);
    const shape = sdSphere(uvR, r).toVar();
    shape.assign(bloomEdgePattern(shape, params.bloomRadius, 0.01, 1.0));

    const col = cosinePalette(
      scalar.add(t.mul(0.1)),
      params.colorA,
      params.colorB,
      params.colorC,
      params.colorD
    );

    finalColor.addAssign(col.mul(shape).mul(0.6));
  });

  return finalColor;
});
`;

const DEFAULT_REMOTE_CODE = '';

const params: LiveParams = {
  speed: TSL.uniform(1.0),
  distort: TSL.uniform(1.0),
  dispersionFactor: TSL.uniform(1.0),
  amplitudeMult: TSL.uniform(1.0),
  offsetNoiseMult: TSL.uniform(1.0),
  scalarNoiseMult: TSL.uniform(1.6),
  bloomRadius: TSL.uniform(5.0),

  bgR: TSL.uniform(0.05),
  bgG: TSL.uniform(0.12),
  bgB: TSL.uniform(0.22),

  colorA: TSL.vec3(0.46, 0.55, 0.7),
  colorB: TSL.vec3(0.42, 0.35, 0.25),
  colorC: TSL.vec3(1.0, 0.9, 0.75),
  colorD: TSL.vec3(0.0, 0.15, 0.25)
};

const LIVE_UTILS: LiveUtilities = TSLUtils;
const BLOCKED_UTILITY_BINDINGS = new Set([
  'THREE',
  'TSL',
  'material',
  'params',
  'uniforms',
  'utils',
  'sketch',
  'Fn',
  'If',
  'Loop',
  'float',
  'int',
  'vec2',
  'vec3',
  'vec4',
  'color',
  'time',
  'deltaTime',
  'uv',
  'screenSize',
  'sin',
  'cos',
  'tan',
  'atan',
  'mix',
  'smoothstep',
  'saturate',
  'abs',
  'min',
  'max',
  'clamp',
  'length',
  'normalize',
  'dot',
  'cross',
  'mod',
  'fract',
  'step',
  'pow',
  'remap',
  'oscSine',
  'oscSawtooth',
  'oscTriangle',
  'oscSquare',
  'normalLocal',
  'normalWorld',
  'positionLocal',
  'positionWorld',
  'cameraPosition'
]);

const LIVE_UTILITY_BINDINGS = Object.keys(LIVE_UTILS)
  .filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name))
  .filter((name) => !BLOCKED_UTILITY_BINDINGS.has(name))
  .map((name) => `const ${name} = utils.${name};`)
  .join('\n');

const appMode = resolveAppMode();
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container.');
document.body.dataset.mode = appMode;

app.innerHTML = renderTemplate(appMode);

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`UI boot failure: missing element ${selector}`);
  return element;
}

const stage = must<HTMLDivElement>('#stage');
const localStage = document.querySelector<HTMLDivElement>('#local-stage');

const localEditor = document.querySelector<HTMLTextAreaElement>('#live-editor');
const remoteEditor = document.querySelector<HTMLTextAreaElement>('#remote-editor');
const compileState = document.querySelector<HTMLSpanElement>('#compile-state');
const compileErrors = document.querySelector<HTMLPreElement>('#compile-errors');
const viewerStatus = document.querySelector<HTMLSpanElement>('#viewer-status');
const presentStatus = document.querySelector<HTMLSpanElement>('#present-status');

const roomIdInput = document.querySelector<HTMLInputElement>('#room-id');
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn');
const disconnectBtn = document.querySelector<HTMLButtonElement>('#disconnect-btn');
const sendBtn = document.querySelector<HTMLButtonElement>('#send-btn');
const viewModeSelect = document.querySelector<HTMLSelectElement>('#view-mode');
const mixRange = document.querySelector<HTMLInputElement>('#mix-range');
const mixValue = document.querySelector<HTMLSpanElement>('#mix-value');
const presentViewModeSelect = document.querySelector<HTMLSelectElement>('#present-view-mode');
const presentMixRange = document.querySelector<HTMLInputElement>('#present-mix-range');
const presentMixValue = document.querySelector<HTMLSpanElement>('#present-mix-value');
const presentLocalCodeView = document.querySelector<HTMLPreElement>('#present-local-code');
const presentRemoteCodeView = document.querySelector<HTMLPreElement>('#present-remote-code');
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const panelToggles = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toggle-panel]'));
const panelHideButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel-hide]'));
const panelPopoutButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel-popout]'));
const peerState = document.querySelector<HTMLSpanElement>('#peer-state');
const signalState = document.querySelector<HTMLSpanElement>('#signal-state');
const remoteNotice = document.querySelector<HTMLSpanElement>('#remote-notice');
const openReceivedBtn = document.querySelector<HTMLButtonElement>('#open-received-btn');
const openPresentBtn = document.querySelector<HTMLButtonElement>('#open-present-btn');

let camera: THREE.OrthographicCamera | null = null;
let scene: THREE.Scene | null = null;
let renderer: THREE.WebGPURenderer | null = null;
let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
let localPreviewCamera: THREE.OrthographicCamera | null = null;
let localPreviewScene: THREE.Scene | null = null;
let localPreviewRenderer: THREE.WebGPURenderer | null = null;
let localPreviewMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
let resizeObserver: ResizeObserver | null = null;
let applyDebounce: number | null = null;
let remoteNoticeTimeout: number | null = null;
let presentHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
let panelMoveHandler: ((event: PointerEvent) => void) | null = null;
let panelUpHandler: ((event: PointerEvent) => void) | null = null;
let panelZIndex = 20;
let frameHandle: number | null = null;

let localCode = DEFAULT_LIVE_CODE;
let remoteCode = DEFAULT_REMOTE_CODE;
let localProgram: LiveProgram | null = null;
let remoteProgram: LiveProgram | null = null;
let localCompileError = '';
let remoteCompileError = '';

let viewMode: ViewMode = appMode === 'received' ? 'remote' : appMode === 'present' ? 'mix' : 'local';
let mixAmount = 0.5;

if (localEditor) localEditor.value = localCode;
if (remoteEditor) remoteEditor.value = remoteCode;
if (presentLocalCodeView) presentLocalCodeView.textContent = localCode;
if (presentRemoteCodeView) presentRemoteCodeView.textContent = remoteCode;
if (mixRange) {
  mixRange.value = String(mixAmount);
  mixRange.style.setProperty('--mix-pct', String(mixAmount * 100));
}
if (mixValue) mixValue.textContent = mixAmount.toFixed(2);
if (presentMixRange) presentMixRange.value = String(mixAmount);
if (presentMixValue) presentMixValue.textContent = mixAmount.toFixed(2);
if (viewModeSelect) viewModeSelect.value = viewMode;
if (presentViewModeSelect) presentViewModeSelect.value = viewMode;
if (signalState && appMode === 'studio') signalState.textContent = `Signal :${SIGNAL_PORT}`;
if (viewerStatus && appMode !== 'studio') viewerStatus.textContent = 'Waiting for studio tab...';
if (presentStatus && appMode === 'present') presentStatus.textContent = 'Mix Desk Ready';

const tabChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(TAB_CHANNEL_NAME) : null;

const peer =
  appMode === 'studio'
    ? new B2BPeer({
        onStatus: (text) => {
          if (signalState) signalState.textContent = text;
        },
        onPeerState: (connected, peerId) => {
          if (!peerState) return;
          peerState.textContent = connected ? `Peer connected (${peerId ?? '-'})` : 'Peer offline';
          peerState.classList.toggle('connected', connected);
          connectBtn?.classList.toggle('hidden', connected);
          disconnectBtn?.classList.toggle('hidden', !connected);
        },
        onRemoteShader: (code) => {
          remoteCode = code;
          syncCodeViews();

          const compiled = remoteCode.trim() ? tryCompile(remoteCode) : { program: null, error: '' };
          remoteProgram = compiled.program;
          remoteCompileError = compiled.error;

          notifyIncomingShader(`Remote shader updated ${new Date().toLocaleTimeString()}`);
          applyShaderGraph();
          publishState();
        }
      })
    : null;

setupTabSync();

if (!('gpu' in navigator)) {
  showWebGPUFallback();
} else {
  void boot();
}

function clampMixAmount(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function notifyIncomingShader(message: string): void {
  if (appMode === 'present') return;
  if (!remoteNotice) return;

  remoteNotice.textContent = message;
  remoteNotice.classList.add('show');

  if (remoteNoticeTimeout !== null) {
    window.clearTimeout(remoteNoticeTimeout);
  }

  remoteNoticeTimeout = window.setTimeout(() => {
    remoteNotice?.classList.remove('show');
  }, 2200);
}

function syncCodeViews(): void {
  if (remoteEditor) {
    remoteEditor.value = remoteCode || '// Waiting for remote shader...';
  }

  if (presentLocalCodeView) {
    presentLocalCodeView.textContent = localCode || '// Waiting for local shader...';
  }

  if (presentRemoteCodeView) {
    presentRemoteCodeView.textContent = remoteCode || '// Waiting for remote shader...';
  }
}

function syncMixUI(): void {
  const normalized = clampMixAmount(mixAmount);
  mixAmount = normalized;

  if (mixRange) {
    mixRange.value = String(normalized);
    mixRange.style.setProperty('--mix-pct', String(normalized * 100));
  }
  if (mixValue) mixValue.textContent = normalized.toFixed(2);

  if (presentMixRange) presentMixRange.value = String(normalized);
  if (presentMixValue) presentMixValue.textContent = normalized.toFixed(2);
}

function syncViewModeUI(): void {
  if (viewModeSelect) viewModeSelect.value = viewMode;
  if (presentViewModeSelect) presentViewModeSelect.value = viewMode;
}

function setMixAmount(next: number): void {
  mixAmount = clampMixAmount(next);
  syncMixUI();
}

function setViewMode(next: ViewMode): void {
  viewMode = next;
  syncViewModeUI();
}

function updateWorkspaceMetrics(): void {
  // Layout is now flex-driven — no manual top offset needed.
}

function applyControlPayload(payload: ControlPayload, publish = false): void {
  let changed = false;

  if (typeof payload.mixAmount === 'number') {
    const normalized = clampMixAmount(payload.mixAmount);
    if (Math.abs(normalized - mixAmount) > 0.0001) {
      setMixAmount(normalized);
      changed = true;
    }
  }

  if (payload.viewMode && payload.viewMode !== viewMode) {
    setViewMode(payload.viewMode);
    changed = true;
  }

  if (!changed) return;

  applyShaderGraph();
  if (publish) publishState();
}

async function boot(): Promise<void> {
  const stageCtx = await createWebGPUStage(stage);
  camera = stageCtx.camera;
  scene = stageCtx.scene;
  renderer = stageCtx.renderer;
  mesh = stageCtx.mesh;

  if (appMode === 'studio' && localStage) {
    const localStageCtx = await createWebGPUStage(localStage);
    localPreviewCamera = localStageCtx.camera;
    localPreviewScene = localStageCtx.scene;
    localPreviewRenderer = localStageCtx.renderer;
    localPreviewMesh = localStageCtx.mesh;
  }

  updateWorkspaceMetrics();
  window.addEventListener('resize', updateWorkspaceMetrics);

  resizeObserver = new ResizeObserver(() => {
    updateWorkspaceMetrics();
    resizeStages();
  });
  resizeObserver.observe(stage);
  if (localStage) resizeObserver.observe(localStage);
  resizeStages();

  startFrameLoop();

  const localCompiled = tryCompile(localCode);
  localProgram = localCompiled.program;
  localCompileError = localCompiled.error;

  const remoteCompiled = remoteCode.trim() ? tryCompile(remoteCode) : { program: null, error: '' };
  remoteProgram = remoteCompiled.program;
  remoteCompileError = remoteCompiled.error;

  syncCodeViews();
  syncMixUI();
  syncViewModeUI();
  applyShaderGraph();

  if (appMode === 'studio') {
    bindStudioEvents();
    bindPanelWorkspace();
    publishState();
  } else if (appMode === 'present') {
    bindPresentEvents();
  }
}

function setupTabSync(): void {
  if (!tabChannel) return;

  tabChannel.onmessage = (event: MessageEvent<TabMessage>) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'request-state' && appMode === 'studio') {
      publishState();
      return;
    }

    if (data.type === 'control' && appMode === 'studio') {
      applyControlPayload(data.payload, true);
      return;
    }

    if (data.type === 'state' && appMode !== 'studio') {
      const state = data.state;
      const previousRemoteCode = remoteCode;

      localCode = state.localCode;
      remoteCode = state.remoteCode;
      setMixAmount(state.mixAmount);
      setViewMode(appMode === 'received' ? 'remote' : appMode === 'present' ? viewMode : state.viewMode);
      syncCodeViews();

      const remoteUpdated = previousRemoteCode !== remoteCode && remoteCode.trim().length > 0;

      if (viewerStatus) {
        if (!remoteCode.trim()) {
          viewerStatus.textContent = 'Waiting for incoming remote shader...';
        } else if (remoteUpdated) {
          viewerStatus.textContent = `Remote shader updated ${new Date().toLocaleTimeString()}`;
        } else {
          viewerStatus.textContent = `Synced ${new Date().toLocaleTimeString()}`;
        }
      }
      if (presentStatus) presentStatus.textContent = `Synced ${new Date().toLocaleTimeString()}`;

      const lc = tryCompile(localCode);
      localProgram = lc.program;
      localCompileError = lc.error;

      const rc = remoteCode.trim() ? tryCompile(remoteCode) : { program: null, error: '' };
      remoteProgram = rc.program;
      remoteCompileError = rc.error;

      if (remoteUpdated) {
        notifyIncomingShader(`Remote shader updated ${new Date().toLocaleTimeString()}`);
      }

      applyShaderGraph();
      return;
    }
  };

  if (appMode !== 'studio') {
    tabChannel.postMessage({ type: 'request-state' } as TabMessage);
  }
}

function publishState(): void {
  if (appMode !== 'studio' || !tabChannel) return;

  const state: SyncState = {
    localCode,
    remoteCode,
    mixAmount,
    viewMode
  };

  tabChannel.postMessage({ type: 'state', state } as TabMessage);
}

function publishControl(payload: ControlPayload): void {
  if (!tabChannel) return;
  tabChannel.postMessage({ type: 'control', payload } as TabMessage);
}

function bindStudioEvents(): void {
  if (!localEditor || !roomIdInput || !connectBtn || !disconnectBtn || !sendBtn || !viewModeSelect || !mixRange || !mixValue) {
    throw new Error('Studio UI boot failure: missing one or more controls.');
  }

  localEditor.addEventListener('input', () => {
    localCode = localEditor.value;
    if (applyDebounce !== null) window.clearTimeout(applyDebounce);

    applyDebounce = window.setTimeout(() => {
      const compiled = tryCompile(localCode);
      localProgram = compiled.program;
      localCompileError = compiled.error;
      applyShaderGraph();
      publishState();
    }, 220);
  });

  localEditor.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      localCode = localEditor.value;
      const compiled = tryCompile(localCode);
      localProgram = compiled.program;
      localCompileError = compiled.error;
      applyShaderGraph();
      publishState();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const start = localEditor.selectionStart;
      const end = localEditor.selectionEnd;
      const nextValue = `${localEditor.value.slice(0, start)}  ${localEditor.value.slice(end)}`;
      localEditor.value = nextValue;
      localEditor.selectionStart = start + 2;
      localEditor.selectionEnd = start + 2;

      localCode = localEditor.value;
      const compiled = tryCompile(localCode);
      localProgram = compiled.program;
      localCompileError = compiled.error;
      applyShaderGraph();
      publishState();
    }
  });

  connectBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim() || 'b2b-room';
    peer?.connect(roomId, SIGNALING_URL);
  });

  disconnectBtn.addEventListener('click', () => {
    peer?.disconnect();
    if (peerState) {
      peerState.textContent = 'Peer offline';
      peerState.classList.remove('connected');
    }
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  });

  sendBtn.addEventListener('click', () => {
    const ok = peer?.sendShader(localCode) ?? false;
    if (!ok && signalState) signalState.textContent = 'Cannot send yet: data channel closed';
  });

  viewModeSelect.addEventListener('change', () => {
    setViewMode(viewModeSelect.value as ViewMode);
    applyShaderGraph();
    publishState();
  });

  mixRange.addEventListener('input', () => {
    setMixAmount(Number(mixRange.value));
    applyShaderGraph();
    publishState();
  });

  openReceivedBtn?.addEventListener('click', () => {
    window.open(`${window.location.pathname}?mode=received`, '_blank', 'noopener');
    publishState();
  });

  openPresentBtn?.addEventListener('click', () => {
    window.open(`${window.location.pathname}?mode=present`, '_blank', 'noopener');
    publishState();
  });
}

function bindPanelWorkspace(): void {
  panels.forEach((panel) => {
    const header = panel.querySelector<HTMLElement>('[data-panel-drag]');
    if (!header) return;

    panel.style.zIndex = String(panelZIndex++);

    header.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, input, select, textarea')) {
        return;
      }

      event.preventDefault();
      bringPanelToFront(panel);
      undockPanel(panel);

      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;

      panel.classList.add('dragging');
      document.body.classList.add('drag-preview');
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      panelMoveHandler = (moveEvent: PointerEvent) => {
        const maxLeft = Math.max(12, window.innerWidth - panel.offsetWidth - 12);
        const maxTop = Math.max(PANEL_MIN_TOP, window.innerHeight - panel.offsetHeight - 12);

        const nextLeft = Math.min(Math.max(12, moveEvent.clientX - offsetX), maxLeft);
        const nextTop = Math.min(Math.max(PANEL_MIN_TOP, moveEvent.clientY - offsetY), maxTop);

        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
      };

      panelUpHandler = () => {
        panel.classList.remove('dragging');
        document.body.classList.remove('drag-preview');

        if (panelMoveHandler) {
          window.removeEventListener('pointermove', panelMoveHandler);
          panelMoveHandler = null;
        }

        if (panelUpHandler) {
          window.removeEventListener('pointerup', panelUpHandler);
          window.removeEventListener('pointercancel', panelUpHandler);
          panelUpHandler = null;
        }

        requestStageResize();
      };

      window.addEventListener('pointermove', panelMoveHandler);
      window.addEventListener('pointerup', panelUpHandler);
      window.addEventListener('pointercancel', panelUpHandler);
    });

    panel.addEventListener('pointerdown', () => {
      bringPanelToFront(panel);
    });
  });

  panelToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const panelId = toggle.dataset.togglePanel;
      if (!panelId) return;
      const panel = document.getElementById(panelId);
      if (!(panel instanceof HTMLElement)) return;

      const hidden = panel.classList.toggle('panel-hidden');
      syncPanelToggleState(panelId, hidden);

      if (!hidden) {
        bringPanelToFront(panel);
      }

      requestStageResize();
    });
  });

  panelHideButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.panelHide;
      if (!panelId) return;
      const panel = document.getElementById(panelId);
      if (!(panel instanceof HTMLElement)) return;

      panel.classList.add('panel-hidden');
      syncPanelToggleState(panelId, true);
      requestStageResize();
    });
  });

  panelPopoutButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.panelPopout;
      if (!panelId) return;
      const panel = document.getElementById(panelId);
      if (!(panel instanceof HTMLElement)) return;

      const isPopped = panel.classList.contains('panel-popped');

      if (isPopped) {
        panel.classList.remove('panel-popped');
        button.textContent = '↗';
        const prevMode = panel.dataset.prevMode ?? 'docked';

        if (prevMode === 'docked') {
          panel.classList.remove('panel-floating');
          panel.style.left = '';
          panel.style.top = '';
          panel.style.width = '';
          panel.style.height = '';
          panel.style.right = '';
          panel.style.bottom = '';
        } else {
          panel.classList.add('panel-floating');
          panel.style.left = panel.dataset.prevLeft ?? '';
          panel.style.top = panel.dataset.prevTop ?? '';
          panel.style.width = panel.dataset.prevWidth ?? '';
          panel.style.height = panel.dataset.prevHeight ?? '';
          panel.style.right = panel.dataset.prevRight ?? '';
          panel.style.bottom = panel.dataset.prevBottom ?? '';
        }

        requestStageResize();
        return;
      }

      button.textContent = '↙';

      const rect = panel.getBoundingClientRect();
      panel.dataset.prevMode = panel.classList.contains('panel-floating') ? 'floating' : 'docked';
      panel.dataset.prevLeft = panel.style.left;
      panel.dataset.prevTop = panel.style.top;
      panel.dataset.prevWidth = panel.style.width;
      panel.dataset.prevHeight = panel.style.height;
      panel.dataset.prevRight = panel.style.right;
      panel.dataset.prevBottom = panel.style.bottom;

      const nextWidth = Math.min(window.innerWidth * 0.72, 920);
      const nextHeight = Math.min(window.innerHeight * 0.72, 760);
      const nextLeft = Math.max(24, (window.innerWidth - nextWidth) / 2);
      const nextTop = Math.max(PANEL_MIN_TOP, (window.innerHeight - nextHeight) / 2);

      panel.classList.add('panel-popped');
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.width = `${Math.max(rect.width, nextWidth)}px`;
      panel.style.height = `${Math.max(rect.height, nextHeight)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      bringPanelToFront(panel);
      requestStageResize();
    });
  });
}

function bindPresentEvents(): void {
  if (!presentViewModeSelect || !presentMixRange) return;

  presentViewModeSelect.addEventListener('change', () => {
    const nextViewMode = presentViewModeSelect.value as ViewMode;
    applyControlPayload({ viewMode: nextViewMode }, false);
    publishControl({ viewMode: nextViewMode });
    if (presentStatus) presentStatus.textContent = `Live ${nextViewMode}`;
  });

  presentMixRange.addEventListener('input', () => {
    const nextMixAmount = Number(presentMixRange.value);
    applyControlPayload({ mixAmount: nextMixAmount }, false);
    publishControl({ mixAmount: nextMixAmount });
    if (presentStatus) presentStatus.textContent = `Live mix ${mixAmount.toFixed(2)}`;
  });

  presentHotkeyHandler = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = clampMixAmount(mixAmount - 0.02);
      applyControlPayload({ mixAmount: next }, false);
      publishControl({ mixAmount: next });
      if (presentStatus) presentStatus.textContent = `Live mix ${mixAmount.toFixed(2)}`;
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = clampMixAmount(mixAmount + 0.02);
      applyControlPayload({ mixAmount: next }, false);
      publishControl({ mixAmount: next });
      if (presentStatus) presentStatus.textContent = `Live mix ${mixAmount.toFixed(2)}`;
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      applyControlPayload({ viewMode: 'local' }, false);
      publishControl({ viewMode: 'local' });
      if (presentStatus) presentStatus.textContent = 'Live local';
      return;
    }

    if (event.key === '2') {
      event.preventDefault();
      applyControlPayload({ viewMode: 'mix' }, false);
      publishControl({ viewMode: 'mix' });
      if (presentStatus) presentStatus.textContent = 'Live mix';
      return;
    }

    if (event.key === '3') {
      event.preventDefault();
      applyControlPayload({ viewMode: 'remote' }, false);
      publishControl({ viewMode: 'remote' });
      if (presentStatus) presentStatus.textContent = 'Live remote';
    }
  };

  window.addEventListener('keydown', presentHotkeyHandler);
}

function bringPanelToFront(panel: HTMLElement): void {
  panel.style.zIndex = String(panelZIndex++);
}

function syncPanelToggleState(panelId: string, hidden: boolean): void {
  const toggle = panelToggles.find((item) => item.dataset.togglePanel === panelId);
  toggle?.classList.toggle('inactive', hidden);
}

function requestStageResize(): void {
  window.requestAnimationFrame(() => {
    resizeStages();
  });
}

function undockPanel(panel: HTMLElement): void {
  if (panel.classList.contains('panel-floating') || panel.classList.contains('panel-popped')) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  panel.classList.add('panel-floating');
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.top}px`;
  panel.style.width = `${rect.width}px`;
  panel.style.height = `${rect.height}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

function startFrameLoop(): void {
  if (frameHandle !== null) {
    window.cancelAnimationFrame(frameHandle);
  }

  const step = () => {
    frame();
    frameHandle = window.requestAnimationFrame(step);
  };

  frameHandle = window.requestAnimationFrame(step);
}

function frame(): void {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }

  if (localPreviewRenderer && localPreviewScene && localPreviewCamera) {
    localPreviewRenderer.render(localPreviewScene, localPreviewCamera);
  }
}

function resizeStages(): void {
  resizeSingleStage(stage, renderer, camera);

  if (localStage) {
    resizeSingleStage(localStage, localPreviewRenderer, localPreviewCamera);
  }
}

function resizeSingleStage(
  container: HTMLElement,
  nextRenderer: THREE.WebGPURenderer | null,
  nextCamera: THREE.OrthographicCamera | null
): void {
  if (!nextRenderer || !nextCamera) return;

  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  nextCamera.updateProjectionMatrix();
  nextRenderer.setSize(width, height);
}

function normalizeSketchSource(source: string): string {
  return source.replace(/\bexport\s+(?=(const|let|var|function|class)\b)/g, '');
}

function compileProgram(source: string): LiveProgram {
  const normalizedSource = normalizeSketchSource(source);

  const wrapped = `
    "use strict";
    return (ctx) => {
      const { THREE, TSL, material, params, utils } = ctx;
      const uniforms = params;

      const {
        Fn, If, Loop,
        float, int, vec2, vec3, vec4, color,
        time, deltaTime, uv, screenSize,
        sin, cos, tan, atan, mix, smoothstep, saturate,
        abs, min, max, clamp, length, normalize, dot, cross,
        mod, fract, step, pow, remap,
        oscSine, oscSawtooth, oscTriangle, oscSquare,
        normalLocal, normalWorld,
        positionLocal, positionWorld,
        cameraPosition
      } = TSL;

      ${LIVE_UTILITY_BINDINGS}

      ${normalizedSource}

      return {
        sketch: typeof sketch !== 'undefined' ? sketch : undefined
      };
    };
  `;

  const factory = new Function(wrapped) as () => LiveProgram;
  return factory();
}

function tryCompile(source: string): { program: LiveProgram | null; error: string } {
  try {
    return {
      program: compileProgram(source),
      error: ''
    };
  } catch (error) {
    return {
      program: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function evaluateProgram(program: LiveProgram): any {
  const materialProxy: Record<string, unknown> = {
    colorNode: TSL.color('#1d33ff')
  };

  const result = program({
    THREE,
    TSL,
    material: materialProxy as unknown as THREE.MeshBasicNodeMaterial,
    params,
    utils: LIVE_UTILS
  });

  if (result?.sketch !== undefined) {
    if (typeof result.sketch !== 'function') {
      throw new Error('`sketch` must be declared as `export const sketch = Fn(() => { ... })`.');
    }

    return (result.sketch as () => unknown)();
  }

  return materialProxy.colorNode as any;
}

function applyNodeToMesh(
  nextMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null,
  nextNode: any
): void {
  if (!nextMesh) return;

  const nextMaterial = new THREE.MeshBasicNodeMaterial();
  nextMaterial.colorNode = nextNode;

  const previous = nextMesh.material;
  nextMesh.material = nextMaterial;
  previous.dispose();
}

function applyShaderGraph(): void {
  if (!mesh) return;

  const issues: string[] = [];
  if (localCompileError) issues.push(`[local]\n${localCompileError}`);
  if (remoteCompileError) issues.push(`[remote]\n${remoteCompileError}`);

  try {
    const localNode = localProgram ? evaluateProgram(localProgram) : null;
    const remoteNode = remoteProgram ? evaluateProgram(remoteProgram) : null;

    const renderMode = appMode === 'received' ? 'remote' : viewMode;

    let outputNode: any = TSL.color('#111733');

    if (renderMode === 'local') {
      outputNode = localNode ?? remoteNode ?? outputNode;
    }

    if (renderMode === 'remote') {
      outputNode = remoteNode ?? localNode ?? outputNode;
    }

    if (renderMode === 'mix') {
      if (localNode && remoteNode) {
        outputNode = TSL.mix(localNode, remoteNode, TSL.float(mixAmount));
      } else {
        outputNode = localNode ?? remoteNode ?? outputNode;
      }
    }

    const localPreviewNode = localNode ?? remoteNode ?? TSL.color('#111733');

    applyNodeToMesh(mesh, outputNode);
    applyNodeToMesh(localPreviewMesh, localPreviewNode);

    updateStatus(renderMode, issues);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(message);
    updateStatus('local', issues, true);
  }
}

function updateStatus(renderMode: ViewMode, issues: string[], forceError = false): void {
  if (appMode === 'present') {
    if (!presentStatus) return;

    if (forceError || issues.length > 0) {
      presentStatus.classList.remove('ok');
      presentStatus.classList.add('error');
      presentStatus.textContent = 'Mix issues';
      return;
    }

    presentStatus.classList.remove('error');
    presentStatus.classList.add('ok');

    if (renderMode === 'mix') {
      presentStatus.textContent = `Live mix ${mixAmount.toFixed(2)}`;
    } else {
      presentStatus.textContent = renderMode === 'local' ? 'Live local' : 'Live remote';
    }

    return;
  }

  if (viewerStatus && appMode === 'received') {
    viewerStatus.textContent = issues.length > 0 ? 'Synced with issues' : 'Synced';
    return;
  }

  if (!compileState || !compileErrors) return;

  if (forceError || issues.length > 0) {
    compileState.classList.remove('ok');
    compileState.classList.add('error');
    compileState.textContent = forceError ? 'Error' : 'Partial';
    compileErrors.textContent = issues.join('\n\n');
    return;
  }

  compileState.classList.remove('error');
  compileState.classList.add('ok');

  if (renderMode === 'mix') {
    compileState.textContent = `Mix ${mixAmount.toFixed(2)}`;
  } else {
    compileState.textContent = renderMode === 'local' ? 'Local' : 'Remote';
  }

  compileErrors.textContent = '';
}

function showWebGPUFallback(): void {
  const fallback = document.createElement('div');
  fallback.className = 'fallback';
  fallback.innerHTML = `
    <h1>WebGPU is required</h1>
    <p>
      Your browser does not expose the WebGPU API. Use a recent Chrome/Edge build and enable
      WebGPU support, then reload.
    </p>
  `;

  app?.replaceChildren(fallback);
}

function resolveAppMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'received') return 'received';
  if (mode === 'present') return 'present';
  return 'studio';
}

function renderTemplate(mode: AppMode): string {
  if (mode === 'present') {
    return `<div id="stage" class="stage"></div>`;
  }

  if (mode === 'received') {
    return `
      <div id="stage" class="stage"></div>
      <div class="viewer-hud">REMOTE SHADER VIEW</div>
      <div class="editor-overlay received">
        <textarea id="remote-editor" readonly aria-label="Remote shader code"></textarea>
        <div class="meta">
          <span id="viewer-status" class="state">Waiting for studio tab...</span>
          <span class="hint">Visualizer + incoming code</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="workspace-shell">
      <div class="workspace-bar">
        <div class="workspace-brand">TSL B2B Terminal</div>

        <div class="workspace-controls">
          <input id="room-id" type="text" value="b2b-room" spellcheck="false" />
          <button id="connect-btn">Connect</button>
          <button id="disconnect-btn" class="hidden">Disconnect</button>
          <button id="send-btn" class="btn-primary">Send Shader</button>
          <button id="open-received-btn">Open Received Tab</button>
          <button id="open-present-btn">Open Mix Output</button>
        </div>

        <div class="workspace-controls">
          <label>
            View
            <select id="view-mode">
              <option value="local">Local</option>
              <option value="remote">Remote</option>
              <option value="mix">Mix</option>
            </select>
          </label>

          <label>
            Mix
            <input id="mix-range" type="range" min="0" max="1" step="0.01" value="0.5" />
            <span id="mix-value">0.50</span>
          </label>
        </div>

        <div class="workspace-dock">
          <button class="dock-toggle" data-toggle-panel="local-code-panel">Our Code</button>
          <button class="dock-toggle" data-toggle-panel="remote-code-panel">Sender Code</button>
          <button class="dock-toggle" data-toggle-panel="output-panel">Shader Output</button>
          <button class="dock-toggle" data-toggle-panel="local-preview-panel">Our Shader</button>
        </div>

        <div class="workspace-status">
          <span id="peer-state">Peer offline</span>
          <span id="signal-state"></span>
          <span id="remote-notice" class="remote-notice" aria-live="polite"></span>
        </div>
      </div>

      <div class="workspace-area">
        <aside class="shader-sidebar">
          <div class="sidebar-header">
            <span class="sidebar-header-led"></span>
            SHADERS
          </div>
          <ul class="shader-list" role="listbox" aria-label="Shader library">
            <li class="shader-item shader-item-active" role="option" aria-selected="true">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">sphere_rings</span>
              <span class="shader-item-duration">live</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">plasma_field</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">voronoi_drift</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">fbm_terrain</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">bloom_spiral</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">tunnel_warp</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">kaleid_noise</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">liquid_chrome</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">dot_matrix</span>
            </li>
            <li class="shader-item" role="option" aria-selected="false">
              <span class="shader-item-dot"></span>
              <span class="shader-item-name">aurora_bands</span>
            </li>
          </ul>
        </aside>

        <div class="workspace-grid">
          <div id="local-code-panel" class="panel panel-local-code">
            <div class="panel-header" data-panel-drag>
              <div class="panel-title">
                <span class="panel-led"></span>
                <span>OUR CODE</span>
              </div>
              <div class="panel-actions">
                <button type="button" data-panel-popout="local-code-panel">↗</button>
              </div>
            </div>
            <div class="panel-body panel-code-body">
              <textarea id="live-editor" spellcheck="false" aria-label="Local live shader code"></textarea>
              <pre id="compile-errors" class="errors" aria-live="polite"></pre>
              <div class="meta">
                <span id="compile-state" class="state ok">Compiled</span>
                <span class="hint">export const sketch = Fn(() => ...)</span>
              </div>
            </div>
          </div>

          <div id="remote-code-panel" class="panel panel-remote-code">
            <div class="panel-header" data-panel-drag>
              <div class="panel-title">
                <span class="panel-led amber"></span>
                <span>SENDER CODE</span>
              </div>
              <div class="panel-actions">
                <button type="button" data-panel-popout="remote-code-panel">↗</button>
              </div>
            </div>
            <div class="panel-body panel-code-body">
              <textarea id="remote-editor" readonly aria-label="Remote shader code"></textarea>
              <div class="meta">
                <span class="state">Remote</span>
                <span class="hint">Incoming shader from peer</span>
              </div>
            </div>
          </div>

          <div id="local-preview-panel" class="panel panel-local-preview">
            <div class="panel-header" data-panel-drag>
              <div class="panel-title">
                <span class="panel-led silver"></span>
                <span>OUR SHADER</span>
              </div>
              <div class="panel-actions">
                <button type="button" data-panel-popout="local-preview-panel">↗</button>
              </div>
            </div>
            <div class="panel-body panel-stage-body">
              <div id="local-stage" class="stage"></div>
            </div>
          </div>

          <div id="output-panel" class="panel panel-output">
            <div class="panel-header" data-panel-drag>
              <div class="panel-title">
                <span class="panel-led green"></span>
                <span>SHADER OUTPUT</span>
              </div>
              <div class="panel-actions">
                <button type="button" data-panel-popout="output-panel">↗</button>
              </div>
            </div>
            <div class="panel-body panel-stage-body">
              <div id="stage" class="stage"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    peer?.disconnect();
    tabChannel?.close();
    if (remoteNoticeTimeout !== null) window.clearTimeout(remoteNoticeTimeout);
    if (presentHotkeyHandler) window.removeEventListener('keydown', presentHotkeyHandler);
    window.removeEventListener('resize', updateWorkspaceMetrics);
    if (panelMoveHandler) window.removeEventListener('pointermove', panelMoveHandler);
    if (panelUpHandler) {
      window.removeEventListener('pointerup', panelUpHandler);
      window.removeEventListener('pointercancel', panelUpHandler);
    }
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    resizeObserver?.disconnect();
    mesh?.material.dispose();
    renderer?.dispose();
    localPreviewMesh?.material.dispose();
    localPreviewRenderer?.dispose();
  });
}
