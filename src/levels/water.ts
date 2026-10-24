// Water surfaces: rivers, ponds and reservoirs with animated normals, depth tint and a physics volume.
import * as THREE from 'three';
import type { World } from '../game/world';
import { canvasTexture } from '../engine/materials';

export interface WaterDef {
  /** Outline as an axis-aligned rectangle, or a strip along a path. */
  rect?: { x0: number; z0: number; x1: number; z1: number };
  path?: Array<[number, number]>;
  width?: number;
  y: number;
  color?: THREE.ColorRepresentation;
  /** Flow direction (x,z) for rivers; zero for still water. */
  flow?: [number, number];
  opacity?: number;
}

const waterNormals = () => canvasTexture('waterNormals', (c, s) => {
  // Tileable bumpy height field converted into a normal map.
  const h = new Float32Array(s * s);
  for (let k = 0; k < 6; k++) {
    const f = 2 + k * 3, a = 1 / (k + 1), ph = k * 1.7;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
      h[y * s + x] += a * Math.sin(u * f + Math.sin(v * (k + 1) + ph) * 1.3) * Math.cos(v * (f - 1) + ph);
    }
  }
  const img = c.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const hl = h[y * s + ((x - 1 + s) % s)], hr = h[y * s + ((x + 1) % s)];
    const hd = h[((y - 1 + s) % s) * s + x], hu = h[((y + 1) % s) * s + x];
    const n = new THREE.Vector3((hl - hr) * 1.2, (hd - hu) * 1.2, 1).normalize();
    const o = (y * s + x) * 4;
    img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}, 256, false);

export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms = { uTime: { value: 0 }, uFlow: { value: new THREE.Vector2() } };

  constructor(readonly world: World, readonly def: WaterDef) {
    const geo = def.path ? stripGeometry(def.path, def.width ?? 8, def.y) : rectGeometry(def.rect!, def.y);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color ?? 0x1d2d2a, roughness: 0.06, metalness: 0.0, transparent: true, opacity: def.opacity ?? 0.88,
      normalMap: waterNormals(), depthWrite: false,
    });
    mat.normalScale.set(0.35, 0.35);
    mat.envMapIntensity = 1.1;
    const flow = def.flow ?? [0, 0];
    this.uniforms.uFlow.value.set(flow[0], flow[1]);
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uFlow = u.uFlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uFlow;\nvarying vec2 vWUv;\nvarying vec2 vWUv2;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vec4 wp4 = modelMatrix * vec4(position, 1.0);
vWUv = wp4.xz * 0.11 + uFlow * uTime * 0.09 + vec2(uTime * 0.013, uTime * 0.007);
vWUv2 = wp4.xz * 0.043 + uFlow * uTime * 0.05 - vec2(uTime * 0.009, -uTime * 0.011);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWUv;\nvarying vec2 vWUv2;')
        .replace('#include <normal_fragment_maps>', `
vec3 mapN = normalize((texture2D(normalMap, vWUv).xyz * 2.0 - 1.0) + (texture2D(normalMap, vWUv2).xyz * 2.0 - 1.0));
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);`);
    };
    mat.customProgramCacheKey = () => 'water';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    world.root.add(this.mesh);
    // Physics volume (axis-aligned pieces).
    if (def.rect) world.physics.water.push({ minX: Math.min(def.rect.x0, def.rect.x1), maxX: Math.max(def.rect.x0, def.rect.x1), minZ: Math.min(def.rect.z0, def.rect.z1), maxZ: Math.max(def.rect.z0, def.rect.z1), y: def.y });
    else if (def.path) {
      const w = (def.width ?? 8) / 2;
      for (let i = 0; i < def.path.length - 1; i++) {
        const [ax, az] = def.path[i], [bx, bz] = def.path[i + 1];
        world.physics.water.push({ minX: Math.min(ax, bx) - w, maxX: Math.max(ax, bx) + w, minZ: Math.min(az, bz) - w, maxZ: Math.max(az, bz) + w, y: def.y });
      }
    }
    world.tickers.add((_dt, t) => { u.uTime.value = t; });
  }
}

function rectGeometry(r: { x0: number; z0: number; x1: number; z1: number }, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(Math.abs(r.x1 - r.x0), Math.abs(r.z1 - r.z0), 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  return g;
}

/** Ribbon along a polyline (rivers). */
function stripGeometry(pts: Array<[number, number]>, width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    pos.push(p[0] + nx * width / 2, y, p[1] + nz * width / 2, p[0] - nx * width / 2, y, p[1] - nz * width / 2);
    uv.push(0, acc / width, 1, acc / width);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Normals should point up regardless of winding.
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
