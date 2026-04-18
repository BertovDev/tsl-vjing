import * as THREE from 'three/webgpu';
import { extend, type ThreeToJSXElements } from '@react-three/fiber';

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

// R3F catalog registration for three/webgpu classes (WebGPURenderer, NodeMaterials, etc.)
extend(THREE as unknown as Parameters<typeof extend>[0]);
