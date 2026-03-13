# AI VJ Agents — Design Spec

Two autonomous LLM-powered agents run in-browser, connected via existing B2B WebRTC, reactively generating TSL shaders in response to each other's code every 10-20 seconds. A present tab shows the mixed output.

## Architecture

### Approach: Dual Browser Tabs

Each agent is a separate browser tab at `?mode=agent`. Reuses existing B2B infrastructure (WebRTC peer sync, signaling server, BroadcastChannel tab sync) with minor modifications to support the new mode.

### Workflow

```
Terminal:
  $ npm run dev:b2b

Tab 1: localhost:5173?mode=agent&room=jam1   → Agent A
Tab 2: localhost:5173?mode=agent&room=jam1   → Agent B
Tab 3: localhost:5173?mode=present           → Mixed output
```

Both agents connect via WebRTC and independently generate shaders on randomized timers (12-18s). There is no turn-taking protocol — both agents may generate simultaneously, which is fine since each processes whatever the peer's latest shader was at generation time. Each agent sends its compiled shader to the peer and publishes state via BroadcastChannel for the present tab.

## Agent Mode (`?mode=agent`)

### Type System Update

The `AppMode` union type in `src/main.ts` must be extended:

```typescript
type AppMode = 'studio' | 'received' | 'present' | 'agent'
```

The `resolveAppMode()` function must also recognize `'agent'` as a valid mode (currently defaults unknown modes to `'studio'`).

### State Machine

```
SETUP → CONNECTING → GENERATING → WAITING → GENERATING → ...
                                     ↑___________|
```

- **SETUP**: API key input + room config. User clicks "Start Jamming".
- **CONNECTING**: Joins B2B room via WebRTC. Proceeds to generate even without a peer (solo mode).
- **GENERATING**: Calls Claude API via proxy. On success: compiles shader via `tryCompile()`, applies it, sends to peer via `sendShader()`. On failure: retries once with error context, then skips cycle.
- **WAITING**: Renders current shader for 12-18s (randomized per cycle). Listens for incoming peer shaders.

### Generation Loop

Each cycle:
1. Build prompt with: system context, agent's current shader, peer's current shader, last 3 generation history entries.
2. Call `POST /api/generate-shader` on the signaling server.
3. Receive shader code from Claude.
4. Compile via `tryCompile(code)`.
5. If compile fails: send error back to Claude, retry once.
6. If compile succeeds: `applyShaderGraph()`, `sendShader(code)`, `publishState()`.
7. Wait 12-18s (randomized), then repeat.

### Reactive Context

Each agent maintains a rolling history of the last 3 generations:

```typescript
type GenerationEntry = {
  mine: string      // this agent's shader code
  theirs: string    // peer's shader code at that time
  cycle: number
}

// Sent to LLM each cycle for creative continuity
generationHistory: GenerationEntry[]  // max length 3
```

This gives the LLM enough memory to evolve aesthetically rather than producing disconnected shaders.

### Error Handling

| Error | Response |
|-------|----------|
| API error (non-429) | Log, wait, retry next cycle |
| API rate limit (429) | Respect `retry-after` header, exponential backoff (start 30s, max 120s) |
| Compile error | Send error to Claude with "fix this", one retry per cycle |
| WebRTC disconnect | Keep generating locally, auto-reconnect when peer returns |
| Tab unfocused | Loop continues (`setTimeout`, not `requestAnimationFrame`) |

## Claude API Integration

### Proxy Endpoint

The signaling server (`signaling/server.mjs`) currently creates a bare `WebSocketServer`. This must be restructured to use an `http.Server` with the WSS attached:

```javascript
import http from 'node:http'
import { WebSocketServer } from 'ws'

const server = http.createServer(handleHttpRequest)
const wss = new WebSocketServer({ server })
server.listen(PORT)
```

New HTTP endpoint:

```
POST /api/generate-shader
Body: { messages: [...], apiKey: string }
Response: { code: string }
```

Forwards messages to Claude API (Sonnet model for speed — 2-5s response time). Avoids CORS issues.

**Security note (dev context):** The proxy relays whatever API key the client sends — it does not store or validate keys. This means anyone who can reach the signaling server can use it as a relay. This is acceptable for local dev/jam sessions. Production deployment would need HTTPS and optionally a shared secret to gate proxy access.

### API Key Handling

- Input on setup screen, stored in `localStorage:tsl-vjing-api-key`.
- Sent with each request to the proxy (proxy does not store it).

### Prompt Structure

**System prompt:**
- Describes the TSL environment: available functions, bindings, utility library.
- Specifies the `export const sketch = Fn(() => { ... })` format.
- Includes curated example shaders as reference.
- Instructs: return ONLY shader code, no explanation.

**User message (each cycle):**
- Agent identity: "You are Agent [A/B] in a live VJ jam session. Generation #N."
- Current shader: the agent's last compiled code (or "none yet").
- Partner's shader: the peer's latest received code (or "none yet").
- Last 3 generation history entries for creative trajectory.
- Instruction: "Create a new shader that evolves your visual direction while responding to your partner's aesthetic."

**Model:** Claude Sonnet — optimized for speed over depth.

**Cost estimate:** Each request is ~3000-6000 tokens. At one generation per ~15s per agent, that's ~480 requests/hour total for a 2-agent session.

## Agent Tab UI

### Setup Screen

Centered card:
- Text input: "Anthropic API Key" (pre-filled from localStorage)
- Text input: "Room ID" (pre-filled from `?room=` param, defaults to random 4-char ID)
- Button: "Start Jamming"

### Running State

Full viewport WebGPU canvas rendering the agent's own shader.

**Bottom-left overlay** (semi-transparent, small):
- Connection: "Connected to peer" / "Waiting for peer..." / "Solo mode"
- Counter: "Gen #7"
- State: "Generating..." / "Waiting 14s..."

**Bottom-right:** Stop button (pauses generation loop, keeps rendering).

No editor, no code display. The agent tab is pure output.

### BroadcastChannel Publishing — Single Publisher Model

**Problem:** If both agent tabs publish `{ localCode, remoteCode }` to BroadcastChannel, the present tab receives contradictory state (each agent's "local" is the other's "remote").

**Solution:** Only one agent tab publishes to BroadcastChannel — the **WebRTC caller** (the first peer that initiates the data channel). This is deterministic: the caller is always the peer that was already in the room when the second peer joins (`peer-joined` event triggers the caller flow in `webrtc_b2b.ts`).

The caller agent publishes:

```typescript
channel.postMessage({
  type: 'state',
  state: {
    localCode: myCurrentShader,
    remoteCode: peerCurrentShader,
    mixAmount: 0.5,
    viewMode: 'mix'
  }
})
```

The non-caller agent does not publish state — it only renders its own output and communicates with the caller via WebRTC.

**When running solo (no peer):** The solo agent publishes its own shader as `localCode` with empty `remoteCode`. When a peer connects, the caller role is established and publishing switches to the single-publisher model. If the solo agent becomes the non-caller, it must stop publishing via BroadcastChannel.

### BroadcastChannel Guard Update

The existing `publishState()` in `src/main.ts` has a guard:

```typescript
if (appMode !== 'studio' || !tabChannel) return
```

This must be updated to also allow `agent` mode:

```typescript
if ((appMode !== 'studio' && appMode !== 'agent') || !tabChannel) return
```

The agent mode will use its own `publishState()` implementation in `src/agent/agent_loop.ts`, but the present tab's `setupTabSync()` listener does not need changes — it already accepts any incoming `{ type: 'state' }` message regardless of sender mode.

## File Changes

### New Files

| File | Purpose | ~Lines |
|------|---------|--------|
| `src/agent/agent_loop.ts` | Generation loop state machine, context builder, retry logic, BroadcastChannel publishing | ~200 |
| `src/agent/prompt.ts` | System prompt template, user message builder, example shaders | ~120 |
| `src/agent/ui.ts` | Setup screen + status overlay DOM rendering | ~100 |

### Modified Files

| File | Change | ~Lines |
|------|--------|--------|
| `src/main.ts` | Add `'agent'` to `AppMode` union. Add `agent` case to mode switch. Update `resolveAppMode()` to recognize `'agent'`. Wire up `createWebGPUStage()`, `B2BPeer`, agent loop. | ~40 |
| `src/network/webrtc_b2b.ts` | Expose caller role via a public `isCaller` getter (the `caller` boolean is currently private/local). Needed for the single-publisher model. | ~5 |
| `signaling/server.mjs` | Restructure from bare `WebSocketServer` to `http.Server` + attached WSS. Add `POST /api/generate-shader` endpoint. Add CORS headers (`Access-Control-Allow-Origin: *` for dev). | ~60 |
| `package.json` | Add `@anthropic-ai/sdk` as a dependency (used server-side in signaling server proxy). | ~1 |

### Untouched

- `src/tsl/*` — all utilities
- `src/webgpu/create_webgpu_stage.ts` — used as-is
- `src/utils/math.ts`
- Existing `studio`, `received`, `present` modes (present tab listener works without changes)

## End-to-End Flow

1. `npm run dev:b2b` starts signaling server (now HTTP + WSS) + vite.
2. Open Tab 1 at `?mode=agent&room=jam1`. Enter API key, click "Start Jamming".
3. Agent A connects to room, starts generating solo. Gen #1 is from scratch (no peer context). Publishes state via BroadcastChannel (solo publisher).
4. Open Tab 2 at `?mode=agent&room=jam1`. Enter API key, start.
5. Agent B connects. WebRTC handshake completes — Agent A becomes the caller (publisher), Agent B is the non-caller.
6. Agent B receives Agent A's latest shader via WebRTC data channel.
7. Agent B's Gen #1 reacts to Agent A's output. Sends result back via WebRTC.
8. Agent A receives Agent B's shader, publishes updated state (both shaders) via BroadcastChannel.
9. Both agents independently generate on randomized 12-18s timers. Agent A publishes state after each generation or incoming peer shader.
10. Open Tab 3 at `?mode=present`. Receives both shaders via BroadcastChannel. Renders crossfaded mix with keyboard controls (1/2/3 for view mode, arrows for mix amount).
11. Jam runs indefinitely until agents are stopped.
