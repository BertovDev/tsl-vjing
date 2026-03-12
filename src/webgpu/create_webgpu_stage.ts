import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// WebGPU stage setup inspired by fragments-boilerplate's WebGPU scene + sketch pattern:
// orthographic camera, fullscreen plane mesh, and NodeMaterial-first workflow.
export async function createWebGPUStage(container: HTMLElement): Promise<{
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
}> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  container.appendChild(renderer.domElement);
  await renderer.init();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(0, 0, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = TSL.color('#1e2fff');

  // Fullscreen effects are mostly fragment-driven; keep geometry cheap for realtime VJing.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), material);
  scene.add(mesh);

  return { renderer, scene, camera, mesh };
}
