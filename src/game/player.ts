// Local player controller and remote (partner) avatar.
import * as THREE from 'three';
import type { CharacterId, PlayerSnap } from '../../shared/protocol';
import type { Input } from '../engine/input';
import type { CameraRig } from '../engine/camera';
import type { AudioManager } from '../engine/audio';
import { Body } from './body';
import type { World } from './world';
import type { InteractionSystem, InteractDef } from './interact';
import type { Session } from './session';
import { POSES, lerpAngle, type PoseCtx } from './poses';

export interface Combatant {
  id: string;
  body: Body;
  hostile: boolean;
  /** Not aware of the player (rear takedown possible). */
  unaware: boolean;
  stunned: boolean;
  alive: boolean;
}

export interface PlayerCtx {
  world: World;
  session: Session;
  audio: AudioManager;
  input: Input;
  cam: CameraRig;
  interact: InteractionSystem;
  combatants(): Combatant[];
  /** Local player hit an enemy (NPC) or the partner (final fight). */
  onAttack(targetId: string, dmg: number, dir: [number, number], kind: 'punch' | 'heavy' | 'takedown'): void;
  onInteract(def: InteractDef, phase: 'press' | 'holdStart' | 'holdEnd' | 'complete'): void;
  onDowned(): void;
  flags: { jump: boolean; sprint: boolean; combat: boolean; crouch: boolean };
}

export interface ScriptStep {
  to: THREE.Vector3;
  dur: number;
  yaw?: number;
  pose?: string;
  poseCtx?: PoseCtx | ((t: number) => PoseCtx);
  /** Locomotion speed shown while moving (m/s). */
  anim?: number;
  crouch?: boolean;
  ease?: 'linear' | 'inOut' | 'out';
  /** Arc height (jumps, vaults). */
  arc?: number;
  onStart?: () => void;
}

const easeF = (t: number, e?: ScriptStep['ease']) => (e === 'linear' ? t : e === 'out' ? 1 - (1 - t) ** 2 : t * t * (3 - 2 * t));

export type PlayerState = 'free' | 'scripted' | 'busy' | 'downed' | 'cutscene' | 'bike' | 'hidden';

export class PlayerController {
  state: PlayerState = 'free';
  readonly body: Body;
  private ctx: PlayerCtx;
  private vy = 0;
  private moveVel = new THREE.Vector3();
  private script: { steps: ScriptStep[]; i: number; t: number; from: THREE.Vector3; fromYaw: number; done?: () => void } | null = null;
  crawlMode = false;
  /** Health regenerates after a few seconds without damage (off in the final fight). */
  regen = true;
  /** Seconds since last damage (for regeneration). */
  private sinceHit = 99;
  private combo = 0;
  private comboT = 0;
  private attackT = -1;
  private attackHit = false;
  private attackTarget: Combatant | null = null;
  private attackKind: 'punch_r' | 'punch_l' | 'hook' = 'punch_r';
  blocking = false;
  private dodgeT = -1;
  private dodgeDir = new THREE.Vector3();
  invulnerable = 0;
  sprinting = false;
  /** Walk speed limit imposed by the level (e.g. inside the cell block). */
  maxSpeed = 6;
  /** World point the head looks at (sent to the partner). */
  look: THREE.Vector3 | null = null;
  inCombat = false;
  private holdDef: InteractDef | null = null;
  variant = 'prison';
  private wallNormal = new THREE.Vector3();
  takedownTarget: Combatant | null = null;

  constructor(readonly char: CharacterId, body: Body, ctx: PlayerCtx) {
    this.body = body;
    this.ctx = ctx;
  }

  teleport(p: THREE.Vector3Like, yaw?: number): void {
    this.body.pos.set(p.x, p.y, p.z);
    if (yaw !== undefined) this.body.yaw = yaw;
    this.vy = 0;
    this.moveVel.set(0, 0, 0);
    this.body.speed = 0;
  }

  /** Runs a scripted sequence of moves (climbs, vaults, boosts, cutscene walks). */
  runScript(steps: ScriptStep[], done?: () => void): void {
    this.cancelHold();
    this.state = 'scripted';
    this.script = { steps, i: 0, t: 0, from: this.body.pos.clone(), fromYaw: this.body.yaw, done };
    steps[0]?.onStart?.();
    this.applyStepPose(steps[0]);
  }

  private applyStepPose(s: ScriptStep | undefined): void {
    if (!s) return;
    if (s.pose) {
      const pc = typeof s.poseCtx === 'function' ? s.poseCtx(0) : s.poseCtx;
      if (this.body.poseName !== s.pose) this.body.setPose(s.pose, pc ?? {});
    } else if (this.body.poseName) this.body.clearPose(0.2);
  }

  get scripted(): boolean {
    return this.state === 'scripted';
  }

  cancelScript(): void {
    this.script = null;
    if (this.state === 'scripted') this.state = 'free';
  }

  setBusy(on: boolean): void {
    if (on) { this.state = 'busy'; this.body.speed = 0; }
    else if (this.state === 'busy') this.state = 'free';
  }

  takeHit(dmg: number, fromYaw: number, kind: string): boolean {
    if (this.invulnerable > 0 || this.state === 'downed' || this.state === 'cutscene') return false;
    const b = this.body;
    // Attack comes from direction fromYaw (attacker facing). Blocking works if we face the attacker.
    const toAttacker = fromYaw + Math.PI;
    const facing = Math.cos(b.yaw - toAttacker) > 0.3;
    if (this.blocking && facing && kind !== 'heavy') {
      this.ctx.audio.play('hit_soft', { pos: b.chest(), volume: 0.7, jitter: 0.1 });
      this.ctx.cam.addShake(0.12);
      b.hp -= dmg * 0.12;
      return false;
    }
    b.hp -= dmg;
    this.sinceHit = 0;
    this.ctx.cam.addShake(kind === 'heavy' ? 0.45 : 0.28);
    this.ctx.audio.play(kind === 'heavy' ? 'punch_heavy' : 'punch', { pos: b.chest(), volume: 0.9, jitter: 0.1 });
    if (Math.random() < 0.6) this.ctx.audio.play('grunt', { pos: b.head(), volume: 0.6, jitter: 0.12 });
    this.attackT = -1;
    if (b.hp <= 0) {
      b.hp = 0;
      this.goDowned();
      return true;
    }
    const side = Math.sin(b.yaw - toAttacker) > 0 ? 1 : -1;
    b.setPose(kind === 'heavy' ? 'stagger' : 'hit_react', { k: { side } }, { restart: true });
    // knockback
    const kb = new THREE.Vector3(Math.sin(fromYaw), 0, Math.cos(fromYaw)).multiplyScalar(kind === 'heavy' ? 1.2 : 0.5);
    this.moveVel.add(kb.multiplyScalar(3));
    return true;
  }

  goDowned(): void {
    this.cancelHold();
    this.script = null;
    this.state = 'downed';
    this.body.speed = 0;
    this.body.setPose('downed');
    this.ctx.onDowned();
  }

  revive(): void {
    if (this.state !== 'downed') return;
    this.state = 'free';
    this.body.hp = 45;
    this.body.clearPose(0.6);
    this.invulnerable = 2;
  }

  private cancelHold(): void {
    if (this.holdDef) {
      this.ctx.onInteract(this.holdDef, 'holdEnd');
      this.holdDef = null;
      this.ctx.interact.holding = null;
      this.ctx.interact.holdT = 0;
      if (this.state === 'busy') this.state = 'free';
      this.body.clearPose(0.25);
    }
  }

  update(dt: number): void {
    const b = this.body;
    const inp = this.ctx.input;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.sinceHit += dt;
    if (this.regen && this.sinceHit > 5 && b.hp < b.maxHp && this.state !== 'downed') b.hp = Math.min(b.maxHp, b.hp + 9 * dt);
    this.ctx.interact.time += dt;

    switch (this.state) {
      case 'scripted': this.updateScript(dt); break;
      case 'cutscene': case 'bike': break;
      case 'downed': b.speed = 0; this.applyGravity(dt); break;
      case 'hidden': b.speed = 0; if (inp.buttons.interact.pressed) this.interactNearby(); break;
      case 'busy': this.updateHold(dt); this.applyGravity(dt); break;
      default: this.updateFree(dt);
    }
    b.updateVisual(dt);
    b.surface = this.ctx.world.surfaceAt(b.pos.x, b.pos.z, b.pos.y);
  }

  private interactNearby(): void {
    const d = this.ctx.interact.find(this.char, this.body.pos, this.body.yaw);
    if (d) this.useInteract(d);
  }

  private useInteract(d: InteractDef): void {
    const mode = d.mode ?? 'press';
    if (d.facing !== undefined) this.body.yaw = d.facing;
    if (mode === 'press') {
      this.ctx.interact.markUsed(d.id);
      this.ctx.onInteract(d, 'press');
      d.onUse?.(this.char);
    } else {
      this.holdDef = d;
      this.ctx.interact.holding = d;
      this.ctx.interact.holdT = 0;
      this.state = 'busy';
      this.body.speed = 0;
      if (d.stand) { this.body.pos.x = d.stand.x; this.body.pos.z = d.stand.z; }
      if (d.pose) this.body.setPose(d.pose, d.poseCtx ?? {});
      d.onHold?.(true);
      this.ctx.onInteract(d, 'holdStart');
    }
  }

  private updateHold(dt: number): void {
    const d = this.holdDef;
    const inp = this.ctx.input;
    if (!d) { this.state = 'free'; return; }
    const still = inp.buttons.interact.down;
    const tooFar = d.pos.distanceTo(this.body.pos) > (d.radius ?? 1.3) + 0.6;
    if (!still || tooFar || (d.enabled && !d.enabled())) {
      d.onHold?.(false);
      this.cancelHold();
      return;
    }
    if (d.coop) return; // completion comes from the authority via an event
    this.ctx.interact.holdT += dt;
    if (this.ctx.interact.holdT >= (d.holdTime ?? 1.5)) {
      const def = d;
      this.holdDef = null;
      this.ctx.interact.holding = null;
      this.ctx.interact.markUsed(def.id);
      this.state = 'free';
      this.body.clearPose(0.3);
      def.onHold?.(false);
      this.ctx.onInteract(def, 'complete');
      def.onUse?.(this.char);
    }
  }

  /** Called when a co-op group completes (event from the authority). */
  endCoopHold(): void {
    if (this.holdDef) {
      this.holdDef = null;
      this.ctx.interact.holding = null;
      if (this.state === 'busy') this.state = 'free';
      this.body.clearPose(0.3);
    }
  }

  private updateFree(dt: number): void {
    const b = this.body;
    const inp = this.ctx.input;
    const cam = this.ctx.cam;
    const f = this.ctx.flags;

    // --- crouch toggle
    if (f.crouch && inp.buttons.crouch.pressed && !this.crawlMode) b.crouched = !b.crouched;
    if (this.crawlMode) b.crouched = true;

    // --- interactions
    const cand = this.ctx.interact.find(this.char, b.pos, b.yaw);
    this.ctx.interact.current = cand;
    if (inp.buttons.interact.pressed && cand && this.attackT < 0) {
      this.useInteract(cand);
      return;
    }

    // --- combat
    this.updateCombat(dt);

    // --- movement
    const mv = inp.move;
    const mag = Math.min(1, mv.length());
    const fwd = cam.forward, right = cam.right;
    const wish = new THREE.Vector3().addScaledVector(fwd, mv.y).addScaledVector(right, mv.x);
    if (wish.lengthSq() > 1e-4) wish.normalize();
    const attacking = this.attackT >= 0;
    const dodging = this.dodgeT >= 0;
    this.sprinting = f.sprint && !b.crouched && mag > 0.9 && (inp.buttons.sprint.down || (inp.device === 'touch' && inp.heldFor('sprint') > 0));
    let target = 0;
    if (mag > 0.05) {
      if (this.crawlMode) target = 0.9 * mag;
      else if (b.crouched) target = mag < 0.6 ? 0.9 : 1.45;
      else if (this.sprinting) target = 5.6;
      else target = mag < 0.55 ? 1.5 * (mag / 0.55) + 0.2 : 3.2 + (mag - 0.55) * 1.3;
      if (this.blocking) target = Math.min(target, 1.2);
      target = Math.min(target, this.maxSpeed);
      // Wading slows you down.
      const depth = this.waterDepth();
      if (depth > 0.15) target *= Math.max(0.45, 1 - depth * 0.6);
    }
    if (attacking) target = 0;
    const curSpeed = Math.hypot(this.moveVel.x, this.moveVel.z);
    const accel = target > curSpeed ? 9 : 14;
    const newSpeed = curSpeed + Math.sign(target - curSpeed) * Math.min(Math.abs(target - curSpeed), accel * dt);
    // Turn toward the wish direction.
    if (mag > 0.05 && !attacking) {
      const wantYaw = Math.atan2(wish.x, wish.z);
      const turnRate = (b.crouched ? 8 : 11) * dt;
      b.yaw = lerpAngle(b.yaw, wantYaw, Math.min(1, turnRate));
    }
    const dirV = mag > 0.05 ? wish : new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
    if (dodging) {
      this.dodgeT += dt;
      const k = Math.max(0, 1 - this.dodgeT / 0.4);
      this.moveVel.set(this.dodgeDir.x * 6 * k, 0, this.dodgeDir.z * 6 * k);
      if (this.dodgeT > 0.42) this.dodgeT = -1;
    } else {
      // Blend velocity toward desired direction (keeps momentum on fast turns).
      const want = dirV.clone().multiplyScalar(newSpeed);
      this.moveVel.x += (want.x - this.moveVel.x) * Math.min(1, dt * 10);
      this.moveVel.z += (want.z - this.moveVel.z) * Math.min(1, dt * 10);
    }
    const h = this.crawlMode ? 0.8 : b.crouched ? 1.2 : 1.75;
    const physics = this.ctx.world.physics;
    const before = b.pos.clone();
    physics.moveCapsule(b.pos, this.moveVel.x * dt, this.moveVel.z * dt, b.radius, h, 0.36, undefined, this.wallNormal);
    this.pushOutOfActors();
    // Use actual displacement for animation speed (no running into walls).
    const moved = Math.hypot(b.pos.x - before.x, b.pos.z - before.z) / Math.max(dt, 1e-4);
    b.speed += (Math.min(moved, Math.hypot(this.moveVel.x, this.moveVel.z)) - b.speed) * Math.min(1, dt * 12);
    if (dodging || attacking) b.speed = Math.min(b.speed, 0.4);

    // --- jump / gravity
    if (f.jump && inp.buttons.jump.pressed && b.grounded && !b.crouched && !attacking) {
      this.vy = 4.3;
      b.grounded = false;
      this.ctx.audio.play('whoosh', { pos: b.pos, volume: 0.25 });
    }
    this.applyGravity(dt);

    // Noise for stealth
    const loud = this.sprinting ? 9 : b.speed > 2.5 ? 5.5 : b.crouched ? 0 : b.speed > 0.5 ? 1.8 : 0;
    if (loud > 0 && Math.random() < dt * 4) this.ctx.world.addNoise(b.pos, loud, this.char, 'step');
    cam.fovBoost = this.sprinting ? 6 : 0;
  }

  /** Depth of water at the player's feet (0 when dry). */
  waterDepth(): number {
    const b = this.body;
    const ph = this.ctx.world.physics;
    for (const w of ph.water) if (b.pos.x >= w.minX && b.pos.x <= w.maxX && b.pos.z >= w.minZ && b.pos.z <= w.maxZ && b.pos.y < w.y) return w.y - b.pos.y;
    return 0;
  }

  private applyGravity(dt: number): void {
    const b = this.body;
    const phys = this.ctx.world.physics;
    const g = phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.36);
    const gy = g ? g.y : -50;
    if (b.grounded && this.vy <= 0) {
      if (b.pos.y - gy < 0.45) {
        b.pos.y += (gy - b.pos.y) * Math.min(1, dt * 18);
        if (Math.abs(b.pos.y - gy) < 0.01) b.pos.y = gy;
        return;
      }
      b.grounded = false;
    }
    this.vy -= 18 * dt;
    b.pos.y += this.vy * dt;
    if (b.pos.y <= gy) {
      const impact = -this.vy;
      b.pos.y = gy;
      this.vy = 0;
      b.grounded = true;
      if (impact > 5) this.ctx.audio.play('land', { pos: b.pos, volume: Math.min(1, impact / 10) });
    }
    if (b.pos.y < -40) this.ctx.onDowned();
  }

  private pushOutOfActors(): void {
    const b = this.body;
    for (const a of this.ctx.world.actors.values()) {
      if (a === b || !a.solid || a.hidden || !a.alive) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = b.radius + a.radius;
      if (d < min && d > 1e-4) {
        const push = (min - d) * 0.8;
        b.pos.x += (dx / d) * push;
        b.pos.z += (dz / d) * push;
      }
    }
  }

  private updateCombat(dt: number): void {
    const b = this.body;
    const inp = this.ctx.input;
    const f = this.ctx.flags;
    this.takedownTarget = null;
    if (!f.combat) { this.blocking = false; return; }
    const enemies = this.ctx.combatants().filter((c) => c.alive && c.hostile);
    const near = enemies.filter((c) => c.body.pos.distanceTo(b.pos) < 6);
    this.inCombat = near.some((c) => !c.unaware);
    // Rear takedown candidate
    for (const c of enemies) {
      if (!c.unaware && !c.stunned) continue;
      const d = c.body.pos.distanceTo(b.pos);
      if (d > 1.5) continue;
      const toMe = new THREE.Vector3().subVectors(b.pos, c.body.pos).normalize();
      const theirFwd = c.body.forward();
      if (c.stunned || theirFwd.dot(toMe) < -0.3) { this.takedownTarget = c; break; }
    }
    // Block
    const wantBlock = inp.buttons.block.down && this.attackT < 0;
    if (wantBlock !== this.blocking) {
      this.blocking = wantBlock;
      if (wantBlock) b.setPose('block');
      else if (b.poseName === 'block') b.setPose(this.inCombat ? 'guard' : 'guard');
    }
    // Guard stance when enemies are close and aware.
    if (!this.blocking && this.attackT < 0 && this.dodgeT < 0) {
      if (this.inCombat && b.poseName !== 'guard' && !b.poseName?.startsWith('hit') && b.poseName !== 'stagger') b.setPose('guard');
      if (!this.inCombat && b.poseName === 'guard') b.clearPose(0.4);
    }
    // Dodge
    if (inp.buttons.dodge.pressed && this.dodgeT < 0 && this.attackT < 0) {
      const mv = inp.move;
      const cam = this.ctx.cam;
      const dir = new THREE.Vector3().addScaledVector(cam.forward, mv.y).addScaledVector(cam.right, mv.x);
      if (dir.lengthSq() < 0.01) dir.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
      this.dodgeDir.copy(dir.normalize());
      this.dodgeT = 0;
      this.invulnerable = 0.35;
      const side = Math.sign(new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw)).dot(this.dodgeDir)) || 1;
      b.setPose('dodge', { k: { side } }, { restart: true });
      this.ctx.audio.play('whoosh', { pos: b.pos, volume: 0.4 });
    }
    // Attack
    this.comboT += dt;
    if (this.comboT > 0.9) this.combo = 0;
    if (inp.buttons.attack.pressed && this.attackT < 0 && this.dodgeT < 0) {
      if (this.takedownTarget) {
        this.ctx.onAttack(this.takedownTarget.id, 999, [Math.sin(b.yaw), Math.cos(b.yaw)], 'takedown');
        return;
      }
      // Auto-aim toward the nearest enemy in front.
      let best: Combatant | null = null, bestD = 2.6;
      for (const c of near) {
        const d = c.body.pos.distanceTo(b.pos);
        const to = new THREE.Vector3().subVectors(c.body.pos, b.pos).normalize();
        const facing = to.dot(b.forward());
        if (d < bestD && facing > -0.2) { best = c; bestD = d; }
      }
      if (best) b.yaw = Math.atan2(best.body.pos.x - b.pos.x, best.body.pos.z - b.pos.z);
      this.attackTarget = best;
      const kinds = ['punch_r', 'punch_l', 'hook'] as const;
      this.attackKind = kinds[this.combo % 3];
      this.combo++;
      this.comboT = 0;
      this.attackT = 0;
      this.attackHit = false;
      this.blocking = false;
      b.setPose(this.attackKind, {}, { restart: true });
      this.ctx.audio.play('whoosh', { pos: b.chest(), volume: 0.3, rate: 1.2, jitter: 0.1 });
    }
    if (this.attackT >= 0) {
      this.attackT += dt;
      const hitAt = this.attackKind === 'hook' ? 0.22 : 0.14;
      if (!this.attackHit && this.attackT >= hitAt) {
        this.attackHit = true;
        // Hit everything in a short cone in front.
        for (const c of near) {
          const to = new THREE.Vector3().subVectors(c.body.pos, b.pos);
          const d = to.length();
          if (d > 1.45) continue;
          to.normalize();
          if (to.dot(b.forward()) < 0.45) continue;
          const dmg = this.attackKind === 'hook' ? 22 : 12;
          this.ctx.onAttack(c.id, dmg, [to.x, to.z], this.attackKind === 'hook' ? 'heavy' : 'punch');
        }
      }
      if (this.attackT >= POSES[this.attackKind].dur) this.attackT = -1;
    }
  }

  private updateScript(dt: number): void {
    const s = this.script;
    const b = this.body;
    if (!s) { this.state = 'free'; return; }
    const step = s.steps[s.i];
    if (!step) {
      this.script = null;
      this.state = 'free';
      b.clearPose(0.25);
      b.speed = 0;
      s.done?.();
      return;
    }
    s.t += dt;
    const k = step.dur > 0 ? Math.min(1, s.t / step.dur) : 1;
    const e = easeF(k, step.ease);
    b.pos.lerpVectors(s.from, step.to, e);
    if (step.arc) b.pos.y += Math.sin(k * Math.PI) * step.arc;
    if (step.yaw !== undefined) b.yaw = lerpAngle(s.fromYaw, step.yaw, Math.min(1, e * 1.5));
    else {
      const dx = step.to.x - s.from.x, dz = step.to.z - s.from.z;
      if (Math.hypot(dx, dz) > 0.05) b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
    }
    b.crouched = !!step.crouch;
    b.speed = step.anim ?? 0;
    if (step.pose && typeof step.poseCtx === 'function') b.updatePoseCtx(step.poseCtx(k));
    b.grounded = true;
    if (k >= 1) {
      s.i++;
      s.t = 0;
      s.from = step.to.clone();
      s.fromYaw = b.yaw;
      const next = s.steps[s.i];
      next?.onStart?.();
      this.applyStepPose(next);
    }
  }

  snapshot(time: number): PlayerSnap {
    const b = this.body;
    let f = 0;
    if (b.crouched) f |= 1;
    if (this.sprinting) f |= 2;
    if (b.grounded) f |= 4;
    if (this.state === 'downed') f |= 8;
    if (this.state === 'bike') f |= 16;
    if (this.blocking) f |= 32;
    if (b.hidden) f |= 64;
    if (b.concealed) f |= 128;
    const snap: PlayerSnap = {
      tm: time,
      p: [+b.pos.x.toFixed(3), +b.pos.y.toFixed(3), +b.pos.z.toFixed(3)],
      y: +b.yaw.toFixed(3),
      s: +b.speed.toFixed(2),
      f,
      hp: Math.round(b.hp),
      v: this.variant,
    };
    const pose = b.poseName;
    if (pose) {
      snap.a = pose;
      snap.at = +(time - b.poseTime).toFixed(3);
      const pc = b.poseCtx();
      if (pc && (pc.points || pc.k)) {
        snap.pc = {};
        if (pc.points) snap.pc.p = Object.fromEntries(Object.entries(pc.points).map(([k, v]) => [k, [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]]));
        if (pc.k) snap.pc.k = pc.k;
      }
    }
    if (this.look) snap.lk = [+this.look.x.toFixed(2), +this.look.y.toFixed(2), +this.look.z.toFixed(2)];
    return snap;
  }
}

/** The partner's character, driven by network snapshots with interpolation. */
export class RemoteAvatar {
  readonly body: Body;
  private buf: PlayerSnap[] = [];
  /** Estimated (localTime - remoteTime) minimum, i.e. clock offset + min latency. */
  private offset: number | null = null;
  delay = 0.12;
  lastSnapAt = -1;
  downed = false;
  blocking = false;
  /** Riding a bike (snapshot bit 4) and the interpolated bike state [lean, pitch, steer, rpm, spin]. */
  onBike = false;
  bike: number[] | null = null;
  /** Driven by a local script instead of the network. */
  scripted = false;
  /** Held by a cutscene: stays script-driven after a script ends until release(). */
  cutsceneHold = false;
  private lastPoseKey = '';
  variant = 'prison';
  onVariant: ((v: string) => void) | null = null;
  readonly scriptCtl: { steps: ScriptStep[] | null; i: number; t: number; from: THREE.Vector3; fromYaw: number; done?: () => void } = { steps: null, i: 0, t: 0, from: new THREE.Vector3(), fromYaw: 0 };

  constructor(readonly char: CharacterId, body: Body) {
    this.body = body;
  }

  push(s: PlayerSnap, localTime: number): void {
    const off = localTime - s.tm;
    // Track the minimum offset with slow upward drift (handles clock skew and latency spikes).
    if (this.offset === null || off < this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.002;
    if (this.buf.length && s.tm <= this.buf[this.buf.length - 1].tm) return;
    this.buf.push(s);
    if (this.buf.length > 40) this.buf.shift();
    this.lastSnapAt = localTime;
  }

  teleport(p: THREE.Vector3Like, yaw: number): void {
    this.body.pos.set(p.x, p.y, p.z);
    this.body.yaw = yaw;
    this.buf = [];
  }

  /** Same scripted-move support as the local player, used during cutscenes. */
  runScript(steps: ScriptStep[], done?: () => void): void {
    this.scripted = true;
    Object.assign(this.scriptCtl, { steps, i: 0, t: 0, from: this.body.pos.clone(), fromYaw: this.body.yaw, done });
    steps[0]?.onStart?.();
    if (steps[0]?.pose) this.body.setPose(steps[0].pose, (typeof steps[0].poseCtx === 'function' ? steps[0].poseCtx(0) : steps[0].poseCtx) ?? {});
  }

  update(dt: number, localTime: number): void {
    const b = this.body;
    if (this.scripted) {
      this.updateScript(dt);
      b.updateVisual(dt);
      return;
    }
    if (this.buf.length && this.offset !== null) {
      const rt = localTime - this.offset - this.delay;
      let a = this.buf[0], c = this.buf[this.buf.length - 1];
      for (let i = 0; i < this.buf.length - 1; i++) {
        if (this.buf[i].tm <= rt && this.buf[i + 1].tm >= rt) { a = this.buf[i]; c = this.buf[i + 1]; break; }
      }
      let k = 0;
      if (rt >= c.tm) { a = c; k = 0; }
      else if (rt <= a.tm) k = 0;
      else k = (rt - a.tm) / Math.max(1e-4, c.tm - a.tm);
      const target = new THREE.Vector3(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
      // Large corrections (teleports) snap; small ones smooth.
      if (target.distanceTo(b.pos) > 4) b.pos.copy(target);
      else b.pos.lerp(target, Math.min(1, dt * 20));
      b.yaw = lerpAngle(b.yaw, lerpAngle(a.y, c.y, k), Math.min(1, dt * 18));
      b.speed = a.s + (c.s - a.s) * k;
      b.crouched = !!(a.f & 1);
      b.grounded = !!(a.f & 4);
      b.hidden = !!(a.f & 64);
      b.concealed = !!(a.f & 128);
      this.downed = !!(a.f & 8);
      this.blocking = !!(a.f & 32);
      this.onBike = !!(a.f & 16);
      if (a.b && c.b) {
        const lerp = (i: number) => a.b![i] + (c.b![i] - a.b![i]) * k;
        let ds = c.b[4] - a.b[4];
        if (ds < -Math.PI) ds += Math.PI * 2;
        this.bike = [lerp(0), lerp(1), lerp(2), lerp(3), a.b[4] + ds * k, lerp(5), c.b[6] ?? 0];
      } else this.bike = a.b ?? null;
      if (a.hp !== undefined) b.hp = a.hp;
      if (a.v && a.v !== this.variant) { this.variant = a.v; this.onVariant?.(a.v); }
      // Poses
      const latest = this.buf[this.buf.length - 1];
      const src = rt >= latest.tm ? latest : a;
      const key = src.a ? `${src.a}@${src.at}` : '';
      if (key !== this.lastPoseKey) {
        this.lastPoseKey = key;
        if (src.a && POSES[src.a]) {
          const ctx: PoseCtx = {};
          if (src.pc?.p) ctx.points = Object.fromEntries(Object.entries(src.pc.p).map(([kk, v]) => [kk, new THREE.Vector3(...v)]));
          if (src.pc?.k) ctx.k = src.pc.k;
          const def = POSES[src.a];
          const elapsed = src.at !== undefined ? Math.max(0, (localTime - this.offset) - src.at - this.delay) : 0;
          if (def.dur === Infinity || elapsed < def.dur) b.setPose(src.a, ctx, { restart: true, startAt: Math.min(elapsed, def.dur === Infinity ? 0 : def.dur) });
        } else b.clearPose(0.25);
      } else if (src.a && src.pc) {
        const ctx: PoseCtx = {};
        if (src.pc.p) ctx.points = Object.fromEntries(Object.entries(src.pc.p).map(([kk, v]) => [kk, new THREE.Vector3(...v)]));
        if (src.pc.k) ctx.k = src.pc.k;
        b.updatePoseCtx(ctx);
      }
      if (src.lk) b.model.lookTarget = new THREE.Vector3(...src.lk);
      else b.model.lookTarget = null;
    }
    b.updateVisual(dt);
  }

  private updateScript(dt: number): void {
    const s = this.scriptCtl;
    const b = this.body;
    if (!s.steps) return;
    const step = s.steps[s.i];
    if (!step) {
      s.steps = null;
      b.speed = 0;
      b.clearPose(0.25);
      // Gameplay moves (boosts, climbs) hand the avatar back to the partner's snapshots.
      if (!this.cutsceneHold) this.scripted = false;
      s.done?.();
      return;
    }
    s.t += dt;
    const k = step.dur > 0 ? Math.min(1, s.t / step.dur) : 1;
    const e = easeF(k, step.ease);
    b.pos.lerpVectors(s.from, step.to, e);
    if (step.arc) b.pos.y += Math.sin(k * Math.PI) * step.arc;
    if (step.yaw !== undefined) b.yaw = lerpAngle(s.fromYaw, step.yaw, Math.min(1, e * 1.5));
    else {
      const dx = step.to.x - s.from.x, dz = step.to.z - s.from.z;
      if (Math.hypot(dx, dz) > 0.05) b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
    }
    b.speed = step.anim ?? 0;
    b.crouched = !!step.crouch;
    if (step.pose && typeof step.poseCtx === 'function') b.updatePoseCtx(step.poseCtx(k));
    if (k >= 1) {
      s.i++;
      s.t = 0;
      s.from = step.to.clone();
      s.fromYaw = b.yaw;
      const next = s.steps[s.i];
      next?.onStart?.();
      if (next?.pose) b.setPose(next.pose, (typeof next.poseCtx === 'function' ? next.poseCtx(0) : next.poseCtx) ?? {});
      else if (next && b.poseName) b.clearPose(0.2);
    }
  }

  /** Back to network control (after a cutscene). */
  release(): void {
    this.scripted = false;
    this.cutsceneHold = false;
    this.scriptCtl.steps = null;
    this.buf = [];
  }

  get stale(): boolean {
    return this.lastSnapAt < 0;
  }
}
