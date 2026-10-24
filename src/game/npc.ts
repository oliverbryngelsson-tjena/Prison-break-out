// NPCs: guards, inmates, thugs and police. Simulated on the authority, interpolated elsewhere.
import * as THREE from 'three';
import type { CharacterId, NpcSnap } from '../../shared/protocol';
import { LOCO_GUARD, LOCO_INJURED, LOCO_NORMAL, type CharacterModel } from '../engine/characters';
import { Body } from './body';
import type { NavGraph } from './nav';
import { POSES, lerpAngle, type PoseCtx } from './poses';
import type { World } from './world';
import type { Combatant } from './player';

export type NpcRole = 'guard' | 'inmate' | 'thug' | 'police' | 'story' | 'dog';
export type NpcState = 'idle' | 'patrol' | 'suspicious' | 'investigate' | 'alert' | 'search' | 'return' | 'combat' | 'stunned' | 'down' | 'distracted' | 'scripted' | 'flee';

export interface NpcDef {
  id: string;
  char: string;
  variant?: string;
  pos: [number, number, number];
  yaw?: number;
  role: NpcRole;
  name?: string;
  /** Waypoints: [x, z, waitSeconds?, lookYaw?] (y follows the ground). */
  patrol?: Array<[number, number, number?, number?]>;
  idleClip?: string;
  idlePose?: string;
  vision?: { range: number; fov: number };
  /** Attacks players when alerted. */
  hostile?: boolean;
  /** Ends the attempt (caught) on contact when alerted. */
  catches?: boolean;
  hp?: number;
  walk?: number;
  run?: number;
  loco?: 'guard' | 'normal' | 'injured';
  damage?: number;
  /** Cannot be taken down from behind. */
  noTakedown?: boolean;
  /** Ignore players completely (ambient). */
  passive?: boolean;
  look?: boolean;
}

export interface Perceivable {
  char: CharacterId;
  body: Body;
  /** Not detectable (hidden, in cutscene). */
  ignore: boolean;
  /** Multiplier for light at the player's position (0 dark .. 1 bright). */
  light: number;
}

export interface NpcHooks {
  nav: NavGraph | null;
  players(): Perceivable[];
  /** A guard caught a player (authority). */
  onCaught(npc: Npc, who: CharacterId): void;
  /** A guard spotted a player and raised the alarm (authority). */
  onSpotted(npc: Npc, who: CharacterId): void;
  /** NPC attacks a player (authority decides, game applies locally or sends to peer). */
  onAttackPlayer(npc: Npc, who: CharacterId, dmg: number, kind: 'punch' | 'heavy'): void;
  onKO(npc: Npc): void;
  bark(npc: Npc, kind: 'suspicious' | 'alert' | 'lost' | 'hit' | 'search' | 'attack'): void;
  /** Light level at a point (0..1). */
  lightAt(p: THREE.Vector3): number;
  /** How suspicious it is for this player to be seen here right now (0 = allowed). */
  suspicion(who: CharacterId, p: THREE.Vector3, npc: Npc): number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Npc implements Combatant {
  readonly body: Body;
  state: NpcState = 'idle';
  private homePos: THREE.Vector3;
  private homeYaw: number;
  awareness: Record<CharacterId, number> = { elias: 0, jax: 0 };
  target: CharacterId | null = null;
  private wp = 0;
  private waitT = 0;
  private path: THREE.Vector3[] = [];
  private pathT = 0;
  private stateT = 0;
  private lastSeen = new THREE.Vector3();
  private investigatePos = new THREE.Vector3();
  private attackCd = 1;
  private windup = -1;
  private distractPos: THREE.Vector3 | null = null;
  private distractT = 0;
  private sightT = 0;
  hostile: boolean;
  /** Interpolation buffer for proxies. */
  private buf: NpcSnap[] = [];
  private offset: number | null = null;
  private lastAnimKey = '';
  /** Script control: target position + speed. */
  scriptTarget: THREE.Vector3 | null = null;
  scriptSpeed = 1.4;
  scriptYaw: number | null = null;
  onArrive: (() => void) | null = null;
  private lastSnapPos = new THREE.Vector3();
  private stuckT = 0;
  private barkT = 0;
  enabled = true;
  /** Last pose name/time for snapshots. */
  pose: string | null = null;
  poseAt = 0;
  idleClipPlaying: string | null = null;

  constructor(readonly def: NpcDef, model: CharacterModel, world: World, private hooks: NpcHooks) {
    const team = def.role === 'guard' || def.role === 'police' ? (def.role === 'guard' ? 'guard' : 'police') : def.role === 'thug' ? 'thug' : def.role === 'inmate' ? 'prisoner' : 'neutral';
    this.body = new Body(def.id, 'npc', team, model, world);
    this.body.pos.set(...def.pos);
    this.body.yaw = def.yaw ?? 0;
    this.body.hp = this.body.maxHp = def.hp ?? 60;
    this.homePos = this.body.pos.clone();
    this.homeYaw = this.body.yaw;
    this.hostile = !!def.hostile;
    model.setLocoSet(def.loco === 'injured' ? LOCO_INJURED : def.loco === 'normal' || def.role === 'inmate' || def.role === 'thug' ? LOCO_NORMAL : LOCO_GUARD);
    this.state = def.patrol?.length ? 'patrol' : 'idle';
    this.startIdle();
  }

  get id(): string { return this.def.id; }
  get alive(): boolean { return this.state !== 'down' && this.body.alive; }
  get unaware(): boolean { return this.state === 'idle' || this.state === 'patrol' || this.state === 'distracted' || this.state === 'return' || (this.state === 'scripted' && !this.hostile); }
  get stunned(): boolean { return this.state === 'stunned'; }
  get world(): World { return this.body.world; }

  private startIdle(): void {
    if (this.def.idlePose) this.body.setPose(this.def.idlePose);
    else if (this.def.idleClip && this.state === 'idle') { this.body.model.play(this.def.idleClip, { fade: 0.4 }); this.idleClipPlaying = this.def.idleClip; }
  }

  private stopIdle(): void {
    if (this.idleClipPlaying) { this.body.model.stop('full', 0.3); this.idleClipPlaying = null; }
  }

  reset(): void {
    this.body.pos.copy(this.homePos);
    this.body.yaw = this.homeYaw;
    this.body.hp = this.body.maxHp;
    this.body.alive = true;
    this.awareness = { elias: 0, jax: 0 };
    this.target = null;
    this.wp = 0;
    this.path = [];
    this.windup = -1;
    this.scriptTarget = null;
    this.body.clearPose(0);
    this.state = this.def.patrol?.length ? 'patrol' : 'idle';
    this.startIdle();
  }

  setState(s: NpcState): void {
    if (this.state === s) return;
    if (this.state === 'idle') this.stopIdle();
    this.state = s;
    this.stateT = 0;
    this.path = [];
    if (s === 'idle') this.startIdle();
  }

  /** Make this NPC look at something for a while (distraction). */
  distract(at: THREE.Vector3, seconds: number): void {
    if (!this.alive || this.state === 'alert' || this.state === 'combat') return;
    this.distractPos = at.clone();
    this.distractT = seconds;
    this.setState('distracted');
  }

  /** Scripted walk (cutscenes, escorts). */
  walkTo(p: THREE.Vector3, speed = 1.4, onArrive?: () => void, yaw?: number): void {
    this.setState('scripted');
    this.scriptTarget = p.clone();
    this.scriptSpeed = speed;
    this.scriptYaw = yaw ?? null;
    this.onArrive = onArrive ?? null;
  }

  release(): void {
    this.scriptTarget = null;
    this.setState(this.def.patrol?.length ? 'return' : 'idle');
  }

  /** Authority: apply damage. Returns true if KO. */
  hit(dmg: number, dir: [number, number], kind: string): boolean {
    if (!this.alive) return false;
    if (kind === 'takedown') {
      this.setState('down');
      this.body.hp = 0;
      this.pose = 'choked';
      this.poseAt = this.world.time;
      this.body.setPose('choked', {}, { onEnd: () => { if (this.state === 'down') { this.pose = 'lying'; this.poseAt = this.world.time; this.body.setPose('lying'); } } });
      this.hooks.onKO(this);
      return true;
    }
    // Enemies sometimes block frontal punches.
    const faceDot = Math.sin(this.body.yaw) * -dir[0] + Math.cos(this.body.yaw) * -dir[1];
    if (this.state === 'combat' && this.windup < 0 && faceDot > 0.5 && kind !== 'heavy' && Math.random() < 0.25) {
      this.setPose('block');
      return false;
    }
    this.body.hp -= dmg;
    this.windup = -1;
    if (this.body.hp <= 0) {
      this.setState('down');
      this.body.yaw = Math.atan2(-dir[0], -dir[1]);
      this.setPose('knockdown', () => { if (this.state === 'down') this.setPose('lying'); });
      this.hooks.onKO(this);
      return true;
    }
    if (kind === 'heavy' && Math.random() < 0.6) {
      this.setState('stunned');
      this.setPose('stagger');
    } else this.setPose('hit_react', undefined, { side: Math.random() < 0.5 ? -1 : 1 });
    // Getting hit makes anyone aware.
    if (this.state !== 'stunned' && this.state !== 'combat' && this.state !== 'alert') {
      this.awareness.elias = this.awareness.jax = 1;
      this.setState(this.hostile ? 'combat' : 'alert');
    }
    this.hooks.bark(this, 'hit');
    return false;
  }

  private setPose(name: string, onEnd?: () => void, k?: Record<string, number>): void {
    this.pose = name;
    this.poseAt = this.world.time;
    this.body.setPose(name, k ? { k } : {}, { restart: true, onEnd: () => { if (this.pose === name) this.pose = null; onEnd?.(); } });
  }

  // ------------------------------------------------------------------ authority simulation
  updateAuthority(dt: number): void {
    const b = this.body;
    this.stateT += dt;
    this.barkT -= dt;
    if (!this.enabled) { b.speed = 0; b.updateVisual(dt); return; }
    if (this.state !== 'down' && this.state !== 'scripted' && !this.def.passive) this.perceive(dt);
    let moveTarget: THREE.Vector3 | null = null;
    let speed = 0;
    switch (this.state) {
      case 'idle':
        b.speed = 0;
        if (this.stateT > 0.1 && Math.abs(lerpAngle(b.yaw, this.homeYaw, 1) - b.yaw) > 0.05 && b.pos.distanceTo(this.homePos) < 0.5) b.yaw = lerpAngle(b.yaw, this.homeYaw, dt * 3);
        break;
      case 'patrol': {
        const pts = this.def.patrol!;
        const p = pts[this.wp];
        tmp.set(p[0], b.pos.y, p[1]);
        if (b.pos.distanceTo(tmp) < 0.35) {
          this.waitT += dt;
          if (p[3] !== undefined) b.yaw = lerpAngle(b.yaw, p[3], dt * 3);
          if (this.waitT >= (p[2] ?? 0)) { this.waitT = 0; this.wp = (this.wp + 1) % pts.length; this.path = []; }
          if ((p[2] ?? 0) > 0.5 && this.waitT > 0.3 && this.waitT < 0.35 && Math.random() < 0.3) this.body.model.play('idle_look', { loop: false, fade: 0.4 });
        } else { moveTarget = tmp.clone(); speed = this.def.walk ?? 1.05; }
        break;
      }
      case 'distracted':
        b.speed = 0;
        this.distractT -= dt;
        if (this.distractPos) b.yaw = lerpAngle(b.yaw, Math.atan2(this.distractPos.x - b.pos.x, this.distractPos.z - b.pos.z), dt * 4);
        if (this.distractT <= 0) { this.distractPos = null; this.setState(this.def.patrol?.length ? 'patrol' : 'return'); }
        break;
      case 'suspicious':
        b.speed = 0;
        b.yaw = lerpAngle(b.yaw, Math.atan2(this.lastSeen.x - b.pos.x, this.lastSeen.z - b.pos.z), dt * 3);
        if (this.stateT > 2.2 && this.maxAwareness() < 0.5) { this.investigatePos.copy(this.lastSeen); this.setState('investigate'); }
        if (this.maxAwareness() < 0.05) this.setState(this.def.patrol?.length ? 'patrol' : 'return');
        break;
      case 'investigate':
        if (b.pos.distanceTo(this.investigatePos) > 0.8 && this.stateT < 12) { moveTarget = this.investigatePos; speed = 1.25; }
        else {
          b.speed = 0;
          if (this.stateT > 12 || this.waitT > 3.5) { this.waitT = 0; this.hooks.bark(this, 'lost'); this.setState('return'); }
          else { this.waitT += dt; b.yaw += Math.sin(this.stateT * 1.5) * dt * 1.2; }
        }
        break;
      case 'alert': {
        const tgt = this.targetBody();
        if (!tgt) { this.setState('search'); break; }
        this.lastSeen.copy(tgt.pos);
        moveTarget = tgt.pos;
        speed = this.def.run ?? 4.6;
        if (this.def.catches && b.pos.distanceTo(tgt.pos) < 1.1) {
          this.hooks.onCaught(this, this.target!);
          this.setState('idle');
        }
        if (this.sightT > 4.5) { this.hooks.bark(this, 'search'); this.setState('search'); }
        break;
      }
      case 'search':
        if (b.pos.distanceTo(this.lastSeen) > 0.8 && this.stateT < 10) { moveTarget = this.lastSeen; speed = 2.2; }
        else {
          b.speed = 0;
          b.yaw += dt * 1.4;
          if (this.stateT > 7) { this.hooks.bark(this, 'lost'); this.setState('return'); this.awareness.elias = this.awareness.jax = 0; }
        }
        break;
      case 'return':
        if (this.def.patrol?.length) { this.setState('patrol'); break; }
        if (b.pos.distanceTo(this.homePos) > 0.4) { moveTarget = this.homePos; speed = this.def.walk ?? 1.1; }
        else this.setState('idle');
        break;
      case 'combat':
        this.updateCombat(dt);
        moveTarget = this.combatMove;
        speed = this.combatSpeed;
        break;
      case 'stunned':
        b.speed = 0;
        if (this.stateT > 2.2) this.setState(this.hostile ? 'combat' : 'alert');
        break;
      case 'down':
        b.speed = 0;
        break;
      case 'scripted':
        if (this.scriptTarget) {
          if (b.pos.distanceTo(this.scriptTarget) > 0.25) { moveTarget = this.scriptTarget; speed = this.scriptSpeed; }
          else {
            b.speed = 0;
            if (this.scriptYaw !== null) b.yaw = lerpAngle(b.yaw, this.scriptYaw, dt * 4);
            const cb = this.onArrive;
            this.onArrive = null;
            cb?.();
          }
        } else b.speed = 0;
        break;
      case 'flee':
        break;
    }
    if (moveTarget && speed > 0) this.moveToward(moveTarget, speed, dt);
    else b.speed += (0 - b.speed) * Math.min(1, dt * 8);
    this.ground(dt);
    b.updateVisual(dt);
  }

  private combatMove: THREE.Vector3 | null = null;
  private combatSpeed = 0;

  private updateCombat(dt: number): void {
    const b = this.body;
    const tgt = this.targetBody();
    this.combatMove = null;
    this.combatSpeed = 0;
    if (!tgt) { this.setState('search'); return; }
    const d = b.pos.distanceTo(tgt.pos);
    const faceYaw = Math.atan2(tgt.pos.x - b.pos.x, tgt.pos.z - b.pos.z);
    b.yaw = lerpAngle(b.yaw, faceYaw, dt * 6);
    if (this.pose !== 'guard' && !this.pose) this.setPose('guard');
    if (this.windup >= 0) {
      this.windup += dt;
      if (this.windup >= 0.55) {
        this.windup = -1;
        this.attackCd = 1.1 + Math.random() * 1.2;
        const heavy = Math.random() < 0.25;
        this.setPose(heavy ? 'hook' : 'punch_r');
        if (d < 1.6 && Math.cos(b.yaw - faceYaw) > 0.7) this.hooks.onAttackPlayer(this, this.target!, (this.def.damage ?? 14) * (heavy ? 1.6 : 1), heavy ? 'heavy' : 'punch');
      }
      return;
    }
    if (d > 1.3) { this.combatMove = tgt.pos; this.combatSpeed = d > 4 ? (this.def.run ?? 4) : 1.6; }
    else {
      this.attackCd -= dt;
      // Circle slowly
      tmp2.set(Math.cos(faceYaw), 0, -Math.sin(faceYaw)).multiplyScalar(Math.sin(this.stateT * 0.7) * 0.4);
      if (this.attackCd <= 0) { this.windup = 0; this.hooks.bark(this, 'attack'); }
    }
  }

  maxAwareness(): number {
    return Math.max(this.awareness.elias, this.awareness.jax);
  }

  private targetBody(): Body | null {
    if (!this.target) return null;
    const p = this.hooks.players().find((x) => x.char === this.target);
    if (!p || p.ignore || !p.body.alive) return null;
    return p.body;
  }

  private perceive(dt: number): void {
    const b = this.body;
    const vis = this.def.vision ?? { range: 13, fov: 100 };
    const eye = tmp.set(b.pos.x, b.pos.y + 1.65, b.pos.z);
    const fwd = b.forward(tmp2);
    let anySeen = false;
    let best: CharacterId | null = null;
    let bestA = 0;
    for (const p of this.hooks.players()) {
      const pb = p.body;
      let aw = this.awareness[p.char];
      let seen = false;
      const closeBy = pb.pos.distanceTo(b.pos) < 2.2;
      if (!p.ignore && !pb.hidden && pb.alive && (!pb.concealed || closeBy)) {
        const to = new THREE.Vector3().subVectors(pb.pos, b.pos);
        to.y = 0;
        const d = to.length();
        if (d < vis.range) {
          to.normalize();
          const ang = Math.acos(THREE.MathUtils.clamp(to.dot(fwd), -1, 1));
          const inCone = ang < THREE.MathUtils.degToRad(vis.fov / 2);
          const close = d < 1.6;
          if ((inCone || close) && this.world.physics.lineOfSight(eye, pb.chest())) {
            seen = (this.hostile ? 1 : this.hooks.suspicion(p.char, pb.pos, this)) > 0;
            const light = Math.max(0.25, p.light);
            const dist = 1 - d / vis.range;
            const sus = this.hostile ? 1 : this.hooks.suspicion(p.char, pb.pos, this);
            let rate = (0.35 + 2.1 * dist * dist) * light * sus;
            if (pb.crouched) rate *= 0.45;
            if (pb.speed > 3) rate *= 1.6;
            if (!inCone) rate *= 0.6;
            if (this.state === 'suspicious' || this.state === 'investigate' || this.state === 'search') rate *= 1.6;
            aw = Math.min(1, aw + rate * dt);
          }
        }
      }
      if (!seen) aw = Math.max(0, aw - dt * (this.state === 'alert' || this.state === 'combat' ? 0.08 : 0.3));
      this.awareness[p.char] = aw;
      if (seen) { anySeen = true; if (aw > bestA) { bestA = aw; best = p.char; } }
    }
    // Hearing
    for (const n of this.world.noises) {
      if (n.source === this.id) continue;
      const d = n.pos.distanceTo(b.pos);
      if (d < n.radius && this.state !== 'alert' && this.state !== 'combat') {
        if (n.kind === 'distraction') { this.investigatePos.copy(n.pos); if (this.state !== 'investigate') { this.hooks.bark(this, 'suspicious'); this.setState('investigate'); } }
        else if (this.unaware || this.state === 'suspicious') {
          this.lastSeen.copy(n.pos);
          for (const c of ['elias', 'jax'] as const) if (n.source === c) this.awareness[c] = Math.min(0.95, this.awareness[c] + 0.4);
          if (this.state !== 'suspicious' && this.state !== 'investigate') { this.hooks.bark(this, 'suspicious'); this.setState('suspicious'); }
        }
        n.radius = 0; // consumed
      }
    }
    if (anySeen && best) {
      const p = this.hooks.players().find((x) => x.char === best)!;
      this.lastSeen.copy(p.body.pos);
      this.sightT = 0;
      if (bestA >= 1 && this.state !== 'alert' && this.state !== 'combat' && this.state !== 'stunned') {
        this.target = best;
        this.hooks.bark(this, 'alert');
        this.hooks.onSpotted(this, best);
        this.setState(this.hostile ? 'combat' : 'alert');
      } else if (bestA > 0.25 && this.unaware && this.state !== 'distracted') {
        this.hooks.bark(this, 'suspicious');
        this.setState('suspicious');
      } else if (this.state === 'distracted' && bestA > 0.75) {
        this.setState('suspicious');
      }
      if (this.state === 'alert' || this.state === 'combat') this.target = best;
    } else this.sightT += dt;
  }

  private moveToward(target: THREE.Vector3, speed: number, dt: number): void {
    const b = this.body;
    // Re-plan every second or when the path is empty.
    this.pathT -= dt;
    if (!this.path.length || this.pathT <= 0) {
      this.path = this.hooks.nav ? this.hooks.nav.path(b.pos, target) : [target.clone()];
      this.pathT = this.state === 'alert' || this.state === 'combat' ? 0.4 : 1.5;
    }
    let next = this.path[0];
    while (next && Math.hypot(next.x - b.pos.x, next.z - b.pos.z) < 0.35 && this.path.length > 1) { this.path.shift(); next = this.path[0]; }
    if (!next) return;
    const dx = next.x - b.pos.x, dz = next.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { b.speed = 0; return; }
    const want = Math.atan2(dx, dz);
    b.yaw = lerpAngle(b.yaw, want, Math.min(1, dt * 7));
    const facing = Math.cos(b.yaw - want);
    const v = speed * Math.max(0.2, facing);
    const step = Math.min(d, v * dt);
    const before = b.pos.clone();
    this.world.physics.moveCapsule(b.pos, (dx / d) * step, (dz / d) * step, b.radius, 1.75, 0.36);
    // Avoid other characters.
    for (const a of this.world.actors.values()) {
      if (a === b || !a.solid || a.hidden || !a.alive) continue;
      const ox = b.pos.x - a.pos.x, oz = b.pos.z - a.pos.z;
      const od = Math.hypot(ox, oz);
      const min = b.radius + a.radius;
      if (od < min && od > 1e-4) { b.pos.x += (ox / od) * (min - od) * 0.5; b.pos.z += (oz / od) * (min - od) * 0.5; }
    }
    const moved = before.distanceTo(b.pos) / Math.max(dt, 1e-4);
    b.speed += (moved - b.speed) * Math.min(1, dt * 10);
    if (moved < speed * 0.2) { this.stuckT += dt; if (this.stuckT > 1) { this.path = []; this.stuckT = 0; } } else this.stuckT = 0;
  }

  private ground(dt: number): void {
    const b = this.body;
    const g = this.world.physics.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.4);
    if (g) b.pos.y += (g.y - b.pos.y) * Math.min(1, dt * 14);
  }

  snapshot(): NpcSnap {
    const b = this.body;
    const s: NpcSnap = {
      id: this.id,
      p: [+b.pos.x.toFixed(3), +b.pos.y.toFixed(3), +b.pos.z.toFixed(3)],
      y: +b.yaw.toFixed(3),
      s: +b.speed.toFixed(2),
      st: this.state,
      aw: [+this.awareness.elias.toFixed(2), +this.awareness.jax.toFixed(2)],
    };
    if (this.pose && POSES[this.pose]) { s.a = this.pose; s.at = +(this.world.time - this.poseAt).toFixed(2); }
    if (this.windup >= 0) s.x = [1];
    if (this.idleClipPlaying) s.x = [...(s.x ?? [0]), 0];
    s.hp = Math.round(b.hp);
    return s;
  }

  // ------------------------------------------------------------------ proxy (non-authority)
  pushSnap(s: NpcSnap, tm: number, localTime: number): void {
    const off = localTime - tm;
    if (this.offset === null || off < this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.003;
    (s as NpcSnap & { _t: number })._t = tm;
    this.buf.push(s);
    if (this.buf.length > 30) this.buf.shift();
  }

  updateProxy(dt: number, localTime: number): void {
    const b = this.body;
    if (this.buf.length && this.offset !== null) {
      const rt = localTime - this.offset - 0.15;
      const tOf = (x: NpcSnap) => (x as NpcSnap & { _t: number })._t;
      let a = this.buf[0], c = this.buf[this.buf.length - 1];
      for (let i = 0; i < this.buf.length - 1; i++) if (tOf(this.buf[i]) <= rt && tOf(this.buf[i + 1]) >= rt) { a = this.buf[i]; c = this.buf[i + 1]; break; }
      let k = 0;
      if (rt >= tOf(c)) a = c;
      else if (rt > tOf(a)) k = (rt - tOf(a)) / Math.max(1e-4, tOf(c) - tOf(a));
      const target = tmp.set(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
      if (target.distanceTo(b.pos) > 3) b.pos.copy(target); else b.pos.lerp(target, Math.min(1, dt * 15));
      b.yaw = lerpAngle(b.yaw, lerpAngle(a.y, c.y, k), Math.min(1, dt * 15));
      b.speed = a.s + (c.s - a.s) * k;
      const latest = this.buf[this.buf.length - 1];
      if (latest.st !== this.state) {
        const wasIdle = this.state === 'idle';
        this.state = latest.st as NpcState;
        if (this.state === 'idle' && !wasIdle) this.startIdle();
        if (wasIdle && this.state !== 'idle') this.stopIdle();
      }
      if (latest.aw) { this.awareness.elias = latest.aw[0]; this.awareness.jax = latest.aw[1]; }
      if (latest.hp !== undefined) b.hp = latest.hp;
      const key = latest.a ? `${latest.a}` + (POSES[latest.a]?.dur === Infinity ? '' : `@${Math.floor((localTime - (latest.at ?? 0)) * 2)}`) : '';
      if ((latest.a ?? '') !== (this.pose ?? '')) {
        this.pose = latest.a ?? null;
        if (latest.a) b.setPose(latest.a, {}, { restart: true, startAt: Math.min(latest.at ?? 0, POSES[latest.a].dur === Infinity ? 0 : POSES[latest.a].dur * 0.9) });
        else b.clearPose(0.25);
      }
      void key;
      this.lastAnimKey = '';
      this.lastSnapPos.copy(b.pos);
    }
    b.updateVisual(dt);
  }

  /** Proxy-side: whether the NPC is winding up an attack (telegraph). */
  get windingUp(): boolean {
    if (this.buf.length) return !!this.buf[this.buf.length - 1].x?.[0];
    return this.windup >= 0;
  }

  setPoseCtx(ctx: PoseCtx): void {
    this.body.updatePoseCtx(ctx);
  }

  dispose(): void {
    this.body.dispose();
  }
}
