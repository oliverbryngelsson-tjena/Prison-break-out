// Procedural square hay bale: rounded box with a painted straw texture and two twine bands (~400 triangles).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialLib } from '../engine/materials';

/** Same footprint as the colliders the levels place: 0.66 x 0.62 x 1.2 m, origin on the ground. */
const W = 0.66, H = 0.62, D = 1.2;

function drawStraw(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#a88a4a';
  ctx.fillRect(0, 0, size, size);
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Dark depth under the top strands, then layers of lighter straw.
  for (const [n, lMin, lMax, alpha] of [[2600, 26, 40, 0.55], [5200, 42, 62, 0.75], [2600, 60, 78, 0.85]] as const) {
    for (let i = 0; i < n; i++) {
      const x = r() * size, y = r() * size, len = 6 + r() * 26, a = (r() - 0.5) * 0.5;
      ctx.strokeStyle = `hsla(${38 + r() * 12}, ${40 + r() * 25}%, ${lMin + r() * (lMax - lMin)}%, ${alpha})`;
      ctx.lineWidth = 0.8 + r() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}

let geo: { bale: THREE.BufferGeometry; twine: THREE.BufferGeometry } | null = null;

export async function makeHayBale(mats: MaterialLib): Promise<THREE.Object3D> {
  if (!geo) {
    const bale = new RoundedBoxGeometry(W, H, D, 2, 0.07);
    bale.translate(0, H / 2, 0);
    const bands: THREE.BufferGeometry[] = [];
    const t = new THREE.BoxGeometry(W + 0.012, H + 0.012, 0.025);
    for (const z of [-D * 0.27, D * 0.27]) bands.push(t.clone().translate(0, H / 2, z));
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    geo = { bale, twine: mergeGeometries(bands)! };
  }
  const straw = await mats.canvasMat('hay_straw', drawStraw, 512, { roughness: 0.95, envIntensity: 0.3 });
  const twine = mats.plain(0x5a4630, 0.9);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo.bale, straw), new THREE.Mesh(geo.twine, twine));
  return g;
}
