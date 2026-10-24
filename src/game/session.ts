// Gameplay networking: authority-ordered events, player/NPC snapshots, holds and full-state sync.
import type { CharacterId, GameMsg, NpcSnap, PlayerSnap } from '../../shared/protocol';
import type { NetClient } from '../net/client';

export interface SessionHandlers {
  /** Apply a world event (runs on both clients in the same order). */
  applyEvent(type: string, args: unknown, fromAuthorityReplay: boolean): void;
  /** Authority-side validation of a peer request. Return false to reject. */
  validate(type: string, args: unknown, from: 'local' | 'peer'): boolean;
  onPeerSnap(s: PlayerSnap): void;
  onNpcSnaps(tm: number, n: NpcSnap[]): void;
  /** Authority: produce full state for (re)sync. */
  fullState(): unknown;
  /** Non-authority: apply a full state. */
  applyFull(state: unknown): void;
  onHold(id: string, on: boolean, from: 'local' | 'peer'): void;
  onHit(target: string, dmg: number, dir: [number, number], kind: string): void;
  onSkip(id: string, from: 'local' | 'peer'): void;
  onPeerLoaded(chapter: number, checkpoint: string): void;
}

export class Session {
  /** Seconds since this session object was created (local game clock). */
  time = 0;
  private seq = 0;
  private lastSnap = 0;
  private lastWorld = 0;
  snapRate = 15;
  worldRate = 10;
  handlers: SessionHandlers | null = null;
  /** Events applied so far (authority log, used for debugging/tests). */
  readonly log: Array<{ type: string; seq: number }> = [];
  peerPresent = true;
  private unsub: Array<() => void> = [];
  /** Events requested before the authority answered (for latency display / tests). */
  pendingRequests = 0;
  stats = { eventsApplied: 0, snapsIn: 0, snapsOut: 0, worldIn: 0 };

  constructor(public net: NetClient | null, public localChar: CharacterId, public remoteChar: CharacterId) {
    if (net) {
      this.unsub.push(net.on('relay', (_from, d) => this.onRelay(d)));
      this.unsub.push(net.on('peer', (ev) => {
        if (ev === 'disconnected' || ev === 'left') this.peerPresent = false;
        if (ev === 'reconnected') {
          this.peerPresent = true;
          if (this.authority) this.sendFull();
        }
      }));
      this.unsub.push(net.on('authority', () => {
        if (this.authority) this.sendFull();
        else this.send({ k: 'needFull' });
      }));
      this.unsub.push(net.on('status', (s) => {
        // After our own reconnect, ask the authority for the latest state.
        if (s === 'online' && !this.authority) setTimeout(() => this.send({ k: 'needFull' }), 300);
      }));
    }
  }

  get authority(): boolean {
    return !this.net || this.net.isAuthority;
  }

  get online(): boolean {
    return !!this.net;
  }

  /** Shared clock (ms) for synchronising cutscene starts. */
  sharedNow(): number {
    return this.net ? this.net.serverNow() : Date.now();
  }

  private send(d: GameMsg): void {
    this.net?.relay(d);
  }

  /** Ask for a world change. The authority applies it and broadcasts it in order. */
  request(type: string, args?: unknown): void {
    if (this.authority) {
      if (this.handlers?.validate(type, args, 'local') === false) return;
      this.emit(type, args);
    } else {
      this.pendingRequests++;
      this.send({ k: 'req', type, args, seq: ++this.seq });
    }
  }

  /** Authority only: apply and broadcast an event. */
  emit(type: string, args?: unknown): void {
    if (!this.authority) {
      console.warn('emit from non-authority', type);
      return;
    }
    const seq = ++this.seq;
    this.log.push({ type, seq });
    if (this.log.length > 400) this.log.shift();
    this.stats.eventsApplied++;
    this.handlers?.applyEvent(type, args, false);
    this.send({ k: 'ev', type, args, seq, tm: this.time });
  }

  hold(id: string, on: boolean): void {
    this.handlers?.onHold(id, on, 'local');
    this.send({ k: 'hold', id, on });
  }

  skip(id: string): void {
    this.handlers?.onSkip(id, 'local');
    this.send({ k: 'skip', id });
  }

  /** Deal damage to the partner's character (final fight) or notify of a hit. */
  hit(target: string, dmg: number, dir: [number, number], kind: string): void {
    this.send({ k: 'hit', target, dmg, dir, kind });
  }

  loaded(chapter: number, checkpoint: string): void {
    this.send({ k: 'loaded', chapter, checkpoint });
  }

  sendFull(): void {
    if (!this.authority || !this.handlers) return;
    this.send({ k: 'full', state: this.handlers.fullState(), tm: this.time });
  }

  update(dt: number, snap: () => PlayerSnap | null, npcs: () => NpcSnap[]): void {
    this.time += dt;
    if (!this.net) return;
    if (this.time - this.lastSnap >= 1 / this.snapRate) {
      this.lastSnap = this.time;
      const s = snap();
      if (s) { this.send({ k: 'ps', s }); this.stats.snapsOut++; }
    }
    if (this.authority && this.time - this.lastWorld >= 1 / this.worldRate) {
      this.lastWorld = this.time;
      const n = npcs();
      if (n.length) this.send({ k: 'ws', tm: this.time, npcs: n });
    }
  }

  private onRelay(d: GameMsg): void {
    const h = this.handlers;
    if (!h) return;
    switch (d.k) {
      case 'ps':
        this.stats.snapsIn++;
        h.onPeerSnap(d.s);
        return;
      case 'ws':
        if (this.authority) return;
        this.stats.worldIn++;
        h.onNpcSnaps(d.tm, d.npcs);
        return;
      case 'req':
        if (!this.authority) return;
        if (h.validate(d.type, d.args, 'peer') === false) return;
        this.emit(d.type, d.args);
        return;
      case 'ev':
        if (this.authority) return;
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
        this.stats.eventsApplied++;
        this.log.push({ type: d.type, seq: d.seq });
        if (this.log.length > 400) this.log.shift();
        h.applyEvent(d.type, d.args, false);
        return;
      case 'full':
        if (this.authority) return;
        h.applyFull(d.state);
        return;
      case 'needFull':
        if (this.authority) this.sendFull();
        return;
      case 'hold':
        h.onHold(d.id, d.on, 'peer');
        return;
      case 'skip':
        h.onSkip(d.id, 'peer');
        return;
      case 'hit':
        h.onHit(d.target, d.dmg, d.dir, d.kind);
        return;
      case 'loaded':
        h.onPeerLoaded(d.chapter, d.checkpoint);
        return;
      case 'chat':
      case 'app':
        return;
    }
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.handlers = null;
  }
}
