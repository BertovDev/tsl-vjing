import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { TAB_CHANNEL_NAME } from '../lib/constants';
import type { AppMode, SyncState, TabMessage, ViewMode } from '../lib/types';

const ORIGIN_ID = (() => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
})();

type UseTabSyncArgs = {
  mode: AppMode;
};

/**
 * BroadcastChannel bridge. Studio broadcasts `state`; received/present
 * request state on mount; present can emit `control` messages that
 * studio applies and re-broadcasts.
 */
export function useTabSync({ mode }: UseTabSyncArgs) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const skipBroadcastRef = useRef(false);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(TAB_CHANNEL_NAME);
    channelRef.current = channel;

    const applyIncomingState = (state: SyncState, forceRemoteView: boolean) => {
      skipBroadcastRef.current = true;
      const store = useSessionStore.getState();
      store.setLocalCode(state.localCode);
      store.setRemoteCode(state.remoteCode);
      store.setMixAmount(state.mixAmount);
      store.setViewMode(forceRemoteView ? 'remote' : state.viewMode);
      queueMicrotask(() => {
        skipBroadcastRef.current = false;
      });
    };

    channel.onmessage = (ev: MessageEvent<TabMessage>) => {
      const msg = ev.data;
      if (!msg || msg.originId === ORIGIN_ID) return;

      if (mode === 'studio') {
        if (msg.type === 'request-state') {
          publishState(channel);
        } else if (msg.type === 'control') {
          skipBroadcastRef.current = true;
          const store = useSessionStore.getState();
          if (typeof msg.payload.mixAmount === 'number') {
            store.setMixAmount(msg.payload.mixAmount);
          }
          if (msg.payload.viewMode) {
            store.setViewMode(msg.payload.viewMode);
          }
          queueMicrotask(() => {
            skipBroadcastRef.current = false;
            publishState(channel);
          });
        }
        return;
      }

      if (msg.type === 'state') {
        applyIncomingState(msg.state, mode === 'received');
      }
    };

    // Studio broadcasts fresh state on every relevant change.
    let unsubscribe: (() => void) | null = null;
    if (mode === 'studio') {
      unsubscribe = useSessionStore.subscribe((s, prev) => {
        if (skipBroadcastRef.current) return;
        if (
          s.localCode === prev.localCode &&
          s.remoteCode === prev.remoteCode &&
          s.mixAmount === prev.mixAmount &&
          s.viewMode === prev.viewMode
        ) {
          return;
        }
        publishState(channel);
      });
    }

    // Non-studio tabs request the current state on mount.
    if (mode !== 'studio') {
      channel.postMessage({ type: 'request-state', originId: ORIGIN_ID } satisfies TabMessage);
    }

    return () => {
      unsubscribe?.();
      channel.close();
      channelRef.current = null;
    };
  }, [mode]);

  const publishControl = (payload: { mixAmount?: number; viewMode?: ViewMode }) => {
    const channel = channelRef.current;
    if (!channel) return;
    channel.postMessage({ type: 'control', payload, originId: ORIGIN_ID } satisfies TabMessage);
  };

  return { publishControl };
}

function publishState(channel: BroadcastChannel) {
  const s = useSessionStore.getState();
  const state: SyncState = {
    localCode: s.localCode,
    remoteCode: s.remoteCode,
    mixAmount: s.mixAmount,
    viewMode: s.viewMode
  };
  channel.postMessage({ type: 'state', state, originId: ORIGIN_ID } satisfies TabMessage);
}
