// WebSocket client for the room server: lobbies, relay, reconnection and clock sync.
import {
  PROTOCOL_VERSION,
  type CharacterId,
  type ClientMsg,
  type ErrorCode,
  type GameMsg,
  type Progress,
  type RoomState,
  type ServerMsg,
} from '../../shared/protocol';
import { normalizeCode } from '../../shared/protocol';
import { GuestSocket, P2PHost, type SocketLike } from './p2p';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'failed';

interface SessionInfo {
  code: string;
  token: string;
  you: string;
  savedAt: number;
  /** Peer-to-peer room: whether this tab hosts it. */
  p2p?: 'host' | 'guest';
}

/**
 * 'ws'  = rooms on a game server (VITE_SERVER_URL, ?server=, Settings > Network, or same-origin /ws).
 * 'p2p' = the room creator's browser hosts the room; no server needed (default for static hosting).
 */
export type NetMode = 'ws' | 'p2p';

function explicitServer(): string {
  return new URLSearchParams(location.search).get('server') || safeGet('pbo.serverUrl') || ((import.meta.env?.VITE_SERVER_URL as string | undefined) || '');
}

export function defaultNetMode(): NetMode {
  const q = new URLSearchParams(location.search).get('net');
  if (q === 'p2p' || q === 'ws') return q;
  if (explicitServer()) return 'ws';
  return (import.meta.env?.VITE_NET_MODE as string | undefined) === 'p2p' ? 'p2p' : 'ws';
}

type Handlers = {
  status: (s: NetStatus) => void;
  room: (r: RoomState) => void;
  joined: (r: RoomState, you: string) => void;
  start: (r: RoomState, at: number) => void;
  relay: (from: string, d: GameMsg) => void;
  peer: (event: 'disconnected' | 'reconnected' | 'left', id: string, graceMs?: number) => void;
  authority: (id: string) => void;
  error: (code: ErrorCode, message: string) => void;
};

const SESSION_KEY = 'pbo.session';

export function defaultServerUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  const saved = safeGet('pbo.serverUrl');
  const env = (import.meta.env?.VITE_SERVER_URL as string | undefined) || '';
  const base = q || saved || env;
  if (base) return toWs(base);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.protocol === 'file:' || location.hostname === 'localhost' && location.port === '') return 'ws://localhost:8080/ws';
  return `${proto}//${location.host}/ws`;
}

function toWs(u: string): string {
  let s = u.trim();
  if (s.startsWith('http')) s = s.replace(/^http/, 'ws');
  if (!/^wss?:\/\//.test(s)) s = (location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
  if (!/\/ws\/?$/.test(s)) s = s.replace(/\/$/, '') + '/ws';
  return s;
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null): void {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
}

export class NetClient {
  status: NetStatus = 'offline';
  room: RoomState | null = null;
  you: string | null = null;
  rtt = 0;
  /** serverTime ≈ Date.now() + offset */
  offset = 0;
  private ws: SocketLike | null = null;
  mode: NetMode = defaultNetMode();
  /** P2P: the room this tab hosts, or the code of the room this tab joins. */
  private host: P2PHost | null = null;
  private target: string | null = null;
  private unavailableSince = 0;
  private url: string;
  private handlers: { [K in keyof Handlers]: Set<Handlers[K]> } = {
    status: new Set(), room: new Set(), joined: new Set(), start: new Set(), relay: new Set(), peer: new Set(), authority: new Set(), error: new Set(),
  };
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private wantOnline = false;
  private pendingAfterOpen: ClientMsg[] = [];
  private session: SessionInfo | null = null;
  private samples: Array<{ rtt: number; off: number }> = [];
  name = 'Player';
  bytesOut = 0;
  bytesIn = 0;
  msgsOut = 0;

  constructor(url = defaultServerUrl()) {
    this.url = url;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || safeGet(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as SessionInfo;
        if (Date.now() - s.savedAt < 110_000) this.session = s;
      }
    } catch { /* ignore */ }
  }

  get serverUrl(): string { return this.url; }
  setServerUrl(u: string): void {
    safeSet('pbo.serverUrl', u || null);
    this.url = u ? toWs(u) : defaultServerUrl();
    this.mode = defaultNetMode();
    if (this.ws) { this.ws.close(); }
  }

  on<K extends keyof Handlers>(ev: K, fn: Handlers[K]): () => void {
    (this.handlers[ev] as Set<Handlers[K]>).add(fn);
    return () => (this.handlers[ev] as Set<Handlers[K]>).delete(fn);
  }

  private emit<K extends keyof Handlers>(ev: K, ...args: Parameters<Handlers[K]>): void {
    for (const fn of this.handlers[ev]) (fn as (...a: Parameters<Handlers[K]>) => void)(...args);
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  /** A previous session (e.g. after a page reload) that can be resumed. */
  get resumable(): SessionInfo | null {
    return this.session && Date.now() - this.session.savedAt < 110_000 ? this.session : null;
  }

  connect(): Promise<void> {
    // P2P with no room yet: nothing to connect to until a room is created or joined.
    if (this.mode === 'p2p' && !this.host && !this.target) { this.setStatus('online'); return Promise.resolve(); }
    this.wantOnline = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onStatus = (s: NetStatus) => {
        if (s === 'online') { off(); resolve(); }
        if (s === 'failed') { off(); reject(new Error('Could not reach the game server')); }
      };
      const off = this.on('status', onStatus);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.open();
    });
  }

  private makeSocket(): SocketLike {
    if (this.mode === 'p2p' && this.host) return this.host.loopback();
    if (this.mode === 'p2p' && this.target) return new GuestSocket(this.target);
    return new WebSocket(this.url) as unknown as SocketLike;
  }

  private open(): void {
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting');
    let ws: SocketLike;
    try {
      ws = this.makeSocket();
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    const timeout = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, this.mode === 'p2p' ? 16000 : 8000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.retry = 0;
      this.unavailableSince = 0;
      this.rawSend({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
      if (this.session) this.rawSend({ t: 'resume', code: this.session.code, token: this.session.token });
      this.setStatus('online');
      for (const m of this.pendingAfterOpen.splice(0)) this.rawSend(m);
      this.startPings();
    };
    ws.onmessage = (e) => {
      this.bytesIn += (e.data as string).length;
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      this.dispatch(msg);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      this.stopPings();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.mode === 'p2p' && this.target && ws instanceof GuestSocket && this.p2pGuestFailed(ws.lastError)) return;
      if (this.wantOnline) this.scheduleRetry();
      else this.setStatus(this.mode === 'p2p' ? 'online' : 'offline');
    };
    ws.onerror = () => { /* close follows */ };
  }

  /** Guest could not reach the host. Returns true when retrying makes no sense. */
  private p2pGuestFailed(err: string): boolean {
    if (err !== 'peer-unavailable') { this.unavailableSince = 0; return false; }
    const now = Date.now();
    if (!this.session) {
      // First join: nobody is hosting that code.
      this.pendingAfterOpen = [];
      this.wantOnline = false;
      this.target = null;
      this.retry = 0;
      this.setStatus('online');
      this.emit('error', 'ROOM_NOT_FOUND', 'No game with that code is open right now. Check the code with your friend.');
      return true;
    }
    // In a game: the host may be reloading. Give up after the reconnection window.
    if (!this.unavailableSince) this.unavailableSince = now;
    if (now - this.unavailableSince > 100_000) {
      this.wantOnline = false;
      this.target = null;
      this.retry = 0;
      this.clearSession();
      this.setStatus('online');
      this.emit('error', 'SESSION_EXPIRED', 'Your friend closed the game.');
      return true;
    }
    return false;
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retry++;
    // Give up on the first connection after a few tries; keep trying forever once in a room.
    if (!this.session && this.retry > (this.mode === 'p2p' ? 2 : 4)) {
      this.target = null;
      this.setStatus('failed');
      this.wantOnline = false;
      this.retry = 0;
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(8000, 400 * 2 ** Math.min(this.retry, 5)) * (0.75 + Math.random() * 0.5);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.wantOnline) this.open();
    }, delay);
  }

  private startPings(): void {
    this.stopPings();
    const ping = () => this.rawSend({ t: 'ping', c: performance.now(), rtt: this.rtt });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }
  private stopPings(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private dispatch(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.offset = msg.serverTime - Date.now();
        return;
      case 'pong': {
        const now = performance.now();
        const rtt = now - msg.c;
        const off = msg.s - (Date.now() - rtt / 2);
        this.samples.push({ rtt, off });
        if (this.samples.length > 12) this.samples.shift();
        const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
        const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
        this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
        this.rtt = sorted[Math.floor(sorted.length / 2)].rtt;
        return;
      }
      case 'joined':
        this.you = msg.you;
        this.room = msg.room;
        this.session = { code: msg.room.code, token: msg.token, you: msg.you, savedAt: Date.now(), p2p: this.mode === 'p2p' ? (this.host ? 'host' : 'guest') : undefined };
        this.persistSession();
        this.emit('joined', msg.room, msg.you);
        this.emit('room', msg.room);
        return;
      case 'room':
        this.room = msg.room;
        if (this.session) { this.session.savedAt = Date.now(); this.persistSession(); }
        this.emit('room', msg.room);
        return;
      case 'start':
        this.room = msg.room;
        this.emit('start', msg.room, msg.at);
        return;
      case 'relay':
        this.emit('relay', msg.from, msg.d);
        return;
      case 'peer':
        this.emit('peer', msg.event, msg.id, msg.graceMs);
        return;
      case 'authority':
        if (this.room) for (const p of this.room.players) p.isAuthority = p.id === msg.id;
        this.emit('authority', msg.id);
        return;
      case 'error':
        if (msg.code === 'SESSION_EXPIRED') this.clearSession();
        this.emit('error', msg.code, msg.message);
        return;
    }
  }

  private persistSession(): void {
    const raw = this.session ? JSON.stringify(this.session) : null;
    try { if (raw) sessionStorage.setItem(SESSION_KEY, raw); else sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    safeSet(SESSION_KEY, raw);
  }

  clearSession(): void {
    this.session = null;
    this.room = null;
    this.persistSession();
  }

  private rawSend(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const s = JSON.stringify(m);
      this.bytesOut += s.length;
      this.msgsOut++;
      this.ws.send(s);
    }
  }

  private send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.rawSend(m);
    else if (m.t !== 'relay' && m.t !== 'ping') this.pendingAfterOpen.push(m);
  }

  /** Switches the P2P role and opens a fresh socket for it. */
  private async openP2P(): Promise<void> {
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.retry = 0;
    if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    await this.connect();
  }

  private dropHost(): void {
    if (!this.host) return;
    const h = this.host;
    this.host = null;
    // Let the 'left' notice reach the partner before the room disappears.
    setTimeout(() => h.dispose(), 300);
  }

  // ---- lobby API
  async createRoom(name: string, progress: Progress | null): Promise<void> {
    this.name = name;
    this.clearSession();
    if (this.mode === 'p2p') {
      this.dropHost();
      this.target = null;
      this.setStatus('connecting');
      const host = new P2PHost();
      try {
        await host.start();
      } catch (e) {
        host.dispose();
        this.setStatus('failed');
        throw e;
      }
      this.host = host;
      this.pendingAfterOpen = [{ t: 'create', name, progress }];
      await this.openP2P();
      return;
    }
    await this.connect();
    this.send({ t: 'create', name, progress });
  }
  async joinRoom(code: string, name: string): Promise<void> {
    this.name = name;
    this.clearSession();
    if (this.mode === 'p2p') {
      this.dropHost();
      this.target = normalizeCode(code);
      this.pendingAfterOpen = [{ t: 'join', code, name }];
      await this.openP2P().catch(() => { /* error event already shown */ });
      return;
    }
    await this.connect();
    this.send({ t: 'join', code, name });
  }
  async resume(): Promise<void> {
    const s = this.session;
    if (s?.p2p) {
      this.mode = 'p2p';
      if (s.p2p === 'host') {
        this.setStatus('reconnecting');
        const host = await P2PHost.restore(s.you).catch(() => null);
        if (!host) { this.clearSession(); this.setStatus('online'); throw new Error('The game you hosted has ended.'); }
        this.host = host;
        this.target = null;
      } else {
        this.target = s.code;
      }
      await this.openP2P();
      return;
    }
    await this.connect();
  }
  select(character: CharacterId): void { this.send({ t: 'select', character }); }
  ready(ready: boolean): void { this.send({ t: 'ready', ready }); }
  start(): void { this.send({ t: 'start' }); }
  backToLobby(): void { this.send({ t: 'backToLobby' }); }
  save(progress: Progress): void { this.send({ t: 'save', progress }); }
  leave(): void {
    this.send({ t: 'leave' });
    this.clearSession();
    if (this.mode === 'p2p') {
      this.wantOnline = false;
      this.target = null;
      this.dropHost();
      const ws = this.ws;
      setTimeout(() => { if (this.ws === ws) { this.ws = null; ws?.close(); this.setStatus('online'); } }, 200);
    }
  }
  disconnect(): void {
    this.wantOnline = false;
    this.ws?.close();
  }
  relay(d: GameMsg): void {
    this.send({ t: 'relay', d });
  }

  // ---- helpers
  serverNow(): number { return Date.now() + this.offset; }
  get me() { return this.room?.players.find((p) => p.id === this.you) ?? null; }
  get peer() { return this.room?.players.find((p) => p.id !== this.you) ?? null; }
  get isHost(): boolean { return !!this.me?.isHost; }
  get isAuthority(): boolean { return !!this.me?.isAuthority; }
  get connected(): boolean { return this.status === 'online'; }
  /** P2P: this tab is the room host. */
  get hosting(): boolean { return !!this.host; }

  /** Testing hook: simulate a dropped connection. */
  simulateDrop(): void { this.ws?.close(); }
}
