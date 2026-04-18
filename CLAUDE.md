# Project: TSL VJing Lab

## Overview
Hydra-style WebGPU livecoding sketch app for real-time VJ performances. Built with Three.js TSL (Three Shading Language) rendered through React Three Fiber.

## Tech Stack
- **React 19** + **React Three Fiber 9** — declarative WebGPU canvas
- **Three.js** (^0.184) — WebGPU renderer + TSL shading language
- **Zustand** — State management (session + panel stores)
- **Vite** (^8.0) — Dev server + build
- **TypeScript** — Strict mode, `noUncheckedIndexedAccess`
- **WebRTC** — Peer-to-peer shader sync between 2 performers
- **WebSocket** — Signaling server (`signaling/server.mjs`)

## Architecture

### App Modes (`?mode=` query param)
- `studio` — WMP-style workspace: 4-panel grid (editor, remote editor, preview canvas, output canvas) + top bar + sidebar
- `received` — Read-only viewer: shows remote shader only
- `present` — Mix desk: fullscreen output with HUD, mix slider, code overlays, keyboard hotkeys (←/→ mix, 1/2/3 view)

### Directory Layout
```
src/
├── main.tsx                    # ReactDOM entry
├── App.tsx                     # Mode router
├── views/{Studio,Received,Present}.tsx
├── components/                 # UI components (Panel, LiveEditor, WorkspaceBar, etc.)
├── hooks/                      # useLiveCompile, useShaderGraph, useB2BPeer, useTabSync, useAppMode
├── store/                      # Zustand stores (session, panels)
├── lib/                        # constants, types, liveCompile, liveParams, extendR3F
├── network/webrtc_b2b.ts       # WebRTC peer connection (B2BPeer class)
├── tsl/                        # Reusable TSL shader building blocks (noise, SDF, color, etc.)
├── utils/math.ts               # Pure math helpers
└── webgpu/create_webgpu_stage.ts  # Legacy imperative stage factory (not used by React path)
signaling/server.mjs            # WebSocket signaling server (port 8787)
```

### Rendering
R3F's `<Canvas>` owns the `WebGPURenderer` via an async `gl` factory. Each canvas runs an independent render loop. Studio mounts two canvases (output + local preview). `LiveSketchMesh` mutates `material.colorNode` in a `useLayoutEffect` when compiled programs change — no mesh/material re-creation.

### Data Flow
- User types → Zustand `localCode` → `useLiveCompile` debounces 220 ms → `tryCompile()` → `programsRef.current.local` + `compileVersion` bump → `LiveSketchMesh` swaps `material.colorNode`.
- Peer sync: `useB2BPeer` owns the WebRTC peer; remote shader arrives → `setRemoteCode` → immediate recompile → output updates.
- Tab sync: `useTabSync` bridges `BroadcastChannel` ↔ store. Studio broadcasts `state`; viewers request state on mount; present emits `control` payloads that studio applies and re-broadcasts.

### TSL Shader Compilation
Shaders are TSL node graphs compiled at runtime via `new Function()` in `src/lib/liveCompile.ts`. TSL primitives (vec3, float, sin, noise, etc.) and helpers from `src/tsl/**` are injected into the execution scope through a generated `LIVE_UTILITY_BINDINGS` preamble.

## Scripts
- `bun run dev` — Vite dev server (port 5173)
- `bun run dev:b2b` — Signaling server + Vite dev concurrently
- `bun run build` — TypeScript check + Vite build
- `bun run signal` — Signaling server only (port 8787)

## Important Notes
- Package manager: **bun**
- No linter/formatter configured (no Biome/ESLint/Prettier)
- No Tailwind — plain CSS (`src/style.css`); design tokens live in `:root`
- `dist/` is committed (build output)
