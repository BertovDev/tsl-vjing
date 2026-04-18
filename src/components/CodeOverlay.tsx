import { useSessionStore } from '../store/useSessionStore';

type CodeOverlayProps = {
  kind: 'local' | 'remote';
};

export function CodeOverlay({ kind }: CodeOverlayProps) {
  const code = useSessionStore((s) => (kind === 'local' ? s.localCode : s.remoteCode));
  const label = kind === 'local' ? 'LOCAL' : 'REMOTE';

  return (
    <div className={`present-code-side present-code-${kind}`}>
      <div className="present-code-label">{label}</div>
      <pre className="present-code">{code || '// empty'}</pre>
    </div>
  );
}
