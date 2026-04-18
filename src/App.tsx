import { useEffect } from 'react';
import './lib/extendR3F';
import { useAppMode } from './hooks/useAppMode';
import { Fallback } from './components/Fallback';
import { Studio } from './views/Studio';
import { Received } from './views/Received';
import { Present } from './views/Present';

const supportsWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

export function App() {
  const mode = useAppMode();

  useEffect(() => {
    document.body.dataset.mode = mode;
    return () => {
      delete document.body.dataset.mode;
    };
  }, [mode]);

  if (!supportsWebGPU) return <Fallback />;

  if (mode === 'received') return <Received />;
  if (mode === 'present') return <Present />;
  return <Studio />;
}
