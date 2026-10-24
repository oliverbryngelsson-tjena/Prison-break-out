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

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'failed';

interface SessionInfo {
  code: string;
  token: string;
  you: string;
  savedAt: number;
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
  private ws: WebSocket | null = null;
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
    this.url = toWs(u);
    safeSet('pbo.serverUrl', u || null);
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

  private open(): void {
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    const timeout = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 8000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.retry = 0;
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
      if (this.ws === ws) this.ws = null;
      if (this.wantOnline) this.scheduleRetry();
      else this.setStatus('offline');
    };
    ws.onerror = () => { /* close follows */ };
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retry++;
    // Give up on the first connection after a few tries; keep trying forever once in a room.
    if (!this.session && this.retry > 4) {
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
        this.session = { code: msg.room.code, token: msg.token, you: msg.you, savedAt: Date.now() };
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

  // ---- lobby API
  async createRoom(name: string, progress: Progress | null): Promise<void> {
    this.name = name;
    this.clearSession();
    await this.connect();
    this.send({ t: 'create', name, progress });
  }
  async joinRoom(code: string, name: string): Promise<void> {
    this.name = name;
    this.clearSession();
    await this.connect();
    this.send({ t: 'join', code, name });
  }
  async resume(): Promise<void> {
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

  /** Testing hook: simulate a dropped connection. */
  simulateDrop(): void { this.ws?.close(); }
}
