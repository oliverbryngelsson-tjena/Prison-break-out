// A character in the world: transform, health, poses, footsteps. Shared by players and NPCs.
import * as THREE from 'three';
import type { CharacterModel } from '../engine/characters';
import type { Surface } from '../engine/physics';
import { POSES, applyPose, type PoseCtx } from './poses';
import type { Actor, Team, World } from './world';

interface ActivePose {
  name: string;
  t: number;
  w: number;
  target: number;
  fade: number;
  ctx: PoseCtx;
  done: boolean;
  onEnd?: () => void;
}

export class Body implements Actor {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  radius = 0.32;
  height = 1.78;
  alive = true;
  hidden = false;
  /** In cover (crouched in tall grass/bushes): undetectable except at very close range. */
  concealed = false;
  /** Extra whole-body tilt (riding a bike): roll about the forward axis, pitch about the side axis. */
  roll = 0;
  pitch = 0;
  /** Called right before the model is posed each frame (e.g. to attach the rider to a bike). */
  preVisual: (() => void) | null = null;
  crouched = false;
  solid = true;
  grounded = true;
  /** Ground speed used for locomotion animation. */
  speed = 0;
  hp = 100;
  maxHp = 100;
  surface: Surface = 'concrete';
  private poses: ActivePose[] = [];
  private lastPhase = 0;
  private shadow: THREE.Mesh | null = null;
  visible = true;
  /** Too far from the camera to draw (set by the game each frame; separate from `visible`). */
  culled = false;
  /** Called on each footstep (with surface). */
  onStep: ((b: Body, surface: Surface, loud: number) => void) | null = null;

  constructor(readonly id: string, readonly kind: 'player' | 'npc', public team: Team, readonly model: CharacterModel, readonly world: World) {
    this.height = model.height;
    model.postHooks.push((m, dt) => this.applyPoses(m, dt));
    world.root.add(model.root);
    // Soft contact shadow under every character (lighter where real shadows are also drawn).
    this.shadow = world.blobShadow(0.95, world.q.shadows ? 0.38 : 0.6);
    world.root.add(this.shadow);
    world.actors.set(id, this);
  }

  get poseName(): string | null {
    const p = this.poses.find((x) => !x.done && x.target > 0);
    return p ? p.name : null;
  }

  get poseTime(): number {
    const p = this.poses.find((x) => !x.done && x.target > 0);
    return p ? p.t : 0;
  }

  poseCtx(): PoseCtx | null {
    const p = this.poses.find((x) => !x.done && x.target > 0);
    return p ? p.ctx : null;
  }

  /** Starts a procedural pose. `restart` replays it if already active. */
  setPose(name: string, ctx: PoseCtx = {}, opts: { restart?: boolean; startAt?: number; onEnd?: () => void } = {}): void {
    const def = POSES[name];
    if (!def) { console.warn('unknown pose', name); return; }
    const cur = this.poses.find((p) => p.name === name && !p.done && p.target > 0);
    if (cur && !opts.restart) {
      cur.ctx = ctx;
      return;
    }
    for (const p of this.poses) if (p.target > 0) { p.target = 0; p.fade = Math.max(0.08, def.fade ?? 0.15); }
    const fade = def.fade ?? 0.15;
    this.poses.push({ name, t: opts.startAt ?? 0, w: fade <= 0 ? 1 : 0, target: 1, fade, ctx, done: false, onEnd: opts.onEnd });
    if (def.clip) this.model.play(def.clip, { fade: Math.max(0.15, fade), layer: 'full' });
    else if (this.model.current('full') && !POSES[name].clip) this.model.stop('full', 0.25);
    if (def.upperClip) this.model.play(def.upperClip, { layer: 'upper', fade: 0.3 });
  }

  clearPose(fade = 0.2): void {
    let hadClip = false, hadUpper = false;
    for (const p of this.poses) {
      if (p.target > 0) {
        p.target = 0; p.fade = fade;
        if (POSES[p.name].clip) hadClip = true;
        if (POSES[p.name].upperClip) hadUpper = true;
      }
    }
    if (hadClip) this.model.stop('full', Math.max(0.2, fade));
    if (hadUpper) this.model.stop('upper', 0.3);
  }

  updatePoseCtx(ctx: PoseCtx): void {
    const p = this.poses.find((x) => !x.done && x.target > 0);
    if (p) p.ctx = ctx;
  }

  private applyPoses(m: CharacterModel, dt: number): void {
    for (const p of this.poses) {
      const def = POSES[p.name];
      p.t += dt;
      const rate = dt / Math.max(0.001, p.fade);
      p.w += Math.sign(p.target - p.w) * Math.min(rate, Math.abs(p.target - p.w));
      if (p.target > 0 && p.t >= def.dur && !p.done) {
        p.done = true;
        p.target = 0;
        p.fade = 0.18;
        if (def.clip) this.model.stop('full', 0.25);
        p.onEnd?.();
      }
      applyPose(m, p.name, Math.min(p.t, def.dur), p.w, p.ctx);
    }
    this.poses = this.poses.filter((p) => p.w > 0.001 || p.target > 0);
  }

  /** Syncs the visual model with the body and advances animation. */
  updateVisual(dt: number, animDt = dt): void {
    this.preVisual?.();
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    r.visible = this.visible && !this.hidden && !this.culled;
    this.model.setLocomotion(this.speed, this.crouched);
    if (r.visible) this.model.update(animDt);
    if (this.shadow) {
      this.shadow.visible = r.visible;
      this.shadow.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);
    }
    // Footsteps at the two contact points of the gait cycle.
    const ph = this.model.phase;
    if (this.speed > 0.4 && this.grounded && r.visible) {
      const crossed = (a: number, b: number, x: number) => (a < x && b >= x) || (a > b && (x <= b || x > a));
      if (crossed(this.lastPhase, ph, 0.02) || crossed(this.lastPhase, ph, 0.52)) {
        this.onStep?.(this, this.surface, this.speed > 4 ? 1 : this.speed > 2 ? 0.7 : 0.35);
      }
    }
    this.lastPhase = ph;
  }

  /** Chest position (for line-of-sight checks). */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + (this.crouched ? 0.75 : 1.3), this.pos.z);
  }

  head(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + (this.crouched ? 1.0 : this.height - 0.1), this.pos.z);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  dispose(): void {
    this.world.actors.delete(this.id);
    this.model.dispose();
    this.shadow?.removeFromParent();
  }
}
