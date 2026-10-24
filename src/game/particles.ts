// Pooled GPU point particles (dust, mud, sparks, steam, smoke, splashes) and camera-local rain.
import * as THREE from 'three';
import type { QualitySettings } from '../engine/quality';

export type ParticleKind = 'dust' | 'mud' | 'sparks' | 'steam' | 'smoke' | 'splash' | 'debris' | 'leaves';

interface Preset {
  color: [number, number, number];
  colorVar: number;
  size: [number, number];
  grow: number;
  life: [number, number];
  speed: [number, number];
  up: number;
  spread: number;
  gravity: number;
  drag: number;
  alpha: number;
  additive?: boolean;
}

const PRESETS: Record<ParticleKind, Preset> = {
  dust: { color: [0.55, 0.5, 0.42], colorVar: 0.08, size: [0.25, 0.5], grow: 1.6, life: [0.8, 1.6], speed: [0.3, 1.2], up: 0.5, spread: 1, gravity: -0.1, drag: 1.8, alpha: 0.35 },
  mud: { color: [0.22, 0.16, 0.1], colorVar: 0.05, size: [0.05, 0.14], grow: 0, life: [0.5, 1.0], speed: [2, 5], up: 1.2, spread: 0.6, gravity: 9.8, drag: 0.4, alpha: 0.95 },
  sparks: { color: [1.0, 0.7, 0.3], colorVar: 0.1, size: [0.03, 0.06], grow: -0.5, life: [0.25, 0.6], speed: [2, 6], up: 0.8, spread: 1, gravity: 6, drag: 0.6, alpha: 1, additive: true },
  steam: { color: [0.85, 0.87, 0.9], colorVar: 0.03, size: [0.3, 0.6], grow: 1.2, life: [2, 4], speed: [0.2, 0.5], up: 1, spread: 0.3, gravity: -0.3, drag: 0.5, alpha: 0.18 },
  smoke: { color: [0.25, 0.25, 0.27], colorVar: 0.05, size: [0.5, 1.0], grow: 1.5, life: [2, 4], speed: [0.3, 1], up: 1, spread: 0.5, gravity: -0.4, drag: 0.6, alpha: 0.35 },
  splash: { color: [0.7, 0.75, 0.8], colorVar: 0.05, size: [0.05, 0.12], grow: 0.5, life: [0.4, 0.8], speed: [1.5, 4], up: 1.5, spread: 0.7, gravity: 9.8, drag: 0.3, alpha: 0.7 },
  debris: { color: [0.45, 0.42, 0.38], colorVar: 0.1, size: [0.04, 0.1], grow: 0, life: [0.6, 1.2], speed: [1.5, 4], up: 1, spread: 1, gravity: 9.8, drag: 0.2, alpha: 1 },
  leaves: { color: [0.32, 0.36, 0.14], colorVar: 0.1, size: [0.06, 0.12], grow: 0, life: [1.5, 3], speed: [0.5, 2], up: 1, spread: 1, gravity: 1.2, drag: 1.5, alpha: 0.9 },
};

const VERT = /* glsl */ `
  attribute float aSize; attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    float a = smoothstep(1.0, 0.2, d) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <fog_fragment>
  }`;

export class Particles {
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private kind: Uint8Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private geo: THREE.BufferGeometry;
  private points: THREE.Points;
  private additive: THREE.Points;
  private addGeo: THREE.BufferGeometry;
  private next = 0;
  private kinds = Object.keys(PRESETS) as ParticleKind[];
  rain: Rain | null = null;

  constructor(private scene: THREE.Scene, private q: QualitySettings) {
    this.max = Math.floor(1600 * Math.max(0.25, q.particles));
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.baseSize = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    const mk = (additive: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
        uniforms: { uScale: { value: 600 }, ...THREE.UniformsLib.fog },
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = 5;
      return { g, p };
    };
    const a = mk(false);
    this.geo = a.g; this.points = a.p;
    const b = mk(true);
    this.addGeo = b.g; this.additive = b.p;
    // Additive points share buffers but render only additive kinds via alpha trick: we keep a separate pass.
    this.additive.visible = false;
    scene.add(this.points);
  }

  setViewport(height: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = height * 0.9;
  }

  emit(kind: ParticleKind, at: THREE.Vector3, count: number, dir?: THREE.Vector3, opts: { speed?: number; color?: [number, number, number] } = {}): void {
    const p = PRESETS[kind];
    const n = Math.max(1, Math.round(count * this.q.particles));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const sp = (p.speed[0] + Math.random() * (p.speed[1] - p.speed[0])) * (opts.speed ?? 1);
      let vx = (Math.random() * 2 - 1) * p.spread, vy = p.up * (0.5 + Math.random() * 0.5), vz = (Math.random() * 2 - 1) * p.spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const len = Math.hypot(vx, vy, vz) || 1;
      this.vel[i * 3] = (vx / len) * sp; this.vel[i * 3 + 1] = (vy / len) * sp; this.vel[i * 3 + 2] = (vz / len) * sp;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.1;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.1;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.1;
      const c = opts.color ?? p.color;
      const v = (Math.random() * 2 - 1) * p.colorVar;
      this.col[i * 4] = c[0] + v; this.col[i * 4 + 1] = c[1] + v; this.col[i * 4 + 2] = c[2] + v;
      this.baseAlpha[i] = p.alpha;
      this.baseSize[i] = p.size[0] + Math.random() * (p.size[1] - p.size[0]);
      this.maxLife[i] = p.life[0] + Math.random() * (p.life[1] - p.life[0]);
      this.life[i] = this.maxLife[i];
      this.kind[i] = this.kinds.indexOf(kind);
    }
  }

  update(dt: number): void {
    let anyAlive = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      anyAlive = true;
      const p = PRESETS[this.kinds[this.kind[i]]];
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const drag = Math.max(0, 1 - p.drag * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - p.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = Math.max(0, this.baseSize[i] * (1 + p.grow * t));
      this.col[i * 4 + 3] = this.baseAlpha[i] * Math.min(1, t * 8) * (1 - t);
    }
    if (anyAlive || this.next) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
    this.rain?.update(dt);
  }

  enableRain(camera: THREE.Camera, intensity = 1): void {
    if (!this.rain) this.rain = new Rain(this.scene, camera, Math.floor(2200 * this.q.particles * intensity));
  }

  disableRain(): void {
    this.rain?.dispose();
    this.rain = null;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.addGeo.dispose();
    (this.points.material as THREE.Material).dispose();
    this.disableRain();
  }
}

/** Rain streaks in a box that follows the camera. */
class Rain {
  private lines: THREE.LineSegments;
  private pos: Float32Array;
  private n: number;
  private area = 18;
  private height = 12;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.reset(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.32, depthWrite: false });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  private reset(i: number, anyHeight: boolean): void {
    const c = this.camera.position;
    const x = c.x + (Math.random() - 0.5) * this.area * 2;
    const z = c.z + (Math.random() - 0.5) * this.area * 2;
    const y = c.y + (anyHeight ? (Math.random() - 0.4) * this.height : this.height * 0.6);
    const o = i * 6;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.pos[o + 3] = x + 0.03; this.pos[o + 4] = y - 0.45; this.pos[o + 5] = z + 0.02;
  }
  update(dt: number): void {
    const c = this.camera.position;
    const fall = 16 * dt;
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      this.pos[o + 1] -= fall; this.pos[o + 4] -= fall;
      this.pos[o] += 0.6 * dt; this.pos[o + 3] += 0.6 * dt;
      if (this.pos[o + 1] < c.y - this.height * 0.4 || Math.abs(this.pos[o] - c.x) > this.area || Math.abs(this.pos[o + 2] - c.z) > this.area) this.reset(i, false);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
