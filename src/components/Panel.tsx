import { useEffect, useRef, type ReactNode } from 'react';
import { usePanelStore, type PanelId } from '../store/usePanelStore';
import { PANEL_MIN_TOP } from '../lib/constants';

type PanelProps = {
  id: PanelId;
  /** CSS class for grid-area placement + visual variant. */
  variant: string;
  ledColor: 'cyan' | 'amber' | 'silver' | 'green';
  title: string;
  children: ReactNode;
  /** Body wrapper class — controls padding/overflow (code body vs stage body). */
  bodyClassName?: string;
};

/**
 * Reusable panel with draggable header, popout, and hide support.
 * Each panel reads its own slot from usePanelStore.
 */
export function Panel({ id, variant, ledColor, title, children, bodyClassName = 'panel-body' }: PanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panel = usePanelStore((s) => s.panels[id]);
  const bringToFront = usePanelStore((s) => s.bringToFront);
  const startFloating = usePanelStore((s) => s.startFloating);
  const setFloating = usePanelStore((s) => s.setFloating);
  const togglePopped = usePanelStore((s) => s.togglePopped);

  // Apply inline style for mode-specific geometry
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    if (panel.mode === 'docked' || panel.mode === 'hidden') {
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      el.style.right = '';
      el.style.bottom = '';
    } else if (panel.floating) {
      el.style.left = `${panel.floating.left}px`;
      el.style.top = `${panel.floating.top}px`;
      el.style.width = `${panel.floating.width}px`;
      el.style.height = `${panel.floating.height}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }

    el.style.zIndex = String(panel.z);
  }, [panel.mode, panel.floating, panel.z]);

  const onDragStart = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select')) return;
    const el = rootRef.current;
    if (!el) return;

    bringToFront(id);

    if (panel.mode === 'docked') {
      const rect = el.getBoundingClientRect();
      startFloating(id, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const originLeft = rect.left;
    const originTop = rect.top;

    document.body.classList.add('drag-preview');
    el.classList.add('dragging');

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const nextLeft = clamp(originLeft + dx, 12, window.innerWidth - w - 12);
      const nextTop = clamp(originTop + dy, PANEL_MIN_TOP, window.innerHeight - h - 12);
      el.style.left = `${nextLeft}px`;
      el.style.top = `${nextTop}px`;
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('drag-preview');
      el.classList.remove('dragging');
      const final = el.getBoundingClientRect();
      setFloating(id, {
        left: final.left,
        top: final.top,
        width: final.width,
        height: final.height
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const classes = ['panel', variant];
  if (panel.mode === 'floating') classes.push('panel-floating');
  if (panel.mode === 'popped') classes.push('panel-popped');
  if (panel.mode === 'hidden') classes.push('panel-hidden');

  return (
    <div
      ref={rootRef}
      id={id}
      className={classes.join(' ')}
      onPointerDown={() => bringToFront(id)}
    >
      <div className="panel-header" data-panel-drag onPointerDown={onDragStart}>
        <div className="panel-title">
          <span className={`panel-led${ledColor === 'cyan' ? '' : ` ${ledColor}`}`} />
          <span>{title}</span>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            data-panel-popout={id}
            onClick={() => {
              const el = rootRef.current;
              if (!el) return;
              togglePopped(id, () => {
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
              });
            }}
            aria-label={panel.mode === 'popped' ? 'Dock panel' : 'Pop out panel'}
          >
            {panel.mode === 'popped' ? '↙' : '↗'}
          </button>
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
