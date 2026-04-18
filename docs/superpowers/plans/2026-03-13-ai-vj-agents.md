# AI VJ Agents Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `?mode=agent` — an autonomous LLM-powered browser tab that generates TSL shaders via Claude API, syncs with a peer agent over WebRTC, and publishes state for the present tab.

**Architecture:** New `agent` app mode reuses existing B2BPeer + BroadcastChannel. A generation loop calls Claude API through a proxy endpoint on the signaling server. Two agent tabs connect via WebRTC, react to each other's shaders, and a present tab shows the crossfaded mix.

**Tech Stack:** TypeScript, Three.js TSL, WebRTC, BroadcastChannel, Node.js http server. (Uses raw `fetch` to call Claude API — no `@anthropic-ai/sdk` dependency needed. Spec deviation: simpler, no extra dependency.)

**Spec:** `docs/superpowers/specs/2026-03-13-ai-vj-agents-design.md`

---

## Chunk 1: Infrastructure Changes

### Task 1: Expose `isCaller` on B2BPeer

**Files:**
- Modify: `src/network/webrtc_b2b.ts`

The `caller` boolean is currently a parameter of `ensurePeerConnection()` (line 150) and a local in `handleSignal()` (line 238). We need a public getter so agent mode can determine who publishes to BroadcastChannel.

- [ ] **Step 1: Add `isCaller` property to B2BPeer**

In `src/network/webrtc_b2b.ts`, add a private field and public getter. The field is set to `true` in `startCallerFlow()` (line 217) and derived in `handleSignal()` (line 238).

Add after the existing private fields (around line 18):

```typescript
private _isCaller = false;
```

Add a public getter after the existing `get connected()` (around line 30):

```typescript
get isCaller(): boolean {
  return this._isCaller;
}
```

Set it in `startCallerFlow()` before `ensurePeerConnection`:

```typescript
this._isCaller = true;
```

Set it in `handleSignal()` where `const caller = data.type !== 'offer'` is computed (line 238):

```typescript
this._isCaller = caller;
```

Reset in `disconnect()`:

```typescript
this._isCaller = false;
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No errors related to `_isCaller` or `isCaller`.

- [ ] **Step 3: Commit**

```bash
git add src/network/webrtc_b2b.ts
git commit -m "feat: expose isCaller getter on B2BPeer"
```

---

### Task 2: Restructure signaling server to support HTTP

**Files:**
- Modify: `signaling/server.mjs`

Currently the server creates a bare `WebSocketServer({ port: PORT })` (line 6). We need to wrap it in an `http.Server` so we can handle both WebSocket upgrades and HTTP POST requests.

- [ ] **Step 1: Read the current signaling server**

Read `signaling/server.mjs` fully to understand the current structure before modifying.

- [ ] **Step 2: Restructure to http.Server + attached WSS**

Replace the server creation. The WebSocket logic stays identical — only the server bootstrap changes.

At the top of the file, add:

```javascript
import http from 'node:http';
```

Replace the bare WSS creation:

```javascript
// OLD: const wss = new WebSocketServer({ port: PORT });
// NEW:
const server = http.createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
```

Replace the `wss.on('listening', ...)` at the bottom with:

```javascript
server.listen(PORT, () => {
  console.log(`signaling server listening on :${PORT}`);
});
```

- [ ] **Step 3: Add the HTTP request handler with CORS**

Add `handleHttpRequest` function before the server creation. This handles `POST /api/generate-shader` and CORS preflight:

```javascript
async function handleHttpRequest(req, res) {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/generate-shader
  if (req.method === 'POST' && req.url === '/api/generate-shader') {
    try {
      const body = await readBody(req);
      const { messages, apiKey, system } = JSON.parse(body);

      if (!apiKey || !messages) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing apiKey or messages' }));
        return;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: system || undefined,
          messages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: data.error?.message || 'API error', status: response.status }));
        return;
      }

      // Extract text content from Claude response
      const textBlock = data.content?.find(b => b.type === 'text');
      const code = textBlock?.text || '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
```

Note: We use raw `fetch` to call the Claude API instead of importing `@anthropic-ai/sdk`. This avoids adding a dependency — Node 18+ has built-in fetch. The signaling server is a simple .mjs script that shouldn't need an SDK.

- [ ] **Step 4: Verify the server starts**

Run: `node signaling/server.mjs`
Expected: "signaling server listening on :8787" with no errors.
Kill the process after verifying.

- [ ] **Step 5: Commit**

```bash
git add signaling/server.mjs
git commit -m "feat: restructure signaling server to support HTTP endpoints"
```

---

### Task 3: Add `agent` to AppMode type system

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update the AppMode type**

At line 12, change:

```typescript
// OLD
type AppMode = 'studio' | 'received' | 'present';

// NEW
type AppMode = 'studio' | 'received' | 'present' | 'agent';
```

- [ ] **Step 2: Update resolveAppMode()**

At lines 857-862, add recognition for `'agent'`:

```typescript
function resolveAppMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'received') return 'received';
  if (mode === 'present') return 'present';
  if (mode === 'agent') return 'agent';
  return 'studio';
}
```

- [ ] **Step 3: Add agent case to the mode branching in boot()**

At lines 414-419, add the agent branch. For now, just a placeholder that we'll wire up in Task 7:

```typescript
  if (appMode === 'studio') {
    bindStudioEvents();
    publishState();
  } else if (appMode === 'present') {
    bindPresentEvents();
  } else if (appMode === 'agent') {
    // Wired up in Task 7
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: add agent to AppMode type and mode resolution"
```

---

## Chunk 2: Agent Modules

### Task 4: Create the prompt module

**Files:**
- Create: `src/agent/prompt.ts`

This module builds the system prompt and per-cycle user messages for the Claude API.

- [ ] **Step 1: Create `src/agent/prompt.ts`**

```typescript
/**
 * Prompt templates for AI VJ agent shader generation.
 */

export interface GenerationEntry {
  mine: string;
  theirs: string;
  cycle: number;
}

const SYSTEM_PROMPT = `You are an AI VJ (visual jockey) performing in a live jam session. You write shaders using Three.js TSL (Three Shading Language).

## Output Format
Return ONLY valid shader code. No explanations, no markdown, no backticks. The code must define:

export const sketch = Fn(() => {
  // ... your TSL code here
  return someColorNode; // must return a vec3 or vec4 node
});

## Available Bindings (automatically in scope)
From TSL:
  Fn, If, Loop,
  float, int, vec2, vec3, vec4, color,
  time, deltaTime, uv, screenSize,
  sin, cos, tan, atan, mix, smoothstep, saturate,
  abs, min, max, clamp, length, normalize, dot, cross,
  mod, fract, step, pow, remap,
  oscSine, oscSawtooth, oscTriangle, oscSquare,
  normalLocal, normalWorld, positionLocal, positionWorld, cameraPosition

From utility library (also in scope):
  Noise: simplexNoise3d, fbm, ridgedFbm, domainWarpedFbm, warpedFbmCoords
  SDF Shapes: sdSphere, sdBox2d, sdBox3d, sdDiamond, sdHexagon, sdEquilateralTriangle, sdLine, sdRing, sdParallelogram, sdRhombus, sdTriangle
  SDF Ops: smin, smax
  Color: cosinePalette(t, a, b, c, d, e?)
  Distortion: waveDistortion, swirlDistortion, bulgeDistortion
  Functions: screenAspectUV, bloom, repeatingPattern, bloomEdgePattern, domainIndex

## Creative Guidelines
- Create visually interesting, animated shaders
- Use time for animation
- Use uv() for spatial coordinates (0 to 1 range)
- Use screenAspectUV() for aspect-corrected coordinates
- Combine noise, SDF shapes, color palettes, and distortions creatively
- Evolve your style gradually — don't jump to completely different aesthetics each generation
- When reacting to your partner's shader, find complementary or contrasting elements

## Example Shader
export const sketch = Fn(() => {
  const p = screenAspectUV();
  const n = fbm(vec3(p.mul(3.0), time.mul(0.3)));
  const col = cosinePalette(n.add(time.mul(0.1)),
    vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.2)
  );
  return col;
});`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserMessage(opts: {
  agentId: 'A' | 'B';
  cycle: number;
  myShader: string | null;
  theirShader: string | null;
  history: GenerationEntry[];
}): string {
  const parts: string[] = [];

  parts.push(\`You are Agent \${opts.agentId} in a live VJ jam session. Generation #\${opts.cycle}.\`);

  if (opts.myShader) {
    parts.push(\`\\nYour current shader:\\n\${opts.myShader}\`);
  } else {
    parts.push('\\nYou have no current shader yet. Create your first one.');
  }

  if (opts.theirShader) {
    parts.push(\`\\nYour partner's current shader:\\n\${opts.theirShader}\`);
  } else {
    parts.push('\\nYour partner has not sent a shader yet. Create something on your own.');
  }

  if (opts.history.length > 0) {
    parts.push('\\nRecent history (for creative continuity):');
    for (const entry of opts.history) {
      parts.push(\`  Gen #\${entry.cycle}: you wrote \${entry.mine.slice(0, 80)}...\`);
    }
  }

  parts.push('\\nCreate a new shader that evolves your visual direction while responding to your partner\\'s aesthetic. Return ONLY the shader code.');

  return parts.join('\\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/prompt.ts
git commit -m "feat: add prompt module for AI VJ agent"
```

---

### Task 5: Create the agent UI module

**Files:**
- Create: `src/agent/ui.ts`

Renders the setup screen (API key, room ID, start button) and the running overlay (status, gen counter, stop button).

- [ ] **Step 1: Create `src/agent/ui.ts`**

```typescript
/**
 * Agent mode UI — setup screen and running overlay.
 */

export interface AgentConfig {
  apiKey: string;
  roomId: string;
}

export interface StatusOverlay {
  update(state: { connection: string; generation: number; status: string }): void;
  onStop(callback: () => void): void;
  destroy(): void;
}

const STORAGE_KEY_API = 'tsl-vjing-api-key';

export function renderSetupScreen(
  container: HTMLElement,
  onStart: (config: AgentConfig) => void
): { destroy: () => void } {
  const roomParam = new URLSearchParams(window.location.search).get('room')
    || Math.random().toString(36).slice(2, 6);
  const savedKey = localStorage.getItem(STORAGE_KEY_API) || '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: #000; z-index: 100;
    font-family: monospace; color: #fff;
  `;

  wrapper.innerHTML = `
    <div style="background: #111; border: 1px solid #333; border-radius: 8px;
                padding: 32px; width: 320px; display: flex; flex-direction: column; gap: 16px;">
      <h2 style="margin: 0; font-size: 16px; color: #0f0;">AI VJ Agent</h2>
      <label style="font-size: 12px; color: #888;">
        Anthropic API Key
        <input id="agent-api-key" type="password" value="${savedKey}"
          style="width: 100%; margin-top: 4px; padding: 8px; background: #000;
                 border: 1px solid #444; border-radius: 4px; color: #fff;
                 font-family: monospace; font-size: 13px; box-sizing: border-box;" />
      </label>
      <label style="font-size: 12px; color: #888;">
        Room ID
        <input id="agent-room-id" type="text" value="${roomParam}"
          style="width: 100%; margin-top: 4px; padding: 8px; background: #000;
                 border: 1px solid #444; border-radius: 4px; color: #fff;
                 font-family: monospace; font-size: 13px; box-sizing: border-box;" />
      </label>
      <button id="agent-start-btn"
        style="padding: 10px; background: #0f0; color: #000; border: none;
               border-radius: 4px; font-family: monospace; font-size: 14px;
               font-weight: bold; cursor: pointer;">
        Start Jamming
      </button>
    </div>
  `;

  container.appendChild(wrapper);

  const btn = wrapper.querySelector('#agent-start-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const apiKey = (wrapper.querySelector('#agent-api-key') as HTMLInputElement).value.trim();
    const roomId = (wrapper.querySelector('#agent-room-id') as HTMLInputElement).value.trim();

    if (!apiKey) {
      alert('Please enter your Anthropic API key.');
      return;
    }

    localStorage.setItem(STORAGE_KEY_API, apiKey);
    onStart({ apiKey, roomId: roomId || 'default' });
  });

  return {
    destroy: () => wrapper.remove(),
  };
}

export function createStatusOverlay(container: HTMLElement): StatusOverlay {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; z-index: 50;
    font-family: monospace; font-size: 12px; color: #0f0;
    background: rgba(0,0,0,0.6); padding: 8px 12px; border-radius: 4px;
    pointer-events: none; line-height: 1.6;
  `;

  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop';
  stopBtn.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 50;
    font-family: monospace; font-size: 12px; color: #f00;
    background: rgba(0,0,0,0.6); padding: 8px 16px; border: 1px solid #f00;
    border-radius: 4px; cursor: pointer;
  `;

  container.appendChild(overlay);
  container.appendChild(stopBtn);

  return {
    update({ connection, generation, status }) {
      overlay.innerHTML = `${connection}<br>Gen #${generation}<br>${status}`;
    },
    onStop(callback: () => void) {
      stopBtn.addEventListener('click', callback);
    },
    destroy() {
      overlay.remove();
      stopBtn.remove();
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/ui.ts
git commit -m "feat: add agent UI module (setup screen + status overlay)"
```

---

### Task 6: Create the agent loop module

**Files:**
- Create: `src/agent/agent_loop.ts`

The core state machine: SETUP → CONNECTING → GENERATING → WAITING → loop. Handles Claude API calls, shader compilation, B2B sync, and BroadcastChannel publishing.

- [ ] **Step 1: Create `src/agent/agent_loop.ts`**

```typescript
/**
 * Agent generation loop — state machine for autonomous shader generation.
 */
import type { B2BPeer } from '../network/webrtc_b2b';
import { buildSystemPrompt, buildUserMessage, type GenerationEntry } from './prompt';
import type { StatusOverlay } from './ui';

type AgentState = 'connecting' | 'generating' | 'waiting' | 'stopped';

class RateLimitError extends Error {
  constructor(public waitMs: number) {
    super(`Rate limited, waiting ${Math.round(waitMs / 1000)}s`);
  }
}

interface AgentLoopDeps {
  peer: B2BPeer;
  tabChannel: BroadcastChannel | null;
  /** Compile shader source, returns program (or null) and error string. */
  tryCompile: (source: string) => { program: unknown | null; error: string };
  /** Assign compiled program to localProgram and re-render. */
  applyLocalShader: (code: string, program: unknown) => void;
  overlay: StatusOverlay;
  apiKey: string;
  signalingUrl: string;
}

const WAIT_MIN_MS = 12_000;
const WAIT_MAX_MS = 18_000;
const MAX_HISTORY = 3;
const RATE_LIMIT_BACKOFF_START_MS = 30_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 120_000;

export class AgentLoop {
  private state: AgentState = 'connecting';
  private cycle = 0;
  private myShader: string | null = null;
  private theirShader: string | null = null;
  private history: GenerationEntry[] = [];
  private agentId: 'A' | 'B' = 'A';
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private rateLimitBackoff = RATE_LIMIT_BACKOFF_START_MS;
  private deps: AgentLoopDeps;

  constructor(deps: AgentLoopDeps) {
    this.deps = deps;
  }

  start(): void {
    this.stopped = false;
    this.updateOverlay('Waiting for peer...', 'Connecting...');

    // Start generating after a short delay to allow WebRTC connection
    setTimeout(() => this.generate(), 2000);
  }

  stop(): void {
    this.stopped = true;
    this.state = 'stopped';
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    this.updateOverlay(this.connectionStatus(), 'Stopped');
  }

  onRemoteShader(code: string): void {
    this.theirShader = code;
    // If we haven't determined our role yet, we're the non-caller (B)
    if (this.cycle === 0 && !this.deps.peer.isCaller) {
      this.agentId = 'B';
    }
  }

  onPeerConnected(): void {
    this.agentId = this.deps.peer.isCaller ? 'A' : 'B';
    this.updateOverlay('Connected to peer', this.stateLabel());
  }

  onPeerDisconnected(): void {
    this.updateOverlay('Peer disconnected', this.stateLabel());
  }

  private async generate(): Promise<void> {
    if (this.stopped) return;

    this.state = 'generating';
    this.cycle++;
    this.updateOverlay(this.connectionStatus(), 'Generating...');

    try {
      const code = await this.callClaudeApi();
      if (this.stopped) return;

      // Try to compile
      const { program, error } = this.deps.tryCompile(code);
      if (error && !program) {
        // Retry once with error feedback
        console.warn(`[Agent ${this.agentId}] Compile error, retrying:`, error);
        const retryCode = await this.callClaudeApiWithRetry(code, error);
        if (this.stopped) return;

        const retry = this.deps.tryCompile(retryCode);
        if (retry.error && !retry.program) {
          console.error(`[Agent ${this.agentId}] Retry also failed:`, retry.error);
          this.scheduleNext();
          return;
        }
        this.applyShader(retryCode, retry.program!);
      } else {
        this.applyShader(code, program!);
      }
    } catch (err) {
      console.error(`[Agent ${this.agentId}] Generation error:`, err);
      if (err instanceof RateLimitError) {
        // Use the rate limit backoff instead of normal schedule
        this.updateOverlay(this.connectionStatus(), `Rate limited, waiting ${Math.round(err.waitMs / 1000)}s...`);
        this.state = 'waiting';
        this.waitTimer = setTimeout(() => {
          this.waitTimer = null;
          this.generate();
        }, err.waitMs);
        return;
      }
      this.updateOverlay(this.connectionStatus(), `Error: ${(err as Error).message?.slice(0, 40)}`);
    }

    this.scheduleNext();
  }

  private applyShader(code: string, program: unknown): void {
    this.myShader = code;

    // Update history
    this.history.push({
      mine: code,
      theirs: this.theirShader || '',
      cycle: this.cycle,
    });
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    // Assign to localProgram and re-render
    this.deps.applyLocalShader(code, program);

    // Send to peer
    this.deps.peer.sendShader(code);

    // Publish to BroadcastChannel (only if caller or solo)
    this.publishState();
  }

  private publishState(): void {
    if (!this.deps.tabChannel) return;
    // Only publish if we're the caller, or if there's no peer (solo mode)
    if (this.deps.peer.connected && !this.deps.peer.isCaller) return;

    this.deps.tabChannel.postMessage({
      type: 'state',
      state: {
        localCode: this.myShader || '',
        remoteCode: this.theirShader || '',
        mixAmount: 0.5,
        viewMode: 'mix',
      },
    });
  }

  private scheduleNext(): void {
    if (this.stopped) return;

    this.state = 'waiting';
    const waitMs = WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);
    const waitSec = Math.round(waitMs / 1000);
    this.updateOverlay(this.connectionStatus(), `Waiting ${waitSec}s...`);

    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      this.generate();
    }, waitMs);
  }

  private async callClaudeApi(): Promise<string> {
    const system = buildSystemPrompt();
    const userMessage = buildUserMessage({
      agentId: this.agentId,
      cycle: this.cycle,
      myShader: this.myShader,
      theirShader: this.theirShader,
      history: this.history,
    });

    return this.fetchShader(system, [{ role: 'user', content: userMessage }]);
  }

  private async callClaudeApiWithRetry(failedCode: string, error: string): Promise<string> {
    const system = buildSystemPrompt();
    const userMessage = buildUserMessage({
      agentId: this.agentId,
      cycle: this.cycle,
      myShader: this.myShader,
      theirShader: this.theirShader,
      history: this.history,
    });

    return this.fetchShader(system, [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: failedCode },
      { role: 'user', content: `That shader failed to compile with error:\n${error}\n\nFix the issue and return only the corrected shader code.` },
    ]);
  }

  private async fetchShader(
    system: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    const proxyUrl = `http://${window.location.hostname}:8787/api/generate-shader`;

    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: this.deps.apiKey,
        system,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));

      // Handle rate limiting with exponential backoff
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : this.rateLimitBackoff;
        this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, RATE_LIMIT_BACKOFF_MAX_MS);
        throw new RateLimitError(waitMs);
      }
      // Reset backoff on successful non-429 (even if error)
      this.rateLimitBackoff = RATE_LIMIT_BACKOFF_START_MS;

      throw new Error(err.error || `API returned ${res.status}`);
    }

    const data = await res.json();
    return data.code;
  }

  private connectionStatus(): string {
    if (this.deps.peer.connected) return 'Connected to peer';
    return this.cycle > 0 ? 'Solo mode' : 'Waiting for peer...';
  }

  private stateLabel(): string {
    switch (this.state) {
      case 'generating': return 'Generating...';
      case 'waiting': return 'Waiting...';
      case 'stopped': return 'Stopped';
      default: return 'Connecting...';
    }
  }

  private updateOverlay(connection: string, status: string): void {
    this.deps.overlay.update({
      connection,
      generation: this.cycle,
      status,
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to agent code).

- [ ] **Step 3: Commit**

```bash
git add src/agent/agent_loop.ts
git commit -m "feat: add agent generation loop state machine"
```

---

## Chunk 3: Wiring & Integration

### Task 7: Wire agent mode into main.ts

**Files:**
- Modify: `src/main.ts`

Connect the agent modules to the existing app infrastructure: WebGPU stage, B2BPeer, BroadcastChannel, and the compile/apply pipeline.

**Key context:** In `boot()`, `tabChannel` is created at line 267 (for all modes), `peer` is created at lines 269-293 (studio only), `renderTemplate()` is called to generate UI HTML before mode branching, and `must('#stage')` queries for the `#stage` element. The agent mode needs to handle its own peer creation, provide a minimal HTML template with `#stage`, and bridge the `localProgram` variable so shaders actually render.

- [ ] **Step 1: Add imports for agent modules**

At the top of `src/main.ts` (after line 6), add:

```typescript
import { AgentLoop } from './agent/agent_loop';
import { renderSetupScreen, createStatusOverlay } from './agent/ui';
```

- [ ] **Step 2: Handle renderTemplate for agent mode**

The existing `renderTemplate()` generates the full studio/present/received UI (editor textarea, controls, etc.). For agent mode, we need only the `#stage` div (where the WebGPU canvas is mounted). Find where `renderTemplate()` is called (e.g., `app.innerHTML = renderTemplate(appMode)`) and guard it:

```typescript
if (appMode === 'agent') {
  // Agent mode: minimal template with just the stage container
  app.innerHTML = '<div id="stage" class="stage"></div>';
} else {
  app.innerHTML = renderTemplate(appMode);
}
```

This ensures `must('#stage')` succeeds (no crash) and the agent gets a clean fullscreen canvas without studio UI elements.

- [ ] **Step 3: Wire up the agent case in boot()**

Replace the placeholder `else if (appMode === 'agent')` block (from Task 3) with the full wiring. The agent creates its own B2BPeer inside the "Start Jamming" callback:

```typescript
  } else if (appMode === 'agent') {
    const setup = renderSetupScreen(document.body, (config) => {
      setup.destroy();

      const overlay = createStatusOverlay(document.body);
      const signalingUrl = `ws://${window.location.hostname}:8787`;

      const agentPeer = new B2BPeer({
        onStatus: (text) => console.log('[Agent]', text),
        onPeerState: (connected) => {
          if (connected) agentLoop.onPeerConnected();
          else agentLoop.onPeerDisconnected();
        },
        onRemoteShader: (code) => {
          remoteCode = code;
          const result = tryCompile(code);
          if (result.program) {
            remoteProgram = result.program;
            applyShaderGraph();
          }
          agentLoop.onRemoteShader(code);
        },
      });

      const agentLoop = new AgentLoop({
        peer: agentPeer,
        tabChannel,
        tryCompile,
        applyLocalShader: (code, program) => {
          // Bridge: assign to module-level localCode/localProgram so
          // applyShaderGraph() can read them when it renders
          localCode = code;
          localProgram = program;
          applyShaderGraph();
        },
        overlay,
        apiKey: config.apiKey,
        signalingUrl,
      });

      agentPeer.connect(config.roomId, signalingUrl);
      overlay.onStop(() => agentLoop.stop());
      agentLoop.start();
    });
  }
```

**Critical detail:** The `applyLocalShader` callback bridges the agent loop to `main.ts`'s module-level `localCode` and `localProgram` variables. Without this, `applyShaderGraph()` would never see the agent's compiled shader and the canvas would stay black.

- [ ] **Step 4: Verify closure access**

Confirm these module-level variables are accessible from within the agent callback closure in `boot()`:
- `localCode` (string) — set by studio editor input
- `localProgram` (LiveProgram | null) — set by tryCompile
- `remoteCode` (string) — set by remote shader handler
- `remoteProgram` (LiveProgram | null) — set by remote shader compile
- `tabChannel` (BroadcastChannel | null) — created at line 267
- `tryCompile` (function) — defined in boot scope
- `applyShaderGraph` (function) — defined in boot scope

If any of these are `const` and need reassignment, they must be changed to `let`. Check each one.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev:b2b`
Open: `http://localhost:5173?mode=agent`
Expected: See the setup screen with API key input, room ID, and "Start Jamming" button. No console errors. The page has a fullscreen black canvas behind the setup card.

Open: `http://localhost:5173` (studio mode)
Expected: Studio mode works exactly as before — no regressions from the renderTemplate guard.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire agent mode into main app boot sequence"
```

---

### Task 8: End-to-end integration test

**Files:** No new files — this is a manual verification task.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev:b2b`
Expected: Both signaling server and Vite start successfully.

- [ ] **Step 2: Test agent tab setup screen**

Open: `http://localhost:5173?mode=agent&room=test1`
Expected: Setup screen renders. Room ID pre-filled with "test1". API key field is empty (or filled from localStorage if previously saved).

- [ ] **Step 3: Test with a real API key**

Enter a valid Anthropic API key. Click "Start Jamming".
Expected:
- Setup screen disappears
- Canvas renders (may be black initially)
- Status overlay shows "Waiting for peer..." / "Solo mode" and "Generating..."
- After 2-5 seconds, a shader should compile and render
- Console logs show generation activity

- [ ] **Step 4: Test two agent tabs**

Open a second tab: `http://localhost:5173?mode=agent&room=test1`
Enter API key, click "Start Jamming".
Expected:
- Both tabs connect via WebRTC
- Status shows "Connected to peer"
- Shaders start flowing between tabs
- Each tab renders its own generated shader

- [ ] **Step 5: Test present tab**

Open a third tab: `http://localhost:5173?mode=present`
Expected:
- Receives both shaders via BroadcastChannel
- Renders mixed output
- Keyboard controls work (1/2/3 for view mode, arrows for mix)

- [ ] **Step 6: Test stop button**

Click "Stop" on one agent tab.
Expected: Generation loop pauses, last shader keeps rendering, other agent continues.

- [ ] **Step 7: Verify existing modes still work**

Open: `http://localhost:5173` (studio mode)
Expected: Studio mode works exactly as before — no regressions.

- [ ] **Step 8: Commit any fixes**

If any issues were found and fixed during testing:

```bash
git add -A
git commit -m "fix: address integration issues from agent mode testing"
```
