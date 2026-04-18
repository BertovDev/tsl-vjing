import { WebGPUCanvas } from '../components/WebGPUCanvas';
import { LiveSketchMesh } from '../components/LiveSketchMesh';
import { useLiveCompile } from '../hooks/useLiveCompile';
import { useB2BPeer } from '../hooks/useB2BPeer';
import { useTabSync } from '../hooks/useTabSync';
import { WorkspaceBar } from '../components/WorkspaceBar';
import { ShaderSidebar } from '../components/ShaderSidebar';
import { Panel } from '../components/Panel';
import { LiveEditor } from '../components/LiveEditor';
import { RemoteEditor } from '../components/RemoteEditor';
import { useSessionStore } from '../store/useSessionStore';

export function Studio() {
  const { programsRef, compileNow } = useLiveCompile();
  const { connect, disconnect, sendShader } = useB2BPeer();
  useTabSync({ mode: 'studio' });

  const onSend = () => {
    const code = useSessionStore.getState().localCode;
    sendShader(code);
  };

  return (
    <div className="workspace-shell">
      <WorkspaceBar onConnect={connect} onDisconnect={disconnect} onSend={onSend} />
      <div className="workspace-area">
        <ShaderSidebar />
        <div className="workspace-grid">
          <Panel
            id="local-code-panel"
            variant="panel-local-code"
            ledColor="cyan"
            title="OUR CODE"
            bodyClassName="panel-body panel-code-body"
          >
            <LiveEditor onForceCompile={() => compileNow('local')} />
          </Panel>

          <Panel
            id="remote-code-panel"
            variant="panel-remote-code"
            ledColor="amber"
            title="SENDER CODE"
            bodyClassName="panel-body panel-code-body"
          >
            <RemoteEditor />
          </Panel>

          <Panel
            id="local-preview-panel"
            variant="panel-local-preview"
            ledColor="silver"
            title="OUR SHADER"
            bodyClassName="panel-body panel-stage-body"
          >
            <WebGPUCanvas>
              <LiveSketchMesh programsRef={programsRef} target="preview" />
            </WebGPUCanvas>
          </Panel>

          <Panel
            id="output-panel"
            variant="panel-output"
            ledColor="green"
            title="SHADER OUTPUT"
            bodyClassName="panel-body panel-stage-body"
          >
            <WebGPUCanvas>
              <LiveSketchMesh programsRef={programsRef} target="output" />
            </WebGPUCanvas>
          </Panel>
        </div>
      </div>
    </div>
  );
}
