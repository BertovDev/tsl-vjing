import { useSessionStore } from '../store/useSessionStore';
import type { ViewMode } from '../lib/types';
import type { CSSProperties } from 'react';

export function MixControls() {
  const viewMode = useSessionStore((s) => s.viewMode);
  const mixAmount = useSessionStore((s) => s.mixAmount);
  const setViewMode = useSessionStore((s) => s.setViewMode);
  const setMixAmount = useSessionStore((s) => s.setMixAmount);

  const mixStyle: CSSProperties = { ['--mix-pct' as string]: `${mixAmount * 100}%` };

  return (
    <div className="workspace-controls">
      <label>
        View
        <select
          id="view-mode"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as ViewMode)}
        >
          <option value="local">Local</option>
          <option value="remote">Remote</option>
          <option value="mix">Mix</option>
        </select>
      </label>
      <label>
        Mix
        <input
          id="mix-range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mixAmount}
          onChange={(e) => setMixAmount(Number(e.target.value))}
          style={mixStyle}
        />
        <span id="mix-value">{mixAmount.toFixed(2)}</span>
      </label>
    </div>
  );
}
