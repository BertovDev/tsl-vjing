import { useEffect, useRef } from 'react';
import { B2BPeer } from '../network/webrtc_b2b';
import { SIGNALING_URL } from '../lib/constants';
import { useSessionStore } from '../store/useSessionStore';

export function useB2BPeer() {
  const peerRef = useRef<B2BPeer | null>(null);

  useEffect(() => {
    const peer = new B2BPeer({
      onStatus: (text) => {
        useSessionStore.getState().setSignalStatus(text);
      },
      onPeerState: (connected, peerId) => {
        useSessionStore.getState().setPeerState(connected, peerId);
      },
      onRemoteShader: (code) => {
        useSessionStore.getState().setRemoteCode(code);
        useSessionStore.getState().fireRemoteNotice('Remote shader updated');
      }
    });
    peerRef.current = peer;
    return () => {
      peer.disconnect();
      peerRef.current = null;
    };
  }, []);

  const connect = (roomId: string) => {
    peerRef.current?.connect(roomId, SIGNALING_URL);
  };

  const disconnect = () => {
    peerRef.current?.disconnect();
  };

  const sendShader = (code: string): boolean => {
    if (!peerRef.current) return false;
    const ok = peerRef.current.sendShader(code);
    if (!ok) {
      useSessionStore.getState().setSignalStatus('Send failed — peer offline');
    }
    return ok;
  };

  return { connect, disconnect, sendShader };
}
