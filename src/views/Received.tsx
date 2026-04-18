import { WebGPUCanvas } from '../components/WebGPUCanvas';
import { LiveSketchMesh } from '../components/LiveSketchMesh';
import { useLiveCompile } from '../hooks/useLiveCompile';
import { useTabSync } from '../hooks/useTabSync';
import { RemoteEditor } from '../components/RemoteEditor';
import { useSessionStore } from '../store/useSessionStore';

export function Received() {
  const { programsRef } = useLiveCompile();
  useTabSync({ mode: 'received' });

  const peerConnected = useSessionStore((s) => s.peerConnected);

  return (
    <div className="received-root">
      <WebGPUCanvas>
        <LiveSketchMesh programsRef={programsRef} target="output" forceRenderMode="remote" />
      </WebGPUCanvas>
      <div className="viewer-hud">REMOTE SHADER VIEW</div>
      <div className="editor-overlay received">
        <RemoteEditor withMeta={false} />
        <div className="meta">
          <span id="viewer-status" className="state">
            {peerConnected ? 'Live feed' : 'Waiting for studio tab…'}
          </span>
          <span className="hint">Visualizer + incoming code</span>
        </div>
      </div>
    </div>
  );
}
