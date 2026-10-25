// Pistols: the gun model in the hand, muzzle flash, tracer, impact and shot sound.
// Players aim automatically at the best enemy in front; shots are one shared 'shot' event
// so both clients see and hear every shot. The authority applies the damage.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from './game';
import type { Body } from './body';
import type { Combatant } from './player';

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
}

const v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function pistol(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.17), mat);
  slide.position.set(0, 0.03, 0.06);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.045), mat);
  grip.position.set(0, -0.015, -0.005);
  grip.rotation.x = -0.25;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.05), mat);
  guard.position.set(0, -0.0, 0.035);
  g.add(slide, grip, guard);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export class Guns {
  /** Players carry and use pistols (set by chapters). */
  playersArmed = false;
  /** Extra bodies showing a gun (cutscenes, NPC gunmen). */
  private shown = new Set<string>();
  private models = new Map<string, THREE.Group>();
  /** Bodies currently aiming: gun points along the aim instead of down. */
  private fx: Fx[] = [];
  private mat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.75, roughness: 0.38 });
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private flashGeo = new THREE.OctahedronGeometry(0.09, 0);
  private tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  private light: THREE.PointLight | null = null;
  private lightT = 0;
  /** Local player's magazine. */
  ammo = MAG_SIZE;
  reloadT = 0;

  constructor(private g: Game) {}

  show(id: string, on: boolean): void {
    if (on) this.shown.add(id); else this.shown.delete(id);
  }

  hasGun(id: string): boolean {
    if (this.shown.has(id)) return true;
    if (this.playersArmed && (id === 'elias' || id === 'jax')) return true;
    return !!this.g.npcs.get(id)?.def.gun && !!this.g.npcs.get(id)?.alive;
  }

  private bodyOf(id: string): Body | null {
    if (id === 'elias' || id === 'jax') return this.g.body(id);
    return this.g.npcs.get(id)?.body ?? null;
  }

  /** World position of the muzzle (the hand if no gun is drawn). */
  muzzle(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const m = this.models.get(id);
    if (m?.visible) return out.set(0, 0.03, 0.16).applyMatrix4(m.matrixWorld);
    const b = this.bodyOf(id);
    if (!b) return out.set(0, 0, 0);
    return out.copy(b.chest()).addScaledVector(b.forward(), 0.5);
  }

  update(dt: number): void {
    const g = this.g;
    // Guns in hands.
    const ids = new Set<string>(this.shown);
    if (this.playersArmed) { ids.add('elias'); ids.add('jax'); }
    for (const n of g.npcs.values()) if (n.def.gun) ids.add(n.id);
    for (const [id, m] of this.models) if (!ids.has(id)) m.visible = false;
    for (const id of ids) {
      const b = this.bodyOf(id);
      const hand = b?.model.bone('Bip01_R_Hand');
      if (!b || !hand || b.hidden || !b.model.root.visible || (g.npcs.has(id) && !g.npcs.get(id)!.alive && !this.shown.has(id))) { const m = this.models.get(id); if (m) m.visible = false; continue; }
      let m = this.models.get(id);
      if (!m) { m = pistol(this.mat); g.world.root.add(m); this.models.set(id, m); }
      m.visible = true;
      hand.getWorldPosition(m.position);
      const fwd = b.forward();
      const aiming = b.poseName === 'aim';
      // Pointing forward when aiming, else held down along the leg.
      const dir = aiming ? fwd.clone().add(new THREE.Vector3(0, (b.poseCtx()?.k?.pitch ?? 0) * 0.9, 0)).normalize() : fwd.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
      m.position.addScaledVector(fwd, aiming ? 0.04 : 0.02).add(new THREE.Vector3(0, aiming ? 0.02 : -0.03, 0));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      // Keep the gun upright around its barrel.
      const right = new THREE.Vector3().crossVectors(UP, dir);
      if (right.lengthSq() > 1e-4) {
        right.normalize();
        const up = new THREE.Vector3().crossVectors(dir, right);
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, dir));
      }
      m.updateMatrixWorld();
    }
    // Flashes and tracers.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) { f.mesh.removeFromParent(); this.fx.splice(i, 1); continue; }
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life / f.max;
    }
    if (this.light) {
      this.lightT -= dt;
      this.light.intensity = this.lightT > 0 ? 6 * (this.lightT / 0.06) : 0;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = MAG_SIZE;
    }
  }

  /** Visuals and sound of one shot (both clients). */
  fire(byId: string, from: THREE.Vector3, to: THREE.Vector3, wall: boolean): void {
    const g = this.g;
    const muzzle = this.models.get(byId)?.visible ? this.muzzle(byId) : from;
    // Flash
    const fl = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    fl.position.copy(muzzle);
    fl.scale.set(1, 1, 1.8);
    fl.lookAt(to);
    fl.rotateZ(Math.random() * Math.PI);
    g.world.root.add(fl);
    this.fx.push({ mesh: fl, life: 0.05, max: 0.05 });
    // Tracer
    const len = muzzle.distanceTo(to);
    if (len > 0.5) {
      const tr = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      tr.position.lerpVectors(muzzle, to, 0.5);
      tr.scale.set(1, 1, len);
      tr.lookAt(to);
      g.world.root.add(tr);
      this.fx.push({ mesh: tr, life: 0.06, max: 0.06 });
    }
    // One shared light for the flash: added once so shaders compile once.
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
    g.audio.gunshot(from, byId === g.localChar ? 0.9 : 0.8, near > 45);
    g.world.addNoise(from, 30, byId, 'fight');
    if (byId === g.localChar) g.cam.addShake(0.08);
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

  /** Best enemy for the local player's auto-aim. */
  pickTarget(b: Body, list: Combatant[], camFwd: THREE.Vector3): Combatant | null {
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const eye = b.chest();
    for (const c of list) {
      if (!c.alive || !c.hostile) continue;
      const to = v.subVectors(c.body.pos, b.pos);
      const d = Math.hypot(to.x, to.z);
      if (d > SHOT_RANGE) continue;
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
    this.ammo = MAG_SIZE;
    this.reloadT = 0;
    for (const f of this.fx) f.mesh.removeFromParent();
    this.fx = [];
  }

  dispose(): void {
    this.reset();
    for (const m of this.models.values()) m.removeFromParent();
    this.models.clear();
    this.light?.removeFromParent();
    this.light = null;
    this.shown.clear();
  }
}
