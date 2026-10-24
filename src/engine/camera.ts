// Third-person follow camera with collision, auto-recentre, shake and cinematic shots.
import * as THREE from 'three';
import type { CollisionWorld } from './physics';

export interface Shot {
  /** Camera position. */
  from: THREE.Vector3;
  /** Look-at point. */
  to: THREE.Vector3;
  /** End position/target for a moving shot. */
  fromEnd?: THREE.Vector3;
  toEnd?: THREE.Vector3;
  fov?: number;
  duration: number;
  /** Blend time from the previous camera. */
  blend?: number;
  ease?: 'linear' | 'inOut' | 'out';
  /** Optional getters to track moving actors. */
  track?: () => { from?: THREE.Vector3; to?: THREE.Vector3 };
  shake?: number;
}

const ease = (t: number, e: Shot['ease']) => (e === 'linear' ? t : e === 'out' ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t));

export type CamMode = 'follow' | 'bike' | 'cinematic' | 'fixed';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'follow';
  yaw = 0;
  pitch = 0.18;
  distance = 3.4;
  minPitch = -0.6;
  maxPitch = 1.05;
  shoulder = 0.42;
  height = 1.55;
  baseFov = 62;
  fovBoost = 0;
  private curDist = 3.4;
  private trauma = 0;
  private idleLook = 0;
  readonly pivot = new THREE.Vector3();
  private smoothPivot = new THREE.Vector3();
  private shot: Shot | null = null;
  private shotT = 0;
  private blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
  private blendT = 1;
  private blendDur = 0;
  /** Extra look offset for aiming at points of interest during gameplay. */
  readonly lookOffset = new THREE.Vector3();
  autoFollow = true;
  /** Bike chase camera state. */
  private bikeVel = new THREE.Vector3();
  private noise = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.06, 600);
    this.camera.position.set(0, 2, -4);
  }

  get forward(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get right(): THREE.Vector3 { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Point the camera behind a heading immediately. */
  snapBehind(yaw: number, pivot?: THREE.Vector3): void {
    this.yaw = yaw;
    this.pitch = 0.18;
    if (pivot) { this.pivot.copy(pivot); this.smoothPivot.copy(pivot); }
    this.curDist = this.distance;
  }

  playShot(shot: Shot): void {
    this.captureBlend(shot.blend ?? 0);
    this.shot = shot;
    this.shotT = 0;
    this.mode = 'cinematic';
  }

  endCinematic(blend = 0.6): void {
    this.captureBlend(blend);
    this.shot = null;
    this.mode = 'follow';
  }

  private captureBlend(dur: number): void {
    this.blendFrom.pos.copy(this.camera.position);
    this.blendFrom.quat.copy(this.camera.quaternion);
    this.blendFrom.fov = this.camera.fov;
    this.blendDur = dur;
    this.blendT = dur > 0 ? 0 : 1;
  }

  /**
   * @param look input look delta (already sensitivity-scaled)
   * @param target character feet position
   * @param heading character facing yaw (for auto-follow)
   * @param moving whether the character is moving
   */
  update(dt: number, look: THREE.Vector2, target: THREE.Vector3, heading: number, moving: boolean, world: CollisionWorld | null, speed = 0): void {
    this.noise += dt;
    if (this.mode === 'cinematic' && this.shot) {
      this.updateShot(dt);
    } else if (this.mode === 'bike') {
      this.updateBike(dt, look, target, heading, speed, world);
    } else {
      this.updateFollow(dt, look, target, heading, moving, world);
    }
    // Blend from previous camera transform.
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / Math.max(0.001, this.blendDur));
      const k = ease(this.blendT, 'inOut');
      this.camera.position.lerpVectors(this.blendFrom.pos, this.camera.position, k);
      this.camera.quaternion.slerpQuaternions(this.blendFrom.quat, this.camera.quaternion, k);
      this.camera.fov = THREE.MathUtils.lerp(this.blendFrom.fov, this.camera.fov, k);
    }
    // Shake
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const t = this.noise * 30;
      this.camera.rotateX(Math.sin(t * 1.1) * 0.02 * s);
      this.camera.rotateY(Math.sin(t * 1.7 + 1) * 0.02 * s);
      this.camera.rotateZ(Math.sin(t * 2.3 + 2) * 0.015 * s);
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
    }
    this.camera.updateProjectionMatrix();
  }

  private updateFollow(dt: number, look: THREE.Vector2, target: THREE.Vector3, heading: number, moving: boolean, world: CollisionWorld | null): void {
    const manual = Math.abs(look.x) + Math.abs(look.y) > 1e-4;
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, this.minPitch, this.maxPitch);
    this.idleLook = manual ? 0 : this.idleLook + dt;
    if (this.autoFollow && moving && this.idleLook > 1.2) {
      // Gently swing behind the direction of travel.
      let d = heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2.6) this.yaw += d * Math.min(1, dt * 0.9);
      this.pitch += (0.16 - this.pitch) * Math.min(1, dt * 0.6);
    }
    this.pivot.set(target.x, target.y + this.height, target.z).add(this.lookOffset);
    // Smooth the pivot vertically to hide stair steps.
    this.smoothPivot.x = this.pivot.x;
    this.smoothPivot.z = this.pivot.z;
    this.smoothPivot.y += (this.pivot.y - this.smoothPivot.y) * Math.min(1, dt * 12);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const right = this.right;
    const origin = this.smoothPivot.clone().addScaledVector(right, this.shoulder * Math.min(1, this.curDist / this.distance));
    let want = this.distance;
    if (world) {
      const hit = world.raycast(origin, back, this.distance + 0.25, (b) => b.blocksCamera);
      if (hit) want = Math.max(0.55, hit.dist - 0.25);
    }
    // Pull in fast, ease out slowly.
    this.curDist += (want - this.curDist) * Math.min(1, dt * (want < this.curDist ? 18 : 3));
    this.camera.position.copy(origin).addScaledVector(back, this.curDist);
    this.camera.lookAt(origin.x - back.x, origin.y - back.y * 0.9, origin.z - back.z);
    const fovT = this.baseFov + this.fovBoost;
    this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 4);
  }

  private updateBike(dt: number, look: THREE.Vector2, target: THREE.Vector3, heading: number, speed: number, world: CollisionWorld | null): void {
    this.idleLook = Math.abs(look.x) > 1e-4 ? 0 : this.idleLook + dt;
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -0.2, 0.8);
    let d = heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const followRate = this.idleLook > 0.6 ? 4.5 : 0.6;
    this.yaw += d * Math.min(1, dt * followRate);
    this.pitch += (0.2 - this.pitch) * Math.min(1, dt * 1.5);
    const dist = 4.2 + Math.min(speed, 30) * 0.05;
    this.pivot.set(target.x, target.y + 1.25, target.z);
    this.bikeVel.lerp(this.pivot, Math.min(1, dt * 14));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    let want = dist;
    if (world) {
      const hit = world.raycast(this.pivot, back, dist + 0.3, (b) => b.blocksCamera);
      if (hit) want = Math.max(1.2, hit.dist - 0.3);
    }
    this.curDist += (want - this.curDist) * Math.min(1, dt * (want < this.curDist ? 14 : 2.5));
    this.camera.position.copy(this.bikeVel).addScaledVector(back, this.curDist);
    // Keep the camera above terrain.
    if (world) {
      const g = world.groundAt(this.camera.position.x, this.camera.position.z, this.camera.position.y + 5);
      if (g && this.camera.position.y < g.y + 0.6) this.camera.position.y = g.y + 0.6;
    }
    this.camera.lookAt(this.bikeVel.x - back.x * 4, this.bikeVel.y - back.y * 2 + 0.2, this.bikeVel.z - back.z * 4);
    const fovT = this.baseFov + 4 + Math.min(speed, 35) * 0.45 + this.fovBoost;
    this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 3);
  }

  private updateShot(dt: number): void {
    const s = this.shot!;
    this.shotT = Math.min(s.duration, this.shotT + dt);
    const k = ease(s.duration > 0 ? this.shotT / s.duration : 1, s.ease ?? 'inOut');
    const tr = s.track?.();
    const from = (tr?.from ?? s.from).clone();
    const to = (tr?.to ?? s.to).clone();
    if (s.fromEnd) from.lerp(s.fromEnd, k);
    if (s.toEnd) to.lerp(s.toEnd, k);
    this.camera.position.copy(from);
    this.camera.lookAt(to);
    this.camera.fov = s.fov ?? 45;
    if (s.shake) this.trauma = Math.max(this.trauma, s.shake);
  }

  get shotDone(): boolean {
    return !this.shot || this.shotT >= this.shot.duration;
  }
}
