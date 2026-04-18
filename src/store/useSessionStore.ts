import { create } from 'zustand';
import { DEFAULT_LIVE_CODE } from '../lib/liveCompile';
import type { ViewMode } from '../lib/types';

export type RemoteNotice = { text: string; at: number };

export type SessionState = {
  localCode: string;
  remoteCode: string;
  localCompileError: string;
  remoteCompileError: string;
  mixAmount: number;
  viewMode: ViewMode;
  peerConnected: boolean;
  peerId: string | null;
  signalStatus: string;
  remoteNotice: RemoteNotice | null;
  compileVersion: number;

  setLocalCode: (code: string, opts?: { silent?: boolean }) => void;
  setRemoteCode: (code: string, opts?: { silent?: boolean }) => void;
  setCompileError: (kind: 'local' | 'remote', err: string) => void;
  setMixAmount: (value: number) => void;
  setViewMode: (value: ViewMode) => void;
  setPeerState: (connected: boolean, peerId: string | null) => void;
  setSignalStatus: (text: string) => void;
  fireRemoteNotice: (text: string) => void;
  bumpCompileVersion: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  localCode: DEFAULT_LIVE_CODE,
  remoteCode: '',
  localCompileError: '',
  remoteCompileError: '',
  mixAmount: 0.5,
  viewMode: 'local',
  peerConnected: false,
  peerId: null,
  signalStatus: '',
  remoteNotice: null,
  compileVersion: 0,

  setLocalCode: (code) => set({ localCode: code }),
  setRemoteCode: (code) => set({ remoteCode: code }),
  setCompileError: (kind, err) =>
    set(
      kind === 'local' ? { localCompileError: err } : { remoteCompileError: err }
    ),
  setMixAmount: (value) => set({ mixAmount: clamp01(value) }),
  setViewMode: (value) => set({ viewMode: value }),
  setPeerState: (connected, peerId) => set({ peerConnected: connected, peerId }),
  setSignalStatus: (text) => set({ signalStatus: text }),
  fireRemoteNotice: (text) => set({ remoteNotice: { text, at: Date.now() } }),
  bumpCompileVersion: () =>
    set((state) => ({ compileVersion: state.compileVersion + 1 }))
}));

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
