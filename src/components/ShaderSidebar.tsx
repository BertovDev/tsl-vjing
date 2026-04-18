const PRESETS = [
  { name: 'sphere_rings', duration: 'live' },
  { name: 'plasma_field' },
  { name: 'voronoi_drift' },
  { name: 'fbm_terrain' },
  { name: 'bloom_spiral' },
  { name: 'tunnel_warp' },
  { name: 'kaleid_noise' },
  { name: 'liquid_chrome' },
  { name: 'dot_matrix' },
  { name: 'aurora_bands' }
] as const;

export function ShaderSidebar() {
  return (
    <aside className="shader-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-header-led" />
        SHADERS
      </div>
      <ul className="shader-list" role="listbox">
        {PRESETS.map((preset, idx) => {
          const active = idx === 0;
          return (
            <li
              key={preset.name}
              className={`shader-item${active ? ' shader-item-active' : ''}`}
              role="option"
              aria-selected={active}
            >
              <span className="shader-item-dot" />
              <span className="shader-item-name">{preset.name}</span>
              {'duration' in preset && (
                <span className="shader-item-duration">{preset.duration}</span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
