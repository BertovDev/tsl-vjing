import { useSessionStore } from '../store/useSessionStore';

type RemoteEditorProps = {
  withMeta?: boolean;
  hint?: string;
  label?: string;
};

export function RemoteEditor({ withMeta = true, hint = 'Incoming shader from peer', label = 'Remote' }: RemoteEditorProps) {
  const remoteCode = useSessionStore((s) => s.remoteCode);
  const remoteError = useSessionStore((s) => s.remoteCompileError);

  return (
    <>
      <textarea id="remote-editor" readOnly value={remoteCode} spellCheck={false} />
      {withMeta && (
        <div className="meta">
          <span className={`state${remoteError ? ' error' : ''}`}>
            {remoteError ? 'Error' : label}
          </span>
          <span className="hint">{hint}</span>
        </div>
      )}
    </>
  );
}
