// Dirt bikes: arcade physics for the local rider, a rigged visual for both riders, rider IK and network sync.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { World } from './world';
import type { Game } from './game';
import type { EngineSound } from '../engine/audio';
import { lerpAngle } from './poses';

const V = () => new THREE.Vector3();

/** Visual bike: the rigged CRF model re-centred so the origin is on the ground between the wheels, front = +Z. */
export class BikeVisual {
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  model!: THREE.Object3D;
  private steerBone: THREE.Object3D | null = null;
  private steerRest = new THREE.Quaternion();
  private wheels: Array<{ bone: THREE.Object3D; rest: THREE.Quaternion }> = [];
  private gripL: THREE.Object3D | null = null;
  private gripR: THREE.Object3D | null = null;
  /** Local anchor points (bike space) */
  readonly anchors = { seat: new THREE.Vector3(0, 1.02, -0.3), gripL: new THREE.Vector3(-0.36, 1.28, 0.5), gripR: new THREE.Vector3(0.36, 1.28, 0.5), pegL: new THREE.Vector3(-0.24, 0.42, -0.12), pegR: new THREE.Vector3(0.24, 0.42, -0.12) };
  wheelbase = 1.7;
  wheelR = 0.38;

  static async create(world: World): Promise<BikeVisual> {
    const v = new BikeVisual();
    const m = await world.model('dirtbike', { shadows: true, receive: true });
    v.model = m;
    const holder = new THREE.Group();
    holder.add(m);
    v.tilt.add(holder);
    v.root.add(v.tilt);
    m.updateMatrixWorld(true);
    // Find rig bones (names are sanitised by the loader: dots removed, spaces to underscores).
    const find = (pred: (n: string) => boolean) => { let r: THREE.Object3D | null = null; m.traverse((o) => { if (!r && pred(o.name)) r = o; }); return r as THREE.Object3D | null; };
    v.steerBone = find((n) => n.startsWith('FRONT-STEER'));
    if (v.steerBone) v.steerRest.copy(v.steerBone.quaternion);
    for (const name of ['FRONT-WHEEL-DEF', 'REAR-WHEEL-DEF']) {
      const b = find((n) => n.startsWith(name) && !n.includes('end'));
      if (b) v.wheels.push({ bone: b, rest: b.quaternion.clone() });
    }
    v.gripR = find((n) => n.startsWith('HAND-SNAPR') || n.startsWith('HAND-SNAP_R') || n === 'HAND-SNAPR_010');
    v.gripL = find((n) => n.startsWith('HAND-SNAPL') || n.startsWith('HAND-SNAP_L') || n === 'HAND-SNAPL_011');
    // Measure real bounds (skinned meshes) and re-centre.
    const box = new THREE.Box3();
    m.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) { mesh.computeBoundingBox(); const bb = mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld); if (isFinite(bb.min.y)) box.union(bb); }
      else box.expandByObject(mesh);
      mesh.frustumCulled = false;
    });
    const size = box.getSize(V()), center = box.getCenter(V());
    // Long axis is the bike's length; front is where the steering bone sits.
    const alongX = size.x > size.z;
    const steerP = v.steerBone ? v.steerBone.getWorldPosition(V()) : center.clone().add(new THREE.Vector3(0, 0, 1));
    let yawFix = 0;
    if (alongX) yawFix = steerP.x > center.x ? -Math.PI / 2 : Math.PI / 2;
    else yawFix = steerP.z > center.z ? 0 : Math.PI;
    holder.rotation.y = yawFix;
    m.position.set(-center.x, -box.min.y, -center.z);
    const len = Math.max(size.x, size.z);
    v.wheelbase = len * 0.68;
    v.wheelR = Math.min(0.45, size.y * 0.3);
    // Grip anchors from the rig, in bike space.
    v.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(v.root.matrixWorld).invert();
    const toLocal = (o: THREE.Object3D | null, fallback: THREE.Vector3) => (o ? o.getWorldPosition(V()).applyMatrix4(inv) : fallback);
    v.anchors.gripL.copy(toLocal(v.gripL, v.anchors.gripL));
    v.anchors.gripR.copy(toLocal(v.gripR, v.anchors.gripR));
    if (v.anchors.gripL.x > v.anchors.gripR.x) { const t = v.anchors.gripL.clone(); v.anchors.gripL.copy(v.anchors.gripR); v.anchors.gripR.copy(t); }
    v.anchors.seat.set(0, size.y * 0.74, -len * 0.14);
    v.anchors.pegL.set(-0.24, size.y * 0.3, -len * 0.06);
    v.anchors.pegR.set(0.24, size.y * 0.3, -len * 0.06);
    world.root.add(v.root);
    return v;
  }

  /** Places the bike: pos = ground point between the wheels. */
  set(pos: THREE.Vector3, yaw: number, pitch: number, lean: number, steer: number, spin: number): void {
    this.root.position.copy(pos);
    this.root.rotation.set(0, yaw, 0);
    // Pitch about the rear axle-ish, roll about the contact line.
    this.tilt.rotation.set(-pitch, 0, lean, 'YXZ');
    if (this.steerBone) {
      this.steerBone.quaternion.copy(this.steerRest);
      this.steerBone.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion())), steer * 0.45);
    }
    for (const w of this.wheels) { w.bone.quaternion.copy(w.rest); w.bone.rotateX(spin); }
    this.root.updateMatrixWorld(true);
  }

  /** Anchor points in world space. */
  points(): Record<'seat' | 'gripL' | 'gripR' | 'pegL' | 'pegR', THREE.Vector3> {
    const m = this.tilt.matrixWorld;
    return {
      seat: this.anchors.seat.clone().applyMatrix4(m),
      gripL: this.anchors.gripL.clone().applyMatrix4(m),
      gripR: this.anchors.gripR.clone().applyMatrix4(m),
      pegL: this.anchors.pegL.clone().applyMatrix4(m),
      pegR: this.anchors.pegR.clone().applyMatrix4(m),
    };
  }

  dispose(): void { this.root.removeFromParent(); }
}

export interface BikeInput { throttle: number; brake: number; steer: number }

/** Arcade dirt-bike physics for the local rider. */
export class BikeController {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vy = 0;
  pitch = 0;
  lean = 0;
  steer = 0;
  spin = 0;
  rpm = 1200;
  grounded = true;
  airT = 0;
  crashed = false;
  crashT = 0;
  maxSpeed = 27;
  private prevGround = 0;
  surface = 'dirt';
  inWater = false;
  /** Called when the bike crashes (respawn handled by the chapter). */
  onCrash: ((reason: string) => void) | null = null;
  onLand: ((impact: number) => void) | null = null;

  constructor(readonly world: World) {}

  place(p: THREE.Vector3, yaw: number): void {
    this.pos.copy(p);
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.pitch = 0;
    this.lean = 0;
    this.crashed = false;
    this.grounded = true;
    const g = this.ground(p.x, p.z, p.y + 3);
    this.pos.y = g;
    this.prevGround = g;
  }

  private ground(x: number, z: number, top: number): number {
    const hit = this.world.physics.groundAt(x, z, top);
    if (hit) { this.surface = hit.surface; return hit.y; }
    return -100;
  }

  update(dt: number, inp: BikeInput): void {
    if (this.crashed) { this.crashT += dt; this.speed *= Math.max(0, 1 - dt * 3); return; }
    const ph = this.world.physics;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // --- engine / brakes
    const surfMax: Record<string, number> = { mud: 17, water: 12, grass: 23, leaves: 22, dirt: 26, gravel: 25, asphalt: this.maxSpeed + 3, concrete: this.maxSpeed + 3, wood: 20, metal: 22 };
    const vmax = Math.min(this.maxSpeed + 3, surfMax[this.surface] ?? this.maxSpeed) * (this.inWater ? 0.55 : 1);
    if (this.grounded) {
      const accel = inp.throttle * (this.speed < 8 ? 11 : this.speed < 18 ? 7.5 : 4.5);
      this.speed += accel * dt;
      if (inp.brake > 0) this.speed -= (this.speed > 0.5 ? 16 : 4) * inp.brake * dt;
      // Drag + rolling resistance + overspeed bleed
      this.speed -= (0.012 * this.speed * this.speed + 0.6) * dt * Math.sign(this.speed);
      if (this.speed > vmax) this.speed -= (this.speed - vmax) * Math.min(1, dt * 2.5);
      // Gravity along the slope
      this.speed -= Math.sin(this.pitch) * 9.8 * dt * 0.6;
      if (this.speed < -3) this.speed = -3;
      if (Math.abs(this.speed) < 0.05 && inp.throttle === 0) this.speed = 0;
    }
    // --- steering
    this.steer += (inp.steer - this.steer) * Math.min(1, dt * 6);
    const sp = Math.abs(this.speed);
    const turnRate = this.steer * (2.4 / (1 + sp * 0.07)) * Math.min(1, sp / 2.5) * (this.grounded ? 1 : 0.35);
    this.yaw -= turnRate * dt * Math.sign(this.speed || 1);
    const leanTarget = this.grounded ? -this.steer * Math.min(1, sp / 10) * 0.6 : this.lean * 0.98;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 5);
    // --- horizontal move with collisions
    const before = this.pos.clone();
    const want = fwd.multiplyScalar(this.speed * dt);
    const n = new THREE.Vector3();
    const hit = ph.moveCapsule(this.pos, want.x, want.z, 0.42, 1.2, 0.55, (b) => !b.ramp || true, n);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (hit && sp > 1) {
      const head = -(n.x * Math.sin(this.yaw) + n.z * Math.cos(this.yaw)); // 1 = head-on
      if (sp > 11 && head > 0.65) { this.crash('wall'); return; }
      // Glancing: lose speed proportional to impact.
      this.speed *= 1 - Math.min(0.8, head * 0.9);
      if (moved < want.length() * 0.3) this.speed *= 0.5;
    }
    // --- vertical: follow the ground, launch off crests
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const half = 0.85;
    const top = this.pos.y + 1.2;
    const hF = this.ground(this.pos.x + f.x * half, this.pos.z + f.z * half, top);
    const hR = this.ground(this.pos.x - f.x * half, this.pos.z - f.z * half, top);
    const gy = Math.max(this.ground(this.pos.x, this.pos.z, top), (hF + hR) / 2);
    this.inWater = this.world.physics.inWater(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.grounded) {
      const slopeVy = (gy - this.prevGround) / Math.max(dt, 1e-3);
      if (gy < this.pos.y - 0.25 && this.speed > 6) {
        // Ground fell away faster than we can follow: airborne.
        this.grounded = false;
        this.vy = Math.max(this.vy, 0);
        this.airT = 0;
      } else {
        this.vy = THREE.MathUtils.clamp(slopeVy, -20, 20);
        this.pos.y = gy;
        const tp = Math.atan2(hF - hR, half * 2);
        this.pitch += (tp - this.pitch) * Math.min(1, dt * 12);
      }
    }
    if (!this.grounded) {
      this.airT += dt;
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      // Nose follows the arc a little.
      const arc = Math.atan2(this.vy, Math.max(4, this.speed)) * 0.7;
      this.pitch += (arc - this.pitch) * Math.min(1, dt * 2.5);
      if (this.pos.y <= gy) {
        const impact = -this.vy;
        this.pos.y = gy;
        this.grounded = true;
        const tp = Math.atan2(hF - hR, half * 2);
        const misalign = Math.abs(tp - this.pitch);
        this.onLand?.(impact);
        if (impact > 16 || (impact > 9 && misalign > 0.6) || Math.abs(this.lean) > 0.9) { this.crash('landing'); return; }
        this.speed *= impact > 10 ? 0.85 : 0.97;
        this.pitch = tp;
        this.vy = 0;
      }
    } else if (this.vy > 1.5 && gy > this.pos.y + 1.5) {
      // fell under the ground (e.g. teleports): snap up
      this.pos.y = gy;
    }
    this.prevGround = gy;
    if (this.pos.y < -60) this.crash('fell');
    // --- engine sound params
    const gear = Math.min(5, Math.floor(sp / 6));
    const inGear = (sp - gear * 6) / 6;
    const target = this.grounded ? 1800 + inGear * 7200 + inp.throttle * 600 : 2500 + inp.throttle * 7500;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
    this.spin = (this.spin + (this.speed / Math.max(0.2, 0.38)) * dt) % (Math.PI * 2);
  }

  crash(reason: string): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashT = 0;
    this.onCrash?.(reason);
  }
}

/**
 * Owns both bikes for a chapter: the local controller, visuals for both riders, rider poses,
 * camera target, engine sounds, dust/mud particles and the network fields.
 */
export class BikeSystem {
  readonly visuals = new Map<CharacterId, BikeVisual>();
  ctrl: BikeController;
  mounted = false;
  private engines = new Map<CharacterId, EngineSound>();
  private remoteB: [number, number, number, number, number] = [0, 0, 0, 1200, 0];
  private dustT = 0;
  enabled = true;

  constructor(readonly game: Game) {
    this.ctrl = new BikeController(game.world);
  }

  async init(): Promise<void> {
    for (const c of ['elias', 'jax'] as CharacterId[]) this.visuals.set(c, await BikeVisual.create(this.game.world));
    // Remote rider: pose the body on the bike right before it is drawn.
    const remote = this.game.remote;
    remote.body.preVisual = () => this.syncRemote();
    this.game.updaters.add((dt) => this.update(dt));
  }

  /** Puts the local player on their bike at p. */
  mount(p: THREE.Vector3, yaw: number): void {
    const g = this.game;
    this.ctrl.place(p, yaw);
    this.mounted = true;
    g.local.state = 'bike';
    g.local.body.crouched = false;
    g.local.body.setPose('ride', { points: this.visuals.get(g.localChar)!.points(), k: { lean: 0, stand: 0, steer: 0 } }, { restart: true });
    g.camTarget = () => ({ pos: this.ctrl.pos, yaw: this.ctrl.yaw, speed: this.ctrl.speed, mode: 'bike' });
    g.cam.snapBehind(yaw, p);
    g.deps.touch.setMode('bike');
    if (!this.engines.has(g.localChar)) { const e = g.audio.engine('bike'); if (e) this.engines.set(g.localChar, e); }
  }

  dismount(): void {
    const g = this.game;
    this.mounted = false;
    if (g.local.state === 'bike') g.local.state = 'free';
    g.local.body.clearPose(0.3);
    g.local.body.roll = 0; g.local.body.pitch = 0;
    g.camTarget = null;
    g.deps.touch.setMode('foot');
    for (const e of this.engines.values()) e.stop();
    this.engines.clear();
  }

  private input(): { throttle: number; brake: number; steer: number } {
    const inp = this.game.input;
    const y = inp.move.y;
    return {
      throttle: Math.max(inp.buttons.throttle.down ? 1 : 0, y > 0.25 ? Math.min(1, y * 1.3) : 0),
      brake: Math.max(inp.buttons.brake.down ? 1 : 0, y < -0.3 ? 1 : 0),
      steer: THREE.MathUtils.clamp(inp.move.x, -1, 1),
    };
  }

  update(dt: number): void {
    const g = this.game;
    if (!this.enabled) return;
    if (this.mounted && g.local.state === 'bike') {
      const c = this.ctrl;
      const ctl = g.inCutscene ? { throttle: 0, brake: 0, steer: 0 } : this.input();
      c.update(dt, ctl);
      const vis = this.visuals.get(g.localChar)!;
      vis.root.visible = true;
      vis.set(c.pos, c.yaw, c.pitch, c.lean, c.steer, c.spin);
      const b = g.local.body;
      b.pos.copy(c.pos);
      b.yaw = c.yaw;
      b.speed = 0;
      b.grounded = c.grounded;
      b.roll = c.crashed ? 0 : c.lean;
      b.pitch = c.crashed ? 0 : c.pitch;
      if (!c.crashed) {
        if (b.poseName !== 'ride') b.setPose('ride', {}, { restart: true });
        b.updatePoseCtx({ points: vis.points(), k: { lean: c.lean, stand: c.grounded ? 0 : 0.6, steer: c.steer } });
      }
      g.bikeSnap = [+c.lean.toFixed(2), +c.pitch.toFixed(2), +c.steer.toFixed(2), Math.round(c.rpm), +c.spin.toFixed(2)];
      this.engines.get(g.localChar)?.set(c.rpm, ctl.throttle, 0.55, c.pos);
      // Dust / mud from the rear wheel
      this.dustT -= dt;
      if (c.grounded && Math.abs(c.speed) > 4 && this.dustT <= 0) {
        this.dustT = 0.05;
        const rear = c.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), -0.9);
        const kind = c.inWater ? 'splash' : c.surface === 'mud' ? 'mud' : c.surface === 'asphalt' || c.surface === 'concrete' ? null : 'dust';
        if (kind) g.world.particles.emit(kind, rear.add(new THREE.Vector3(0, 0.15, 0)), kind === 'dust' ? 2 : 3, new THREE.Vector3(-Math.sin(c.yaw), 0.6, -Math.cos(c.yaw)), { speed: 1 + Math.abs(c.speed) * 0.08 });
      }
    } else {
      g.bikeSnap = null;
      const vis = this.visuals.get(g.localChar);
      if (vis && !this.parkedLocal) vis.root.visible = false;
    }
  }
  /** Keep the local bike visible when parked (e.g. before mounting). */
  parkedLocal = false;

  /** Park a bike (no rider) at a spot. */
  park(c: CharacterId, p: THREE.Vector3, yaw: number): void {
    const v = this.visuals.get(c);
    if (!v) return;
    v.root.visible = true;
    v.set(p, yaw, 0, 0.12, 0, 0);
    if (c === this.game.localChar) this.parkedLocal = true;
    else this.parkedRemote = true;
  }
  parkedRemote = false;

  private syncRemote(): void {
    const g = this.game;
    const r = g.remote;
    const vis = this.visuals.get(g.remoteChar);
    if (!vis) return;
    const b = r.body;
    if (!r.onBike) {
      b.roll = 0; b.pitch = 0;
      if (!this.parkedRemote) vis.root.visible = false;
      this.engines.get(g.remoteChar)?.stop();
      this.engines.delete(g.remoteChar);
      return;
    }
    const s = r.bike ?? this.remoteB;
    const lean = s[0], pitch = s[1], steer = s[2], rpm = s[3], spin = s[4];
    vis.root.visible = true;
    vis.set(b.pos, b.yaw, pitch, lean, steer, spin);
    b.roll = lean; b.pitch = pitch;
    if (b.poseName !== 'ride') b.setPose('ride', {}, { restart: true });
    b.updatePoseCtx({ points: vis.points(), k: { lean, stand: b.grounded ? 0 : 0.6, steer } });
    if (!this.engines.has(g.remoteChar)) { const e = g.audio.engine('bike'); if (e) this.engines.set(g.remoteChar, e); }
    this.engines.get(g.remoteChar)?.set(rpm, 0.5, 0.5, b.pos);
    void lerpAngle;
  }

  dispose(): void {
    for (const v of this.visuals.values()) v.dispose();
    for (const e of this.engines.values()) e.stop();
    this.engines.clear();
    this.game.remote.body.preVisual = null;
    this.game.bikeSnap = null;
  }
}
