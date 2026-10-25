// Scattered vegetation and props with distance LOD: full meshes near the camera, baked billboards far away.
import * as THREE from 'three';
import type { World } from '../game/world';

export interface FoliageItem {
  model: string;
  /** Uniform scale range. */
  scale?: [number, number];
  /** Trunk collider radius (0 = none). */
  collider?: number;
  colliderHeight?: number;
  /** Use a billboard impostor beyond the near distance. */
  impostor?: boolean;
  /** Max visible distance (m) for the full mesh; defaults from quality. */
  near?: number;
  /** Max distance for the impostor. */
  far?: number;
  shadow?: boolean;
  /** Push down into the ground (m) to hide floating roots. */
  sink?: number;
}

export interface Placement { item: number; x: number; y: number; z: number; yaw: number; s: number }

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }

interface ItemRuntime {
  def: FoliageItem;
  parts: Part[];
  near: THREE.InstancedMesh[];
  imp: THREE.InstancedMesh | null;
  placements: Placement[];
  nearDist: number;
  farDist: number;
}

export class Foliage {
  private items: ItemRuntime[] = [];
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private timer = 0;
  readonly group = new THREE.Group();

  constructor(readonly world: World, private gl: THREE.WebGLRenderer) {
    world.root.add(this.group);
  }

  async add(defs: FoliageItem[], placements: Placement[]): Promise<void> {
    const base = this.items.length;
    const q = this.world.q;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const obj = await this.world.model(def.model);
      obj.updateMatrixWorld(true);
      const parts: Part[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) parts.push({ geo: m.geometry, mat: m.material, local: m.matrixWorld.clone() });
      });
      const mine = placements.filter((p) => p.item === i);
      const cap = Math.max(1, mine.length);
      const scaleQ = q.level === 'low' ? 0.6 : q.level === 'medium' ? 0.8 : q.level === 'high' ? 1 : 1.35;
      const nearDist = (def.near ?? (def.impostor ? 55 : 40)) * scaleQ;
      const farDist = (def.far ?? Math.min(q.drawDistance, 220)) * (def.impostor ? 1 : 0);
      const near = parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, cap);
        im.count = 0;
        im.castShadow = (def.shadow ?? true) && q.shadows;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
        return im;
      });
      let imp: THREE.InstancedMesh | null = null;
      if (def.impostor) {
        imp = this.makeImpostor(obj, cap);
        imp.count = 0;
        imp.frustumCulled = false;
        this.group.add(imp);
      }
      this.items.push({ def, parts, near, imp, placements: mine.map((p) => ({ ...p, item: base + i })), nearDist, farDist });
      // Trunk colliders
      if (def.collider) {
        for (const p of mine) {
          const r = def.collider * p.s;
          const h = (def.colliderHeight ?? 3) * p.s;
          this.world.physics.addBox({ x: p.x, y: p.y + h / 2, z: p.z }, { x: r * 2, y: h, z: r * 2 }, p.yaw, { surface: 'wood', blocksCamera: false });
        }
      }
    }
    this.lastCam.set(1e9, 0, 0);
  }

  /** Renders the model from the side into a texture and returns an instanced cross-billboard. */
  private makeImpostor(obj: THREE.Object3D, cap: number): THREE.InstancedMesh {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const w = Math.max(size.x, size.z), h = size.y;
    const texW = 128, texH = Math.min(512, Math.max(128, Math.round((128 * h) / w / 64) * 64 || 256));
    const rt = new THREE.WebGLRenderTarget(texW, texH, { samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(0.3, 1, 0.6);
    scene.add(dl);
    const clone = obj.clone(true);
    scene.add(clone);
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 200);
    cam.position.set(center.x, center.y, center.z + 50);
    cam.lookAt(center);
    const prevTarget = this.gl.getRenderTarget();
    const prevClear = this.gl.getClearColor(new THREE.Color());
    const prevAlpha = this.gl.getClearAlpha();
    const prevTM = this.gl.toneMapping;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.setRenderTarget(rt);
    this.gl.setClearColor(0x3a4a2a, 0);
    this.gl.clear(true, true, false);
    this.gl.render(scene, cam);
    this.gl.setRenderTarget(prevTarget);
    this.gl.setClearColor(prevClear, prevAlpha);
    this.gl.toneMapping = prevTM;
    const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    mat.envMapIntensity = 0.3;
    mat.userData.renderTarget = rt; // freed with the level (disposeTree)
    // Two crossed quads, normals tilted up so lighting matches the 3D trees.
    const g1 = new THREE.PlaneGeometry(w, h);
    const g2 = new THREE.PlaneGeometry(w, h);
    g2.rotateY(Math.PI / 2);
    const g = mergeSimple([g1, g2]);
    g.translate(center.x, center.y, center.z);
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) {
      const v = new THREE.Vector3(n.getX(i), 0, n.getZ(i)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.85, 0)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    const im = new THREE.InstancedMesh(g, mat, cap);
    im.castShadow = false;
    im.receiveShadow = true;
    return im;
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.timer -= dt;
    if (this.timer > 0 && cam.distanceToSquared(this.lastCam) < 16) return;
    if (cam.distanceToSquared(this.lastCam) < 4) return;
    this.timer = 0.4;
    this.lastCam.copy(cam);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Matrix4();
    for (const it of this.items) {
      const n2 = it.nearDist * it.nearDist, f2 = it.farDist * it.farDist;
      let ni = 0, fi = 0;
      for (const pl of it.placements) {
        const dx = pl.x - cam.x, dz = pl.z - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > f2 && d2 > n2) continue;
        q.setFromAxisAngle(up, pl.yaw);
        s.setScalar(pl.s);
        p.set(pl.x, pl.y - (it.def.sink ?? 0) * pl.s, pl.z);
        m.compose(p, q, s);
        if (d2 <= n2) {
          for (let k = 0; k < it.near.length; k++) it.near[k].setMatrixAt(ni, tmp.multiplyMatrices(m, it.parts[k].local));
          ni++;
        } else if (it.imp) {
          it.imp.setMatrixAt(fi++, m);
        }
      }
      for (const im of it.near) { im.count = ni; im.instanceMatrix.needsUpdate = true; }
      if (it.imp) { it.imp.count = fi; it.imp.instanceMatrix.needsUpdate = true; }
    }
  }
}

function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of gs) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(U.getX(i), U.getY(i)); }
    const I = g.index!;
    for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + off);
    off += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Poisson-ish scatter: jittered grid with rejection by a density function. */
export function scatter(opts: {
  x0: number; z0: number; x1: number; z1: number; spacing: number; seed: number;
  density: (x: number, z: number) => number;
  pick: (r: number, x: number, z: number) => number;
  height: (x: number, z: number) => number;
  scale?: (item: number, r: number) => number;
}): Placement[] {
  let s = opts.seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Placement[] = [];
  for (let z = opts.z0; z < opts.z1; z += opts.spacing) {
    for (let x = opts.x0; x < opts.x1; x += opts.spacing) {
      const px = x + rnd() * opts.spacing, pz = z + rnd() * opts.spacing;
      if (rnd() > opts.density(px, pz)) continue;
      const item = opts.pick(rnd(), px, pz);
      if (item < 0) continue;
      const r = rnd();
      out.push({ item, x: px, z: pz, y: opts.height(px, pz), yaw: rnd() * Math.PI * 2, s: opts.scale ? opts.scale(item, r) : 0.85 + r * 0.4 });
    }
  }
  return out;
}
