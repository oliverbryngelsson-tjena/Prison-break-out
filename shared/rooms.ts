// Room management for two-player private lobbies. Runs in the Node server and, for peer-to-peer
// games, inside the host player's browser (no Node APIs here).
import {
  AUTHORITY_HANDOFF_MS,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  type CharacterId,
  type ClientMsg,
  type ErrorCode,
  type PlayerInfo,
  type Progress,
  type RoomState,
  type ServerMsg,
  normalizeCode,
} from './protocol';

/** Anything that can carry JSON text to one client (a WebSocket, a WebRTC data channel, a loopback). */
export interface Transport {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Conn {
  ws: Transport;
  playerId: string | null;
  roomCode: string | null;
  name: string;
  helloed: boolean;
  /** token bucket for rate limiting */
  budget: number;
  lastRefill: number;
}

interface Player {
  id: string;
  token: string;
  name: string;
  character: CharacterId | null;
  ready: boolean;
  conn: Conn | null;
  disconnectedAt: number | null;
  ping: number;
}

interface Room {
  code: string;
  phase: 'lobby' | 'playing';
  players: Player[];
  hostId: string;
  authorityId: string;
  progress: Progress | null;
  startedAt: number | null;
  createdAt: number;
  lastActivity: number;
}

const send = (conn: Conn | null, msg: ServerMsg) => {
  if (conn && conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg));
};

export class RoomManager {
  rooms = new Map<string, Room>();
  stats = { created: 0, joined: 0, resumed: 0, relayed: 0 };

  constructor(private log: (...a: unknown[]) => void = () => {}) {
    setInterval(() => this.sweep(), 1000).unref?.();
  }

  /** Code to use for the next created room (P2P hosts register it with the signaling server first). */
  reservedCode: string | null = null;

  newCode(): string {
    if (this.reservedCode && !this.rooms.has(this.reservedCode)) { const c = this.reservedCode; this.reservedCode = null; return c; }
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  }

  private state(room: Room): RoomState {
    return {
      code: room.code,
      phase: room.phase,
      progress: room.progress,
      startedAt: room.startedAt,
      players: room.players.map<PlayerInfo>((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        ready: p.ready,
        connected: !!p.conn,
        isHost: p.id === room.hostId,
        isAuthority: p.id === room.authorityId,
        ping: p.ping,
      })),
    };
  }

  private broadcast(room: Room, msg: ServerMsg, except?: string) {
    for (const p of room.players) if (p.id !== except) send(p.conn, msg);
  }

  private pushRoom(room: Room) {
    this.broadcast(room, { t: 'room', room: this.state(room) });
  }

  private error(conn: Conn, code: ErrorCode, message: string) {
    send(conn, { t: 'error', code, message });
  }

  private rateOk(conn: Conn): boolean {
    const now = Date.now();
    conn.budget = Math.min(200, conn.budget + ((now - conn.lastRefill) / 1000) * 120);
    conn.lastRefill = now;
    if (conn.budget < 1) return false;
    conn.budget -= 1;
    return true;
  }

  handle(conn: Conn, msg: ClientMsg) {
    if (!this.rateOk(conn)) {
      if (msg.t !== 'relay') this.error(conn, 'RATE_LIMIT', 'Too many messages');
      return;
    }
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    const me = room?.players.find((p) => p.id === conn.playerId);
    if (room) room.lastActivity = Date.now();
    switch (msg.t) {
      case 'hello':
        conn.helloed = true;
        conn.name = sanitizeName(msg.name);
        return;
      case 'ping':
        send(conn, { t: 'pong', c: Number(msg.c) || 0, s: Date.now() });
        return;
      case 'create': {
        this.detach(conn, true);
        const code = this.newCode();
        const p: Player = { id: id(), token: token(), name: sanitizeName(msg.name), character: 'elias', ready: false, conn, disconnectedAt: null, ping: 0 };
        const r: Room = {
          code, phase: 'lobby', players: [p], hostId: p.id, authorityId: p.id,
          progress: validProgress(msg.progress) ? msg.progress! : null, startedAt: null,
          createdAt: Date.now(), lastActivity: Date.now(),
        };
        this.rooms.set(code, r);
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.created++;
        this.log('room created', code, p.name);
        send(conn, { t: 'joined', you: p.id, token: p.token, room: this.state(r) });
        return;
      }
      case 'join': {
        const code = normalizeCode(String(msg.code || ''));
        const r = this.rooms.get(code);
        if (!r) return this.error(conn, 'ROOM_NOT_FOUND', `No game with code ${code}. Check the code with your friend.`);
        if (r.players.length >= MAX_PLAYERS) return this.error(conn, 'ROOM_FULL', 'That game already has two players.');
        if (r.phase === 'playing') return this.error(conn, 'ROOM_IN_GAME', 'That game has already started.');
        this.detach(conn, true);
        const taken = new Set(r.players.map((p) => p.character));
        const character: CharacterId = taken.has('elias') ? 'jax' : 'elias';
        const p: Player = { id: id(), token: token(), name: sanitizeName(msg.name), character, ready: false, conn, disconnectedAt: null, ping: 0 };
        r.players.push(p);
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.joined++;
        this.log('room joined', code, p.name);
        send(conn, { t: 'joined', you: p.id, token: p.token, room: this.state(r) });
        this.pushRoom(r);
        return;
      }
      case 'resume': {
        const code = normalizeCode(String(msg.code || ''));
        const r = this.rooms.get(code);
        const p = r?.players.find((x) => x.token === msg.token);
        if (!r || !p) return this.error(conn, 'SESSION_EXPIRED', 'That session has ended.');
        if (p.conn && p.conn !== conn) {
          // A stale socket for the same seat: replace it.
          const old = p.conn;
          old.playerId = null;
          old.roomCode = null;
          try { old.ws.close(4000, 'replaced'); } catch { /* ignore */ }
        }
        this.detach(conn, true);
        p.conn = conn;
        p.disconnectedAt = null;
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.resumed++;
        this.log('resumed', code, p.name);
        send(conn, { t: 'joined', you: p.id, token: p.token, room: this.state(r) });
        this.broadcast(r, { t: 'peer', event: 'reconnected', id: p.id }, p.id);
        this.pushRoom(r);
        return;
      }
      case 'select': {
        if (!room || !me) return this.error(conn, 'BAD_REQUEST', 'Not in a room');
        if (room.phase !== 'lobby') return;
        if (msg.character !== 'elias' && msg.character !== 'jax') return this.error(conn, 'BAD_REQUEST', 'Unknown character');
        const other = room.players.find((p) => p.id !== me.id);
        if (other && other.character === msg.character) {
          // Swap characters so both players always have one each.
          other.character = me.character;
          other.ready = false;
        }
        me.character = msg.character;
        me.ready = false;
        this.pushRoom(room);
        return;
      }
      case 'ready': {
        if (!room || !me || room.phase !== 'lobby') return;
        me.ready = !!msg.ready;
        this.pushRoom(room);
        return;
      }
      case 'start': {
        if (!room || !me) return;
        if (room.hostId !== me.id) return this.error(conn, 'NOT_HOST', 'Only the host can start the game.');
        if (room.players.length < MAX_PLAYERS) return this.error(conn, 'NOT_READY', 'Waiting for your friend to join.');
        if (!room.players.every((p) => p.ready && p.conn && p.character)) return this.error(conn, 'NOT_READY', 'Both players must be ready.');
        room.phase = 'playing';
        room.startedAt = Date.now();
        room.authorityId = room.hostId;
        this.log('game started', room.code);
        this.broadcast(room, { t: 'start', room: this.state(room), at: Date.now() + 1500 });
        return;
      }
      case 'backToLobby': {
        if (!room || !me || room.hostId !== me.id) return;
        room.phase = 'lobby';
        for (const p of room.players) p.ready = false;
        this.pushRoom(room);
        return;
      }
      case 'save': {
        if (!room || !me) return;
        if (validProgress(msg.progress)) {
          room.progress = msg.progress;
          this.pushRoom(room);
        }
        return;
      }
      case 'relay': {
        if (!room || !me) return;
        const raw = msg.d;
        if (!raw || typeof raw !== 'object') return;
        this.stats.relayed++;
        for (const p of room.players) if (p.id !== me.id) send(p.conn, { t: 'relay', from: me.id, d: raw });
        return;
      }
      case 'leave': {
        this.detach(conn, true);
        return;
      }
      default:
        this.error(conn, 'BAD_REQUEST', 'Unknown message');
    }
  }

  /** Removes a connection from its room. `leave` = intentional (frees the seat). */
  detach(conn: Conn, leave: boolean) {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    const pid = conn.playerId;
    conn.roomCode = null;
    conn.playerId = null;
    if (!room || !pid) return;
    const p = room.players.find((x) => x.id === pid);
    if (!p || p.conn !== conn) return;
    if (leave) {
      room.players = room.players.filter((x) => x.id !== pid);
      this.log('left', room.code, p.name);
      if (room.players.length === 0) {
        this.rooms.delete(room.code);
        return;
      }
      if (room.hostId === pid) room.hostId = room.players[0].id;
      if (room.authorityId === pid) room.authorityId = room.players[0].id;
      if (room.phase === 'playing') room.phase = 'lobby';
      for (const x of room.players) x.ready = false;
      this.broadcast(room, { t: 'peer', event: 'left', id: pid });
      this.pushRoom(room);
    } else {
      p.conn = null;
      p.disconnectedAt = Date.now();
      this.log('disconnected', room.code, p.name);
      this.broadcast(room, { t: 'peer', event: 'disconnected', id: pid, graceMs: RECONNECT_GRACE_MS });
      this.pushRoom(room);
    }
  }

  /** Snapshot of a room without live connections (P2P host reload). */
  exportRoom(code: string): unknown {
    const r = this.rooms.get(code);
    if (!r) return null;
    return { ...r, players: r.players.map((p) => ({ ...p, conn: null })) };
  }

  /** Restores a room saved by exportRoom; every seat starts disconnected and can resume with its token. */
  importRoom(data: unknown, restorerId?: string): string | null {
    const r = data as Room | null;
    if (!r || typeof r.code !== 'string' || !Array.isArray(r.players)) return null;
    const now = Date.now();
    const room: Room = { ...r, lastActivity: now, players: r.players.map((p) => ({ ...p, conn: null, disconnectedAt: now })) };
    // The player who reloaded lost their world state; the partner who kept playing becomes the authority.
    const other = room.players.find((p) => p.id !== restorerId);
    if (room.phase === 'playing' && restorerId && other && room.authorityId === restorerId) room.authorityId = other.id;
    this.rooms.set(room.code, room);
    return room.code;
  }

  setPing(conn: Conn, ms: number) {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    const p = room?.players.find((x) => x.id === conn.playerId);
    if (p) p.ping = Math.round(ms);
  }

  private sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      // Hand world authority to the connected player if the authority is gone.
      const auth = room.players.find((p) => p.id === room.authorityId);
      if (room.phase === 'playing' && auth && !auth.conn && auth.disconnectedAt && now - auth.disconnectedAt > AUTHORITY_HANDOFF_MS) {
        const other = room.players.find((p) => p.conn);
        if (other) {
          room.authorityId = other.id;
          this.log('authority ->', room.code, other.name);
          this.broadcast(room, { t: 'authority', id: other.id });
          this.pushRoom(room);
        }
      }
      // Expire seats that never came back.
      for (const p of [...room.players]) {
        if (!p.conn && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
          room.players = room.players.filter((x) => x !== p);
          this.log('seat expired', room.code, p.name);
          if (room.hostId === p.id && room.players[0]) room.hostId = room.players[0].id;
          if (room.authorityId === p.id && room.players[0]) room.authorityId = room.players[0].id;
          this.broadcast(room, { t: 'peer', event: 'left', id: p.id });
          if (room.players.length) {
            room.phase = 'lobby';
            for (const x of room.players) x.ready = false;
            this.pushRoom(room);
          }
        }
      }
      if (room.players.length === 0 || (room.players.every((p) => !p.conn) && now - room.lastActivity > RECONNECT_GRACE_MS)) {
        this.rooms.delete(room.code);
        this.log('room closed', room.code);
      }
    }
  }
}

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function randomInt(n: number): number {
  // Rejection sampling for an unbiased index.
  const lim = 256 - (256 % n);
  for (;;) { const v = bytes(1)[0]; if (v < lim) return v % n; }
}
function id(): string {
  return [...bytes(6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function token(): string {
  return [...bytes(18)].map((b) => b.toString(36).padStart(2, '0')).join('');
}
function sanitizeName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return s || 'Player';
}
function validProgress(p: unknown): p is Progress {
  if (!p || typeof p !== 'object') return false;
  const x = p as Progress;
  return Number.isInteger(x.chapter) && x.chapter >= 1 && x.chapter <= 6 && typeof x.checkpoint === 'string' && x.checkpoint.length < 64 &&
    typeof x.flags === 'object' && JSON.stringify(x.flags).length < 8000;
}
