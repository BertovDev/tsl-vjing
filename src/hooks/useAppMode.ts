import { useMemo } from 'react';
import type { AppMode } from '../lib/types';

export function useAppMode(): AppMode {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('mode');
    if (raw === 'received' || raw === 'present' || raw === 'studio') return raw;
    return 'studio';
  }, []);
}
