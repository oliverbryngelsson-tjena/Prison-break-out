// Geometry helpers: metre-UV boxes with baked height AO, and a static batcher that merges by material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface AOConfig {
  /** World heights of floors (darkening above them). */
  floors: number[];
  /** World heights of ceilings (darkening below them). */
  ceilings: number[];
  /** Strength 0..1 */
  strength: number;
  /** Fade distance (m). */
  range: number;
}

export const DEFAULT_AO: AOConfig = { floors: [0], ceilings: [], strength: 0.45, range: 0.7 };

export function aoAt(y: number, cfg: AOConfig): number {
  let k = 1;
  for (const f of cfg.floors) {
    const d = y - f;
    if (d >= -0.01 && d < cfg.range) k = Math.min(k, 1 - cfg.strength * (1 - d / cfg.range) ** 1.6);
  }
  for (const c of cfg.ceilings) {
    const d = c - y;
    if (d >= -0.01 && d < cfg.range * 0.7) k = Math.min(k, 1 - cfg.strength * 0.7 * (1 - d / (cfg.range * 0.7)) ** 1.6);
  }
  return k;
}

interface FaceSpec {
  // axis indices: u axis, v axis, normal axis and sign
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
}

const FACES: Record<string, FaceSpec> = {
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};

export type FaceName = keyof typeof FACES;

export interface BoxOpts {
  faces?: FaceName[];
  /** Vertical subdivisions for AO gradients on side faces. */
  vsplit?: boolean;
  /** UV offset (m) to vary tiling. */
  uvOffset?: [number, number];
  /** Rotate UVs 90deg on top faces (planks direction). */
  uvRotate?: boolean;
}

/**
 * Builds a box in world space (center, size, yaw) with metre-based UVs and AO vertex colours.
 */
export function boxGeometry(center: THREE.Vector3Like, size: THREE.Vector3Like, yaw = 0, ao: AOConfig | null = DEFAULT_AO, o: BoxOpts = {}): THREE.BufferGeometry {
  const faces = o.faces ?? (Object.keys(FACES) as FaceName[]);
  const hs = [size.x / 2, size.y / 2, size.z / 2];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toWorld = (x: number, y: number, z: number): [number, number, number] => [center.x + x * c + z * s, center.y + y, center.z - x * s + z * c];
  const off = o.uvOffset ?? [0, 0];
  for (const f of faces) {
    const F = FACES[f];
    const na = F.n.findIndex((v) => v !== 0);
    const ua = F.u.findIndex((v) => v !== 0);
    const va = F.v.findIndex((v) => v !== 0);
    const nsign = F.n[na];
    const usign = F.u[ua], vsign = F.v[va];
    const isSide = va === 1;
    // Vertical cut positions (local, from -h to +h)
    let vcuts = [-1, 1];
    if (isSide && o.vsplit !== false && ao) {
      const H = hs[1] * 2;
      const set = new Set<number>([-1, 1]);
      const worldBottom = center.y - hs[1];
      for (const fl of ao.floors) for (const d of [0.12, 0.3, ao.range]) {
        const y = fl + d;
        const t = ((y - worldBottom) / H) * 2 - 1;
        if (t > -1 && t < 1) set.add(t);
      }
      for (const cl of ao.ceilings) for (const d of [0.15, ao.range * 0.7]) {
        const y = cl - d;
        const t = ((y - worldBottom) / H) * 2 - 1;
        if (t > -1 && t < 1) set.add(t);
      }
      vcuts = [...set].sort((a, b) => a - b);
    }
    const ucuts = [-1, 1];
    const base = pos.length / 3;
    for (let j = 0; j < vcuts.length; j++) for (let i = 0; i < ucuts.length; i++) {
      const p = [0, 0, 0];
      p[na] = nsign * hs[na];
      p[ua] = ucuts[i] * usign * hs[ua];
      p[va] = vcuts[j] * vsign * hs[va];
      const w = toWorld(p[0], p[1], p[2]);
      pos.push(...w);
      const nw = [F.n[0] * c + F.n[2] * s, F.n[1], -F.n[0] * s + F.n[2] * c];
      nor.push(...nw);
      // metre UVs: u along face width, v along height
      let uu = (ucuts[i] * hs[ua]) + off[0];
      let vv = (vcuts[j] * hs[va]) + off[1];
      if (isSide) vv = w[1];
      if (!isSide) { uu = (f === 'py' || f === 'ny') ? w[0] : uu; vv = (f === 'py' || f === 'ny') ? -w[2] : vv; }
      if (o.uvRotate && !isSide) [uu, vv] = [vv, uu];
      uv.push(uu, vv);
      const k = ao ? aoAt(w[1], ao) : 1;
      // ceilings of rooms are a little darker than floors
      const kk = f === 'ny' ? k * 0.85 : k;
      col.push(kk, kk, kk);
    }
    const cols = ucuts.length;
    for (let j = 0; j < vcuts.length - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = base + j * cols + i, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/** Ensures triangle winding matches the vertex normals (CCW front faces). */
function fixWinding(g: THREE.BufferGeometry): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const idx = g.index!.array as Uint16Array | Uint32Array | number[];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  const arr = Array.from(idx);
  for (let i = 0; i < arr.length; i += 3) {
    a.fromBufferAttribute(p, arr[i]); b.fromBufferAttribute(p, arr[i + 1]); c.fromBufferAttribute(p, arr[i + 2]);
    nn.fromBufferAttribute(n, arr[i]);
    const fn = b.clone().sub(a).cross(c.clone().sub(a));
    if (fn.dot(nn) < 0) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
  }
  g.setIndex(arr);
}

/** Bakes a transform + AO colours into an arbitrary geometry (for props merged into the batch). */
export function bakeGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, ao: AOConfig | null, tint = 1): THREE.BufferGeometry {
  const g = src.index ? src.clone() : src.clone();
  g.applyMatrix4(matrix);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = (ao ? aoAt(p.getY(i), ao) : 1) * tint;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Collects static geometry by material and merges it into few meshes. */
export class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  shadows = true;

  add(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    let list = this.groups.get(mat);
    if (!list) { list = []; this.groups.set(mat, list); }
    list.push(geo.index ? geo : geo);
  }

  box(mat: THREE.Material, center: THREE.Vector3Like, size: THREE.Vector3Like, yaw = 0, ao: AOConfig | null = DEFAULT_AO, o: BoxOpts = {}): void {
    this.add(boxGeometry(center, size, yaw, ao, o), mat);
  }

  /** Merge an Object3D's meshes (e.g. a procedural prop) into the batch. */
  addObject(obj: THREE.Object3D, ao: AOConfig | null = DEFAULT_AO): void {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.length > 1 && m.geometry.groups.length) {
        for (const grp of m.geometry.groups) {
          const sub = m.geometry.clone();
          sub.setIndex(Array.from((m.geometry.index!.array as ArrayLike<number>)).slice(grp.start, grp.start + grp.count));
          this.add(bakeGeometry(sub, m.matrixWorld, ao), mats[grp.materialIndex ?? 0]);
        }
      } else this.add(bakeGeometry(m.geometry, m.matrixWorld, ao), mats[0]);
    });
  }

  build(parent: THREE.Object3D, receive = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.groups) {
      const norm = list.map((g) => {
        const x = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k);
        if (!x.attributes.color) {
          const c = new Float32Array(x.attributes.position.count * 3).fill(1);
          x.setAttribute('color', new THREE.BufferAttribute(c, 3));
        }
        if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
        return x;
      });
      // Split very large batches to keep index counts and culling reasonable.
      const chunks: THREE.BufferGeometry[][] = [];
      let cur: THREE.BufferGeometry[] = [], verts = 0;
      for (const g of norm) {
        if (verts + g.attributes.position.count > 60000 && cur.length) { chunks.push(cur); cur = []; verts = 0; }
        cur.push(g); verts += g.attributes.position.count;
      }
      if (cur.length) chunks.push(cur);
      for (const ch of chunks) {
        const merged = mergeGeometries(ch, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const m = mat as THREE.MeshStandardMaterial;
        if (!m.vertexColors) { m.vertexColors = true; m.needsUpdate = true; }
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = this.shadows && !(m.transparent);
        mesh.receiveShadow = receive;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
        out.push(mesh);
      }
    }
    this.groups.clear();
    return out;
  }
}

/** A flat quad (decal) facing `normal`, centred at `pos`. */
export function quad(w: number, h: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(w, h);
}

/** Cylinder between two points. */
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, rTop = r): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rTop, r, len, seg, 1, false);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return g;
}
