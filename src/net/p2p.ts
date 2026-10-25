// Peer-to-peer rooms: the player who creates a room runs the RoomManager in their own browser and the
// partner connects to it over a WebRTC data channel. PeerJS's free public signaling server (0.peerjs.com)
// introduces the two browsers; game traffic then flows directly between them (or via PeerJS's public
// TURN relay when a direct path is impossible). No game server or account is needed.
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { normalizeCode } from '../../shared/protocol';
import { RoomManager, type Transport } from '../../shared/rooms';
import { serveConnection } from '../../shared/serve';

/** Signaling ids are namespaced so room codes never collide with other PeerJS apps. */
export const PEER_PREFIX = 'redmoor-breakout-v1-';
const HOST_KEY = 'pbo.p2phost';
/** A link with no traffic for this long is treated as dead (the client pings every 2 s). */
const SILENCE_MS = 9000;

/** WebSocket-shaped socket used by NetClient for every transport. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Optional self-hosted signaling server: ?peer=host:port[/path] (used by the automated tests). */
export function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search).get('peer');
  const base: PeerOptions = { debug: 0 };
  if (!q) return base;
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(q);
  if (!m) return base;
  const secure = m[1] ? m[1] === 'https' : location.protocol === 'https:';
  return { ...base, host: m[2], port: Number(m[3] || (secure ? 443 : 80)), path: m[4] || '/', secure };
}

function safeSession(k: string, v?: string | null): string | null {
  try {
    if (v === undefined) return sessionStorage.getItem(k) ?? localStorage.getItem(k);
    if (v === null) { sessionStorage.removeItem(k); localStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.setItem(k, v); }
  } catch { /* private mode */ }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The room "server" living in the host's tab. */
export class P2PHost {
  readonly rooms = new RoomManager();
  code = '';
  private peer: Peer | null = null;
  private links = new Set<DataConnection>();
  private saveTimer: number | null = null;
  private disposed = false;
  private loop: LoopbackSocket | null = null;
  /** Called when the signaling registration is lost for good (partner can no longer find the room). */
  onSignalLost: (() => void) | null = null;

  /** Registers the room code with the signaling server. `restore` keeps the same code (host reloaded). */
  async start(restore?: string): Promise<string> {
    for (let attempt = 0; attempt < (restore ? 24 : 6); attempt++) {
      const code = restore ?? this.rooms.newCode();
      try {
        await this.register(code);
        this.code = code;
        this.rooms.reservedCode = restore ? null : code;
        this.saveTimer = window.setInterval(() => this.persist(), 1000);
        return code;
      } catch (e) {
        const type = (e as { type?: string }).type;
        if (type === 'unavailable-id') { await wait(restore ? 1500 : 50); continue; } // taken (or our old registration not yet released)
        throw e;
      }
    }
    throw new Error('Could not register the room code');
  }

  private register(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_PREFIX + code, peerOptions());
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; peer.destroy(); reject(Object.assign(new Error('signaling timeout'), { type: 'network' })); } }, 15000);
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.peer = peer;
        resolve();
      });
      peer.on('error', (err) => {
        if (!settled) { settled = true; clearTimeout(timer); peer.destroy(); reject(err); return; }
        // After registration: errors about individual peers are harmless here.
      });
      peer.on('connection', (dc) => this.accept(dc));
      peer.on('disconnected', () => {
        // Lost the signaling socket; existing data channels keep working. Re-register so a partner can reconnect.
        if (this.disposed || peer.destroyed) return;
        setTimeout(() => { if (!this.disposed && !peer.destroyed) peer.reconnect(); }, 1500);
      });
    });
  }

  private accept(dc: DataConnection): void {
    let served: ReturnType<typeof serveConnection> | null = null;
    let last = Date.now();
    let watch: number | null = null;
    const t: Transport = {
      get readyState() { return dc.open ? 1 : 3; },
      send: (s: string) => { if (dc.open) dc.send(s); },
      close: () => dc.close(),
    };
    const closed = () => {
      if (watch !== null) clearInterval(watch);
      watch = null;
      this.links.delete(dc);
      served?.closed();
      served = null;
    };
    dc.on('open', () => {
      this.links.add(dc);
      last = Date.now();
      served = serveConnection(this.rooms, t);
      watch = window.setInterval(() => { if (Date.now() - last > SILENCE_MS) { dc.close(); closed(); } }, 2000);
    });
    dc.on('data', (d) => { last = Date.now(); served?.message(String(d)); });
    dc.on('close', closed);
    dc.on('error', closed);
  }

  /** The host's own NetClient talks to the in-tab RoomManager through this. */
  loopback(): SocketLike {
    this.loop?.close();
    this.loop = new LoopbackSocket(this.rooms);
    return this.loop;
  }

  persist(): void {
    if (this.disposed || !this.code) return;
    const room = this.rooms.exportRoom(this.code);
    safeSession(HOST_KEY, room ? JSON.stringify({ code: this.code, room, savedAt: Date.now() }) : null);
  }

  /** A room saved by a host tab that reloaded (within the reconnection window). */
  static saved(): { code: string; room: unknown } | null {
    try {
      const raw = safeSession(HOST_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as { code: string; room: unknown; savedAt: number };
      return Date.now() - s.savedAt < 110_000 ? s : null;
    } catch { return null; }
  }

  static async restore(selfId?: string): Promise<P2PHost | null> {
    const s = P2PHost.saved();
    if (!s) return null;
    const h = new P2PHost();
    if (!h.rooms.importRoom(s.room, selfId)) return null;
    await h.start(s.code);
    return h;
  }

  dispose(): void {
    this.disposed = true;
    if (this.saveTimer !== null) clearInterval(this.saveTimer);
    safeSession(HOST_KEY, null);
    this.loop?.close();
    for (const dc of this.links) dc.close();
    this.links.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

/** In-tab socket between the host's NetClient and its RoomManager (async, like a network). */
class LoopbackSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private served: ReturnType<typeof serveConnection> | null = null;

  constructor(rooms: RoomManager) {
    const self = this;
    const t: Transport = {
      get readyState() { return self.readyState === 1 ? 1 : 3; },
      send: (s: string) => queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: s }); }),
      close: () => this.close(),
    };
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.served = serveConnection(rooms, t);
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.readyState !== 1) return;
    queueMicrotask(() => this.served?.message(data));
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const s = this.served;
    this.served = null;
    queueMicrotask(() => { s?.closed(); this.onclose?.(); });
  }
}

/** The partner's side: a data channel to the host's room. */
export class GuestSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** PeerJS error type of the last failure ('peer-unavailable' = no room with that code is online). */
  lastError = '';
  private peer: Peer;
  private dc: DataConnection | null = null;
  private last = Date.now();
  private watch: number;
  private timer: number;

  constructor(code: string) {
    this.peer = new Peer(peerOptions());
    this.timer = window.setTimeout(() => { if (this.readyState === 0) { this.lastError ||= 'timeout'; this.fail(); } }, 15000);
    this.watch = window.setInterval(() => { if (this.readyState === 1 && Date.now() - this.last > SILENCE_MS) { this.lastError = 'silence'; this.fail(); } }, 2000);
    this.peer.on('open', () => {
      const dc = this.peer.connect(PEER_PREFIX + normalizeCode(code), { reliable: true, serialization: 'raw' });
      this.dc = dc;
      dc.on('open', () => {
        if (this.readyState !== 0) return;
        clearTimeout(this.timer);
        this.readyState = 1;
        this.last = Date.now();
        this.onopen?.();
      });
      dc.on('data', (d) => { this.last = Date.now(); this.onmessage?.({ data: String(d) }); });
      dc.on('close', () => this.fail());
      dc.on('error', () => this.fail());
    });
    this.peer.on('error', (err) => { this.lastError = err.type; this.fail(); });
  }

  send(data: string): void {
    if (this.readyState === 1 && this.dc?.open) this.dc.send(data);
  }

  close(): void { this.fail(); }

  private fail(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.timer);
    clearInterval(this.watch);
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.peer.destroy(); } catch { /* ignore */ }
    this.onclose?.();
  }
}
