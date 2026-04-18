import { useState } from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { MixControls } from './MixControls';
import { DockToggle } from './DockToggle';
import { RemoteNotice } from './RemoteNotice';

type WorkspaceBarProps = {
  onConnect: (roomId: string) => void;
  onDisconnect: () => void;
  onSend: () => void;
};

export function WorkspaceBar({ onConnect, onDisconnect, onSend }: WorkspaceBarProps) {
  const [roomId, setRoomId] = useState('b2b-room');
  const peerConnected = useSessionStore((s) => s.peerConnected);
  const peerId = useSessionStore((s) => s.peerId);
  const signalStatus = useSessionStore((s) => s.signalStatus);

  return (
    <div className="workspace-bar">
      <div className="workspace-brand">TSL B2B Terminal</div>
      <div className="workspace-controls">
        <input
          id="room-id"
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="room id"
        />
        {!peerConnected && (
          <button id="connect-btn" type="button" onClick={() => onConnect(roomId)}>
            Connect
          </button>
        )}
        {peerConnected && (
          <button id="disconnect-btn" type="button" onClick={onDisconnect}>
            Disconnect
          </button>
        )}
        <button id="send-btn" type="button" className="btn-primary" onClick={onSend}>
          Send Shader
        </button>
        <button
          id="open-received-btn"
          type="button"
          onClick={() => window.open(`${window.location.pathname}?mode=received`, '_blank')}
        >
          Open Received Tab
        </button>
        <button
          id="open-present-btn"
          type="button"
          onClick={() => window.open(`${window.location.pathname}?mode=present`, '_blank')}
        >
          Open Mix Output
        </button>
      </div>
      <MixControls />
      <div className="workspace-dock">
        <DockToggle panelId="local-code-panel" label="Our Code" />
        <DockToggle panelId="remote-code-panel" label="Sender Code" />
        <DockToggle panelId="output-panel" label="Shader Output" />
        <DockToggle panelId="local-preview-panel" label="Our Shader" />
      </div>
      <div className="workspace-status">
        <span id="peer-state" className={peerConnected ? 'connected' : ''}>
          {peerConnected ? `Peer connected${peerId ? ` (${peerId})` : ''}` : 'Peer offline'}
        </span>
        <span id="signal-state">{signalStatus || 'Signal idle'}</span>
        <RemoteNotice />
      </div>
    </div>
  );
}
