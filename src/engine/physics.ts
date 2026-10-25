// Lightweight collision world tuned for characters and vehicles on mobile.
// Static geometry is oriented boxes (yaw-only), ramps (stairs/slopes) and heightfield terrain.
import * as THREE from 'three';

export type Surface = 'concrete' | 'metal' | 'wood' | 'grass' | 'dirt' | 'mud' | 'gravel' | 'tile' | 'water' | 'carpet' | 'asphalt' | 'leaves';

export interface ColliderOpts {
  surface?: Surface;
  /** Blocks horizontal movement (default true). */
  solid?: boolean;
  /** Top can be stood on (default true). */
  walkable?: boolean;
  /** Blocks AI line of sight (default true). */
  blocksSight?: boolean;
  /** Pulls the camera in (default true). */
  blocksCamera?: boolean;
  /** Bullets/vehicles collide (default = solid). */
  blocksVehicles?: boolean;
  tag?: string;
}

export interface RampInfo {
  /** Height of the walkable top at local -half and +half along the rise axis. */
  y0: number;
  y1: number;
  axis: 'x' | 'z';
}

let nextId = 1;

export class Box {
  readonly id = nextId++;
  cx = 0; cy = 0; cz = 0;
  hx = 0.5; hy = 0.5; hz = 0.5;
  yaw = 0;
  cos = 1; sin = 0;
  enabled = true;
  ramp: RampInfo | null = null;
  surface: Surface;
  solid: boolean;
  walkable: boolean;
  blocksSight: boolean;
  blocksCamera: boolean;
  blocksVehicles: boolean;
  tag: string;
  minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  cells: string[] = [];
  userData: Record<string, unknown> = {};

  constructor(opts: ColliderOpts = {}) {
    this.surface = opts.surface ?? 'concrete';
    this.solid = opts.solid ?? true;
    this.walkable = opts.walkable ?? true;
    this.blocksSight = opts.blocksSight ?? true;
    this.blocksCamera = opts.blocksCamera ?? true;
    this.blocksVehicles = opts.blocksVehicles ?? this.solid;
    this.tag = opts.tag ?? '';
  }

  get minY(): number { return this.cy - this.hy; }
  get maxY(): number { return this.ramp ? Math.max(this.ramp.y0, this.ramp.y1) : this.cy + this.hy; }

  set(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0): this {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    const ex = Math.abs(this.cos) * hx + Math.abs(this.sin) * hz;
    const ez = Math.abs(this.sin) * hx + Math.abs(this.cos) * hz;
    this.minX = cx - ex; this.maxX = cx + ex;
    this.minZ = cz - ez; this.maxZ = cz + ez;
    return this;
  }

  /** World XZ -> local XZ. */
  toLocal(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    const dx = x - this.cx, dz = z - this.cz;
    out.x = dx * this.cos - dz * this.sin;
    out.z = dx * this.sin + dz * this.cos;
    return out;
  }

  toWorldDir(lx: number, lz: number, out: { x: number; z: number }): { x: number; z: number } {
    out.x = lx * this.cos + lz * this.sin;
    out.z = -lx * this.sin + lz * this.cos;
    return out;
  }

  /** Walkable top height at a local position (ramps interpolate). */
  topAtLocal(lx: number, lz: number): number {
    if (!this.ramp) return this.cy + this.hy;
    const r = this.ramp;
    const t = r.axis === 'x' ? (lx / this.hx + 1) * 0.5 : (lz / this.hz + 1) * 0.5;
    return r.y0 + (r.y1 - r.y0) * THREE.MathUtils.clamp(t, 0, 1);
  }
}

export class Heightfield {
  readonly n: number;
  readonly cell: number;
  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly size: number,
    readonly res: number,
    readonly data: Float32Array,
    public surfaceAt: (x: number, z: number) => Surface = () => 'grass',
  ) {
    this.n = res;
    this.cell = size / (res - 1);
  }

  contains(x: number, z: number): boolean {
    return x >= this.originX && z >= this.originZ && x <= this.originX + this.size && z <= this.originZ + this.size;
  }

  height(x: number, z: number): number {
    const fx = THREE.MathUtils.clamp((x - this.originX) / this.cell, 0, this.n - 1.001);
    const fz = THREE.MathUtils.clamp((z - this.originZ) / this.cell, 0, this.n - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const n = this.n, d = this.data;
    const h00 = d[iz * n + ix], h10 = d[iz * n + ix + 1], h01 = d[(iz + 1) * n + ix], h11 = d[(iz + 1) * n + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell * 0.5;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
}

export interface GroundHit {
  y: number;
  surface: Surface;
  box: Box | null;
  normal: THREE.Vector3;
}

export interface RayHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  box: Box | null;
}

export type BoxFilter = (b: Box) => boolean;

const CELL = 4;
const tmpL = { x: 0, z: 0 };
const tmpW = { x: 0, z: 0 };

export class CollisionWorld {
  readonly boxes = new Set<Box>();
  private grid = new Map<string, Set<Box>>();
  heightfields: Heightfield[] = [];
  /** Water planes: y level inside xz rect (for splashes / no-go). */
  water: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; y: number }> = [];
  private queryStamp = 0;
  private stamps = new Map<Box, number>();

  addBox(center: THREE.Vector3Like, size: THREE.Vector3Like, yaw = 0, opts: ColliderOpts = {}): Box {
    const b = new Box(opts).set(center.x, center.y, center.z, size.x / 2, size.y / 2, size.z / 2, yaw);
    this.insert(b);
    return b;
  }

  /** A sloped walkable box (stairs). `y0`/`y1` are the walkable top heights at the low/high end along `axis`. */
  addRamp(center: THREE.Vector3Like, size: THREE.Vector3Like, yaw: number, axis: 'x' | 'z', y0: number, y1: number, opts: ColliderOpts = {}): Box {
    const b = new Box({ ...opts, solid: opts.solid ?? false }).set(center.x, center.y, center.z, size.x / 2, size.y / 2, size.z / 2, yaw);
    b.ramp = { y0, y1, axis };
    this.insert(b);
    return b;
  }

  addHeightfield(hf: Heightfield): void {
    this.heightfields.push(hf);
  }

  private insert(b: Box): void {
    this.boxes.add(b);
    b.cells = [];
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x + ',' + z;
      let s = this.grid.get(k);
      if (!s) { s = new Set(); this.grid.set(k, s); }
      s.add(b);
      b.cells.push(k);
    }
  }

  remove(b: Box): void {
    for (const k of b.cells) this.grid.get(k)?.delete(b);
    b.cells = [];
    this.boxes.delete(b);
  }

  /** Re-index a box after changing its transform. */
  move(b: Box, cx: number, cy: number, cz: number, yaw = b.yaw): void {
    for (const k of b.cells) this.grid.get(k)?.delete(b);
    b.set(cx, cy, cz, b.hx, b.hy, b.hz, yaw);
    this.insert(b);
  }

  clear(): void {
    this.boxes.clear();
    this.grid.clear();
    this.heightfields = [];
    this.water = [];
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Box[] = []): Box[] {
    out.length = 0;
    const stamp = ++this.queryStamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const s = this.grid.get(x + ',' + z);
      if (!s) continue;
      for (const b of s) {
        if (this.stamps.get(b) === stamp) continue;
        this.stamps.set(b, stamp);
        if (b.enabled && b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ) out.push(b);
      }
    }
    return out;
  }

  private near: Box[] = [];

  /** Highest walkable surface at (x,z) whose top is at or below `yTop`. */
  groundAt(x: number, z: number, yTop: number, out?: GroundHit): GroundHit | null {
    let best = -Infinity;
    let surface: Surface = 'concrete';
    let bestBox: Box | null = null;
    const near = this.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this.near);
    for (const b of near) {
      if (!b.walkable) continue;
      b.toLocal(x, z, tmpL);
      if (Math.abs(tmpL.x) > b.hx || Math.abs(tmpL.z) > b.hz) continue;
      const top = b.topAtLocal(tmpL.x, tmpL.z);
      if (top <= yTop + 1e-3 && top > best) { best = top; surface = b.surface; bestBox = b; }
    }
    let normal: THREE.Vector3 | null = null;
    for (const hf of this.heightfields) {
      if (!hf.contains(x, z)) continue;
      const h = hf.height(x, z);
      if (h <= yTop + 0.6 && h > best) {
        best = h;
        surface = hf.surfaceAt(x, z);
        bestBox = null;
        normal = hf.normal(x, z, out?.normal ?? new THREE.Vector3());
      }
    }
    if (best === -Infinity) return null;
    const res = out ?? { y: 0, surface: 'concrete', box: null, normal: new THREE.Vector3() };
    res.y = best;
    res.surface = surface;
    res.box = bestBox;
    if (normal) res.normal.copy(normal);
    else if (bestBox?.ramp) {
      const r = bestBox.ramp;
      const run = (r.axis === 'x' ? bestBox.hx : bestBox.hz) * 2;
      const slope = (r.y1 - r.y0) / run;
      const lx = r.axis === 'x' ? -slope : 0, lz = r.axis === 'z' ? -slope : 0;
      bestBox.toWorldDir(lx, lz, tmpW);
      res.normal.set(tmpW.x, 1, tmpW.z).normalize();
    } else res.normal.set(0, 1, 0);
    return res;
  }

  /**
   * Slides a vertical capsule (radius r, height h, feet at pos.y) by `dx,dz`.
   * Obstacles whose top is within `step` of the feet are stepped over (ground snapping handles them).
   * Returns true if a wall was hit. `pos` is modified in place.
   */
  moveCapsule(pos: THREE.Vector3, dx: number, dz: number, r: number, h: number, step: number, filter?: BoxFilter, hitNormal?: THREE.Vector3): boolean {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    let hit = false;
    if (hitNormal) hitNormal.set(0, 0, 0);
    for (let s = 0; s < steps; s++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      for (let iter = 0; iter < 4; iter++) {
        let pushed = false;
        const near = this.query(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1, this.near);
        for (const b of near) {
          if (filter && !filter(b)) continue;
          let top: number;
          b.toLocal(pos.x, pos.z, tmpL);
          const qx = THREE.MathUtils.clamp(tmpL.x, -b.hx, b.hx);
          const qz = THREE.MathUtils.clamp(tmpL.z, -b.hz, b.hz);
          if (b.ramp) {
            top = b.topAtLocal(qx, qz);
            if (top <= pos.y + step || b.minY >= pos.y + h) continue;
          } else {
            if (!b.solid) continue;
            top = b.maxY;
            if (top <= pos.y + step || b.minY >= pos.y + h - 0.05) continue;
          }
          let ox = tmpL.x - qx, oz = tmpL.z - qz;
          let d = Math.hypot(ox, oz);
          if (d >= r) continue;
          let push: number;
          if (d < 1e-5) {
            // Centre inside the box: push out along the axis of least penetration.
            const px = b.hx - Math.abs(tmpL.x), pz = b.hz - Math.abs(tmpL.z);
            if (px < pz) { ox = Math.sign(tmpL.x) || 1; oz = 0; push = px + r; }
            else { ox = 0; oz = Math.sign(tmpL.z) || 1; push = pz + r; }
            d = 1;
          } else push = r - d;
          b.toWorldDir((ox / d) * push, (oz / d) * push, tmpW);
          pos.x += tmpW.x;
          pos.z += tmpW.z;
          if (hitNormal) hitNormal.set(tmpW.x, 0, tmpW.z).normalize();
          pushed = true;
          hit = true;
        }
        if (!pushed) break;
      }
    }
    return hit;
  }

  /** Ray cast against boxes and terrain. `dir` must be normalised. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter?: BoxFilter, terrain = true): RayHit | null {
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    const near = this.query(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez), this.near);
    let best = maxDist;
    let bestBox: Box | null = null;
    const bestN = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const b of near) {
      if (filter && !filter(b)) continue;
      const t = rayBox(origin, dir, b, best, n);
      if (t !== null && t < best) { best = t; bestBox = b; bestN.copy(n); }
    }
    if (terrain && this.heightfields.length) {
      const t = this.rayTerrain(origin, dir, best, n);
      if (t !== null && t < best) { best = t; bestBox = null; bestN.copy(n); }
    }
    if (best >= maxDist) return null;
    return { dist: best, point: origin.clone().addScaledVector(dir, best), normal: bestN, box: bestBox };
  }

  private rayTerrain(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, n: THREE.Vector3): number | null {
    for (const hf of this.heightfields) {
      const stepLen = Math.max(0.25, hf.cell * 0.5);
      let prevT = 0;
      let prevAbove = o.y - (hf.contains(o.x, o.z) ? hf.height(o.x, o.z) : -1e9);
      if (prevAbove < 0) continue;
      for (let t = stepLen; t <= maxDist; t += stepLen) {
        const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
        if (!hf.contains(x, z)) { prevT = t; continue; }
        const above = y - hf.height(x, z);
        if (above < 0) {
          let a = prevT, b = t;
          for (let i = 0; i < 6; i++) {
            const m = (a + b) / 2;
            const mx = o.x + d.x * m, mz = o.z + d.z * m, my = o.y + d.y * m;
            if (my - hf.height(mx, mz) < 0) b = m; else a = m;
          }
          hf.normal(o.x + d.x * b, o.z + d.z * b, n);
          return b;
        }
        prevT = t;
        prevAbove = above;
      }
    }
    return null;
  }

  /** True if nothing that blocks sight lies between a and b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    return !this.raycast(a, d, len - 0.05, (x) => x.blocksSight);
  }

  /** Highest terrain (heightfield) height at x,z, or null outside every heightfield. */
  terrainHeight(x: number, z: number): number | null {
    let best: number | null = null;
    for (const hf of this.heightfields) if (hf.contains(x, z)) { const h = hf.height(x, z); if (best === null || h > best) best = h; }
    return best;
  }

  /**
   * Keeps a walker from climbing (or sinking into) terrain steeper than `maxSlope` (rise/run) when it was
   * standing on the terrain: reverts the horizontal move, trying to slide along one axis first.
   * Returns true if the move was changed.
   */
  limitTerrainSlope(pos: THREE.Vector3, fromX: number, fromZ: number, fromY: number, maxSlope = 1.3): boolean {
    const h0 = this.terrainHeight(fromX, fromZ);
    if (h0 === null || Math.abs(fromY - h0) > 0.35) return false; // not walking on terrain (floors, tunnels, bridges)
    const steep = (x: number, z: number) => {
      const h = this.terrainHeight(x, z);
      if (h === null) return false;
      const run = Math.hypot(x - fromX, z - fromZ);
      return h > fromY + 0.05 && run > 1e-4 && (h - h0) / run > maxSlope;
    };
    if (!steep(pos.x, pos.z)) return false;
    // A walkable box (bridge, stairs, floor) at the new spot overrides the terrain.
    const g = this.groundAt(pos.x, pos.z, fromY + 0.36);
    if (g?.box && g.y > (this.terrainHeight(pos.x, pos.z) ?? -1e9) - 0.05) return false;
    if (!steep(pos.x, fromZ)) { pos.z = fromZ; return true; }
    if (!steep(fromX, pos.z)) { pos.x = fromX; return true; }
    pos.x = fromX; pos.z = fromZ;
    return true;
  }

  inWater(x: number, z: number, y: number): boolean {
    for (const w of this.water) if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ && y < w.y) return true;
    return false;
  }
}

/** Slab test of a ray against a yaw-rotated box. Returns hit distance or null. */
export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box, maxDist: number, normalOut: THREE.Vector3): number | null {
  // Into box-local frame.
  const ox = o.x - b.cx, oz = o.z - b.cz, oy = o.y - b.cy;
  const lox = ox * b.cos - oz * b.sin, loz = ox * b.sin + oz * b.cos;
  const ldx = d.x * b.cos - d.z * b.sin, ldz = d.x * b.sin + d.z * b.cos;
  let tmin = 0, tmax = maxDist;
  let axis = -1, sign = 0;
  const slabs: Array<[number, number, number]> = [[lox, ldx, b.hx], [oy, d.y, b.ramp ? (b.maxY - b.cy) : b.hy], [loz, ldz, b.hz]];
  for (let i = 0; i < 3; i++) {
    const [p, v, h] = slabs[i];
    const lo = i === 1 ? -b.hy : -h;
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > h) return null;
      continue;
    }
    let t1 = (lo - p) / v, t2 = (h - p) / v;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) {
    // Origin inside the box.
    normalOut.set(-d.x, -d.y, -d.z);
    return 0;
  }
  if (axis === 1) normalOut.set(0, sign, 0);
  else {
    const lx = axis === 0 ? sign : 0, lz = axis === 2 ? sign : 0;
    normalOut.set(lx * b.cos + lz * b.sin, 0, -lx * b.sin + lz * b.cos);
  }
  return tmin;
}
