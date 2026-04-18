# Project: TSL VJing Lab

## Overview
Hydra-style WebGPU livecoding sketch app for real-time VJ performances. Built with Three.js TSL (Three Shading Language) — no framework, vanilla TypeScript + Vite.

## Tech Stack
- **Three.js** (^0.183) — WebGPU renderer + TSL shading language
- **Vite** (^8.0) — Dev server + build
- **TypeScript** — Strict mode
- **WebRTC** — Peer-to-peer shader sync between 2 performers
- **WebSocket** — Signaling server (`signaling/server.mjs`)
- **No React/Next.js** — Pure DOM manipulation, raw HTML templates

## Architecture

### App Modes (`?mode=` query param)
- `studio` — Main editor: write shader code, connect to peer, send/receive shaders
- `received` — Read-only viewer: shows remote shader only
- `present` — Mix desk: fullscreen output with keyboard hotkeys

### Key Directories
```
src/
├── main.ts                    # All app logic (~945 lines)
├── network/webrtc_b2b.ts      # WebRTC peer connection (B2BPeer class)
├── tsl/                       # Reusable TSL shader building blocks
│   ├── noise/                 # simplex 3D, FBM
│   ├── distortion/            # wave, swirl, bulge
│   ├── utils/sdf/             # shapes, operations
│   ├── utils/color/           # cosine palette
│   └── utils/function/        # bloom, screen aspect UV, patterns
├── utils/math.ts              # Pure math helpers
└── webgpu/create_webgpu_stage.ts  # WebGPU renderer/scene/camera setup
signaling/server.mjs           # WebSocket signaling server (port 8787)
```

### Data Flow
- User types code → debounced compile (220ms) → `tryCompile()` → `applyShaderGraph()` → swaps `mesh.material.colorNode`
- Peer sync: WebRTC data channel sends shader code between performers
- Tab sync: `BroadcastChannel` syncs studio → received/present tabs

### TSL Shader Compilation
Shaders are TSL node graphs compiled at runtime via `new Function()`. TSL bindings (vec3, float, sin, noise, etc.) are injected into execution scope.

## Scripts
- `npm run dev` — Vite dev server (port 5173)
- `npm run dev:b2b` — Signaling server + Vite dev concurrently
- `npm run build` — TypeScript check + Vite build
- `npm run signal` — Signaling server only (port 8787)

## Important Notes
- Package manager: **npm** (not bun)
- No linter/formatter configured (no Biome/ESLint/Prettier)
- No Tailwind — plain CSS (`src/style.css`)
- `dist/` is committed (build output)
