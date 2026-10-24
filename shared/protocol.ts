// Wire protocol shared by the room server and the game client.
// Every message is a JSON object with a `t` (type) field.

export const PROTOCOL_VERSION = 3;
export const MAX_PLAYERS = 2;
/** How long the server keeps a disconnected player's seat (ms). */
export const RECONNECT_GRACE_MS = 120_000;
/** After this long without the authority, the other player takes over the world simulation. */
export const AUTHORITY_HANDOFF_MS = 8_000;

export type CharacterId = 'elias' | 'jax';

export interface Progress {
  chapter: number;
  checkpoint: string;
  /** Persistent story flags (choices, collected items). */
  flags: Record<string, boolean | number | string>;
  /** Wall-clock time the save was made. */
  savedAt: number;
  /** Total play time in seconds. */
  playTime: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  character: CharacterId | null;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** Runs the world simulation (NPCs, puzzles). Usually the host. */
  isAuthority: boolean;
  ping: number;
}

export type RoomPhase = 'lobby' | 'playing';

export interface RoomState {
  code: string;
  phase: RoomPhase;
  players: PlayerInfo[];
  progress: Progress | null;
  /** Server timestamp when the current game session started. */
  startedAt: number | null;
}

// ---------- client -> server ----------
export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'create'; name: string; progress?: Progress | null }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; token: string }
  | { t: 'select'; character: CharacterId }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'relay'; to?: 'peer' | 'all'; d: GameMsg }
  | { t: 'save'; progress: Progress }
  | { t: 'ping'; c: number; rtt?: number }
  | { t: 'backToLobby' };

// ---------- server -> client ----------
export type ServerMsg =
  | { t: 'welcome'; v: number; serverTime: number }
  | { t: 'joined'; you: string; token: string; room: RoomState }
  | { t: 'room'; room: RoomState }
  | { t: 'start'; room: RoomState; at: number }
  | { t: 'relay'; from: string; d: GameMsg }
  | { t: 'peer'; event: 'disconnected' | 'reconnected' | 'left'; id: string; graceMs?: number }
  | { t: 'authority'; id: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'BAD_VERSION'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_GAME'
  | 'BAD_REQUEST'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'CHARACTER_TAKEN'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMIT';

// ---------- game messages (relayed between the two clients) ----------
/** Compact per-player state, sent ~15 times a second. */
export interface PlayerSnap {
  /** sender game time (s) */
  tm: number;
  p: [number, number, number];
  /** yaw */
  y: number;
  /** ground speed */
  s: number;
  /** flags: bit0 crouch, bit1 sprint, bit2 grounded, bit3 downed, bit4 onBike, bit5 blocking, bit6 hidden, bit7 concealed */
  f: number;
  /** active action / animation override name */
  a?: string;
  /** action start time (sender game time) */
  at?: number;
  hp?: number;
  /** bike: [lean, pitch, steer, rpm, wheelSpin, speed, crashed(0/1)] */
  b?: number[];
  /** look target for head (world) */
  lk?: [number, number, number];
  /** pose parameters (world points / scalars) for the active pose */
  pc?: { p?: Record<string, [number, number, number]>; k?: Record<string, number> };
  /** outfit variant */
  v?: string;
}

export interface NpcSnap {
  id: string;
  p: [number, number, number];
  y: number;
  s: number;
  /** behaviour state */
  st: string;
  /** awareness 0..1 of [elias, jax] */
  aw?: [number, number];
  a?: string;
  at?: number;
  hp?: number;
  /** bike/car extra */
  x?: number[];
}

export type GameMsg =
  | { k: 'ps'; s: PlayerSnap }
  | { k: 'ws'; tm: number; npcs: NpcSnap[] }
  | { k: 'req'; type: string; args?: unknown; seq: number }
  | { k: 'ev'; type: string; args?: unknown; seq: number; tm: number }
  | { k: 'full'; state: unknown; tm: number }
  | { k: 'needFull' }
  | { k: 'hold'; id: string; on: boolean }
  | { k: 'skip'; id: string }
  | { k: 'chat'; text: string }
  | { k: 'loaded'; chapter: number; checkpoint: string }
  | { k: 'hit'; target: string; dmg: number; dir: [number, number]; kind: string }
  /** App-level commands outside a running chapter (e.g. host continues to the next chapter). */
  | { k: 'app'; cmd: 'next' | 'menu'; chapter?: number };

export function isClientMsg(x: unknown): x is ClientMsg {
  return !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string';
}

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}
