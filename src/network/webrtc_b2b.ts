type B2BEvents = {
  onStatus?: (text: string) => void;
  onPeerState?: (connected: boolean, peerId: string | null) => void;
  onRemoteShader?: (code: string) => void;
};

type SignalEnvelope = {
  type: 'offer' | 'answer' | 'candidate';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export class B2BPeer {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private roomId: string | null = null;
  private selfId: string | null = null;
  private peerId: string | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(private readonly events: B2BEvents = {}) {}

  get connected(): boolean {
    return this.dc?.readyState === 'open';
  }

  connect(roomId: string, signalingUrl: string): void {
    this.disconnect();

    this.roomId = roomId;
    this.ws = new WebSocket(signalingUrl);

    this.events.onStatus?.('Connecting to signaling...');

    this.ws.addEventListener('open', () => {
      this.events.onStatus?.('Joining room...');
      this.sendWs({ type: 'join', roomId });
    });

    this.ws.addEventListener('message', (event) => {
      this.handleWsMessage(event.data);
    });

    this.ws.addEventListener('close', () => {
      this.events.onStatus?.('Signaling disconnected');
      this.cleanupPeerConnection();
      this.events.onPeerState?.(false, null);
    });

    this.ws.addEventListener('error', () => {
      this.events.onStatus?.('Signaling error');
    });
  }

  disconnect(): void {
    this.cleanupPeerConnection();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWs({ type: 'leave' });
    }

    this.ws?.close();
    this.ws = null;

    this.roomId = null;
    this.selfId = null;
    this.peerId = null;
    this.pendingCandidates = [];
  }

  sendShader(code: string): boolean {
    if (!this.dc || this.dc.readyState !== 'open') {
      this.events.onStatus?.('Data channel is not open yet');
      return false;
    }

    this.dc.send(
      JSON.stringify({
        type: 'shader',
        code,
        sentAt: Date.now()
      })
    );

    this.events.onStatus?.('Shader sent');
    return true;
  }

  private sendWs(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private async handleWsMessage(raw: unknown): Promise<void> {
    let msg: any;

    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'joined') {
      this.selfId = msg.peerId;
      this.events.onStatus?.(`Joined room ${msg.roomId} as ${msg.peerId}`);

      if (Array.isArray(msg.peers) && msg.peers.length > 0) {
        this.peerId = msg.peers[0];
        this.events.onStatus?.('Waiting for offer from host...');
      } else {
        this.events.onStatus?.('Waiting for second VJ...');
      }

      return;
    }

    if (msg.type === 'peer-joined') {
      this.peerId = msg.peerId;
      this.events.onStatus?.(`Peer ${msg.peerId} joined, creating offer...`);
      await this.startCallerFlow(msg.peerId);
      return;
    }

    if (msg.type === 'peer-left') {
      if (this.peerId === msg.peerId) {
        this.events.onStatus?.('Peer left room');
        this.cleanupPeerConnection();
        this.peerId = null;
        this.events.onPeerState?.(false, null);
      }
      return;
    }

    if (msg.type === 'room-full') {
      this.events.onStatus?.(`Room ${msg.roomId} is full (max 2 peers)`);
      return;
    }

    if (msg.type === 'signal') {
      await this.handleSignal(msg.from, msg.data);
      return;
    }

    if (msg.type === 'error') {
      this.events.onStatus?.(msg.message || 'Server error');
    }
  }

  private async ensurePeerConnection(targetPeerId: string, caller: boolean): Promise<RTCPeerConnection> {
    this.peerId = targetPeerId;

    if (this.pc) return this.pc;

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.pc.onicecandidate = (event) => {
      if (!event.candidate || !this.peerId) return;

      this.sendWs({
        type: 'signal',
        target: this.peerId,
        data: {
          type: 'candidate',
          candidate: event.candidate.toJSON()
        }
      });
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (!state) return;

      if (state === 'connected') {
        this.events.onStatus?.('Peer connection established');
      }

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.events.onStatus?.(`Peer connection ${state}`);
      }
    };

    if (!caller) {
      this.pc.ondatachannel = (event) => {
        this.attachDataChannel(event.channel);
      };
    }

    return this.pc;
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dc = channel;

    channel.onopen = () => {
      this.events.onStatus?.('Data channel open');
      this.events.onPeerState?.(true, this.peerId);
    };

    channel.onclose = () => {
      this.events.onStatus?.('Data channel closed');
      this.events.onPeerState?.(false, this.peerId);
    };

    channel.onmessage = (event) => {
      this.handleDataMessage(event.data);
    };

    channel.onerror = () => {
      this.events.onStatus?.('Data channel error');
    };
  }

  private async startCallerFlow(targetPeerId: string): Promise<void> {
    const pc = await this.ensurePeerConnection(targetPeerId, true);

    if (!this.dc || this.dc.readyState === 'closed') {
      const channel = pc.createDataChannel('b2b-shader', { ordered: true });
      this.attachDataChannel(channel);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendWs({
      type: 'signal',
      target: targetPeerId,
      data: {
        type: 'offer',
        sdp: pc.localDescription
      }
    });
  }

  private async handleSignal(from: string, data: SignalEnvelope): Promise<void> {
    const caller = data.type !== 'offer';
    const pc = await this.ensurePeerConnection(from, caller);

    if (data.type === 'offer' && data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendWs({
        type: 'signal',
        target: from,
        data: {
          type: 'answer',
          sdp: pc.localDescription
        }
      });

      await this.flushPendingCandidates();
      return;
    }

    if (data.type === 'answer' && data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await this.flushPendingCandidates();
      return;
    }

    if (data.type === 'candidate' && data.candidate) {
      if (!pc.remoteDescription) {
        this.pendingCandidates.push(data.candidate);
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;

    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (!candidate) continue;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private handleDataMessage(raw: unknown): void {
    let msg: any;

    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'shader' && typeof msg.code === 'string') {
      this.events.onRemoteShader?.(msg.code);
      this.events.onStatus?.('Remote shader received');
    }
  }

  private cleanupPeerConnection(): void {
    this.dc?.close();
    this.dc = null;

    this.pc?.close();
    this.pc = null;

    this.pendingCandidates = [];
  }
}
