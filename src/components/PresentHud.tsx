import { useSessionStore } from '../store/useSessionStore';
import type { ViewMode } from '../lib/types';
import type { CSSProperties } from 'react';

type PresentHudProps = {
  onControl: (payload: { mixAmount?: number; viewMode?: ViewMode }) => void;
};

export function PresentHud({ onControl }: PresentHudProps) {
  const viewMode = useSessionStore((s) => s.viewMode);
  const mixAmount = useSessionStore((s) => s.mixAmount);
  const setViewMode = useSessionStore((s) => s.setViewMode);
  const setMixAmount = useSessionStore((s) => s.setMixAmount);
  const peerConnected = useSessionStore((s) => s.peerConnected);

  const mixStyle: CSSProperties = { ['--mix-pct' as string]: `${mixAmount * 100}%` };

  return (
    <div className="present-hud">
      <label>
        View
        <select
          id="present-view-mode"
          value={viewMode}
          onChange={(e) => {
            const next = e.target.value as ViewMode;
            setViewMode(next);
            onControl({ viewMode: next });
          }}
        >
          <option value="local">Local</option>
          <option value="remote">Remote</option>
          <option value="mix">Mix</option>
        </select>
      </label>
      <label>
        Mix
        <input
          id="present-mix-range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mixAmount}
          onChange={(e) => {
            const next = Number(e.target.value);
            setMixAmount(next);
            onControl({ mixAmount: next });
          }}
          style={mixStyle}
        />
        <span id="present-mix-value">{mixAmount.toFixed(2)}</span>
      </label>
      <span id="present-status">{peerConnected ? 'Live feed' : 'Waiting for studio'}</span>
    </div>
  );
}
