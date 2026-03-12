import { WebSocketServer } from 'ws';

const PORT = Number(process.env.SIGNAL_PORT || 8787);
const rooms = new Map();

const wss = new WebSocketServer({ port: PORT });

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function roomById(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function randomPeerId() {
  return Math.random().toString(36).slice(2, 10);
}

function leaveRoom(ws) {
  if (!ws.meta?.roomId || !ws.meta?.peerId) return;

  const { roomId, peerId } = ws.meta;
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(peerId);

  for (const [, peerSocket] of room.entries()) {
    send(peerSocket, { type: 'peer-left', peerId });
  }

  if (room.size === 0) rooms.delete(roomId);
  ws.meta = null;
}

function joinRoom(ws, roomId) {
  leaveRoom(ws);

  const room = roomById(roomId);
  if (room.size >= 2) {
    send(ws, { type: 'room-full', roomId });
    return;
  }

  const peerId = randomPeerId();
  const peers = [...room.keys()];

  ws.meta = { roomId, peerId };
  room.set(peerId, ws);

  send(ws, { type: 'joined', roomId, peerId, peers });

  for (const [id, peerSocket] of room.entries()) {
    if (id === peerId) continue;
    send(peerSocket, { type: 'peer-joined', peerId });
  }
}

function relaySignal(ws, targetPeerId, data) {
  if (!ws.meta?.roomId || !ws.meta?.peerId) return;

  const room = rooms.get(ws.meta.roomId);
  if (!room) return;

  const target = room.get(targetPeerId);
  if (!target) return;

  send(target, {
    type: 'signal',
    from: ws.meta.peerId,
    data
  });
}

wss.on('connection', (ws) => {
  ws.meta = null;

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON payload.' });
      return;
    }

    if (msg.type === 'join') {
      if (typeof msg.roomId !== 'string' || msg.roomId.trim() === '') {
        send(ws, { type: 'error', message: 'roomId is required.' });
        return;
      }

      joinRoom(ws, msg.roomId.trim());
      return;
    }

    if (msg.type === 'signal') {
      if (typeof msg.target !== 'string' || !msg.data) return;
      relaySignal(ws, msg.target, msg.data);
      return;
    }

    if (msg.type === 'leave') {
      leaveRoom(ws);
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', now: Date.now() });
      return;
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
  });
});

console.log(`B2B signaling server running on ws://localhost:${PORT}`);
