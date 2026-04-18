import { useEffect, useRef } from 'react';
import { tryCompile } from '../lib/liveCompile';
import { COMPILE_DEBOUNCE_MS } from '../lib/constants';
import { useSessionStore } from '../store/useSessionStore';
import type { LiveProgram } from '../lib/types';

export type ProgramsRef = { local: LiveProgram | null; remote: LiveProgram | null };

/**
 * Compiles local (debounced) and remote (immediate) code into LiveProgram
 * factories held in a ref. Bumps `compileVersion` so consumers can react
 * without putting non-serializable functions into state.
 *
 * Returns a `compileNow` imperative for the Cmd/Ctrl+Enter path.
 */
export function useLiveCompile() {
  const programsRef = useRef<ProgramsRef>({ local: null, remote: null });
  const debounceRef = useRef<number | null>(null);

  const compileLocal = (source: string) => {
    const { program, error } = tryCompile(source);
    if (!error) programsRef.current.local = program;
    useSessionStore.getState().setCompileError('local', error);
    useSessionStore.getState().bumpCompileVersion();
  };

  const compileRemote = (source: string) => {
    if (!source) {
      programsRef.current.remote = null;
      useSessionStore.getState().setCompileError('remote', '');
      useSessionStore.getState().bumpCompileVersion();
      return;
    }
    const { program, error } = tryCompile(source);
    if (!error) programsRef.current.remote = program;
    useSessionStore.getState().setCompileError('remote', error);
    useSessionStore.getState().bumpCompileVersion();
  };

  // Initial compile on mount
  useEffect(() => {
    const state = useSessionStore.getState();
    compileLocal(state.localCode);
    if (state.remoteCode) compileRemote(state.remoteCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced local recompile when localCode changes
  useEffect(() => {
    return useSessionStore.subscribe((s, prev) => {
      if (s.localCode === prev.localCode) return;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      const snapshot = s.localCode;
      debounceRef.current = window.setTimeout(() => {
        compileLocal(snapshot);
      }, COMPILE_DEBOUNCE_MS);
    });
  }, []);

  // Synchronous remote recompile (remote code arrives already debounced via peer)
  useEffect(() => {
    return useSessionStore.subscribe((s, prev) => {
      if (s.remoteCode === prev.remoteCode) return;
      compileRemote(s.remoteCode);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const compileNow = (kind: 'local' | 'remote') => {
    const state = useSessionStore.getState();
    if (kind === 'local') compileLocal(state.localCode);
    else compileRemote(state.remoteCode);
  };

  return { programsRef, compileNow };
}
