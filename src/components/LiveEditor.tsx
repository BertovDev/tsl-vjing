import { useSessionStore } from '../store/useSessionStore';

type LiveEditorProps = {
  onForceCompile: () => void;
};

export function LiveEditor({ onForceCompile }: LiveEditorProps) {
  const localCode = useSessionStore((s) => s.localCode);
  const localError = useSessionStore((s) => s.localCompileError);
  const setLocalCode = useSessionStore((s) => s.setLocalCode);

  return (
    <>
      <textarea
        id="live-editor"
        spellCheck={false}
        value={localCode}
        onChange={(e) => setLocalCode(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onForceCompile();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const target = e.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const next = target.value.slice(0, start) + '  ' + target.value.slice(end);
            setLocalCode(next);
            requestAnimationFrame(() => {
              target.selectionStart = target.selectionEnd = start + 2;
            });
          }
        }}
      />
      <pre id="compile-errors" className="errors" aria-live="polite">
        {localError}
      </pre>
      <div className="meta">
        <span id="compile-state" className={`state${localError ? ' error' : ' ok'}`}>
          {localError ? 'Error' : 'Compiled'}
        </span>
        <span className="hint">export const sketch = Fn(() =&gt; ...)</span>
      </div>
    </>
  );
}
