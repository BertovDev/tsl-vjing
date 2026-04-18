import { useLayoutEffect, useRef, type RefObject } from 'react';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { evaluateProgram } from '../lib/liveCompile';
import { useSessionStore } from '../store/useSessionStore';
import type { LiveProgram, ViewMode } from '../lib/types';

export type ProgramsRef = RefObject<{ local: LiveProgram | null; remote: LiveProgram | null }>;

type LiveSketchMeshProps = {
  programsRef: ProgramsRef;
  /** 'output' honors viewMode + mix; 'preview' always renders local only. */
  target: 'output' | 'preview';
  /** If set, overrides the store's viewMode for output target (e.g. received → 'remote'). */
  forceRenderMode?: ViewMode;
};

const FALLBACK_NODE = TSL.color('#111733');

/**
 * Fullscreen plane whose material colorNode is hot-swapped whenever
 * the compiled programs, view mode, or mix amount change.
 */
export function LiveSketchMesh({ programsRef, target, forceRenderMode }: LiveSketchMeshProps) {
  const materialRef = useRef<THREE.MeshBasicNodeMaterial>(null);
  const compileVersion = useSessionStore((s) => s.compileVersion);
  const viewMode = useSessionStore((s) => s.viewMode);
  const mixAmount = useSessionStore((s) => s.mixAmount);

  useLayoutEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    const programs = programsRef.current;
    let localNode: unknown = null;
    let remoteNode: unknown = null;
    let runtimeError = '';

    try {
      if (programs.local) localNode = evaluateProgram(programs.local);
    } catch (err) {
      runtimeError = err instanceof Error ? err.message : String(err);
    }

    try {
      if (programs.remote) remoteNode = evaluateProgram(programs.remote);
    } catch (err) {
      runtimeError = err instanceof Error ? err.message : String(err);
    }

    let nextNode: unknown = FALLBACK_NODE;

    if (target === 'preview') {
      nextNode = localNode ?? remoteNode ?? FALLBACK_NODE;
    } else {
      const renderMode: ViewMode = forceRenderMode ?? viewMode;
      if (renderMode === 'local') {
        nextNode = localNode ?? remoteNode ?? FALLBACK_NODE;
      } else if (renderMode === 'remote') {
        nextNode = remoteNode ?? localNode ?? FALLBACK_NODE;
      } else if (localNode && remoteNode) {
        nextNode = TSL.mix(
          localNode as Parameters<typeof TSL.mix>[0],
          remoteNode as Parameters<typeof TSL.mix>[1],
          TSL.float(mixAmount)
        );
      } else {
        nextNode = localNode ?? remoteNode ?? FALLBACK_NODE;
      }
    }

    mat.colorNode = nextNode as THREE.MeshBasicNodeMaterial['colorNode'];
    mat.needsUpdate = true;

    if (runtimeError && !useSessionStore.getState().localCompileError) {
      useSessionStore.getState().setCompileError('local', runtimeError);
    }
  }, [compileVersion, viewMode, mixAmount, target, forceRenderMode, programsRef]);

  return (
    <mesh>
      <planeGeometry args={[2, 2, 1, 1]} />
      <meshBasicNodeMaterial ref={materialRef} />
    </mesh>
  );
}
