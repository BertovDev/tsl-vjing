import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as TSLUtils from '../tsl/utilities';
import { liveParams } from './liveParams';
import type { LiveProgram } from './types';

const BLOCKED_UTILITY_BINDINGS = new Set([
  'THREE', 'TSL', 'material', 'params', 'uniforms', 'utils', 'sketch',
  'Fn', 'If', 'Loop',
  'float', 'int', 'vec2', 'vec3', 'vec4', 'color',
  'time', 'deltaTime', 'uv', 'screenSize',
  'sin', 'cos', 'tan', 'atan', 'mix', 'smoothstep', 'saturate',
  'abs', 'min', 'max', 'clamp', 'length', 'normalize', 'dot', 'cross',
  'mod', 'fract', 'step', 'pow', 'remap',
  'oscSine', 'oscSawtooth', 'oscTriangle', 'oscSquare',
  'normalLocal', 'normalWorld',
  'positionLocal', 'positionWorld',
  'cameraPosition'
]);

const LIVE_UTILITY_BINDINGS = Object.keys(TSLUtils)
  .filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name))
  .filter((name) => !BLOCKED_UTILITY_BINDINGS.has(name))
  .map((name) => `const ${name} = utils.${name};`)
  .join('\n');

export const DEFAULT_LIVE_CODE = `export const sketch = Fn(() => {
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

export function normalizeSketchSource(source: string): string {
  return source.replace(/\bexport\s+(?=(const|let|var|function|class)\b)/g, '');
}

export function compileProgram(source: string): LiveProgram {
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

export function tryCompile(source: string): { program: LiveProgram | null; error: string } {
  try {
    return { program: compileProgram(source), error: '' };
  } catch (error) {
    return {
      program: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function evaluateProgram(program: LiveProgram): unknown {
  const materialProxy: Record<string, unknown> = {
    colorNode: TSL.color('#1d33ff')
  };

  const result = program({
    THREE,
    TSL,
    material: materialProxy as unknown as THREE.MeshBasicNodeMaterial,
    params: liveParams as unknown as Record<string, unknown>,
    utils: TSLUtils as unknown as Record<string, unknown>
  });

  if (result?.sketch !== undefined) {
    if (typeof result.sketch !== 'function') {
      throw new Error('`sketch` must be declared as `export const sketch = Fn(() => { ... })`.');
    }
    return (result.sketch as () => unknown)();
  }

  return materialProxy.colorNode;
}
