import { usePanelStore, type PanelId } from '../store/usePanelStore';

type DockToggleProps = {
  panelId: PanelId;
  label: string;
};

export function DockToggle({ panelId, label }: DockToggleProps) {
  const mode = usePanelStore((s) => s.panels[panelId].mode);
  const toggleHidden = usePanelStore((s) => s.toggleHidden);
  const bringToFront = usePanelStore((s) => s.bringToFront);

  const active = mode !== 'hidden';

  return (
    <button
      type="button"
      className={`dock-toggle${active ? '' : ' inactive'}`}
      data-toggle-panel={panelId}
      onClick={() => {
        toggleHidden(panelId);
        if (!active) bringToFront(panelId);
      }}
    >
      {label}
    </button>
  );
}
