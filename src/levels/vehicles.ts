// Cars as props: police cruisers with light bars and headlight beams, driven along paths by the shared clock.
import * as THREE from 'three';
import type { World } from '../game/world';
import type { LightCone } from './lights';
import { canvasTexture } from '../engine/materials';

export interface CarOpts {
  police?: boolean;
  /** Body tint multiplier. */
  tint?: THREE.ColorRepresentation;
  headlights?: boolean;
  /** Collider while parked/moving (kept in sync with the car). */
  collider?: boolean;
}

const beamMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  uniforms: { uColor: { value: new THREE.Color(0xfff4dc) }, uStrength: { value: 0.12 }, ...THREE.UniformsLib.fog },
  vertexShader: /* glsl */ `varying float vT; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <fog_pars_vertex>
    void main() { vT = uv.y; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uStrength; varying float vT; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <fog_pars_fragment>
    void main() { float a = uStrength * pow(abs(dot(vN, vV)), 1.5) * pow(vT, 1.6); gl_FragColor = vec4(uColor * a, a);
    #include <fog_fragment>
    }`,
});

/** A driveable-looking car prop. Front faces local +X. */
export class Car {
  readonly root = new THREE.Group();
  readonly cones: Array<LightCone & { local: THREE.Vector3 }> = [];
  private bar: THREE.Mesh[] = [];
  private beams: THREE.Mesh[] = [];
  collider: import('../engine/physics').Box | null = null;
  readonly length = 5.2;
  readonly width = 2.0;
  speed = 0;
  sirenOn = false;
  lightsOn = true;

  static async create(world: World, opts: CarOpts = {}): Promise<Car> {
    const c = new Car();
    const model = await world.model('sedan');
    if (opts.police || opts.tint) {
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        m.material = mats.map((mt) => {
          if (!mt.name?.includes('Bodymat')) return mt;
          const cl = mt.clone();
          cl.color = new THREE.Color(opts.police ? 0x2a2d33 : opts.tint);
          cl.metalness = 0.5; cl.roughness = 0.35;
          return cl;
        });
        if ((m.material as THREE.Material[]).length === 1) m.material = (m.material as THREE.Material[])[0];
      });
    }
    c.root.add(model);
    const W = world.mats;
    if (opts.police) {
      // Light bar
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 1.25), W.plain(0x1a1a1a, 0.5, 0.4));
      base.position.set(-0.25, 1.52, 0);
      c.root.add(base);
      for (const [z, col] of [[-0.33, 0xff1a1a], [0.33, 0x1a4dff]] as const) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0.2, roughness: 0.3 }));
        l.position.set(-0.25, 1.6, z);
        c.root.add(l);
        c.bar.push(l);
      }
      // Door lettering
      const tex = canvasTexture('policeDoor', (ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.fillStyle = '#e8e8e2';
        ctx.fillRect(0, s * 0.36, s, s * 0.28);
        ctx.fillStyle = '#1b2a55';
        ctx.font = `bold ${s * 0.18}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('COUNTY SHERIFF', s / 2, s / 2);
      }, 512);
      const dm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), dm);
        p.position.set(0.1, 0.78, side * 0.955);
        p.rotation.y = side > 0 ? 0 : Math.PI;
        c.root.add(p);
      }
    }
    if (opts.headlights !== false) {
      const geo = new THREE.CylinderGeometry(0.05, 2.6, 16, 18, 1, true);
      geo.translate(0, -8, 0);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI / 2); // point along +X
      for (const z of [-0.6, 0.6]) {
        const b = new THREE.Mesh(geo, beamMaterial());
        b.position.set(2.45, 0.68, z);
        b.rotation.z = -0.06;
        b.renderOrder = 3;
        c.root.add(b);
        c.beams.push(b);
      }
      const glow = W.emissive(0xfff2d8, 6);
      for (const z of [-0.62, 0.62]) { const h = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), glow); h.position.set(2.5, 0.68, z); h.rotation.y = Math.PI / 2; c.root.add(h); }
      c.cones.push({ local: new THREE.Vector3(2.5, 0.8, 0), pos: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), cosHalf: Math.cos(0.32), range: 18, intensity: 1.4, on: true });
    }
    c.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).transparent) { m.castShadow = true; m.receiveShadow = true; } });
    world.root.add(c.root);
    if (opts.collider !== false) c.collider = world.physics.addBox({ x: 0, y: 0.8, z: 0 }, { x: c.length, y: 1.6, z: c.width }, 0, { surface: 'metal' });
    return c;
  }

  setPose(p: THREE.Vector3, yaw: number, physics?: import('../engine/physics').CollisionWorld): void {
    this.root.position.copy(p);
    // Model front is +X; yaw measured like characters (0 = +Z).
    this.root.rotation.y = yaw - Math.PI / 2;
    this.root.updateMatrixWorld(true);
    if (this.collider && physics) physics.move(this.collider, p.x, p.y + 0.8, p.z, yaw - Math.PI / 2);
    for (const c of this.cones) {
      c.pos.copy(c.local).applyMatrix4(this.root.matrixWorld);
      c.dir.set(Math.sin(yaw), -0.08, Math.cos(yaw)).normalize();
    }
  }

  update(t: number): void {
    for (const b of this.beams) b.visible = this.lightsOn;
    for (const c of this.cones) c.on = this.lightsOn;
    if (this.bar.length) {
      const ph = Math.floor(t * 6) % 4;
      const on = this.sirenOn;
      (this.bar[0].material as THREE.MeshStandardMaterial).emissiveIntensity = on && (ph === 0 || ph === 1) ? 8 : 0.2;
      (this.bar[1].material as THREE.MeshStandardMaterial).emissiveIntensity = on && (ph === 2 || ph === 3) ? 8 : 0.2;
    }
  }

  dispose(): void { this.root.removeFromParent(); }
}

/** Arc-length parameterised polyline for deterministic path driving. */
export class Path {
  readonly pts: THREE.Vector3[];
  readonly lens: number[] = [];
  readonly length: number;
  constructor(pts: THREE.Vector3[], readonly loop = true) {
    this.pts = loop ? [...pts, pts[0]] : pts;
    let acc = 0;
    this.lens.push(0);
    for (let i = 1; i < this.pts.length; i++) { acc += this.pts[i].distanceTo(this.pts[i - 1]); this.lens.push(acc); }
    this.length = acc;
  }
  /** Position and heading at distance s along the path. */
  at(s: number, out = new THREE.Vector3()): { pos: THREE.Vector3; yaw: number } {
    const L = this.length;
    s = this.loop ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    let i = 1;
    while (i < this.lens.length - 1 && this.lens[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const k = (s - this.lens[i - 1]) / Math.max(1e-6, this.lens[i] - this.lens[i - 1]);
    out.lerpVectors(a, b, k);
    return { pos: out, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  /** Closest distance parameter to p (coarse). */
  project(p: THREE.Vector3): number {
    let best = 0, bd = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const q = a.clone().addScaledVector(ab, t);
      const d = q.distanceToSquared(p);
      if (d < bd) { bd = d; best = this.lens[i - 1] + t * (this.lens[i] - this.lens[i - 1]); }
    }
    return best;
  }
}
