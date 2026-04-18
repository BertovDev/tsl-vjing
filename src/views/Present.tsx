import { useEffect } from 'react';
import { WebGPUCanvas } from '../components/WebGPUCanvas';
import { LiveSketchMesh } from '../components/LiveSketchMesh';
import { useLiveCompile } from '../hooks/useLiveCompile';
import { useTabSync } from '../hooks/useTabSync';
import { useSessionStore } from '../store/useSessionStore';
import { PresentHud } from '../components/PresentHud';
import { CodeOverlay } from '../components/CodeOverlay';

const MIX_STEP = 0.02;

export function Present() {
  const { programsRef } = useLiveCompile();
  const { publishControl } = useTabSync({ mode: 'present' });

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const store = useSessionStore.getState();
      if (ev.key === 'ArrowLeft') {
        const next = Math.max(0, store.mixAmount - MIX_STEP);
        store.setMixAmount(next);
        publishControl({ mixAmount: next });
      } else if (ev.key === 'ArrowRight') {
        const next = Math.min(1, store.mixAmount + MIX_STEP);
        store.setMixAmount(next);
        publishControl({ mixAmount: next });
      } else if (ev.key === '1') {
        store.setViewMode('local');
        publishControl({ viewMode: 'local' });
      } else if (ev.key === '2') {
        store.setViewMode('mix');
        publishControl({ viewMode: 'mix' });
      } else if (ev.key === '3') {
        store.setViewMode('remote');
        publishControl({ viewMode: 'remote' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [publishControl]);

  return (
    <div className="present-root">
      <WebGPUCanvas>
        <LiveSketchMesh programsRef={programsRef} target="output" />
      </WebGPUCanvas>
      <PresentHud onControl={publishControl} />
      <div className="present-code-layer">
        <CodeOverlay kind="local" />
        <CodeOverlay kind="remote" />
      </div>
    </div>
  );
}
