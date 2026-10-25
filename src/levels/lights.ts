// Night-time stealth lights: guard flashlight beams and sweeping searchlights (visual cone + light level query).
import * as THREE from 'three';
import type { World } from '../game/world';
import type { Body } from '../game/body';

export const beamMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  uniforms: { uColor: { value: new THREE.Color(0xfff1d0) }, uStrength: { value: 0.22 }, ...THREE.UniformsLib.fog },
  vertexShader: /* glsl */ `
    varying float vT; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <fog_pars_vertex>
    void main() {
      vT = uv.y;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mvPosition.xyz);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying float vT; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <fog_pars_fragment>
    void main() {
      float edge = pow(abs(dot(vN, vV)), 1.6);
      float a = uStrength * edge * pow(vT, 1.4);
      gl_FragColor = vec4(uColor * a, a);
      #include <fog_fragment>
    }`,
});

export function coneGeometry(len: number, radius: number): THREE.BufferGeometry {
  // Open cone from apex (uv.y = 1) to base (uv.y = 0), pointing along +Z.
  const g = new THREE.CylinderGeometry(0.02, radius, len, 24, 1, true);
  g.translate(0, -len / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

export interface LightCone {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  cosHalf: number;
  range: number;
  intensity: number;
  on: boolean;
}

/** A flashlight carried by an NPC (follows the body's chest and facing). */
export class Flashlight implements LightCone {
  readonly pos = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, 1);
  readonly cosHalf: number;
  readonly mesh: THREE.Mesh;
  private spot: THREE.Mesh;
  intensity = 0.95;
  on = true;

  constructor(world: World, readonly body: Body, readonly range = 11, half = 0.32) {
    this.cosHalf = Math.cos(half);
    this.mesh = new THREE.Mesh(coneGeometry(range, Math.tan(half) * range), beamMat());
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    world.root.add(this.mesh);
    // Light pool on the ground where the beam lands.
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTex() });
    this.spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spotMat);
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.renderOrder = 2;
    world.root.add(this.spot);
  }

  update(groundY: (x: number, z: number) => number): void {
    const b = this.body;
    const vis = this.on && b.visible !== false;
    this.mesh.visible = this.spot.visible = vis;
    if (!vis) return;
    const f = b.forward();
    this.pos.set(b.pos.x + f.x * 0.35, b.pos.y + 1.25, b.pos.z + f.z * 0.35);
    // Aim slightly down, sweeping a little.
    const t = performance.now() / 1000;
    const yaw = b.yaw + Math.sin(t * 0.9 + b.pos.x) * 0.18;
    this.dir.set(Math.sin(yaw), -0.22, Math.cos(yaw)).normalize();
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.clone().add(this.dir));
    // Ground hit
    const hitD = Math.min(this.range, (this.pos.y - groundY(this.pos.x, this.pos.z)) / Math.max(0.05, -this.dir.y));
    const hx = this.pos.x + this.dir.x * hitD, hz = this.pos.z + this.dir.z * hitD;
    this.spot.position.set(hx, groundY(hx, hz) + 0.04, hz);
    const s = 0.6 + hitD * 0.55;
    this.spot.scale.set(s, s * 1.6, 1);
    this.spot.rotation.z = -yaw;
  }

  dispose(): void { this.mesh.removeFromParent(); this.spot.removeFromParent(); }
}

/** Sweeping searchlight on a tower: follows a looping path of ground targets. */
export class Searchlight implements LightCone {
  readonly pos: THREE.Vector3;
  readonly dir = new THREE.Vector3();
  readonly cosHalf: number;
  readonly target = new THREE.Vector3();
  readonly mesh: THREE.Mesh;
  private pool: THREE.Mesh;
  intensity = 1.2;
  on = true;
  /** Seconds per full loop. */
  period: number;
  private t = 0;
  /** Hidden by zone culling (still simulated). */
  culled = false;
  /** When set, the light tracks this point instead of the path (alarm). */
  track: THREE.Vector3 | null = null;
  readonly spotRadius: number;
  readonly range = 80;

  constructor(world: World, pos: THREE.Vector3, readonly path: THREE.Vector3[], period = 16, readonly half = 0.09, readonly lamp?: THREE.Object3D, readonly light?: THREE.SpotLight | null) {
    this.pos = pos.clone();
    this.period = period;
    this.cosHalf = Math.cos(half);
    const len = 60;
    this.mesh = new THREE.Mesh(coneGeometry(len, Math.tan(half) * len), beamMat());
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.16;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    world.root.add(this.mesh);
    this.spotRadius = 2.6;
    const poolMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTex() });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.renderOrder = 2;
    world.root.add(this.pool);
  }

  /** Deterministic from shared time so both clients see the same sweep. */
  update(dt: number, sharedTime: number, groundY: (x: number, z: number) => number): void {
    void dt;
    this.mesh.visible = this.pool.visible = this.on && !this.culled;
    if (this.light) this.light.visible = this.on;
    if (!this.on) return;
    if (this.track) this.target.lerp(this.track, 0.15);
    else {
      this.t = ((sharedTime / this.period) % 1 + 1) % 1;
      const n = this.path.length;
      const f = this.t * n;
      const i = Math.floor(f), k = f - i;
      const a = this.path[i % n], b = this.path[(i + 1) % n];
      const e = k * k * (3 - 2 * k);
      this.target.lerpVectors(a, b, e);
    }
    this.target.y = groundY(this.target.x, this.target.z);
    this.dir.subVectors(this.target, this.pos).normalize();
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.target);
    const d = this.pos.distanceTo(this.target);
    const r = Math.tan(this.half) * d;
    this.pool.position.set(this.target.x, this.target.y + 0.05, this.target.z);
    this.pool.scale.set(r * 2.2, r * 2.2 / Math.max(0.3, -this.dir.y), 1);
    // A grazing beam spreads its light over a longer, dimmer ellipse.
    (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.32 * THREE.MathUtils.clamp(-this.dir.y * 1.6, 0.25, 1);
    this.pool.rotation.z = -Math.atan2(this.dir.x, this.dir.z);
    if (this.lamp) this.lamp.lookAt(this.target);
    if (this.light) { this.light.position.copy(this.pos); this.light.target.position.copy(this.target); this.light.target.updateMatrixWorld(); }
  }

  dispose(): void { this.mesh.removeFromParent(); this.pool.removeFromParent(); }
}

/** Light contribution of a cone at point p (0..intensity). */
export function coneLight(c: LightCone, p: THREE.Vector3, height = 1.0): number {
  if (!c.on) return 0;
  const dx = p.x - c.pos.x, dy = p.y + height - c.pos.y, dz = p.z - c.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > c.range || d < 0.01) return 0;
  const cos = (dx * c.dir.x + dy * c.dir.y + dz * c.dir.z) / d;
  if (cos < c.cosHalf) return 0;
  const edge = Math.min(1, (cos - c.cosHalf) / (1 - c.cosHalf) * 3);
  return c.intensity * edge * (1 - (d / c.range) ** 2 * 0.5);
}

/**
 * How deep a point is in the searchlight's pool on the ground: 0 at the centre, 1 at the visible
 * edge, >1 outside. Uses the same stretched ellipse that is drawn (a shallow beam makes a long
 * pool), so being in the light you see is what counts.
 */
export function searchlightDepth(s: Searchlight, p: THREE.Vector3): number {
  if (!s.on) return Infinity;
  const r = Math.tan(s.half) * s.pos.distanceTo(s.target) * 1.1;
  const hx = s.dir.x, hz = s.dir.z, hl = Math.hypot(hx, hz) || 1;
  const ax = hx / hl, az = hz / hl;
  const dx = p.x - s.target.x, dz = p.z - s.target.z;
  const along = dx * ax + dz * az, across = -dx * az + dz * ax;
  const rl = r / Math.max(0.3, -s.dir.y);
  return Math.hypot(across / r, along / rl);
}

/** Standing in the clearly lit part of the pool. */
export function inSearchlight(s: Searchlight, p: THREE.Vector3): boolean {
  return searchlightDepth(s, p) < 0.8;
}

let radial: THREE.Texture | null = null;
export function radialTex(): THREE.Texture {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  radial = new THREE.CanvasTexture(c);
  return radial;
}
