import { useRef, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

type WebGPUCanvasProps = {
  children?: ReactNode;
  className?: string;
};

/**
 * Fullscreen-plane R3F canvas backed by WebGPURenderer. Orthographic
 * (-1..1) so a PlaneGeometry(2,2) fills the viewport exactly.
 */
export function WebGPUCanvas({ children, className }: WebGPUCanvasProps) {
  const disposedRef = useRef(false);

  return (
    <div className={className ?? 'stage'}>
      <Canvas
        dpr={[1, 1.25]}
        orthographic
        camera={{
          left: -1,
          right: 1,
          top: 1,
          bottom: -1,
          near: 0.01,
          far: 10,
          zoom: 1,
          position: [0, 0, 1]
        }}
        gl={async (props) => {
          const canvas = props.canvas as HTMLCanvasElement;
          const renderer = new THREE.WebGPURenderer({
            canvas,
            antialias: false,
            powerPreference: 'high-performance'
          });
          if (disposedRef.current) {
            renderer.dispose();
            throw new Error('webgpu canvas disposed before init');
          }
          await renderer.init();
          return renderer;
        }}
        onCreated={() => {
          disposedRef.current = false;
        }}
      >
        <color attach="background" args={['#02040a']} />
        {children}
      </Canvas>
    </div>
  );
}
