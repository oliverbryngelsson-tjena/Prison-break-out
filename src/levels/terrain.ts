// Outdoor terrain: height-field collision plus chunked meshes with a 4-layer blended ground shader.
import * as THREE from 'three';
import { Heightfield, type Surface } from '../engine/physics';
import type { World } from '../game/world';
import type { MaterialLib } from '../engine/materials';

export interface TerrainLayer {
  /** Texture set id from textures.json. */
  set: string;
  /** Repeats per metre. */
  scale: number;
  tint?: THREE.ColorRepresentation;
  roughness?: number;
  surface: Surface;
}

export interface TerrainDef {
  x0: number;
  z0: number;
  size: number;
  /** Vertices per side. */
  res: number;
  height: (x: number, z: number) => number;
  /** Layer weights at a point (will be normalised). Slope is 0 (flat) .. 1 (vertical). */
  weights: (x: number, z: number, h: number, slope: number) => [number, number, number, number];
  layers: [TerrainLayer, TerrainLayer, TerrainLayer, TerrainLayer];
  /** Cells per render chunk side (default 32). */
  chunk?: number;
  /** Detail normals (off on low quality). */
  normals?: boolean;
  /** Darkens the base colour where `occlusion` returns > 0 (e.g. under trees). */
  occlusion?: (x: number, z: number) => number;
}

export class Terrain {
  readonly hf: Heightfield;
  readonly group = new THREE.Group();
  material!: THREE.MeshStandardMaterial;
  private weightsData: Float32Array;

  constructor(readonly def: TerrainDef) {
    const n = def.res;
    const data = new Float32Array(n * n);
    const cell = def.size / (n - 1);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) data[iz * n + ix] = def.height(def.x0 + ix * cell, def.z0 + iz * cell);
    this.hf = new Heightfield(def.x0, def.z0, def.size, n, data, (x, z) => this.surfaceAt(x, z));
    this.weightsData = new Float32Array(n * n * 4);
    const nrm = new THREE.Vector3();
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = def.x0 + ix * cell, z = def.z0 + iz * cell;
      this.hf.normal(x, z, nrm);
      const slope = 1 - nrm.y;
      const w = def.weights(x, z, data[iz * n + ix], Math.min(1, slope * 2.2));
      const s = w[0] + w[1] + w[2] + w[3] || 1;
      const o = (iz * n + ix) * 4;
      for (let k = 0; k < 4; k++) this.weightsData[o + k] = w[k] / s;
    }
  }

  height(x: number, z: number): number { return this.hf.height(x, z); }
  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 { return this.hf.normal(x, z, out); }

  /** Interpolated layer weights. */
  weightsAt(x: number, z: number): [number, number, number, number] {
    const d = this.def, n = d.res, cell = d.size / (n - 1);
    const ix = THREE.MathUtils.clamp(Math.round((x - d.x0) / cell), 0, n - 1);
    const iz = THREE.MathUtils.clamp(Math.round((z - d.z0) / cell), 0, n - 1);
    const o = (iz * n + ix) * 4;
    return [this.weightsData[o], this.weightsData[o + 1], this.weightsData[o + 2], this.weightsData[o + 3]];
  }

  surfaceAt(x: number, z: number): Surface {
    const w = this.weightsAt(x, z);
    let best = 0;
    for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    return this.def.layers[best].surface;
  }

  async build(world: World): Promise<void> {
    const d = this.def;
    const tier = world.q.level === 'low' ? 0 : world.q.level === 'medium' ? 1 : 2;
    this.material = await terrainMaterial(world.mats, d.layers, d.normals !== false && tier > 0, tier);
    const n = d.res, cell = d.size / (n - 1);
    const chunk = d.chunk ?? 32;
    const data = this.hf.data;
    for (let cz = 0; cz < n - 1; cz += chunk) {
      for (let cx = 0; cx < n - 1; cx += chunk) {
        const w = Math.min(chunk, n - 1 - cx), h = Math.min(chunk, n - 1 - cz);
        const vw = w + 1, vh = h + 1;
        const pos = new Float32Array(vw * vh * 3);
        const nor = new Float32Array(vw * vh * 3);
        const spl = new Float32Array(vw * vh * 4);
        const col = new Float32Array(vw * vh * 3);
        const nv = new THREE.Vector3();
        for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
          const ix = cx + i, iz = cz + j;
          const x = d.x0 + ix * cell, z = d.z0 + iz * cell;
          const k = j * vw + i;
          pos[k * 3] = x; pos[k * 3 + 1] = data[iz * n + ix]; pos[k * 3 + 2] = z;
          this.hf.normal(x, z, nv);
          nor[k * 3] = nv.x; nor[k * 3 + 1] = nv.y; nor[k * 3 + 2] = nv.z;
          const o = (iz * n + ix) * 4;
          for (let c = 0; c < 4; c++) spl[k * 4 + c] = this.weightsData[o + c];
          // Macro variation + occlusion baked into vertex colour.
          const v = 0.9 + 0.1 * Math.sin(x * 0.073 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.061);
          const occ = 1 - 0.45 * Math.min(1, d.occlusion?.(x, z) ?? 0);
          col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = v * occ;
        }
        const idx: number[] = [];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const a = j * vw + i, b = a + 1, c = a + vw, e = c + 1;
          idx.push(a, c, b, b, c, e);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, this.material);
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
    world.root.add(this.group);
    world.physics.addHeightfield(this.hf);
  }
}

/** Ground shader: four tiled layers blended by vertex weights with height-aware transitions; rock is tri-planar. */
export async function terrainMaterial(mats: MaterialLib, layers: TerrainLayer[], normals: boolean, tier = 2): Promise<THREE.MeshStandardMaterial> {
  const sets = await Promise.all(layers.map((l) => mats.textureSet(l.set)));
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  m.envMapIntensity = 0.35;
  const uniforms: Record<string, { value: unknown }> = {};
  layers.forEach((l, i) => {
    uniforms[`tC${i}`] = { value: sets[i].c ?? null };
    uniforms[`tN${i}`] = { value: sets[i].n ?? sets[i].c ?? null };
    uniforms[`uS${i}`] = { value: l.scale };
    uniforms[`uT${i}`] = { value: new THREE.Color(l.tint ?? 0xffffff) };
    uniforms[`uR${i}`] = { value: l.roughness ?? 0.95 };
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvTW = (modelMatrix * vec4(position, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * normal);');
    const decl = [0, 1, 2, 3].map((i) => `uniform sampler2D tC${i}; uniform sampler2D tN${i}; uniform float uS${i}; uniform vec3 uT${i}; uniform float uR${i};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vSplat;\nvarying vec3 vTW;\nvarying vec3 vTN;\n${decl}
vec4 triRock(vec3 p, vec3 n, float s) {
  #if TERRAIN_TIER >= 2
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(tC2, p.zy * s) * w.x + texture2D(tC2, p.xz * s) * w.y + texture2D(tC2, p.xy * s) * w.z;
  #else
  // Cheaper: project from the dominant side axis on slopes.
  vec2 uv = abs(n.x) > abs(n.z) ? p.zy : p.xy;
  return texture2D(tC2, mix(p.xz, uv, step(0.55, 1.0 - abs(n.y))) * s);
  #endif
}
vec4 terrainBlend(out float rough, out vec3 nTS) {
  vec2 p = vTW.xz;
  #if TERRAIN_TIER == 0
  // Low quality: plain weights, skip layers that don't contribute.
  vec4 w = vSplat;
  vec4 c0 = vec4(0.0), c1 = vec4(0.0), c2 = vec4(0.0), c3 = vec4(0.0);
  if (w.x > 0.02) { c0 = texture2D(tC0, p * uS0); c0.rgb *= uT0; }
  if (w.y > 0.02) { c1 = texture2D(tC1, p * uS1); c1.rgb *= uT1; }
  if (w.z > 0.02) { c2 = triRock(vTW, vTN, uS2); c2.rgb *= uT2; }
  if (w.w > 0.02) { c3 = texture2D(tC3, p * uS3); c3.rgb *= uT3; }
  #else
  vec4 c0 = texture2D(tC0, p * uS0); c0.rgb *= uT0;
  vec4 c1 = texture2D(tC1, p * uS1); c1.rgb *= uT1;
  vec4 c2 = triRock(vTW, vTN, uS2); c2.rgb *= uT2;
  vec4 c3 = texture2D(tC3, p * uS3); c3.rgb *= uT3;
  // Height-aware blend: brighter texels win at transitions.
  vec4 h = vec4(dot(c0.rgb, vec3(0.33)), dot(c1.rgb, vec3(0.33)), dot(c2.rgb, vec3(0.33)), dot(c3.rgb, vec3(0.33)));
  vec4 w = vSplat + h * 0.35;
  float mx = max(max(w.x, w.y), max(w.z, w.w)) - 0.28;
  w = max(w - mx, 0.0);
  #endif
  w /= max(1e-4, w.x + w.y + w.z + w.w);
  rough = dot(w, vec4(uR0, uR1, uR2, uR3));
  #ifdef TERRAIN_NORMALS
  vec3 n0 = texture2D(tN0, p * uS0).xyz, n1 = texture2D(tN1, p * uS1).xyz, n2 = texture2D(tN2, p * uS2).xyz, n3 = texture2D(tN3, p * uS3).xyz;
  nTS = normalize((n0 * w.x + n1 * w.y + n2 * w.z + n3 * w.w) * 2.0 - 1.0);
  #else
  nTS = vec3(0.0, 0.0, 1.0);
  #endif
  return c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;
}`)
      .replace('#include <map_fragment>', 'float tRough; vec3 tNTS;\nvec4 tCol = terrainBlend(tRough, tNTS);\ndiffuseColor.rgb *= tCol.rgb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef TERRAIN_NORMALS
{
  // World-space tangent frame aligned with the XZ projection, then back to view space.
  vec3 wn = normalize(vTN);
  vec3 t = normalize(vec3(1.0, 0.0, 0.0) - wn * wn.x);
  vec3 b = normalize(cross(wn, t));
  vec3 pn = normalize(t * tNTS.x * 0.8 - b * tNTS.y * 0.8 + wn * tNTS.z);
  normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
}
#endif`);
    shader.defines = { ...(shader.defines ?? {}), TERRAIN_TIER: tier };
    if (normals) shader.defines.TERRAIN_NORMALS = '';
  };
  m.customProgramCacheKey = () => 'terrain' + tier + (normals ? 'N' : '');
  return m;
}

/** Simple value-noise based fBm for terrain shapes. */
export function fbm(x: number, z: number, oct = 4, seed = 0): number {
  let a = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    a += amp * vnoise(x * f + seed * 17.3, z * f - seed * 9.1);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return a / norm;
}

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

/** Distance from p to a polyline (x,z pairs), plus the parameter along it. */
export function distToPath(x: number, z: number, pts: Array<[number, number]>): { d: number; t: number; seg: number } {
  let best = Infinity, bt = 0, bs = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len2 || 1)));
    const px = ax + dx * u, pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bt = acc + u * len; bs = i; }
    acc += len;
  }
  return { d: best, t: bt, seg: bs };
}

export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
