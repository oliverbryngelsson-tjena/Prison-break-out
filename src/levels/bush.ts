// Procedural leafy bushes: leaf-sprig cards on a rough dome plus a few stems, merged into one mesh.
// Normals point away from the bush centre so the whole bush shades like one soft volume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLib } from '../engine/materials';

export interface BushStyle {
  seed: number;
  /** Dome radius (m) and height. */
  radius: number;
  height: number;
  cards: number;
  cardSize: number;
  tint: number;
}

export const BUSH_STYLES: Record<string, BushStyle> = {
  bush_a: { seed: 11, radius: 0.85, height: 1.25, cards: 46, cardSize: 0.95, tint: 0xb9c9a0 },
  bush_b: { seed: 29, radius: 1.1, height: 1.0, cards: 54, cardSize: 1.0, tint: 0xa8b98c },
};

const cache = new Map<string, Promise<{ geo: THREE.BufferGeometry; stems: THREE.BufferGeometry }>>();
let leafMat: Promise<THREE.MeshStandardMaterial> | null = null;
let stemMat: Promise<THREE.MeshStandardMaterial> | null = null;

function rng(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function buildGeometry(st: BushStyle): { geo: THREE.BufferGeometry; stems: THREE.BufferGeometry } {
  const r = rng(st.seed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const centre = new THREE.Vector3(0, st.height * 0.42, 0);
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < st.cards; i++) {
    // Point on an upper dome, denser near the shell.
    const a = r() * Math.PI * 2;
    const el = Math.asin(r() * 0.95) * (r() < 0.2 ? -0.35 : 1);
    const rr = 0.45 + 0.55 * Math.sqrt(r());
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const p = centre.clone().add(new THREE.Vector3(dir.x * st.radius * rr, dir.y * st.height * 0.55 * rr, dir.z * st.radius * rr));
    p.y = Math.max(0.08, p.y);
    // Sprig grows outward from the centre: card "up" axis = outward + a bit of lift, random roll around it.
    up.copy(dir).multiplyScalar(0.8).add(tmp.set((r() - 0.5) * 0.6, 0.5, (r() - 0.5) * 0.6)).normalize();
    side.crossVectors(up, tmp.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize()).normalize();
    const s = st.cardSize * (0.7 + r() * 0.6);
    const base = p.clone().addScaledVector(up, -s * 0.45);
    const corners = [
      base.clone().addScaledVector(side, -s * 0.5),
      base.clone().addScaledVector(side, s * 0.5),
      base.clone().addScaledVector(side, s * 0.5).addScaledVector(up, s),
      base.clone().addScaledVector(side, -s * 0.5).addScaledVector(up, s),
    ];
    const v0 = pos.length / 3;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let k = 0; k < 4; k++) {
      const c = corners[k];
      pos.push(c.x, c.y, c.z);
      n.copy(c).sub(centre).normalize();
      n.y = n.y * 0.8 + 0.25;
      n.normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(uvs[k][0], uvs[k][1]);
    }
    idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  // A handful of woody stems from the ground.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2, len = st.height * (0.6 + r() * 0.4);
    const c = new THREE.CylinderGeometry(0.012, 0.03, len, 5, 1, true);
    c.translate(0, len / 2, 0);
    c.rotateZ((r() - 0.5) * 0.9);
    c.rotateY(a);
    parts.push(c);
  }
  const stems = mergeGeometries(parts)!;
  return { geo, stems };
}

/** A bush as an Object3D (two meshes) for the foliage system or direct placement. */
export async function makeBush(mats: MaterialLib, id: string): Promise<THREE.Object3D> {
  const st = BUSH_STYLES[id] ?? BUSH_STYLES.bush_a;
  if (!cache.has(id)) cache.set(id, Promise.resolve(buildGeometry(st)));
  const { geo, stems } = await cache.get(id)!;
  leafMat ??= mats.textureSet('leaves_oak').then(({ c }) => {
    if (c) { c.wrapS = c.wrapT = THREE.ClampToEdgeWrapping; c.colorSpace = THREE.SRGBColorSpace; }
    return new THREE.MeshStandardMaterial({ map: c ?? null, color: 0xffffff, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
  });
  stemMat ??= mats.pbr('bark_oak', { scale: 2 });
  const lm = (await leafMat).clone();
  lm.color.setHex(st.tint);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, lm));
  g.add(new THREE.Mesh(stems, await stemMat));
  return g;
}
