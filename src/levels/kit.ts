// Level-building kit: architecture with colliders, instanced props, lights and decals.
import * as THREE from 'three';
import { Batcher, DEFAULT_AO, boxGeometry, cylinderBetween, type AOConfig, type BoxOpts } from '../engine/geometry';
import { DRAW, canvasTexture, rng, signDraw, type CanvasDraw } from '../engine/materials';
import type { ColliderOpts, Surface } from '../engine/physics';
import type { World } from '../game/world';

export interface Opening { at: number; width: number; bottom: number; top: number }

/** Shared material set for a level. */
export interface KitMats {
  [k: string]: THREE.Material;
}

export class Kit {
  readonly batch = new Batcher();
  readonly decals = new Batcher();
  ao: AOConfig = { ...DEFAULT_AO };
  /** Light fixture positions (for the dynamic light pool and stealth light levels). */
  readonly fixtures: Array<{ pos: THREE.Vector3; color: THREE.Color; intensity: number; range: number; on: boolean; zone?: string }> = [];
  private lightPool: THREE.PointLight[] = [];
  private poolTimer = 0;
  readonly instanced: THREE.InstancedMesh[] = [];

  constructor(readonly world: World) {
    this.decals.shadows = false;
  }

  get physics() { return this.world.physics; }

  /** Solid box (visual + collider). */
  box(mat: THREE.Material, c: [number, number, number], s: [number, number, number], yaw = 0, col: ColliderOpts | false = {}, o: BoxOpts = {}): void {
    this.batch.box(mat, { x: c[0], y: c[1], z: c[2] }, { x: s[0], y: s[1], z: s[2] }, yaw, this.ao, o);
    if (col !== false) this.physics.addBox({ x: c[0], y: c[1], z: c[2] }, { x: s[0], y: s[1], z: s[2] }, yaw, col);
  }

  /** Collider only. */
  solid(c: [number, number, number], s: [number, number, number], yaw = 0, col: ColliderOpts = {}) {
    return this.physics.addBox({ x: c[0], y: c[1], z: c[2] }, { x: s[0], y: s[1], z: s[2] }, yaw, col);
  }

  /**
   * Wall from (x1,z1) to (x2,z2), bottom y0, height h, thickness t, with openings
   * (doors/windows measured along the wall from its start). Material for each side optional.
   */
  wall(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y0: number, h: number, t = 0.25, openings: Opening[] = [], col: ColliderOpts = {}, matB?: THREE.Material): void {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const segs: Array<[number, number, number, number]> = []; // [from, to, bottom, top] along wall
    const ops = [...openings].sort((a, b) => a.at - b.at);
    let cur = 0;
    for (const o of ops) {
      const a = o.at - o.width / 2, b = o.at + o.width / 2;
      if (a > cur) segs.push([cur, a, 0, h]);
      if (o.bottom > 0) segs.push([a, b, 0, o.bottom]);
      if (o.top < h) segs.push([a, b, o.top, h]);
      cur = b;
    }
    if (cur < len) segs.push([cur, len, 0, h]);
    for (const [a, b, bt, tp] of segs) {
      const m = (a + b) / 2;
      const cx = x1 + dx * m, cz = z1 + dz * m;
      const size: [number, number, number] = [b - a, tp - bt, t];
      const c: [number, number, number] = [cx, y0 + (bt + tp) / 2, cz];
      if (matB && matB !== mat) {
        // Two materials: draw each side separately.
        this.batch.box(mat, { x: c[0], y: c[1], z: c[2] }, { x: size[0], y: size[1], z: size[2] }, yaw, this.ao, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
        this.batch.box(matB, { x: c[0], y: c[1], z: c[2] }, { x: size[0], y: size[1], z: size[2] }, yaw, this.ao, { faces: ['nz'] });
      } else this.batch.box(mat, { x: c[0], y: c[1], z: c[2] }, { x: size[0], y: size[1], z: size[2] }, yaw, this.ao);
      this.physics.addBox({ x: c[0], y: c[1], z: c[2] }, { x: size[0], y: size[1], z: size[2] }, yaw, col);
    }
  }

  floor(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y = 0, thick = 0.2, surface: Surface = 'concrete'): void {
    const c: [number, number, number] = [(x1 + x2) / 2, y - thick / 2, (z1 + z2) / 2];
    const s: [number, number, number] = [Math.abs(x2 - x1), thick, Math.abs(z2 - z1)];
    this.batch.box(mat, { x: c[0], y: c[1], z: c[2] }, { x: s[0], y: s[1], z: s[2] }, 0, null, { faces: ['py'] });
    this.physics.addBox({ x: c[0], y: c[1], z: c[2] }, { x: s[0], y: s[1], z: s[2] }, 0, { surface });
  }

  ceiling(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number, thick = 0.3): void {
    const c = { x: (x1 + x2) / 2, y: y + thick / 2, z: (z1 + z2) / 2 };
    const s = { x: Math.abs(x2 - x1), y: thick, z: Math.abs(z2 - z1) };
    this.batch.box(mat, c, s, 0, null, { faces: ['ny'] });
    this.physics.addBox(c, s, 0, { walkable: false });
  }

  /** A walkable slab (upper floors, catwalks) visible from above and below. */
  slab(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number, thick = 0.25, surface: Surface = 'concrete', matUnder?: THREE.Material): void {
    const c = { x: (x1 + x2) / 2, y: y - thick / 2, z: (z1 + z2) / 2 };
    const s = { x: Math.abs(x2 - x1), y: thick, z: Math.abs(z2 - z1) };
    this.batch.box(mat, c, s, 0, null, { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
    this.batch.box(matUnder ?? mat, c, s, 0, null, { faces: ['ny'] });
    this.physics.addBox(c, s, 0, { surface });
  }

  /** Straight staircase rising along +dir from (x,z) at y0 to y1. */
  stairs(mat: THREE.Material, x: number, z: number, yaw: number, width: number, y0: number, y1: number, run: number, surface: Surface = 'metal'): void {
    const steps = Math.round((y1 - y0) / 0.19);
    const rise = (y1 - y0) / steps;
    const depth = run / steps;
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
    for (let i = 0; i < steps; i++) {
      const d = depth * (i + 0.5);
      const cy = y0 + rise * (i + 0.5);
      this.batch.box(mat, { x: x + f.x * d, y: cy, z: z + f.z * d }, { x: width, y: rise, z: depth }, yaw, null);
      // underside of stairs
    }
    // Stringers
    const len = Math.hypot(run, y1 - y0);
    const ang = Math.atan2(y1 - y0, run);
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.06, 0.28, len);
      const m = new THREE.Matrix4().makeRotationX(-ang);
      m.premultiply(new THREE.Matrix4().makeRotationY(yaw));
      const sx = Math.cos(yaw) * (width / 2 + 0.03) * side, sz = -Math.sin(yaw) * (width / 2 + 0.03) * side;
      m.setPosition(x + f.x * run / 2 + sx, (y0 + y1) / 2 - 0.05, z + f.z * run / 2 + sz);
      g.applyMatrix4(m);
      this.batch.add(g, mat);
    }
    // Ramp collider along the stair run (axis z in local frame).
    this.physics.addRamp({ x: x + f.x * run / 2, y: (y0 + y1) / 2 - 0.2, z: z + f.z * run / 2 }, { x: width, y: y1 - y0 + 0.4, z: run }, yaw, 'z', y0, y1, { surface });
  }

  /** Railing along a line (top rail + posts + mid rail). */
  railing(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number, h = 1.05, solid = true): void {
    const a = new THREE.Vector3(x1, y + h, z1), b = new THREE.Vector3(x2, y + h, z2);
    this.batch.add(cylinderBetween(a, b, 0.03, 8), mat);
    this.batch.add(cylinderBetween(a.clone().setY(y + h * 0.5), b.clone().setY(y + h * 0.5), 0.018, 6), mat);
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      this.batch.add(cylinderBetween(p.clone().setY(y), p, 0.025, 6), mat);
    }
    // Kick plate
    const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
    this.batch.box(mat, { x: (x1 + x2) / 2, y: y + 0.06, z: (z1 + z2) / 2 }, { x: len, y: 0.12, z: 0.02 }, yaw, null);
    if (solid) this.physics.addBox({ x: (x1 + x2) / 2, y: y + h / 2, z: (z1 + z2) / 2 }, { x: len, y: h, z: 0.08 }, yaw, { blocksSight: false, blocksCamera: false, walkable: false });
  }

  /** Vertical bars between two points (prison cell fronts). Returns the group of meshes. */
  bars(mat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y0: number, h: number, spacing = 0.13, parent?: THREE.Object3D, collider = true): THREE.Group {
    const g = new THREE.Group();
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / spacing));
    const geo = new THREE.CylinderGeometry(0.016, 0.016, h, 6, 1, true);
    geo.translate(0, h / 2, 0);
    const im = new THREE.InstancedMesh(geo, mat, n + 1);
    const m = new THREE.Matrix4();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      m.makeTranslation(x1 + (x2 - x1) * t, y0, z1 + (z2 - z1) * t);
      im.setMatrixAt(i, m);
    }
    im.castShadow = true;
    im.receiveShadow = false;
    g.add(im);
    // Horizontal flat bars
    const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
    for (const yy of [0.05, h * 0.45, h - 0.05]) {
      const hb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), mat);
      hb.position.set((x1 + x2) / 2, y0 + yy, (z1 + z2) / 2);
      hb.rotation.y = yaw;
      hb.castShadow = true;
      g.add(hb);
    }
    (parent ?? this.world.root).add(g);
    if (collider) this.physics.addBox({ x: (x1 + x2) / 2, y: y0 + h / 2, z: (z1 + z2) / 2 }, { x: len, y: h, z: 0.06 }, yaw, { blocksSight: false, blocksCamera: false, surface: 'metal' });
    return g;
  }

  /** Ceiling light fixture: emissive tube + entry in the dynamic light pool. */
  fixture(mat: THREE.Material, housing: THREE.Material, x: number, y: number, z: number, yaw = 0, color = 0xfff3dc, intensity = 6, range = 9, len = 1.25, zone?: string): void {
    this.batch.box(housing, { x, y: y + 0.04, z }, { x: len + 0.1, y: 0.08, z: 0.26 }, yaw, null);
    const tube = boxGeometry({ x, y: y - 0.02, z }, { x: len, y: 0.05, z: 0.16 }, yaw, null, { faces: ['ny', 'px', 'nx', 'pz', 'nz'] });
    this.batch.add(tube, mat);
    this.fixtures.push({ pos: new THREE.Vector3(x, y - 0.15, z), color: new THREE.Color(color), intensity, range, on: true, zone });
  }

  /** Caged bulb on a wall (cells, corridors). */
  bulb(mat: THREE.Material, cage: THREE.Material, x: number, y: number, z: number, color = 0xffd9a0, intensity = 3, range = 5, zone?: string): void {
    const s = new THREE.SphereGeometry(0.07, 10, 8);
    s.translate(x, y, z);
    this.batch.add(s, mat);
    // Wire cage: four thin ribs and a ring plate.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const ox = Math.cos(a) * 0.1, oz = Math.sin(a) * 0.1;
      this.batch.add(cylinderBetween(new THREE.Vector3(x + ox, y + 0.08, z + oz), new THREE.Vector3(x + ox * 0.4, y - 0.1, z + oz * 0.4), 0.006, 4), cage);
    }
    const ring = new THREE.TorusGeometry(0.1, 0.008, 4, 12);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, y + 0.08, z);
    this.batch.add(ring, cage);
    this.fixtures.push({ pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, range, on: true, zone });
  }

  /** Creates the fixed pool of point lights that follow the nearest fixtures. */
  initLightPool(count: number, decay = 2): void {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, decay);
      l.castShadow = false;
      this.world.scene.add(l);
      this.lightPool.push(l);
    }
  }

  updateLightPool(focus: THREE.Vector3, dt: number, force = false): void {
    this.poolTimer -= dt;
    if (!force && this.poolTimer > 0) {
      // Smoothly fade intensities toward targets.
      for (const l of this.lightPool) l.intensity += ((l.userData.target ?? 0) - l.intensity) * Math.min(1, dt * 4);
      return;
    }
    this.poolTimer = 0.4;
    const ranked = this.fixtures.filter((f) => f.on).map((f) => ({ f, d: f.pos.distanceToSquared(focus) })).sort((a, b) => a.d - b.d);
    this.lightPool.forEach((l, i) => {
      const r = ranked[i];
      if (!r) { l.userData.target = 0; return; }
      if (l.userData.fixture !== r.f) {
        l.position.copy(r.f.pos);
        l.color.copy(r.f.color);
        l.distance = r.f.range;
        l.userData.fixture = r.f;
        l.intensity = force ? r.f.intensity : 0;
      }
      l.userData.target = r.f.intensity;
      if (force) l.intensity = r.f.intensity;
    });
  }

  /** 0..1 light level at a point from fixtures (plus ambient). */
  lightLevel(p: THREE.Vector3, ambient = 0.25): number {
    let l = ambient;
    for (const f of this.fixtures) {
      if (!f.on) continue;
      const d = f.pos.distanceTo(p);
      if (d < f.range) l += (1 - d / f.range) ** 2 * (f.intensity / 6);
    }
    return Math.min(1, l);
  }

  /** Places instances of a model (one InstancedMesh per sub-mesh). */
  instance(model: THREE.Object3D, transforms: Array<{ p: [number, number, number]; yaw?: number; s?: number }>, shadows = true): THREE.InstancedMesh[] {
    model.updateMatrixWorld(true);
    const out: THREE.InstancedMesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, transforms.length);
      const local = m.matrixWorld.clone();
      const t = new THREE.Matrix4();
      transforms.forEach((tr, i) => {
        t.compose(new THREE.Vector3(...tr.p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.yaw ?? 0), new THREE.Vector3().setScalar(tr.s ?? 1));
        im.setMatrixAt(i, t.clone().multiply(local));
      });
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.world.root.add(im);
      out.push(im);
      this.instanced.push(im);
    });
    return out;
  }

  /** Adds a single model instance to the scene. */
  place(model: THREE.Object3D, p: [number, number, number], yaw = 0, s = 1, parent?: THREE.Object3D): THREE.Object3D {
    model.position.set(...p);
    model.rotation.y = yaw;
    model.scale.setScalar(s);
    (parent ?? this.world.root).add(model);
    return model;
  }

  /** Flat decal quad on a surface (normal axis given by yaw for walls, or floor). */
  decal(mat: THREE.Material, p: [number, number, number], w: number, h: number, yaw = 0, floor = false): void {
    const g = new THREE.PlaneGeometry(w, h);
    if (floor) g.rotateX(-Math.PI / 2);
    else g.rotateY(yaw);
    g.translate(...p);
    this.decals.add(g, mat);
  }

  /** Canvas-texture sign/poster. */
  sign(key: string, draw: CanvasDraw, p: [number, number, number], w: number, h: number, yaw: number, emissive = 0): THREE.Mesh {
    const tex = canvasTexture(key, draw, 512);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, transparent: true, alphaTest: 0.05 });
    if (emissive) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = tex; mat.emissiveIntensity = emissive; }
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    const g = new THREE.PlaneGeometry(w, h);
    // Signs drawn on the top half of a square canvas.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
    const m = new THREE.Mesh(g, mat);
    m.position.set(...p);
    m.rotation.y = yaw;
    this.world.root.add(m);
    return m;
  }

  textSign(lines: string[], p: [number, number, number], w: number, yaw: number, bg = '#21402e', fg = '#ece9d8'): THREE.Mesh {
    return this.sign('sign:' + lines.join('|') + bg, signDraw(lines, bg, fg), p, w, w / 2, yaw);
  }

  /** Chain-link fence panel with posts; collider blocks movement but not sight. */
  fence(postMat: THREE.Material, linkMat: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number, h: number, wire?: THREE.Material): void {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * h / 1.2);
    g.rotateY(yaw);
    g.translate((x1 + x2) / 2, y + h / 2, (z1 + z2) / 2);
    const mesh = new THREE.Mesh(g, linkMat);
    mesh.castShadow = true;
    this.world.root.add(mesh);
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
      this.batch.add(cylinderBetween(new THREE.Vector3(px, y, pz), new THREE.Vector3(px, y + h + 0.1, pz), 0.04, 8), postMat);
    }
    this.batch.add(cylinderBetween(new THREE.Vector3(x1, y + h, z1), new THREE.Vector3(x2, y + h, z2), 0.025, 6), postMat);
    if (wire) {
      // Razor wire coil along the top.
      const coil = new THREE.CylinderGeometry(0.28, 0.28, len, 16, 1, true);
      coil.rotateZ(Math.PI / 2);
      const cuv = coil.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 2, cuv.getY(i) * len * 1.5);
      coil.rotateY(yaw);
      coil.translate((x1 + x2) / 2, y + h + 0.3, (z1 + z2) / 2);
      const cm = new THREE.Mesh(coil, wire);
      this.world.root.add(cm);
    }
    this.physics.addBox({ x: (x1 + x2) / 2, y: y + h / 2, z: (z1 + z2) / 2 }, { x: len, y: h + 0.6, z: 0.1 }, yaw, { blocksSight: false, blocksCamera: false, surface: 'metal', walkable: false });
  }

  /** Light shaft (volumetric look) from a window/skylight. */
  shaft(p: [number, number, number], dir: THREE.Vector3, w: number, len: number, color = 0xfff1d8, opacity = 0.12): THREE.Mesh {
    const tex = canvasTexture('lightCone', DRAW.lightCone, 128);
    const g = new THREE.CylinderGeometry(w * 0.55, w * 0.9, len, 12, 1, true);
    g.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.position.set(...p);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    m.renderOrder = 3;
    this.world.root.add(m);
    return m;
  }

  finish(): void {
    this.batch.build(this.world.root);
    this.decals.build(this.world.root, true);
  }

  rand(seed: number): () => number {
    return rng(seed);
  }
}
