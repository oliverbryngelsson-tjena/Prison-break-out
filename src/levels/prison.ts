// Redmoor State Correctional Facility — geometry shared by Chapters 1 and 2.
import * as THREE from 'three';
import { Kit } from './kit';
import { DRAW, canvasTexture, rng } from '../engine/materials';
import { cylinderBetween } from '../engine/geometry';
import type { World } from '../game/world';
import { NavGraph } from '../game/nav';

export const CELL_W = 2.6;
export const CELL_D = 3.6;
export const TIER_Y = 3.5;
export const ROOF_Y = 8.4;

export interface CellInfo {
  id: string;
  side: 'west' | 'east';
  tier: 0 | 1;
  /** centre of the cell floor */
  center: THREE.Vector3;
  /** point just outside the bars */
  front: THREE.Vector3;
  /** yaw facing out of the cell */
  outYaw: number;
  door: THREE.Group;
  doorCollider: import('../engine/physics').Box;
}

export interface PrisonHandles {
  kit: Kit;
  cells: CellInfo[];
  cell(id: string): CellInfo;
  mainGate: THREE.Object3D;
  mainGateCol: import('../engine/physics').Box;
  yardDoor: THREE.Object3D;
  yardDoorCol: import('../engine/physics').Box;
  workshopDoor: THREE.Object3D;
  workshopDoorCol: import('../engine/physics').Box;
  laundryDoor: THREE.Object3D;
  laundryDoorCol: import('../engine/physics').Box;
  cageDoor: THREE.Object3D;
  cageDoorCol: import('../engine/physics').Box;
  shopLaundryDoor: THREE.Object3D;
  shopLaundryDoorCol: import('../engine/physics').Box;
  chaseDoor: THREE.Object3D;
  chaseDoorCol: import('../engine/physics').Box;
  ventCovers: Map<string, THREE.Mesh>;
  nav: NavGraph;
  mats: Record<string, THREE.Material>;
  screwdriver: THREE.Object3D;
  tvScreen: THREE.Mesh;
  searchlight: THREE.SpotLight | null;
  towerLamp: THREE.Object3D;
  cameraProps: THREE.Object3D[];
  /** Breakout route (Chapter 2): hatch in the chase floor and a storm drain in the no-man's land. */
  hatch: THREE.Group | null;
  hatchCol: import('../engine/physics').Box | null;
  drain: THREE.Group | null;
  drainCol: import('../engine/physics').Box | null;
}

export const HATCH = { x1: 14.65, z1: -6.35, x2: 15.75, z2: -5.25 };
export const DRAIN = { x1: 22.0, z1: 21.5, x2: 23.0, z2: 22.5 };

export async function buildPrison(world: World, mode: 'day' | 'night', opts: { breakout?: boolean } = {}): Promise<PrisonHandles> {
  const L = world.mats;
  const night = mode === 'night';
  const kit = new Kit(world);
  kit.ao = { floors: [0, TIER_Y], ceilings: [3.2, ROOF_Y, 2.5], strength: 0.5, range: 0.75 };

  // ---------------------------------------------------------------- materials
  const [floorM, plasterGreen, plasterCream, plasterWhite, concreteM, concreteOut, ceilM, steelM, steelDark, metalDoor, asphaltM, groundM, gravelM, planksM, brickM, rustM] = await Promise.all([
    L.pbr('concrete_floor', { scale: 0.33, roughness: 0.95 }),
    L.pbr('painted_plaster', { scale: 0.5, color: 0x5c7a66, roughness: 0.8 }),
    L.pbr('painted_plaster', { scale: 0.5, color: 0xd8d0b4, roughness: 0.85 }),
    L.pbr('painted_plaster', { scale: 0.5, color: 0xc7c8c0, roughness: 0.85 }),
    L.pbr('concrete_grey', { scale: 0.4, color: 0xb8b4aa }),
    L.pbr('concrete_wall', { scale: 0.25 }),
    L.pbr('concrete_048', { scale: 0.3, color: 0x9a9890 }),
    L.pbr('steel', { scale: 1, color: 0x7d8185, metalness: 0.65, roughness: 0.55 }),
    L.pbr('steel', { scale: 1, color: 0x3d4043, metalness: 0.7, roughness: 0.5 }),
    L.pbr('metal_plate', { scale: 0.8, color: 0x7d8c94, metalness: 0.5, roughness: 0.6 }),
    L.pbr('asphalt', { scale: 0.25 }),
    L.pbr('dry_ground', { scale: 0.2 }),
    L.pbr('gravel', { scale: 0.4 }),
    L.pbr('planks', { scale: 0.7 }),
    L.pbr('brick_red', { scale: 0.45 }),
    L.pbr('metal_plate', { scale: 0.6, color: 0x8a6448, metalness: 0.3, roughness: 0.85 }),
  ]);
  const tube = L.emissive(0xfff4e0, night ? 2.5 : 3.2);
  const tubeOff = L.plain(0x8b8b86, 0.4, 0.1);
  const bulbM = L.emissive(0xffd39a, 3);
  const glassM = new THREE.MeshStandardMaterial({ color: 0x9fb6c0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.25, envMapIntensity: 1.2, depthWrite: false });
  const skyGlass = new THREE.MeshStandardMaterial({ color: night ? 0x223044 : 0xdfe8ee, roughness: 0.3, emissive: night ? 0x0a1020 : 0x9fb0bb, emissiveIntensity: night ? 0.6 : 1.4, transparent: true, opacity: 0.85 });
  const chain = new THREE.MeshStandardMaterial({ map: canvasTexture('chainLink', DRAW.chainLink, 256), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45, color: 0xb5b8ba });
  const razor = new THREE.MeshStandardMaterial({ map: canvasTexture('razor', DRAW.razorWire, 256), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.35 });
  const mattress = await L.canvasMat('mattress', DRAW.mattress, 256, { roughness: 0.95 });
  const blanket = await L.canvasMat('blanket', DRAW.blanket, 256, { roughness: 1 });
  const tilesM = await L.canvasMat('tiles', DRAW.tiles, 512, { roughness: 0.35 });
  const grime = new THREE.MeshBasicMaterial({ map: canvasTexture('grime', DRAW.grime, 256), transparent: true, depthWrite: false, opacity: 0.85 });
  grime.polygonOffset = true; grime.polygonOffsetFactor = -1;
  const cracks = new THREE.MeshBasicMaterial({ map: canvasTexture('cracks', DRAW.cracks, 512), transparent: true, depthWrite: false, opacity: 0.7 });
  cracks.polygonOffset = true; cracks.polygonOffsetFactor = -1;
  const paintYellow = L.plain(0xc9a227, 0.7);
  const woodM = planksM;
  const rubber = L.plain(0x1c1c1c, 0.9);
  const darkM = L.plain(0x202224, 0.6, 0.3);
  const orangeCloth = L.plain(0xc0622a, 0.95);
  const whiteCloth = L.plain(0xd6d4cc, 0.95);
  const greyCloth = L.plain(0x6e7072, 0.95);
  const mats = { floorM, plasterGreen, plasterCream, concreteM, steelM, steelDark, metalDoor, tube, glassM, chain };

  const B = kit.batch;
  const P = kit.physics;
  const R = rng(1234);

  // ================================================================ CELL BLOCK C
  // Bounds: x [-14,14], z [-22,6]; roof at ROOF_Y.
  kit.floor(floorM, -14, -22, 14, 6, 0, 0.3);
  // Outer shell walls (two-tone: green below 1.3m, cream above)
  const twoTone = (x1: number, z1: number, x2: number, z2: number, h: number, ops: Array<{ at: number; width: number; bottom: number; top: number }> = [], t = 0.3, y0 = 0) => {
    kit.wall(plasterGreen, x1, z1, x2, z2, y0, Math.min(1.3, h), t, ops.filter((o) => o.bottom < 1.3).map((o) => ({ ...o, top: Math.min(o.top, 1.3) })));
    if (h > 1.3) {
      const upOps = ops.filter((o) => o.top > 1.3).map((o) => ({ ...o, bottom: Math.max(0, o.bottom - 1.3), top: o.top - 1.3 }));
      kit.wall(plasterCream, x1, z1, x2, z2, y0 + 1.3, h - 1.3, t, upOps);
    }
    // a thin dark stripe at the paint line
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
    B.box(darkM, { x: (x1 + x2) / 2, y: y0 + 1.3, z: (z1 + z2) / 2 }, { x: len, y: 0.05, z: t + 0.02 }, yaw, null);
  };
  // South wall with main gate at x=0 (width 3)
  twoTone(-14, -22, 14, -22, ROOF_Y, [{ at: 14, width: 3, bottom: 0, top: 3 }]);
  // North wall with yard door at x=0
  twoTone(14, 6, -14, 6, ROOF_Y, [{ at: 14, width: 2.6, bottom: 0, top: 2.8 }]);
  // West/east back walls (behind cells) — full height
  kit.wall(concreteM, -14.15, -22, -14.15, 6, 0, ROOF_Y, 0.3);
  kit.wall(concreteM, 14.15, 6, 14.15, -22, 0, ROOF_Y, 0.3, [
    // vent openings behind east ground cells are cut separately (covers)
  ]);
  // Roof with skylights
  const skylights = [-16, -8, 0];
  kit.ceiling(ceilM, -14, -22, 14, -19, ROOF_Y);
  for (let i = 0; i < skylights.length; i++) {
    const z = skylights[i];
    kit.ceiling(ceilM, -14, z - 3, -3, z + 3, ROOF_Y);
    kit.ceiling(ceilM, 3, z - 3, 14, z + 3, ROOF_Y);
    const zn = i < skylights.length - 1 ? skylights[i + 1] - 3 : 6;
    kit.ceiling(ceilM, -14, z + 3, 14, zn, ROOF_Y);
    // glass + frame
    const g = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), skyGlass);
    g.rotation.x = Math.PI / 2;
    g.position.set(0, ROOF_Y + 0.25, z);
    world.root.add(g);
    for (let k = -2; k <= 2; k++) B.box(steelDark, { x: k * 1.5, y: ROOF_Y + 0.1, z }, { x: 0.08, y: 0.18, z: 6 }, 0, null);
    for (let k = -2; k <= 2; k++) B.box(steelDark, { x: 0, y: ROOF_Y + 0.1, z: z + k * 1.5 }, { x: 6, y: 0.18, z: 0.08 }, 0, null);
    if (!night) kit.shaft([0.6, ROOF_Y, z], new THREE.Vector3(0.25, -1, 0.35), 5.5, 10, 0xfff3dc, 0.075);
  }
  kit.ceiling(ceilM, -14, -19, 14, -19 + 0.001, ROOF_Y);
  // Roof trusses
  for (let z = -20; z <= 4; z += 4) {
    B.box(steelDark, { x: 0, y: ROOF_Y - 0.35, z }, { x: 28, y: 0.35, z: 0.22 }, 0, null);
    B.box(steelDark, { x: 0, y: ROOF_Y - 0.9, z }, { x: 28, y: 0.12, z: 0.12 }, 0, null);
    for (let x = -12; x <= 12; x += 4) B.add(cylinderBetween(new THREE.Vector3(x, ROOF_Y - 0.9, z), new THREE.Vector3(x + 2, ROOF_Y - 0.35, z), 0.04, 5), steelDark);
  }

  // ---------------------------------------------------------------- cells
  const cells: CellInfo[] = [];
  const bed = await world.model('bed_iron');
  const toilet = await world.model('toilet');
  const bedXforms: Array<{ p: [number, number, number]; yaw: number; s: number }> = [];
  const toiletXforms: Array<{ p: [number, number, number]; yaw: number; s: number }> = [];
  const zStart = -20;
  const sides: Array<'west' | 'east'> = ['west', 'east'];
  let num = 1;
  for (const side of sides) for (const tier of [0, 1] as const) for (let i = 0; i < 6; i++) {
    const s = side === 'west' ? -1 : 1;
    const y = tier * TIER_Y;
    const z0 = zStart + i * CELL_W, z1 = z0 + CELL_W;
    const cz = (z0 + z1) / 2;
    const xBack = s * 14, xFront = s * (14 - CELL_D);
    const cx = (xBack + xFront) / 2;
    const id = `C-${num++}`;
    // floor (upper tier has its own slab)
    if (tier === 1) kit.slab(floorM, Math.min(xBack, xFront), z0, Math.max(xBack, xFront), z1, y, 0.3, 'concrete', concreteM);
    // side walls between cells (and end walls)
    if (i === 0) kit.wall(concreteM, xBack, z0, xFront, z0, y, 3.2, 0.2);
    kit.wall(concreteM, xBack, z1, xFront, z1, y, 3.2, 0.2);
    // cell ceiling
    if (tier === 0) kit.batch.box(concreteM, { x: cx, y: TIER_Y - 0.15, z: cz }, { x: CELL_D, y: 0.02, z: CELL_W }, 0, null, { faces: ['ny'] });
    else kit.ceiling(concreteM, Math.min(xBack, xFront), z0, Math.max(xBack, xFront), z1, y + 3.2, 0.3);
    // paint band inside the cell
    B.box(plasterCream, { x: xBack - s * 0.02, y: y + 1.6, z: cz }, { x: 0.04, y: 3.1, z: CELL_W - 0.25 }, 0, kit.ao, { faces: [side === 'west' ? 'px' : 'nx'] });
    // bars front with sliding door (door slides along z toward z0)
    const barH = 3.15;
    kit.bars(steelM, xFront, z0 + 0.1, xFront, z0 + 0.9, y, barH);
    const doorGroup = new THREE.Group();
    world.root.add(doorGroup);
    const dg = kit.bars(steelM, xFront, z0 + 0.95, xFront, z1 - 0.1, y, barH - 0.25, 0.13, doorGroup, false);
    void dg;
    // door rail
    B.box(steelDark, { x: xFront, y: y + barH - 0.12, z: cz }, { x: 0.12, y: 0.14, z: CELL_W }, 0, null);
    const doorCol = P.addBox({ x: xFront, y: y + 1.5, z: (z0 + 0.95 + z1 - 0.1) / 2 }, { x: 0.08, y: 3, z: CELL_W - 1.05 }, 0, { blocksSight: false, blocksCamera: false, surface: 'metal' });
    // bunk bed (iron bed model), toilet, sink, shelf
    bedXforms.push({ p: [xBack - s * 0.75, y, z0 + 0.95], yaw: side === 'west' ? Math.PI / 2 : -Math.PI / 2, s: 0.95 });
    toiletXforms.push({ p: [xBack - s * 0.35, y, z1 - 0.45], yaw: side === 'west' ? Math.PI / 2 : -Math.PI / 2, s: 1 });
    // steel sink on wall
    B.box(steelM, { x: xBack - s * 0.32, y: y + 0.85, z: z1 - 1.05 }, { x: 0.42, y: 0.18, z: 0.5 }, 0, null);
    B.box(steelM, { x: xBack - s * 0.1, y: y + 1.12, z: z1 - 1.05 }, { x: 0.08, y: 0.4, z: 0.5 }, 0, null);
    // shelf with items
    B.box(woodM, { x: xBack - s * 0.17, y: y + 1.75, z: z1 - 1.0 }, { x: 0.3, y: 0.04, z: 0.9 }, 0, null);
    for (let k = 0; k < 4; k++) {
      const bc = new THREE.Color().setHSL(R(), 0.35, 0.3 + R() * 0.2);
      B.box(L.plain(bc, 0.8), { x: xBack - s * 0.17, y: y + 1.88, z: z1 - 1.35 + k * 0.08 }, { x: 0.2, y: 0.22 + R() * 0.06, z: 0.06 }, 0, null);
    }
    B.box(L.plain(0xe0ddd2, 0.5), { x: xBack - s * 0.2, y: y + 1.82, z: z1 - 0.7 }, { x: 0.08, y: 0.1, z: 0.08 }, 0, null);
    // small desk + stool
    B.box(steelM, { x: xFront + -s * -0.5 + s * -0.0, y: y + 0.72, z: z1 - 0.32 }, { x: 0.6, y: 0.04, z: 0.42 }, 0, null);
    // caged wall light
    kit.bulb(bulbM, steelDark, xBack - s * 0.15, y + 2.55, cz, 0xffd5a0, 1.6, 4, `cell:${id}`);
    // grime + cracks decals on back wall
    kit.decal(grime, [xBack - s * 0.03, y + 0.6, cz], CELL_W - 0.3, 1.2, side === 'west' ? Math.PI / 2 : -Math.PI / 2);
    if (R() < 0.6) kit.decal(cracks, [xBack - s * 0.035, y + 1.8, cz + (R() - 0.5)], 1.2, 1.2, side === 'west' ? Math.PI / 2 : -Math.PI / 2);
    // cell number sign
    kit.textSign([id], [xFront + s * -0.02 - s * 0.0, y + barH + 0.1, cz], 0.45, side === 'west' ? Math.PI / 2 : -Math.PI / 2, '#1d2a22', '#e6e2cf');
    // colliders for bed/toilet
    P.addBox({ x: xBack - s * 0.75, y: y + 0.3, z: z0 + 0.95 }, { x: 0.95, y: 0.6, z: 1.9 }, 0, { surface: 'metal' });
    P.addBox({ x: xBack - s * 0.35, y: y + 0.4, z: z1 - 0.45 }, { x: 0.55, y: 0.8, z: 0.45 }, 0, {});
    const center = new THREE.Vector3(cx + -s * 0.3, y, cz + 0.35);
    cells.push({
      id, side, tier, center,
      front: new THREE.Vector3(xFront - s * 0.8, y, cz),
      outYaw: side === 'west' ? Math.PI / 2 : -Math.PI / 2,
      door: doorGroup, doorCollider: doorCol,
    });
  }
  kit.instance(bed, bedXforms);
  kit.instance(toilet, toiletXforms);

  // ---------------------------------------------------------------- upper tier catwalks + stairs
  for (const s of [-1, 1]) {
    const x0 = s * (14 - CELL_D), x1 = s * (14 - CELL_D - 1.7);
    kit.slab(steelM, Math.min(x0, x1), -21.6, Math.max(x0, x1), -3.0, TIER_Y, 0.12, 'metal', steelDark);
    kit.railing(steelDark, x1, -21.6, x1, -3.0, TIER_Y);
    kit.railing(steelDark, x1, -21.6, x0, -21.6, TIER_Y);
    // support columns
    for (let z = -21; z <= -3; z += 4.5) B.box(steelDark, { x: x1 + s * 0.1, y: TIER_Y / 2, z }, { x: 0.2, y: TIER_Y, z: 0.2 }, 0, null), P.addBox({ x: x1 + s * 0.1, y: TIER_Y / 2, z }, { x: 0.22, y: TIER_Y, z: 0.22 }, 0, { surface: 'metal' });
    // stairs from the catwalk north end down toward +z
    const sx = s * (14 - CELL_D - 0.85);
    kit.stairs(steelM, sx, -3.0, Math.PI, 1.3, TIER_Y, 0, 5.3);
    kit.railing(steelDark, sx - s * 0.68, -3.0, sx - s * 0.68, 2.3, 0, 1.0, false);
    // stair rail (sloped) as cylinders
    B.add(cylinderBetween(new THREE.Vector3(sx - s * 0.7, TIER_Y + 1, -3.0), new THREE.Vector3(sx - s * 0.7, 1.0, 2.3), 0.03, 6), steelDark);
    // wall behind stair landing to prevent falling off the far side
    kit.wall(concreteM, s * 14, -3.0, s * 14, 6, 0, ROOF_Y, 0.25);
    kit.wall(concreteM, s * 14, -4.4, s * 10.4, -4.4, TIER_Y, 3.2, 0.2);
  }
  // Fill under the stairs/north corner areas (x |10.4..14|, z -4.4..6)
  for (const s of [-1, 1]) {
    B.box(concreteM, { x: s * 12.2, y: TIER_Y / 2, z: 0.8 }, { x: 3.6, y: TIER_Y, z: 10.4 }, 0, kit.ao);
    P.addBox({ x: s * 12.2, y: TIER_Y / 2, z: 0.8 }, { x: 3.6, y: TIER_Y, z: 10.4 }, 0, { walkable: false });
    kit.textSign(['C BLOCK', s < 0 ? 'WEST TIER' : 'EAST TIER'], [s * 10.38, 2.4, 0.8], 1.6, s < 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  // ---------------------------------------------------------------- dayroom
  const tableAt = (x: number, z: number) => {
    // round steel table with 4 attached stools
    const top = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24);
    top.translate(x, 0.76, z);
    B.add(top, steelM);
    const ped = new THREE.CylinderGeometry(0.07, 0.12, 0.74, 10);
    ped.translate(x, 0.37, z);
    B.add(ped, steelDark);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = x + Math.cos(a) * 0.95, sz = z + Math.sin(a) * 0.95;
      const st = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 14);
      st.translate(sx, 0.46, sz);
      B.add(st, steelM);
      B.add(cylinderBetween(new THREE.Vector3(x, 0.08, z), new THREE.Vector3(sx, 0.08, sz), 0.03, 6), steelDark);
      B.add(cylinderBetween(new THREE.Vector3(sx, 0.08, sz), new THREE.Vector3(sx, 0.45, sz), 0.03, 6), steelDark);
    }
    P.addBox({ x, y: 0.4, z }, { x: 1.25, y: 0.8, z: 1.25 }, 0, { surface: 'metal' });
  };
  const tables: THREE.Vector3[] = [];
  for (const x of [-4.2, 0, 4.2]) for (const z of [-15.5, -10, -4.5]) { tableAt(x, z); tables.push(new THREE.Vector3(x, 0, z)); }
  // Guard desk near the gate
  B.box(metalDoor, { x: 0, y: 0.55, z: -18.6 }, { x: 3.2, y: 1.1, z: 0.8 }, 0, kit.ao);
  B.box(darkM, { x: 0, y: 1.12, z: -18.6 }, { x: 3.3, y: 0.05, z: 0.9 }, 0, null);
  P.addBox({ x: 0, y: 0.55, z: -18.6 }, { x: 3.2, y: 1.1, z: 0.8 }, 0, { surface: 'metal' });
  const monitor = await L.canvasMat('monitor', (c, s) => {
    c.fillStyle = '#0b1410'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#5fbf7a'; c.font = `${s / 14}px monospace`;
    ['CELL BLOCK C', 'COUNT: 24/24', 'DOORS: AUTO', '07:42  OK', 'CAM 1  2  3  4'].forEach((t, i) => c.fillText(t, s * 0.06, s * (0.18 + i * 0.14)));
  }, 256, { emissive: 0xffffff, emissiveIntensity: 1.1 });
  for (const x of [-0.8, 0.8]) {
    B.box(darkM, { x, y: 1.4, z: -18.8 }, { x: 0.55, y: 0.38, z: 0.06 }, 0, null);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.33), monitor);
    scr.position.set(x, 1.4, -18.76);
    world.root.add(scr);
  }
  const chair = await world.model('office_chair');
  kit.place(chair, [0.3, 0, -19.4], 0.2);
  // TV on the north wall
  B.box(darkM, { x: 0, y: 3.6, z: 5.6 }, { x: 1.7, y: 1.0, z: 0.12 }, 0, null);
  const tvMat = await L.canvasMat('tvstatic', (c, s) => {
    const img = c.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) { const v = 40 + Math.random() * 120; img.data[i] = v * 0.8; img.data[i + 1] = v * 0.9; img.data[i + 2] = v; img.data[i + 3] = 255; }
    c.putImageData(img, 0, 0);
  }, 128, { emissive: 0xffffff, emissiveIntensity: 0.9 });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.88), tvMat);
  tvScreen.position.set(0, 3.6, 5.53);
  tvScreen.rotation.y = Math.PI;
  world.root.add(tvScreen);
  B.add(cylinderBetween(new THREE.Vector3(0, 4.1, 5.7), new THREE.Vector3(0, 4.6, 5.85), 0.04, 6), darkM);
  // Pay phones on the east wall (north part)
  for (const z of [3.0, 4.2]) {
    B.box(steelM, { x: 10.3, y: 1.4, z }, { x: 0.12, y: 0.55, z: 0.35 }, 0, null);
    B.box(darkM, { x: 10.22, y: 1.45, z: z - 0.08 }, { x: 0.06, y: 0.25, z: 0.08 }, 0, null);
  }
  // Fluorescent fixtures over the dayroom
  for (const x of [-4.5, 4.5]) for (let z = -19; z <= 3; z += 5.5) kit.fixture(night && Math.abs(z + 8) > 6 ? tubeOff : tube, steelDark, x, 6.2, z, 0, 0xfff1dc, night ? (Math.abs(z + 8) > 6 ? 0 : 3) : 7, 11, 1.25, 'dayroom');
  // Catwalk lights
  for (const s of [-1, 1]) for (let z = -19; z <= -5; z += 7) kit.fixture(tube, steelDark, s * 9.6, TIER_Y + 3.0, z, Math.PI / 2, 0xfff1dc, night ? 2.5 : 4, 7, 1.25, 'catwalk');
  // Floor markings: yellow line in front of the gate and cells
  for (const s of [-1, 1]) kit.decal(L.plain(0xc9a227, 0.7), [s * 9.9, 0.012, -12.7], 0.12, 16.4, 0, true);
  kit.decal(paintYellow, [0, 0.012, -20.4], 4.2, 0.12, 0, true);
  // Floor grime
  for (let i = 0; i < 10; i++) kit.decal(cracks, [-7 + R() * 14, 0.011, -20 + R() * 24], 2 + R() * 2, 2 + R() * 2, 0, true);
  // Signs
  kit.textSign(['REDMOOR STATE', 'CORRECTIONAL FACILITY'], [0, 4.6, -21.82], 3.2, 0);
  kit.textSign(['NO INMATES', 'BEYOND YELLOW LINE'], [2.8, 2.2, -21.82], 1.5, 0, '#6b1d1d', '#f1e5c8');
  kit.textSign(['YARD'], [0, 3.1, 5.82], 1.0, Math.PI);

  // Main gate (sliding bars) in the south wall
  const mainGate = new THREE.Group();
  world.root.add(mainGate);
  kit.bars(steelM, -1.5, -22, 1.5, -22, 0, 3.0, 0.12, mainGate, false);
  const mainGateCol = P.addBox({ x: 0, y: 1.5, z: -22 }, { x: 3, y: 3, z: 0.2 }, 0, { blocksSight: false, blocksCamera: false, surface: 'metal' });
  // Yard door (metal double door)
  const yardDoor = new THREE.Group();
  world.root.add(yardDoor);
  const doorPanel = (parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, window = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), mat);
    m.position.set(w / 2, h / 2, 0);
    m.castShadow = true;
    parent.add(m);
    if (window) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.35, h * 0.22), glassM);
      win.position.set(w / 2, h * 0.7, 0.045);
      parent.add(win);
      const win2 = win.clone(); win2.position.z = -0.045; win2.rotation.y = Math.PI; parent.add(win2);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.06), steelDark);
    handle.position.set(w - 0.1, 1.0, 0.07);
    parent.add(handle);
    return m;
  };
  const yd = new THREE.Group();
  yd.position.set(-1.3, 0, 6);
  yardDoor.add(yd);
  doorPanel(yd, 2.6, 2.8, metalDoor);
  const yardDoorCol = P.addBox({ x: 0, y: 1.4, z: 6 }, { x: 2.6, y: 2.8, z: 0.3 }, 0, { surface: 'metal' });

  // ================================================================ EAST MAINTENANCE CHASE (behind east cells)
  // x [14.3, 16.0], z [-26, -4.4], height 3.7
  if (opts.breakout) kit.floorWithHole(concreteM, 14.3, -26, 16.1, -4.2, HATCH, 0, 0.3);
  else kit.floor(concreteM, 14.3, -26, 16.1, -4.2, 0, 0.3);
  // The ceiling sits above the laundry duct (duct interior y 2.65-3.6, z -26.3..-21.4), so crawlers fit.
  kit.wall(concreteM, 16.1, -26, 16.1, -4.2, 0, 3.8, 0.25);
  kit.wall(concreteM, 14.3, -4.2, 16.1, -4.2, 0, 3.8, 0.25);
  kit.ceiling(concreteM, 14.3, -26, 16.1, -4.2, 3.7);
  // pipes along the chase
  for (const [y, r, c] of [[2.9, 0.09, steelM], [2.6, 0.06, rustM], [0.3, 0.07, steelDark]] as const) B.add(cylinderBetween(new THREE.Vector3(15.85, y, -25.8), new THREE.Vector3(15.85, y, -4.4), r, 10), c);
  for (let z = -24; z <= -6; z += 3) { B.box(steelDark, { x: 15.9, y: 2.75, z }, { x: 0.12, y: 0.5, z: 0.05 }, 0, null); }
  for (let z = -22; z <= -6; z += 5.5) kit.bulb(bulbM, steelDark, 15.95, 2.3, z, 0xffc88a, night ? 0.9 : 1.2, 4, 'chase');
  // Vent covers on the cell back walls (east ground cells), visible from both sides
  const ventCovers = new Map<string, THREE.Mesh>();
  const ventTex = canvasTexture('vent', (c, s) => {
    c.fillStyle = '#6f7478'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#1a1c1e';
    for (let y = s * 0.12; y < s * 0.88; y += s / 10) c.fillRect(s * 0.1, y, s * 0.8, s / 22);
    c.strokeStyle = '#4b4f52'; c.lineWidth = s / 20; c.strokeRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92);
    c.fillStyle = '#9aa0a4'; for (const [x, y] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) { c.beginPath(); c.arc(x * s, y * s, s / 30, 0, 7); c.fill(); }
  }, 128);
  const ventMat = new THREE.MeshStandardMaterial({ map: ventTex, metalness: 0.6, roughness: 0.5 });
  for (const c of cells.filter((x) => x.side === 'east' && x.tier === 0)) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.6), ventMat);
    v.position.set(13.98, 0.45, c.center.z - 0.35);
    v.castShadow = true;
    world.root.add(v);
    ventCovers.set(c.id, v);
    // dark duct opening behind the cover
    B.box(darkM, { x: 14.15, y: 0.45, z: c.center.z - 0.35 }, { x: 0.32, y: 0.62, z: 0.62 }, 0, null);
  }
  // Chase door to the corridor (locked maintenance door)
  const chaseDoor = new THREE.Group();
  const cdp = new THREE.Group();
  cdp.position.set(14.35, 0, -25.95);
  chaseDoor.add(cdp);
  doorPanel(cdp, 1.0, 2.2, metalDoor, false);
  world.root.add(chaseDoor);
  const chaseDoorCol = P.addBox({ x: 14.85, y: 1.1, z: -25.95 }, { x: 1.0, y: 2.2, z: 0.15 }, 0, { surface: 'metal' });

  // ================================================================ CORRIDOR (south)
  // z [-26, -22], x [-16, 26]; ceiling 3.0
  kit.floor(floorM, -16, -26, 16.1, -22, 0);
  kit.ceiling(ceilM, -16, -26, 14.3, -22, 3.0);
  twoTone(-16, -26, 14.3, -26, 3.0, [{ at: 8.75, width: 1.6, bottom: 0, top: 2.3 }, { at: 26.75, width: 1.6, bottom: 0, top: 2.3 }], 0.25);
  twoTone(-16, -22, -16, -26, 3.0, [], 0.25);
  // wall between corridor and chase with the chase door opening
  kit.wall(concreteM, 14.3, -26, 14.3, -22, 0, 3.0, 0.2, [{ at: 0.45, width: 1.0, bottom: 0, top: 2.2 }]);
  for (let x = -12; x <= 12; x += 6) kit.fixture(tube, steelDark, x, 2.95, -24, Math.PI / 2, 0xeef4ff, night ? 2 : 4, 7, 1.25, 'corridor');
  kit.textSign(['WORKSHOP'], [-7.25, 2.6, -25.84], 1.0, 0);
  kit.textSign(['LAUNDRY'], [10.75, 2.6, -25.84], 1.0, 0);
  kit.textSign(['MAINTENANCE', 'AUTHORIZED ONLY'], [13.5, 2.55, -25.84], 1.1, 0, '#6b1d1d');
  // Metal detector arch at the workshop door (inside the corridor)
  for (const dx of [-0.75, 0.75]) B.box(L.plain(0xd9d6cc, 0.5), { x: -7.25 + dx, y: 1.05, z: -25.4 }, { x: 0.12, y: 2.1, z: 0.5 }, 0, null);
  B.box(L.plain(0xd9d6cc, 0.5), { x: -7.25, y: 2.15, z: -25.4 }, { x: 1.62, y: 0.15, z: 0.5 }, 0, null);
  const detLight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), L.emissive(0x40ff60, 2));
  detLight.position.set(-6.5, 2.0, -25.12);
  world.root.add(detLight);

  // ================================================================ WORKSHOP
  // x [-16, 1.5], z [-42, -26]; height 4.5
  kit.floor(floorM, -16, -42, 1.5, -26, 0);
  kit.ceiling(ceilM, -16, -42, 1.5, -26, 4.5);
  kit.wall(concreteOut, -16, -42, -16, -26, 0, 4.5, 0.3);
  kit.wall(concreteOut, 1.5, -42, -16, -42, 0, 4.5, 0.3, [{ at: 4, width: 2.4, bottom: 1.8, top: 3.3 }, { at: 10, width: 2.4, bottom: 1.8, top: 3.3 }]);
  // wall between workshop and laundry, with a door
  kit.wall(concreteM, 1.5, -26, 1.5, -42, 0, 4.5, 0.25, [{ at: 9, width: 1.6, bottom: 0, top: 2.4 }]);
  // corridor wall above 3 m (between corridor ceiling and workshop ceiling)
  kit.wall(plasterCream, -16, -26, 14.3, -26, 3.0, 1.5, 0.25);
  // windows glass
  for (const x of [-2.5, -8.5]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), glassM);
    g.position.set(x, 2.55, -41.9);
    world.root.add(g);
    for (let k = -1; k <= 1; k++) B.box(steelDark, { x: x + k * 0.8, y: 2.55, z: -41.9 }, { x: 0.05, y: 1.5, z: 0.08 }, 0, null);
    if (!night) kit.shaft([x, 3.2, -41.8], new THREE.Vector3(0.15, -0.55, 1), 2.2, 8, 0xfff0d0, 0.06);
  }
  // Workbenches with vises and tools
  const bench = (x: number, z: number, yaw: number) => {
    const c = Math.cos(yaw), s2 = Math.sin(yaw);
    const loc = (lx: number, lz: number) => ({ x: x + lx * c + lz * s2, z: z - lx * s2 + lz * c });
    B.box(woodM, { x, y: 0.9, z }, { x: 2.4, y: 0.08, z: 0.9 }, yaw, null);
    for (const [lx, lz] of [[-1.1, -0.38], [1.1, -0.38], [-1.1, 0.38], [1.1, 0.38]]) { const p = loc(lx, lz); B.box(steelDark, { x: p.x, y: 0.45, z: p.z }, { x: 0.06, y: 0.9, z: 0.06 }, yaw, null); }
    const sh = loc(0, 0); B.box(steelDark, { x: sh.x, y: 0.25, z: sh.z }, { x: 2.3, y: 0.03, z: 0.8 }, yaw, null);
    const v = loc(0.9, 0.3); B.box(steelM, { x: v.x, y: 1.02, z: v.z }, { x: 0.18, y: 0.16, z: 0.22 }, yaw, null);
    for (let k = 0; k < 5; k++) { const t = loc(-0.9 + R() * 1.4, -0.1 + R() * 0.3); B.box(L.plain(new THREE.Color().setHSL(R() * 0.1, 0.4, 0.3), 0.6, 0.3), { x: t.x, y: 0.96, z: t.z }, { x: 0.25 * R() + 0.08, y: 0.04, z: 0.05 }, yaw + R(), null); }
    P.addBox({ x, y: 0.47, z }, { x: 2.45, y: 0.94, z: 0.95 }, yaw, { surface: 'wood' });
  };
  for (const z of [-38.5, -34.5]) for (const x of [-12.5, -7.5]) bench(x, z, 0);
  bench(-13.5, -29.5, Math.PI / 2);
  // Tool cage in the east part of the workshop: x [-3.5, 1.2], z [-31.5, -27.2]
  const cageX0 = -3.5, cageX1 = 1.2, cageZ0 = -31.5, cageZ1 = -27.2;
  // The fences run all the way to the walls (the corridor wall at z -26 and the laundry wall at
  // x 1.5 close the other two sides); they used to stop short and left gaps to walk around the lock.
  void cageX1; void cageZ1;
  kit.fence(steelDark, chain, cageX0, cageZ0, 1.4, cageZ0, 0, 3.0);
  kit.fence(steelDark, chain, cageX0, cageZ0, cageX0, -29.6, 0, 3.0);
  kit.fence(steelDark, chain, cageX0, -28.4, cageX0, -26.1, 0, 3.0);
  // cage door (chain link on a frame), hinged at z -29.6
  const cageDoor = new THREE.Group();
  cageDoor.position.set(cageX0, 0, -29.6);
  world.root.add(cageDoor);
  const cdPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.3), chain);
  cdPanel.position.set(0, 1.15, 0.6);
  cdPanel.rotation.y = Math.PI / 2;
  cageDoor.add(cdPanel);
  for (const [a, b] of [[[0, 0, 0], [0, 2.3, 0]], [[0, 0, 1.2], [0, 2.3, 1.2]], [[0, 2.3, 0], [0, 2.3, 1.2]], [[0, 0.05, 0], [0, 0.05, 1.2]]] as const) {
    const m = new THREE.Mesh(cylinderBetween(new THREE.Vector3(...a), new THREE.Vector3(...b), 0.025, 6), steelDark);
    cageDoor.add(m);
  }
  const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.06), L.plain(0xc9a227, 0.4, 0.8));
  padlock.position.set(-0.05, 1.1, 1.18);
  cageDoor.add(padlock);
  const cageDoorCol = P.addBox({ x: cageX0, y: 1.2, z: -29.0 }, { x: 0.1, y: 2.4, z: 1.2 }, 0, { blocksSight: false, blocksCamera: false, surface: 'metal' });
  // pegboard with tools inside the cage (against laundry wall)
  B.box(L.plain(0x9b8458, 0.9), { x: 1.33, y: 1.7, z: -29.3 }, { x: 0.04, y: 1.4, z: 3.6 }, 0, null);
  for (let k = 0; k < 14; k++) {
    const z = -30.9 + (k % 7) * 0.5, y = 1.3 + Math.floor(k / 7) * 0.6;
    B.box(L.plain(new THREE.Color().setHSL(0.02 + R() * 0.1, 0.5, 0.35), 0.5, 0.4), { x: 1.29, y, z }, { x: 0.03, y: 0.32, z: 0.06 }, 0, null);
  }
  // The screwdriver on the cage shelf (interactable prop)
  B.box(steelM, { x: 0.4, y: 0.95, z: -30.9 }, { x: 1.4, y: 0.05, z: 0.6 }, 0, null);
  P.addBox({ x: 0.4, y: 0.5, z: -30.9 }, { x: 1.4, y: 1.0, z: 0.6 }, 0, {});
  const screwdriver = new THREE.Group();
  const sh1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 8), L.plain(0xd8b020, 0.5));
  sh1.rotation.z = Math.PI / 2;
  const sh2 = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6), steelM);
  sh2.rotation.z = Math.PI / 2;
  sh2.position.x = 0.13;
  screwdriver.add(sh1, sh2);
  screwdriver.position.set(0.2, 0.99, -30.8);
  world.root.add(screwdriver);
  // Haskins' desk at the cage entrance (outside)
  B.box(woodM, { x: -5.2, y: 0.75, z: -29.0 }, { x: 0.8, y: 0.06, z: 1.5 }, 0, null);
  B.box(steelDark, { x: -5.2, y: 0.37, z: -29.0 }, { x: 0.7, y: 0.74, z: 1.4 }, 0, null);
  P.addBox({ x: -5.2, y: 0.4, z: -29.0 }, { x: 0.8, y: 0.8, z: 1.5 }, 0, {});
  const chair2 = await world.model('office_chair');
  kit.place(chair2, [-6.6, 0, -29.7], Math.PI / 2 + 0.4);
  for (let x = -12; x <= -2; x += 5) for (const z of [-30, -37]) kit.fixture(tube, steelDark, x, 4.4, z, 0, 0xfff4e6, night ? 0 : 6, 10, 1.25, 'workshop');
  // crates and barrels
  const crate = await world.model('crate');
  kit.instance(crate, [{ p: [-15.2, 0, -40.8], yaw: 0.1 }, { p: [-15.2, 0.35, -40.8], yaw: -0.2 }, { p: [-14.3, 0, -41.2], yaw: 1.4 }]);
  P.addBox({ x: -15.0, y: 0.4, z: -40.9 }, { x: 1.6, y: 0.8, z: 0.9 }, 0, { surface: 'wood' });
  const barrels = await world.model('oil_barrels');
  kit.place(barrels, [0.4, 0, -40.9], 0.4);
  P.addBox({ x: 0.4, y: 0.45, z: -40.9 }, { x: 0.6, y: 0.9, z: 1.4 }, 0.4, { surface: 'metal' });
  // workshop door from corridor (open frame) + shop->laundry door
  const workshopDoor = new THREE.Group();
  const wdp = new THREE.Group();
  wdp.position.set(-8.05, 0, -26);
  workshopDoor.add(wdp);
  doorPanel(wdp, 1.6, 2.3, metalDoor);
  world.root.add(workshopDoor);
  const workshopDoorCol = P.addBox({ x: -7.25, y: 1.15, z: -26 }, { x: 1.6, y: 2.3, z: 0.2 }, 0, { surface: 'metal' });
  const shopLaundryDoor = new THREE.Group();
  const sldp = new THREE.Group();
  sldp.position.set(1.5, 0, -34.2);
  sldp.rotation.y = -Math.PI / 2;
  shopLaundryDoor.add(sldp);
  doorPanel(sldp, 1.6, 2.4, metalDoor);
  world.root.add(shopLaundryDoor);
  const shopLaundryDoorCol = P.addBox({ x: 1.5, y: 1.2, z: -35.0 }, { x: 0.2, y: 2.4, z: 1.6 }, 0, { surface: 'metal' });

  // ================================================================ LAUNDRY
  // x [1.5, 20], z [-42, -26]
  kit.floor(tilesM, 1.5, -42, 20, -26, 0, 0.3, 'tile');
  kit.ceiling(ceilM, 1.5, -42, 20, -26, 4.5);
  kit.wall(concreteOut, 20, -26, 20, -42, 0, 4.5, 0.3);
  kit.wall(concreteOut, 20, -42, 1.5, -42, 0, 4.5, 0.3);
  // north laundry wall (shares corridor wall up to x 14.3; beyond it the chase): the duct opening is at x 15.2, y 2.6
  kit.wall(concreteM, 14.3, -26, 20, -26, 0, 4.5, 0.25, [{ at: 0.9, width: 1.0, bottom: 2.6, top: 3.6 }]);
  // corridor wall continues above the laundry door etc. handled by corridor wall
  // Washers along the south wall
  const washerGlass = new THREE.MeshStandardMaterial({ color: 0x405058, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 6; i++) {
    const x = 3.2 + i * 1.3;
    B.box(L.plain(0xd9d9d3, 0.45, 0.1), { x, y: 0.55, z: -41.4 }, { x: 1.1, y: 1.1, z: 0.9 }, 0, kit.ao);
    const door = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20);
    door.rotateX(Math.PI / 2);
    door.translate(x, 0.55, -40.94);
    B.add(door, washerGlass);
    const rim = new THREE.TorusGeometry(0.31, 0.03, 6, 20);
    rim.translate(x, 0.55, -40.93);
    B.add(rim, steelM);
    B.box(darkM, { x, y: 1.02, z: -40.95 }, { x: 0.8, y: 0.12, z: 0.02 }, 0, null);
  }
  P.addBox({ x: 6.45, y: 0.55, z: -41.4 }, { x: 7.8, y: 1.1, z: 0.9 }, 0, {});
  // Industrial dryers stacked along the east wall
  for (let i = 0; i < 3; i++) for (const y of [0.7, 1.95]) {
    const z = -40 + i * 1.6;
    B.box(L.plain(0xb8bab4, 0.45, 0.2), { x: 19.3, y, z }, { x: 1.2, y: 1.2, z: 1.4 }, 0, kit.ao);
    const d = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 22);
    d.rotateZ(Math.PI / 2);
    d.translate(18.68, y, z);
    B.add(d, washerGlass);
  }
  P.addBox({ x: 19.3, y: 1.3, z: -38.4 }, { x: 1.2, y: 2.6, z: 4.8 }, 0, {});
  // Folding tables with linen stacks
  for (const [x, z] of [[7, -34], [12, -34], [7, -30], [12, -30]]) {
    B.box(steelM, { x, y: 0.85, z }, { x: 2.2, y: 0.05, z: 1.0 }, 0, null);
    for (const [lx, lz] of [[-1.0, -0.42], [1.0, -0.42], [-1.0, 0.42], [1.0, 0.42]]) B.box(steelDark, { x: x + lx, y: 0.42, z: z + lz }, { x: 0.05, y: 0.84, z: 0.05 }, 0, null);
    for (let k = 0; k < 4; k++) B.box(k % 2 ? orangeCloth : whiteCloth, { x: x - 0.7 + k * 0.45, y: 0.95 + (k % 3) * 0.04, z: z + (R() - 0.5) * 0.3 }, { x: 0.4, y: 0.12 + (k % 3) * 0.08, z: 0.32 }, R() * 0.2, null);
    P.addBox({ x, y: 0.45, z }, { x: 2.25, y: 0.9, z: 1.05 }, 0, {});
  }
  // Laundry carts (hiding cover)
  const cart = (x: number, z: number, yaw: number) => {
    B.box(greyCloth, { x, y: 0.62, z }, { x: 1.1, y: 0.75, z: 0.7 }, yaw, kit.ao);
    B.box(steelDark, { x, y: 0.22, z }, { x: 1.15, y: 0.05, z: 0.75 }, yaw, null);
    for (const [lx, lz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) {
      const c = Math.cos(yaw), s2 = Math.sin(yaw);
      const w = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10);
      w.rotateX(Math.PI / 2);
      w.translate(x + lx * c + lz * s2, 0.08, z - lx * s2 + lz * c);
      B.add(w, rubber);
    }
    B.box(orangeCloth, { x, y: 1.02, z }, { x: 0.95, y: 0.12, z: 0.55 }, yaw + 0.1, null);
    P.addBox({ x, y: 0.5, z }, { x: 1.15, y: 1.0, z: 0.75 }, yaw, { surface: 'metal' });
  };
  cart(4.5, -37.5, 0.2); cart(16.5, -36.5, -0.3); cart(10, -38.3, 1.4); cart(15.2, -31, 0.5);
  // Steel shelving under the duct with folded linen — climbable with a boost
  B.box(steelM, { x: 16.4, y: 1.0, z: -26.75 }, { x: 3.4, y: 0.05, z: 0.9 }, 0, null);
  B.box(steelM, { x: 16.4, y: 1.95, z: -26.75 }, { x: 3.4, y: 0.05, z: 0.9 }, 0, null);
  B.box(steelM, { x: 16.4, y: 0.3, z: -26.75 }, { x: 3.4, y: 0.05, z: 0.9 }, 0, null);
  for (const x of [14.75, 18.05]) for (const z of [-27.15, -26.35]) B.box(steelDark, { x, y: 1.0, z }, { x: 0.05, y: 2.0, z: 0.05 }, 0, null);
  for (let k = 0; k < 6; k++) B.box(k % 2 ? whiteCloth : orangeCloth, { x: 15.1 + k * 0.5, y: 1.13 + (k % 2) * 0.03, z: -26.75 }, { x: 0.42, y: 0.2, z: 0.6 }, 0, null);
  P.addBox({ x: 16.4, y: 1.0, z: -26.75 }, { x: 3.4, y: 2.0, z: 0.9 }, 0, { surface: 'metal' });
  // Duct above the corridor: floor at 2.6, interior 1.0 x 1.0, from z -26 to -21.8 at x 15.2, then drop shaft into the chase
  const ductMat = steelM;
  const dx0 = 14.7, dx1 = 15.7;
  kit.slab(ductMat, dx0, -26.3, dx1, -21.4, 2.6, 0.05, 'metal');
  kit.box(ductMat, [dx0 - 0.03, 3.1, -23.85], [0.05, 1.05, 4.9], 0, { surface: 'metal' });
  kit.box(ductMat, [dx1 + 0.03, 3.1, -23.85], [0.05, 1.05, 4.9], 0, { surface: 'metal' });
  kit.box(ductMat, [15.2, 3.63, -23.85], [1.06, 0.05, 4.9], 0, { walkable: false });
  // drop into the chase: a ladder
  for (let y = 0.3; y < 2.6; y += 0.32) B.add(cylinderBetween(new THREE.Vector3(14.75, y, -21.25), new THREE.Vector3(15.65, y, -21.25), 0.018, 5), steelDark);
  for (const x of [14.75, 15.65]) B.add(cylinderBetween(new THREE.Vector3(x, 0, -21.25), new THREE.Vector3(x, 2.65, -21.25), 0.022, 5), steelDark);
  for (let x = 4; x <= 18; x += 6) for (const z of [-30, -37]) kit.fixture(tube, steelDark, x, 4.4, z, 0, 0xf0f6ff, night ? 0 : 5.5, 10, 1.25, 'laundry');
  kit.bulb(bulbM, steelDark, 15.2, 3.45, -24, 0xffb070, 0.6, 3, 'duct');
  const laundryDoor = new THREE.Group();
  const ldp = new THREE.Group();
  ldp.position.set(9.95, 0, -26);
  laundryDoor.add(ldp);
  doorPanel(ldp, 1.6, 2.3, metalDoor);
  world.root.add(laundryDoor);
  const laundryDoorCol = P.addBox({ x: 10.75, y: 1.15, z: -26 }, { x: 1.6, y: 2.3, z: 0.2 }, 0, { surface: 'metal' });

  // ================================================================ YARD (outdoor)
  // x [-22, 24], z [6, 44]
  if (opts.breakout) kit.floorWithHole(groundM, -22, 6, 24, 44, DRAIN, 0, 0.3, 'dirt');
  else kit.floor(groundM, -22, 6, 24, 44, 0, 0.3, 'dirt');
  kit.floor(asphaltM, -16, 12, 0, 32, 0.02, 0.05, 'asphalt');
  kit.floor(gravelM, 2, 10, 18, 22, 0.015, 0.05, 'gravel');
  // Court lines
  const lineM = L.plain(0xe6e2d0, 0.8);
  kit.decal(lineM, [-8, 0.05, 22], 0.1, 19.6, 0, true);
  kit.decal(lineM, [-15.9, 0.05, 22], 0.1, 19.6, 0, true);
  kit.decal(lineM, [-0.1, 0.05, 22], 0.1, 19.6, 0, true);
  kit.decal(lineM, [-8, 0.05, 12.1], 15.8, 0.1, 0, true);
  kit.decal(lineM, [-8, 0.05, 31.9], 15.8, 0.1, 0, true);
  // Outer walls (6 m concrete) with razor wire on top
  kit.wall(concreteOut, -22, 6, -22, 44, 0, 6, 0.6);
  kit.wall(concreteOut, -22, 44, 24, 44, 0, 6, 0.6);
  kit.wall(concreteOut, 24, 44, 24, 6, 0, 6, 0.6);
  kit.wall(concreteOut, 24, 6, 14.15, 6, 0, 6, 0.6);
  kit.wall(concreteOut, -14.15, 6, -22, 6, 0, 6, 0.6);
  for (const [a, b] of [[[-22, 6], [-22, 44]], [[-22, 44], [24, 44]], [[24, 44], [24, 6]]] as const) {
    const coil = new THREE.CylinderGeometry(0.35, 0.35, Math.hypot(b[0] - a[0], b[1] - a[1]), 16, 1, true);
    coil.rotateZ(Math.PI / 2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const uv = coil.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len * 1.5);
    coil.rotateY(Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2);
    coil.translate((a[0] + b[0]) / 2, 6.4, (a[1] + b[1]) / 2);
    world.root.add(new THREE.Mesh(coil, razor));
  }
  // Inner fence separating the yard from the outer wall perimeter (no-man's land)
  kit.fence(steelDark, chain, -19, 9, -19, 41, 0, 3.6, razor);
  kit.fence(steelDark, chain, -19, 41, 21, 41, 0, 3.6, razor);
  kit.fence(steelDark, chain, 21, 41, 21, 9, 0, 3.6, razor);
  kit.fence(steelDark, chain, 21, 9, 14.15, 9, 0, 3.6, razor);
  kit.fence(steelDark, chain, -14.15, 9, -19, 9, 0, 3.6, razor);
  kit.textSign(['WARNING', 'RESTRICTED ZONE'], [-18.95, 2.2, 25], 1.2, Math.PI / 2, '#7a1a1a');
  kit.textSign(['WARNING', 'RESTRICTED ZONE'], [0, 2.2, 40.95], 1.2, Math.PI, '#7a1a1a');
  // Basketball hoops
  for (const z of [12.8, 31.2]) {
    const dir = z < 20 ? 1 : -1;
    B.add(cylinderBetween(new THREE.Vector3(-8, 0, z - dir * 0.6), new THREE.Vector3(-8, 3.2, z - dir * 0.6), 0.07, 10), steelDark);
    B.box(L.plain(0xe8e8e0, 0.6), { x: -8, y: 3.35, z: z - dir * 0.35 }, { x: 1.8, y: 1.05, z: 0.05 }, 0, null);
    const rim = new THREE.TorusGeometry(0.23, 0.018, 6, 20);
    rim.rotateX(Math.PI / 2);
    rim.translate(-8, 3.05, z);
    B.add(rim, L.plain(0xc04020, 0.5, 0.4));
    P.addBox({ x: -8, y: 1.6, z: z - dir * 0.6 }, { x: 0.2, y: 3.2, z: 0.2 }, 0, { surface: 'metal' });
  }
  // Weight benches + barbells
  for (let i = 0; i < 3; i++) {
    const x = 5 + i * 3.5, z = 15;
    B.box(L.plain(0x3a2a22, 0.8), { x, y: 0.45, z }, { x: 0.35, y: 0.08, z: 1.3 }, 0, null);
    B.box(steelDark, { x, y: 0.22, z }, { x: 0.1, y: 0.42, z: 1.2 }, 0, null);
    for (const dz of [-0.45, 0.45]) B.add(cylinderBetween(new THREE.Vector3(x - 0.3, 0, z + dz + 0.6), new THREE.Vector3(x - 0.3, 1.2, z + dz + 0.6), 0.025, 6), steelDark);
    B.add(cylinderBetween(new THREE.Vector3(x - 0.3, 1.15, z - 0.2), new THREE.Vector3(x - 0.3, 1.15, z + 1.4), 0.02, 6), steelM);
    for (const dz of [-0.1, 1.3]) { const pl = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 18); pl.rotateX(Math.PI / 2); pl.translate(x - 0.3, 1.15, z + dz); B.add(pl, darkM); }
    P.addBox({ x, y: 0.3, z }, { x: 0.5, y: 0.6, z: 1.4 }, 0, {});
  }
  // Bleachers
  for (let r = 0; r < 4; r++) {
    B.box(woodM, { x: 10, y: 0.35 + r * 0.42, z: 27 + r * 0.7 }, { x: 9, y: 0.06, z: 0.45 }, 0, null, { uvRotate: true });
    B.box(woodM, { x: 10, y: 0.12 + r * 0.42, z: 27.2 + r * 0.7 }, { x: 9, y: 0.04, z: 0.3 }, 0, null);
  }
  for (const x of [5.7, 10, 14.3]) B.box(steelDark, { x, y: 0.9, z: 28.05 }, { x: 0.08, y: 1.8, z: 2.6 }, 0, null);
  P.addRamp({ x: 10, y: 0.9, z: 28.05 }, { x: 9, y: 1.8, z: 2.6 }, 0, 'z', 0.4, 1.66, { surface: 'wood' });
  // Picnic tables
  for (const [x, z] of [[6, 35], [12, 35], [-14, 37]]) {
    B.box(woodM, { x, y: 0.75, z }, { x: 2.0, y: 0.06, z: 0.8 }, 0, null, { uvRotate: true });
    for (const dz of [-0.62, 0.62]) B.box(woodM, { x, y: 0.45, z: z + dz }, { x: 2.0, y: 0.05, z: 0.3 }, 0, null, { uvRotate: true });
    for (const dx of [-0.8, 0.8]) B.box(steelDark, { x: x + dx, y: 0.37, z }, { x: 0.06, y: 0.74, z: 1.4 }, 0, null);
    P.addBox({ x, y: 0.4, z }, { x: 2.0, y: 0.8, z: 1.5 }, 0, { surface: 'wood' });
  }
  // Guard tower (NE corner)
  const tx = 19, tz = 38;
  for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
    B.add(cylinderBetween(new THREE.Vector3(tx + lx * 1.2, 0, tz + lz * 1.2), new THREE.Vector3(tx + lx, 7, tz + lz), 0.12, 8), steelDark);
    P.addBox({ x: tx + lx * 1.1, y: 3.5, z: tz + lz * 1.1 }, { x: 0.3, y: 7, z: 0.3 }, 0, { surface: 'metal' });
  }
  for (let y = 1.5; y < 7; y += 1.8) for (const [a, b] of [[[-1.3, -1.3], [1.3, 1.3]], [[1.3, -1.3], [-1.3, 1.3]]] as const) B.add(cylinderBetween(new THREE.Vector3(tx + a[0], y, tz + a[1]), new THREE.Vector3(tx + b[0], y + 1.6, tz + b[1]), 0.04, 5), steelDark);
  B.box(concreteOut, { x: tx, y: 7.1, z: tz }, { x: 3.6, y: 0.25, z: 3.6 }, 0, null);
  for (const [w, d, ox, oz] of [[3.6, 0.15, 0, -1.72], [3.6, 0.15, 0, 1.72], [0.15, 3.6, -1.72, 0], [0.15, 3.6, 1.72, 0]] as const) B.box(metalDoor, { x: tx + ox, y: 7.7, z: tz + oz }, { x: w, y: 1.0, z: d }, 0, null);
  for (const [ox, oz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) B.box(steelDark, { x: tx + ox, y: 8.7, z: tz + oz }, { x: 0.12, y: 2.0, z: 0.12 }, 0, null);
  const roof = new THREE.ConeGeometry(2.9, 1.0, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(tx, 10.1, tz);
  B.add(roof, steelDark);
  const towerLamp = new THREE.Group();
  towerLamp.position.set(tx - 1.6, 8.6, tz - 1.6);
  const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.5, 14), steelDark);
  lampBody.rotation.x = Math.PI / 2;
  towerLamp.add(lampBody);
  const lampFace = new THREE.Mesh(new THREE.CircleGeometry(0.21, 16), L.emissive(0xfff6dd, night ? 8 : 0.5));
  lampFace.position.z = 0.26;
  towerLamp.add(lampFace);
  world.root.add(towerLamp);
  let searchlight: THREE.SpotLight | null = null;
  if (night) {
    searchlight = new THREE.SpotLight(0xfff4dd, 260, 60, 0.22, 0.4, 1.2);
    searchlight.position.copy(towerLamp.position);
    world.scene.add(searchlight, searchlight.target);
  }
  // Yard floodlights on poles
  for (const [x, z] of [[-18, 10], [-18, 40], [20, 10], [0, 40]]) {
    B.add(cylinderBetween(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 8, z), 0.1, 8), steelDark);
    B.box(steelDark, { x, y: 8.1, z }, { x: 1.2, y: 0.15, z: 0.2 }, 0, null);
    for (const dx of [-0.4, 0.4]) B.box(L.emissive(0xfff0d0, night ? 6 : 0.3), { x: x + dx, y: 7.95, z }, { x: 0.35, y: 0.12, z: 0.3 }, 0, null);
    P.addBox({ x, y: 4, z }, { x: 0.25, y: 8, z: 0.25 }, 0, { surface: 'metal' });
    kit.fixtures.push({ pos: new THREE.Vector3(x, 7.8, z), color: new THREE.Color(0xfff0d0), intensity: night ? 30 : 0, range: 24, on: night, zone: 'yard' });
  }
  // Dumpster + barrels near the cell block wall (cover)
  const dumpster = await world.model('dumpster');
  kit.place(dumpster, [16.5, 0, 8.4], Math.PI / 2);
  P.addBox({ x: 16.5, y: 0.75, z: 8.4 }, { x: 1.95, y: 1.5, z: 1.2 }, 0, { surface: 'metal' });
  const barrels2 = await world.model('oil_barrels');
  kit.place(barrels2, [-17, 0, 15], 1.2);
  P.addBox({ x: -17, y: 0.45, z: 15 }, { x: 0.6, y: 0.9, z: 1.4 }, 1.2, { surface: 'metal' });
  const tire = await world.model('tire');
  kit.instance(tire, [{ p: [-16.8, 0, 32], yaw: 0.3 }, { p: [-16.2, 0, 32.6], yaw: 1.3 }, { p: [-17.0, 0, 33.4], yaw: 2.2 }]);
  // Exterior of the cell block (yard side) — brick facade
  kit.wall(brickM, -14.15, 6.32, 14.15, 6.32, 0, ROOF_Y, 0.02, [{ at: 14.15, width: 2.6, bottom: 0, top: 2.8 }], { solid: false });
  kit.textSign(['CELL BLOCK C'], [0, 3.6, 6.35], 2.4, 0);

  // ---------------------------------------------------------------- security cameras (props)
  const cameraProps: THREE.Object3D[] = [];
  const camAt = (x: number, y: number, z: number, yaw: number) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.34), L.plain(0xe0e0d8, 0.5));
    body.position.z = 0.17;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), darkM);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.35;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), L.emissive(0xff2020, 4));
    led.position.set(0.05, 0.05, 0.33);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), steelDark);
    arm.position.z = -0.05;
    g.add(body, lens, led, arm);
    g.position.set(x, y, z);
    g.rotation.set(0.35, yaw, 0);
    world.root.add(g);
    cameraProps.push(g);
  };
  camAt(-13.8, 6.5, -21.6, Math.PI * 0.8);
  camAt(13.8, 6.5, 5.6, -Math.PI * 0.2);
  camAt(-15.6, 2.8, -22.4, Math.PI * 0.6);
  camAt(13.9, 2.7, -22.3, -Math.PI * 0.6);
  camAt(-15.7, 4.2, -41.6, Math.PI * 0.25);

  // ---------------------------------------------------------------- breakout route covers
  let hatch: THREE.Group | null = null, hatchCol: PrisonHandles['hatchCol'] = null;
  let drain: THREE.Group | null = null, drainCol: PrisonHandles['drainCol'] = null;
  if (opts.breakout) {
    // Hatch: steel plate hinged on its west edge.
    hatch = new THREE.Group();
    hatch.position.set(HATCH.x1, 0.01, (HATCH.z1 + HATCH.z2) / 2);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(HATCH.x2 - HATCH.x1, 0.05, HATCH.z2 - HATCH.z1), metalDoor);
    plate.position.x = (HATCH.x2 - HATCH.x1) / 2;
    plate.castShadow = plate.receiveShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12), steelDark);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(HATCH.x2 - HATCH.x1 - 0.18, 0.04, 0);
    hatch.add(plate, handle);
    world.root.add(hatch);
    hatchCol = P.addBox({ x: (HATCH.x1 + HATCH.x2) / 2, y: -0.15, z: (HATCH.z1 + HATCH.z2) / 2 }, { x: HATCH.x2 - HATCH.x1, y: 0.3, z: HATCH.z2 - HATCH.z1 }, 0, { surface: 'metal' });
    // Drain grate in the east no-man's land.
    const grateTex = canvasTexture('drainGrate', (c, sz) => {
      c.clearRect(0, 0, sz, sz);
      c.fillStyle = '#3b3e40';
      c.fillRect(0, 0, sz, sz * 0.08); c.fillRect(0, sz * 0.92, sz, sz * 0.08); c.fillRect(0, 0, sz * 0.08, sz); c.fillRect(sz * 0.92, 0, sz * 0.08, sz);
      for (let x = sz * 0.08; x < sz; x += sz / 9) c.fillRect(x, 0, sz * 0.035, sz);
    }, 128);
    const grateMat = new THREE.MeshStandardMaterial({ map: grateTex, alphaTest: 0.5, metalness: 0.7, roughness: 0.6, side: THREE.DoubleSide, color: 0x9a9a98 });
    drain = new THREE.Group();
    drain.position.set(DRAIN.x1, 0.02, (DRAIN.z1 + DRAIN.z2) / 2);
    const gp = new THREE.Mesh(new THREE.BoxGeometry(DRAIN.x2 - DRAIN.x1, 0.04, DRAIN.z2 - DRAIN.z1), grateMat);
    gp.position.x = (DRAIN.x2 - DRAIN.x1) / 2;
    drain.add(gp);
    world.root.add(drain);
    drainCol = P.addBox({ x: (DRAIN.x1 + DRAIN.x2) / 2, y: -0.15, z: (DRAIN.z1 + DRAIN.z2) / 2 }, { x: DRAIN.x2 - DRAIN.x1, y: 0.3, z: DRAIN.z2 - DRAIN.z1 }, 0, { surface: 'metal' });
    // Concrete rim
    for (const [cx, cz, w, d] of [[(DRAIN.x1 + DRAIN.x2) / 2, DRAIN.z1 - 0.06, 1.24, 0.12], [(DRAIN.x1 + DRAIN.x2) / 2, DRAIN.z2 + 0.06, 1.24, 0.12], [DRAIN.x1 - 0.06, (DRAIN.z1 + DRAIN.z2) / 2, 0.12, 1.0], [DRAIN.x2 + 0.06, (DRAIN.z1 + DRAIN.z2) / 2, 0.12, 1.0]] as const) B.box(concreteOut, { x: cx, y: 0.02, z: cz }, { x: w, y: 0.05, z: d }, 0, null);
  }

  // ---------------------------------------------------------------- navigation graph
  const nav = new NavGraph(P);
  const navPts: Array<[number, number, number]> = [
    // dayroom grid
    ...[-7, -2, 2, 7].flatMap((x) => [-20, -13, -7.5, -1.5, 3.5].map((z) => [x, 0, z] as [number, number, number])),
    // in front of cells
    ...[-20, -15, -10, -5].flatMap((z) => [[-9.6, 0, z], [9.6, 0, z]] as Array<[number, number, number]>),
    // catwalk + stairs
    ...[-20, -15, -10, -5].flatMap((z) => [[-9.6, TIER_Y, z], [9.6, TIER_Y, z]] as Array<[number, number, number]>),
    [-9.6, TIER_Y, -3.4], [9.6, TIER_Y, -3.4], [-9.6, 0, 2.6], [9.6, 0, 2.6],
    // gate + corridor
    [0, 0, -21], [0, 0, -23.2], ...[-14, -7.25, 0, 6, 10.75].map((x) => [x, 0, -24] as [number, number, number]),
    // workshop
    [-7.25, 0, -27.2], [-10, 0, -32.5], [-5, 0, -32.5], [-10, 0, -36.5], [-5, 0, -36.5], [-10, 0, -40.5], [-2, 0, -36.5], [-1.5, 0, -33], [-6.3, 0, -30.5], [0, 0, -35],
    // laundry
    [10.75, 0, -27.2], [4, 0, -35], [9.5, 0, -36], [14.5, 0, -33], [17, 0, -29], [9.5, 0, -32], [14.5, 0, -39],
    // yard
    [0, 0, 7.5], [0, 0, 11], [-8, 0, 17], [-8, 0, 27], [-14, 0, 22], [-2, 0, 22], [8, 0, 12], [8, 0, 20], [14, 0, 24], [8, 0, 34], [16, 0, 34], [-14, 0, 35],
    // chase
    [15.2, 0, -21], [15.2, 0, -15], [15.2, 0, -9], [15.2, 0, -5],
  ];
  for (const p of navPts) nav.add(...p);
  nav.autoLink(9);
  // stairs links (ground <-> catwalk)
  const idx = (x: number, y: number, z: number) => nav.nodes.findIndex((n) => Math.abs(n.x - x) < 0.01 && Math.abs(n.y - y) < 0.01 && Math.abs(n.z - z) < 0.01);
  nav.link(idx(-9.6, 0, 2.6), idx(-9.6, TIER_Y, -3.4));
  nav.link(idx(9.6, 0, 2.6), idx(9.6, TIER_Y, -3.4));

  kit.finish();
  return {
    kit, cells,
    cell: (id: string) => cells.find((c) => c.id === id)!,
    mainGate, mainGateCol, yardDoor, yardDoorCol, workshopDoor, workshopDoorCol, laundryDoor, laundryDoorCol, cageDoor, cageDoorCol,
    shopLaundryDoor, shopLaundryDoorCol, chaseDoor, chaseDoorCol, ventCovers, nav, mats, screwdriver, tvScreen, searchlight, towerLamp, cameraProps,
    hatch, hatchCol, drain, drainCol,
  };
}
