// Guns: the weapon model in the hands, muzzle flash, tracer, impact and shot sound.
// Players aim automatically at the best enemy in front; every bullet is one shared 'gunshot' event
// so both clients see and hear it. The authority applies the damage.
//
// Holding: the gun is placed from the body's frame (shoulder pocket for long guns, out in front
// for pistols) and the 'aim' / 'gun' poses pull both hands onto its grips with IK.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from './game';
import type { Body } from './body';
import type { Combatant } from './player';
import { WEAPONS, DEFAULT_LOADOUT, type WeaponDef, type WeaponId } from './weapons';

export const SHOT_RANGE = 34;
export const PLAYER_SHOT_DMG = 34;
export const MAG_SIZE = 12;

interface Fx { mesh: THREE.Mesh; life: number; max: number }

export interface ShotEvent {
  by: string;
  from: [number, number, number];
  to: [number, number, number];
  /** NPC hit by a player. */
  id?: string;
  dmg?: number;
  /** Player hit by an NPC. */
  who?: CharacterId;
  /** The shot ended on a wall or the ground (sparks/dust). */
  wall?: boolean;
  /** Weapon (sound and flash). */
  w?: WeaponId;
  /** Extra pellet end points (shotgun), for tracers only. */
  more?: Array<[number, number, number]>;
}

/** A gun model normalised to: rear of the gun at the origin, barrel along +Z, bore at y = 0. */
interface GunModel {
  root: THREE.Group;
  def: WeaponDef;
  /** Local grip points (right hand = pistol grip, left hand = handguard). */
  gripR: THREE.Vector3;
  gripL: THREE.Vector3;
  muzzle: THREE.Vector3;
}

const v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Loaded model files by weapon (filled once by `preload`). */
const FILES: Partial<Record<WeaponId, THREE.Object3D>> = {};

/** Simple stand-in models, used until (or if) the real ones load. */
function standIn(def: WeaponDef, mat: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const L = def.length;
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, m = mat, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    b.position.set(x, y, z); b.rotation.x = rx;
    g.add(b);
  };
  if (!def.long) {
    box(0.03, 0.034, L * 0.95, 0, -0.012, L * 0.5);
    box(0.028, 0.1, 0.045, 0, -0.07, L * 0.25, mat, -0.25);
  } else {
    const stockM = def.id === 'ak47' || def.id === 'shotgun' || def.id === 'sniper' ? wood : mat;
    box(0.045, 0.07, L * 0.3, 0, -0.03, L * 0.15, stockM); // stock
    box(0.05, 0.075, L * 0.32, 0, -0.02, L * 0.44); // receiver
    box(0.04, 0.05, L * 0.2, 0, -0.025, L * 0.66, stockM); // handguard
    box(0.018, 0.018, L * 0.3, 0, 0, L * 0.85); // barrel
    box(0.03, 0.09, 0.04, 0, -0.1, L * 0.34, mat, -0.3); // pistol grip
    if (def.id !== 'shotgun' && def.id !== 'sniper') box(0.03, 0.13, 0.05, 0, -0.12, L * 0.47, mat, def.id === 'ak47' ? 0.35 : 0.12); // magazine
    if (def.id === 'sniper') box(0.035, 0.035, 0.26, 0, 0.05, L * 0.45); // scope
  }
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

/** IK targets are wrists, so they sit a hand's width from the grip they hold (model frame: +X is the
 *  shooter's left, +Y up, +Z toward the muzzle). */
function gripsFor(def: WeaponDef): { gripR: THREE.Vector3; gripL: THREE.Vector3; muzzle: THREE.Vector3 } {
  const r = new THREE.Vector3(-0.012, def.grip[1] + 0.035, def.grip[0] - 0.05);
  const l = def.long
    ? new THREE.Vector3(0.045, def.fore[1] - 0.045, def.fore[0] - 0.015) // palm under the handguard
    : new THREE.Vector3(0.05, def.grip[1] + 0.0, def.grip[0] - 0.02); // support hand cupping the grip
  return { gripR: r, gripL: l, muzzle: new THREE.Vector3(0, 0, def.length) };
}

export class Guns {
  /** Players carry and use their guns (set by chapters). */
  playersArmed = false;
  /** Extra bodies showing a gun (cutscenes). */
  private shown = new Set<string>();
  private models = new Map<string, GunModel>();
  private fx: Fx[] = [];
  private mat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.75, roughness: 0.38 });
  private wood = new THREE.MeshStandardMaterial({ color: 0x5a3418, metalness: 0.05, roughness: 0.6 });
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private flashGeo = new THREE.OctahedronGeometry(0.09, 0);
  private tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  private light: THREE.PointLight | null = null;
  private lightT = 0;
  /** What each player carries. */
  loadout: Record<CharacterId, WeaponId> = { ...DEFAULT_LOADOUT };
  /** Local player's magazine and reload timer. */
  ammo = MAG_SIZE;
  reloadT = 0;
  /** Spread added by the current burst (local player), recovers quickly. */
  bloom = 0;
  private sinceShot = 9;

  constructor(private g: Game) {}

  /** Loads the real weapon models (optional: stand-ins are used for any that fail). */
  preload(): Promise<void> {
    this.ready = this.load();
    return this.ready;
  }

  private async load(): Promise<void> {
    const w = this.g.world;
    await Promise.all((Object.keys(WEAPONS) as WeaponId[]).map(async (id) => {
      if (FILES[id]) return;
      try { FILES[id] = await w.model(`weapon_${id}`, { shadows: true }); } catch { /* stand-in */ }
    }));
    // Rebuild any model made from a stand-in before the file arrived.
    for (const [bid, m] of this.models) if (FILES[m.def.id]) { m.root.removeFromParent(); this.models.delete(bid); }
  }

  /** A standalone copy of a weapon for display (shop table, props). */
  displayModel(id: WeaponId): THREE.Object3D {
    const def = WEAPONS[id];
    const file = FILES[id];
    const g = new THREE.Group();
    g.add(file ? file.clone(true) : standIn(def, this.mat, this.wood));
    // Swap in the real model when it arrives.
    if (!file) void this.ready.then(() => { const f = FILES[id]; if (f) { g.clear(); g.add(f.clone(true)); } });
    return g;
  }
  private ready: Promise<void> = Promise.resolve();

  /** Show (or hide) a gun on a body regardless of loadout: cutscenes, or an armed NPC putting it away. */
  show(id: string, on: boolean): void {
    if (on) { this.shown.add(id); this.hiddenIds.delete(id); } else { this.shown.delete(id); this.hiddenIds.add(id); }
  }
  private hiddenIds = new Set<string>();

  weaponOf(id: string): WeaponDef {
    if (id === 'elias' || id === 'jax') return WEAPONS[this.loadout[id]] ?? WEAPONS.pistol;
    const n = this.g.npcs.get(id);
    return WEAPONS[(n?.def.gun?.w as WeaponId) ?? 'pistol'] ?? WEAPONS.pistol;
  }

  /** Sets a player's weapon (both clients, from a shared event) and refills the local magazine. */
  setWeapon(who: CharacterId, w: WeaponId): void {
    this.loadout[who] = w;
    const m = this.models.get(who);
    if (m) { m.root.removeFromParent(); this.models.delete(who); }
    if (who === this.g.localChar) { this.ammo = WEAPONS[w].mag; this.reloadT = 0; this.bloom = 0; }
  }

  get local(): WeaponDef { return this.weaponOf(this.g.localChar); }

  hasGun(id: string): boolean {
    if (this.shown.has(id)) return true;
    if (this.playersArmed && (id === 'elias' || id === 'jax')) return true;
    return !!this.g.npcs.get(id)?.def.gun && !!this.g.npcs.get(id)?.alive;
  }

  private bodyOf(id: string): Body | null {
    if (id === 'elias' || id === 'jax') return this.g.body(id);
    return this.g.npcs.get(id)?.body ?? null;
  }

  private modelFor(id: string): GunModel {
    const def = this.weaponOf(id);
    let m = this.models.get(id);
    if (m && m.def.id === def.id) return m;
    if (m) m.root.removeFromParent();
    const root = new THREE.Group();
    const file = FILES[def.id];
    root.add(file ? file.clone(true) : standIn(def, this.mat, this.wood));
    this.g.world.root.add(root);
    m = { root, def, ...gripsFor(def) };
    this.models.set(id, m);
    return m;
  }

  /** World position of the muzzle (in front of the chest if no gun is drawn). */
  muzzle(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const m = this.models.get(id);
    if (m?.root.visible) return out.copy(m.muzzle).applyMatrix4(m.root.matrixWorld);
    const b = this.bodyOf(id);
    if (!b) return out.set(0, 0, 0);
    return out.copy(b.chest()).addScaledVector(b.forward(), 0.5);
  }

  update(dt: number): void {
    const g = this.g;
    const ids = new Set<string>(this.shown);
    if (this.playersArmed) { ids.add('elias'); ids.add('jax'); }
    for (const n of g.npcs.values()) if (n.def.gun) ids.add(n.id);
    for (const id of this.hiddenIds) if (!(id === 'elias' || id === 'jax') || !this.playersArmed) ids.delete(id);
    for (const [id, m] of this.models) if (!ids.has(id)) m.root.visible = false;
    for (const id of ids) {
      const b = this.bodyOf(id);
      const npc = g.npcs.get(id);
      const dead = !!npc && !npc.alive && !this.shown.has(id);
      if (!b || b.hidden || !b.model.root.visible || dead) { const m = this.models.get(id); if (m) m.root.visible = false; continue; }
      const m = this.modelFor(id);
      m.root.visible = true;
      this.place(id, b, m);
    }
    // Flashes and tracers.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) { f.mesh.removeFromParent(); (f.mesh.material as THREE.Material).dispose(); this.fx.splice(i, 1); continue; }
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life / f.max;
    }
    if (this.light) {
      this.lightT -= dt;
      this.light.intensity = this.lightT > 0 ? 6 * (this.lightT / 0.06) : 0;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = this.local.mag;
    }
    this.sinceShot += dt;
    if (this.sinceShot > 0.12) this.bloom = Math.max(0, this.bloom - dt * 0.6);
  }

  /** Places the gun for the body's current pose and feeds the grip points back to the pose. */
  private place(id: string, b: Body, m: GunModel): void {
    const def = m.def;
    const pose = b.poseName;
    const aiming = pose === 'aim';
    const isPlayer = id === 'elias' || id === 'jax';
    const free = !pose || pose === 'gun' || aiming;
    // Long guns are carried at low ready whenever nothing else is going on.
    if (def.long && !pose && (!isPlayer || this.playerFree(id as CharacterId))) b.setPose('gun', {});
    const fwd = b.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // character's right (same as poses' frame().right)
    const chest = b.chest();
    const pitch = aiming ? (b.poseCtx()?.k?.pitch ?? 0) : 0;
    let origin: THREE.Vector3, dir: THREE.Vector3;
    const r = m.root;
    if (!free && def.long) {
      // Busy (climbing, using things): slung across the back, muzzle up.
      origin = chest.clone().addScaledVector(fwd, -0.2).addScaledVector(right, 0.15).add(new THREE.Vector3(0, -0.35, 0));
      dir = new THREE.Vector3(0, 1, 0).addScaledVector(right, -0.55).normalize();
    } else if (!def.long && !aiming) {
      // Pistol at the side, in the right hand.
      const hand = b.model.bone('Bip01_R_Hand');
      const hp = hand ? hand.getWorldPosition(new THREE.Vector3()) : chest.clone().addScaledVector(right, 0.25).add(new THREE.Vector3(0, -0.4, 0));
      dir = fwd.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
      origin = hp.clone().addScaledVector(dir, -m.gripR.z).add(new THREE.Vector3(0, -m.gripR.y, 0)).addScaledVector(fwd, 0.02);
    } else if (aiming) {
      dir = fwd.clone().add(new THREE.Vector3(0, pitch * 0.9, 0)).normalize();
      // Stock in the shoulder pocket, sights at eye line.
      if (def.long) origin = chest.clone().addScaledVector(right, 0.13).add(new THREE.Vector3(0, 0.19, 0)).addScaledVector(fwd, -0.07);
      else origin = chest.clone().addScaledVector(fwd, 0.42).add(new THREE.Vector3(0, 0.14, 0)).addScaledVector(dir, -m.gripR.z);
    } else {
      // Low ready: stock at the shoulder, muzzle down and across the body.
      dir = fwd.clone().add(new THREE.Vector3(0, -0.55, 0)).addScaledVector(right, -0.3).normalize();
      origin = chest.clone().addScaledVector(right, 0.17).add(new THREE.Vector3(0, 0.02, 0)).addScaledVector(fwd, 0.05);
    }
    const side = new THREE.Vector3().crossVectors(UP, dir);
    if (side.lengthSq() < 1e-4) side.copy(right);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(dir, side).normalize();
    r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, dir));
    r.position.copy(origin);
    r.updateMatrixWorld(true);
    if (free && (aiming || pose === 'gun' || b.poseName === 'gun')) {
      const ctx = b.poseCtx() ?? {};
      b.updatePoseCtx({ ...ctx, points: { gripR: m.gripR.clone().applyMatrix4(r.matrixWorld), gripL: m.gripL.clone().applyMatrix4(r.matrixWorld) } });
    }
  }

  private playerFree(c: CharacterId): boolean {
    const g = this.g;
    if (c === g.localChar) return g.local.state === 'free' && !g.inCutscene;
    return !g.remote.onBike && !g.remote.downed && !g.inCutscene;
  }

  /** Visuals and sound of one shot (both clients). */
  fire(byId: string, from: THREE.Vector3, to: THREE.Vector3, wall: boolean, extra: THREE.Vector3[] = []): void {
    const g = this.g;
    const def = this.weaponOf(byId);
    const muzzle = this.models.get(byId)?.root.visible ? this.muzzle(byId) : from;
    const fl = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    fl.position.copy(muzzle);
    const fs = def.long ? 1.4 : 1;
    fl.scale.set(fs, fs, fs * (def.id === 'shotgun' ? 2.6 : 1.8));
    fl.lookAt(to);
    fl.rotateZ(Math.random() * Math.PI);
    g.world.root.add(fl);
    this.fx.push({ mesh: fl, life: 0.05, max: 0.05 });
    for (const end of [to, ...extra]) {
      const len = muzzle.distanceTo(end);
      if (len < 0.5) continue;
      const tr = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      tr.position.lerpVectors(muzzle, end, 0.5);
      tr.scale.set(1, 1, len);
      tr.lookAt(end);
      g.world.root.add(tr);
      this.fx.push({ mesh: tr, life: 0.06, max: 0.06 });
    }
    if (!this.light) {
      this.light = new THREE.PointLight(0xffc070, 0, 7, 2);
      g.world.root.add(this.light);
    }
    this.light.position.copy(muzzle);
    this.lightT = 0.06;
    if (wall) {
      g.world.particles.emit('sparks', to, 5);
      g.world.particles.emit('dust', to, 2);
      g.audio.play('hit_soft', { pos: to, volume: 0.35, rate: 1.6, jitter: 0.2 });
    }
    const near = from.distanceTo(g.cam.camera.position);
    g.audio.gunshot(from, def.sound.volume * (byId === g.localChar ? 0.9 : 0.8), near > 45, def.sound);
    g.world.addNoise(from, 30, byId, 'fight');
    if (byId === g.localChar) g.cam.addShake(def.kick);
  }

  /** Where a shot from `from` toward `to` really ends (walls stop bullets). */
  trace(from: THREE.Vector3, to: THREE.Vector3): { end: THREE.Vector3; wall: boolean } {
    v.subVectors(to, from);
    const len = v.length();
    if (len < 1e-3) return { end: to.clone(), wall: false };
    v.divideScalar(len);
    const hit = this.g.world.physics.raycast(from, v, len, (b) => b.solid);
    if (hit) return { end: hit.point, wall: true };
    return { end: to.clone(), wall: false };
  }

  /** Local shot fired: grow the burst spread. */
  shotFired(): void {
    this.sinceShot = 0;
    this.bloom = Math.min(0.25, this.bloom + this.local.bloom);
  }

  /** Best enemy for the local player's auto-aim. */
  pickTarget(b: Body, list: Combatant[], camFwd: THREE.Vector3): Combatant | null {
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const eye = b.chest();
    const range = this.local.range;
    for (const c of list) {
      if (!c.alive || !c.hostile) continue;
      const to = v.subVectors(c.body.pos, b.pos);
      const d = Math.hypot(to.x, to.z);
      if (d > range) continue;
      const dir = new THREE.Vector3(to.x / (d || 1), 0, to.z / (d || 1));
      const a = Math.acos(THREE.MathUtils.clamp(dir.dot(camFwd), -1, 1));
      if (a > 1.0 && d > 7) continue; // behind the camera and not close
      if (!this.g.world.physics.lineOfSight(eye, c.body.chest())) continue;
      const score = d * (0.6 + a);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  reset(): void {
    this.ammo = this.local.mag;
    this.reloadT = 0;
    this.bloom = 0;
    for (const f of this.fx) f.mesh.removeFromParent();
    this.fx = [];
  }

  dispose(): void {
    this.reset();
    for (const m of this.models.values()) m.root.removeFromParent();
    this.models.clear();
    this.light?.removeFromParent();
    this.light = null;
    this.shown.clear();
    this.hiddenIds.clear();
  }
}
