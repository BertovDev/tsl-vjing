import './style.css';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as TSLUtils from './tsl/utilities';
import { createWebGPUStage } from './webgpu/create_webgpu_stage';

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

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container.');

app.innerHTML = `
  <div id="stage" class="stage"></div>

  <div class="editor-overlay">
    <textarea id="live-editor" spellcheck="false" aria-label="Live TSL code"></textarea>
    <pre id="compile-errors" class="errors" aria-live="polite"></pre>
    <div class="meta">
      <span id="compile-state" class="state ok">Compiled</span>
      <span class="hint">Sketch mode · export const sketch = Fn(() => ...)</span>
    </div>
  </div>
`;

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`UI boot failure: missing element ${selector}`);
  return element;
}

const editor = must<HTMLTextAreaElement>('#live-editor');
const stage = must<HTMLDivElement>('#stage');
const compileState = must<HTMLSpanElement>('#compile-state');
const compileErrors = must<HTMLPreElement>('#compile-errors');

editor.value = DEFAULT_LIVE_CODE;

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

let camera: THREE.OrthographicCamera | null = null;
let scene: THREE.Scene | null = null;
let renderer: THREE.WebGPURenderer | null = null;
let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
let resizeObserver: ResizeObserver | null = null;
let applyDebounce: number | null = null;
let lastAppliedSource = '';

if (!('gpu' in navigator)) {
  showWebGPUFallback();
} else {
  void boot();
}

async function boot(): Promise<void> {
  const stageCtx = await createWebGPUStage(stage);
  camera = stageCtx.camera;
  scene = stageCtx.scene;
  renderer = stageCtx.renderer;
  mesh = stageCtx.mesh;

  resizeObserver = new ResizeObserver(() => {
    resizeStage();
  });
  resizeObserver.observe(stage);
  resizeStage();

  renderer.setAnimationLoop(frame);

  applyLiveCode(editor.value);

  editor.addEventListener('input', () => {
    if (applyDebounce !== null) window.clearTimeout(applyDebounce);

    applyDebounce = window.setTimeout(() => {
      applyLiveCode(editor.value);
    }, 220);
  });

  editor.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      applyLiveCode(editor.value);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const nextValue = `${editor.value.slice(0, start)}  ${editor.value.slice(end)}`;
      editor.value = nextValue;
      editor.selectionStart = start + 2;
      editor.selectionEnd = start + 2;
      applyLiveCode(editor.value);
    }
  });
}

function frame(): void {
  if (!renderer || !scene || !camera) return;
  renderer.render(scene, camera);
}

function resizeStage(): void {
  if (!renderer || !camera) return;

  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);

  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
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
        sin, cos, tan, mix, smoothstep, saturate,
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

function applyLiveCode(source: string): void {
  if (!mesh) return;
  if (source === lastAppliedSource) return;

  try {
    const program = compileProgram(source);
    const nextMaterial = new THREE.MeshBasicNodeMaterial();
    nextMaterial.colorNode = TSL.color('#1d33ff');

    const result = program({
      THREE,
      TSL,
      material: nextMaterial,
      params,
      utils: LIVE_UTILS
    });

    if (result?.sketch !== undefined) {
      if (typeof result.sketch !== 'function') {
        throw new Error('`sketch` must be declared as `export const sketch = Fn(() => { ... })`.');
      }

      nextMaterial.colorNode = (result.sketch as () => unknown)() as any;
    }

    const previous = mesh.material;
    mesh.material = nextMaterial;
    previous.dispose();
    lastAppliedSource = source;

    compileState.classList.remove('error');
    compileState.classList.add('ok');
    compileState.textContent = 'Compiled';
    compileErrors.textContent = '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    compileState.classList.remove('ok');
    compileState.classList.add('error');
    compileState.textContent = 'Error';
    compileErrors.textContent = message;
  }
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

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    renderer?.setAnimationLoop(null);
    resizeObserver?.disconnect();
    mesh?.material.dispose();
    renderer?.dispose();
  });
}
