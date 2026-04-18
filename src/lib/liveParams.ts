import * as TSL from 'three/tsl';

export const liveParams = {
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
} as const;
