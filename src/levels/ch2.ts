// Chapter 2 — The Breakout. 2 a.m.: vents, the old storm tunnel, the searchlight, the wall and the river.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { buildPrison, HATCH, DRAIN, type PrisonHandles } from './prison';
import { v3, placeChar, run, clipChar, lookChar, shot, closeUp, twoShot, npcPlace, poseChar } from './cs';
import type { ScriptStep } from '../game/player';
import { Terrain, fbm, distToPath, smooth } from './terrain';
import { Water } from './water';
import { Foliage, scatter, type FoliageItem } from './foliage';
import { Flashlight, Searchlight, coneLight, inSearchlight } from './lights';
import { cylinderBetween } from '../engine/geometry';
import type { Line } from '../game/dialogue';

const TY = -3.6; // tunnel floor
const TH = 2.5; // tunnel height
const SIDE_OUT = -Math.PI / 2;
const RIVER: Array<[number, number]> = [[-80, 126], [-50, 121], [-20, 117], [5, 116], [30, 119], [55, 124], [95, 128]];
const RIVER_Y = -8.2;
const SCAFF = { x0: 1.5, x1: 5.5, z0: 42.45, z1: 43.6 };
const P1Y = 2.4, P2Y = 4.8;

export class Chapter2 extends Chapter {
  readonly num = 2;
  readonly title = 'The Breakout';
  readonly subtitle = 'Redmoor, 2:00 a.m.';
  P!: PrisonHandles;
  music = 'music_stealth';
  terrain!: Terrain;
  private foliage: Foliage | null = null;
  private flash = new Map<string, Flashlight>();
  private searchlights: Searchlight[] = [];
  private steamOn = true;
  private steamT = 0;
  private spotT: Record<CharacterId, number> = { elias: 0, jax: 0 };
  private shotT = 2;
  private hatchT = 0;
  private drainT = 0;
  private grate!: THREE.Group;
  private grateCol!: import('../engine/physics').Box;
  private grateT = 0;
  private lowLadder!: THREE.Group;
  private blanket!: THREE.Mesh;
  private rainOn = false;
  private thunderT = 12;

  readonly checkpoints: Record<string, CheckpointDef> = {
    cells: { spawn: { elias: { pos: [11.9, 0, -10.55], yaw: SIDE_OUT }, jax: { pos: [11.9, 0, -7.95], yaw: SIDE_OUT } }, objective: 'Wait for Vance to pass, then open the vent behind your bunk', intro: 'cs2_intro' },
    chase: { spawn: { elias: { pos: [15.2, 0, -11.0], yaw: 0 }, jax: { pos: [15.2, 0, -8.2], yaw: 0 } }, objective: 'Open the maintenance hatch at the end of the chase' },
    tunnel: { spawn: { elias: { pos: [15.0, TY, -4.2], yaw: 0 }, jax: { pos: [15.5, TY, -3.2], yaw: 0 } }, objective: 'Follow the old storm tunnel north', intro: 'cs2_tunnel' },
    yard: { spawn: { elias: { pos: [22.4, 0, 23.4], yaw: 0 }, jax: { pos: [22.7, 0, 24.6], yaw: 0 } }, objective: 'Reach the scaffolding on the north wall — stay out of the searchlight' },
    outside: { spawn: { elias: { pos: [3.0, -0.9, 47.5], yaw: 0 }, jax: { pos: [4.6, -0.9, 47.8], yaw: 0 } }, objective: 'Run for the river!' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: false, sprint: true, combat: false, crouch: true };
    const d = this.npcDefs;
    d.push({ id: 'vance', char: 'guard2', role: 'guard', name: 'Officer Vance', pos: [9.4, 0, -20], yaw: 0, catches: true, vision: { range: 9, fov: 80 }, walk: 0.95,
      patrol: [[9.4, -20, 3, 0], [9.4, -12, 1.5, Math.PI / 2], [9.4, -6, 1.5, Math.PI / 2], [9.4, -2.5, 4, Math.PI], [9.4, -9, 1.5, Math.PI / 2], [9.4, -16, 1, Math.PI / 2]] });
    d.push({ id: 'pruitt', char: 'guard1', role: 'guard', name: 'Officer Pruitt', pos: [0.4, 0, -19.4], yaw: 0, idleClip: 'sit_chair', passive: true });
    d.push({ id: 'briggs', char: 'guard2', role: 'guard', name: 'Officer Briggs', pos: [22.6, 0, 14], yaw: 0, catches: true, vision: { range: 10, fov: 85 }, walk: 1.0,
      patrol: [[22.6, 13, 3, Math.PI], [22.6, 28, 0], [22.6, 40.5, 2, 0], [15, 42.4, 3, -Math.PI / 2], [22.4, 42.4, 0], [22.6, 30, 0]] });
    d.push({ id: 'towerguard', char: 'guard1', role: 'guard', name: 'Tower guard', pos: [19.2, 7.22, 38.4], yaw: -2.4, idleClip: 'idle_look', passive: true });
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.vents = [
      { who: 'jax', text: 'Vent\'s off. You?' },
      { who: 'elias', text: 'Four screws. Give me a minute.' },
    ];
    D.in_chase = [
      { who: 'elias', text: 'The hatch at the north end. Nobody\'s opened it since they paved over the old storm drains.' },
      { who: 'jax', text: 'And you know that how?' },
      { who: 'elias', text: 'I read the building plans. They were in the library, filed under "fiction".' },
    ];
    D.steam = [
      { who: 'jax', text: 'That pipe\'s cooking. We\'re not walking through that.' },
      { who: 'elias', text: 'There are valves on both sides. One holds, one runs.' },
    ];
    D.steam_tip = [{ who: 'narrator', text: 'Hold Use on a valve to shut off the steam while your partner gets past.', dur: 4 }];
    D.water = [{ who: 'jax', text: 'Of course it\'s flooded. Why wouldn\'t it be flooded.' }];
    D.grate = [
      { who: 'elias', text: 'Bolted. Hold it steady, I\'ll take the bolts out.' },
      { who: 'jax', text: 'Hurry up. My arms aren\'t what they used to be. Yesterday.' },
    ];
    D.shift = [
      { who: 'jax', text: 'Tower changes guards at two-thirty. There\'s a gap — five, six minutes where the new guy\'s still getting his coffee.' },
      { who: 'elias', text: 'How do you know the tower rotation?' },
      { who: 'jax', text: '...I listen. You\'re not the only one who pays attention.', pause: 0.5 },
    ];
    D.drain_loud = [{ who: 'elias', text: 'That grate will make noise. Make sure Briggs is far away.' }];
    D.yard_in = [
      { who: 'jax', text: 'Searchlight. Big one.' },
      { who: 'elias', text: 'It sweeps the same way every time. Count it. The scaffolding on the north wall — that\'s our ladder.' },
    ];
    D.scaff = [
      { who: 'elias', text: 'They pull the bottom ladder up at night. Give me your hand — no, other way. I lift, you climb.' },
    ];
    D.boost_tip = [{ who: 'narrator', text: 'One player gives a boost, the other climbs. Then lower the ladder for your partner.', dur: 4 }];
    D.blanket = [{ who: 'elias', text: 'Blanket over the wire. Don\'t touch the coils.' }];
    D.outside = [
      { who: 'jax', text: 'Go, go, go! Down to the river!' },
      { who: 'elias', text: 'Stay in the trees! Out of the light!' },
    ];
    D.downed_hint = [{ who: 'narrator', text: 'If your partner is hit and goes down, hold Use next to them to help them up.', dur: 4 }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/night_city.hdr', envIntensity: 0.18, background: 0x070a10,
      fog: { color: 0x0a0e15, density: 0.022 },
      hemi: { sky: 0x2c3c58, ground: 0x0e0b09, intensity: 0.32 },
      sun: { color: 0x8fa8d8, intensity: 0.55, dir: [-0.4, 0.8, 0.45], shadows: true },
      grade: { saturation: 0.78, contrast: 1.1, lift: [0.0, 0.006, 0.016], gain: [0.96, 1.0, 1.06], shadowTint: [0.9, 0.97, 1.12], highlightTint: [1.06, 1.0, 0.92], exposure: 1.1, bloom: 1.0, vignette: 0.62 },
      reverb: 0.5,
    });
    this.P = await buildPrison(w, 'night', { breakout: true });
    const P = this.P;
    const kit = P.kit;
    // Lights: cells and most of the dayroom are dark at night; the north yard floodlight is broken.
    for (const f of kit.fixtures) {
      if (f.zone?.startsWith('cell:') || f.zone === 'workshop' || f.zone === 'laundry') f.on = false;
      if (f.zone === 'yard' && (Math.abs(f.pos.x) < 1 || (f.pos.x < -17 && f.pos.z < 20))) f.on = false;
    }
    kit.initLightPool(Math.max(2, g.deps.renderer.q.maxLights - 1));
    g.setNav(P.nav);
    // Nav nodes for the no-man's land patrol.
    for (const [x, z] of [[22.6, 13], [22.6, 20], [22.6, 28], [22.6, 35], [22.6, 40.5], [18, 42.4], [12, 42.4], [6, 42.4]] as const) P.nav.add(x, 0, z);
    P.nav.autoLink(9);
    for (const c of P.cells) this.addDoor({ id: c.id, obj: c.door, collider: c.doorCollider, kind: 'slide', open: new THREE.Vector3(0.12 * (c.side === 'east' ? -1 : 1), 0, -1.3), speed: 0.8, sound: 'cell' });
    await this.buildTunnel();
    await this.buildScaffold();
    await this.buildOutside();
    // Tower platform is walkable (the tower guard stands on it).
    w.physics.addBox({ x: 19, y: 7.1, z: 38 }, { x: 3.6, y: 0.25, z: 3.6 }, 0, { surface: 'concrete' });
    kit.finish();
    // Searchlight on the guard tower sweeping the no-man's land.
    const sl = new Searchlight(w, P.towerLamp.position, [
      v3(22.5, 0, 12), v3(22.5, 0, 24), v3(22.6, 0, 34), v3(22.4, 0, 42.4), v3(14, 0, 42.6), v3(4, 0, 42.6), v3(-6, 0, 42.5), v3(4, 0, 42.6), v3(14, 0, 42.6), v3(22.4, 0, 42.4), v3(22.6, 0, 30),
    ], 22, 0.085, P.towerLamp, P.searchlight);
    this.searchlights.push(sl);
    // Second searchlight on the NW wall corner for the outside slope (off until the alarm).
    const sl2 = new Searchlight(w, v3(-21.4, 7.2, 44.6), [v3(-12, 0, 60), v3(10, 0, 70), v3(30, 0, 62), v3(12, 0, 52)], 14, 0.11);
    sl2.on = false;
    this.searchlights.push(sl2);
    // Ambience
    w.ambientLoop('amb_night', 0.35);
    w.ambientLoop('amb_hvac', 0.12, v3(0, 4, -8));
    w.tickers.add((dt, t) => {
      kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      const ground = (x: number, z: number) => this.groundY(x, z);
      for (const f of this.flash.values()) f.update(ground);
      const st = g.session.sharedNow() / 1000;
      for (const s of this.searchlights) s.update(dt, st, ground);
      void t;
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
  }

  /** Ground height for light pools (terrain outside, floor inside). */
  private groundY(x: number, z: number): number {
    if (z > 44.3 && this.terrain) return this.terrain.height(x, z);
    const hit = this.g.world.physics.groundAt(x, z, 1.0);
    return hit ? hit.y : 0;
  }

  // ------------------------------------------------------------------ tunnel
  private async buildTunnel(): Promise<void> {
    const w = this.g.world;
    const kit = this.P.kit;
    const L = w.mats;
    const [brick, conc, steel, rust, mud] = await Promise.all([
      L.pbr('old_stone', { scale: 0.6, color: 0x8c8378 }),
      L.pbr('concrete_048', { scale: 0.4, color: 0x6e6a62 }),
      L.pbr('steel', { scale: 1, color: 0x5d6165, metalness: 0.7, roughness: 0.5 }),
      L.pbr('metal_plate', { scale: 0.6, color: 0x7a5a42, metalness: 0.3, roughness: 0.85 }),
      L.pbr('mud', { scale: 0.5, color: 0x6d6050 }),
    ]);
    const B = kit.batch;
    const bulb = L.emissive(0xffb070, 3);
    const top = TY + TH;
    // Shaft below the hatch.
    const hx = (HATCH.x1 + HATCH.x2) / 2, hz = (HATCH.z1 + HATCH.z2) / 2;
    kit.wall(conc, HATCH.x1 - 0.1, HATCH.z1 - 0.1, HATCH.x2 + 0.1, HATCH.z1 - 0.1, top, -0.3 - top, 0.2);
    kit.wall(conc, HATCH.x2 + 0.1, HATCH.z2 + 0.1, HATCH.x1 - 0.1, HATCH.z2 + 0.1, top, -0.3 - top, 0.2);
    kit.wall(conc, HATCH.x1 - 0.1, HATCH.z2 + 0.1, HATCH.x1 - 0.1, HATCH.z1 - 0.1, top, -0.3 - top, 0.2);
    kit.wall(conc, HATCH.x2 + 0.1, HATCH.z1 - 0.1, HATCH.x2 + 0.1, HATCH.z2 + 0.1, top, -0.3 - top, 0.2);
    this.ladder(steel, hx, HATCH.z2 - 0.05, TY, 0, Math.PI);
    // Tunnel A (north): x [14.1, 16.3], z [-7.2, 22.6]
    const x0 = 14.1, x1 = 16.3;
    const flood0 = 8.5, flood1 = 13.5, dip = 0.45;
    kit.floor(mud, x0, -7.2, x1, flood0 - 1, TY, 0.3, 'mud');
    kit.floor(mud, x0, flood1 + 1, x1, 22.6, TY, 0.3, 'mud');
    kit.floor(mud, x0, flood0, x1, flood1, TY - dip, 0.3, 'mud');
    w.physics.addRamp({ x: (x0 + x1) / 2, y: TY - dip / 2, z: flood0 - 0.5 }, { x: x1 - x0, y: dip, z: 1 }, 0, 'z', TY, TY - dip, { surface: 'mud' });
    w.physics.addRamp({ x: (x0 + x1) / 2, y: TY - dip / 2, z: flood1 + 0.5 }, { x: x1 - x0, y: dip, z: 1 }, 0, 'z', TY - dip, TY, { surface: 'mud' });
    B.box(mud, { x: (x0 + x1) / 2, y: TY - dip / 2, z: flood0 - 0.5 }, { x: x1 - x0, y: dip, z: 1 }, 0, null, { faces: ['py'] });
    B.box(mud, { x: (x0 + x1) / 2, y: TY - dip / 2, z: flood1 + 0.5 }, { x: x1 - x0, y: dip, z: 1 }, 0, null, { faces: ['py'] });
    kit.wall(brick, x0, -7.2, x0, 20.4, TY - dip, TH + dip, 0.3);
    kit.wall(brick, x1, 22.6, x1, -7.2, TY - dip, TH + dip, 0.3, [{ at: 0.0, width: 0.01, bottom: 0, top: 0.01 }]);
    kit.wall(brick, x1, -7.2, x0, -7.2, TY, TH, 0.3);
    // Ceiling with the hatch shaft opening.
    kit.ceiling(conc, x0, -7.2, x1, HATCH.z1 - 0.1, top);
    kit.ceiling(conc, x0, HATCH.z2 + 0.1, x1, 22.6, top);
    kit.ceiling(conc, x0, HATCH.z1 - 0.1, HATCH.x1 - 0.1, HATCH.z2 + 0.1, top);
    kit.ceiling(conc, HATCH.x2 + 0.1, HATCH.z1 - 0.1, x1, HATCH.z2 + 0.1, top);
    // Tunnel B (east) toward the drain: z [20.4, 22.6], x [16.3, 23.4]
    kit.floor(mud, x1, 20.4, 23.4, 22.6, TY, 0.3, 'mud');
    kit.wall(brick, x0, 22.6, 23.4, 22.6, TY, TH, 0.3, [{ at: 8.4, width: 1.2, bottom: TH - 0.2, top: TH }]);
    kit.wall(brick, 23.4, 20.4, x1, 20.4, TY, TH, 0.3);
    kit.wall(brick, 23.4, 22.6, 23.4, 20.4, TY, TH, 0.3);
    kit.ceiling(conc, x1, 20.4, DRAIN.x1 - 0.1, 22.6, top);
    kit.ceiling(conc, DRAIN.x2 + 0.1, 20.4, 23.4, 22.6, top);
    kit.ceiling(conc, DRAIN.x1 - 0.1, 20.4, DRAIN.x2 + 0.1, DRAIN.z1 - 0.1, top);
    kit.ceiling(conc, DRAIN.x1 - 0.1, DRAIN.z2 + 0.1, DRAIN.x2 + 0.1, 22.6, top);
    // Drain shaft walls + ladder
    for (const [ax, az, bx, bz] of [[DRAIN.x1 - 0.1, DRAIN.z1 - 0.1, DRAIN.x2 + 0.1, DRAIN.z1 - 0.1], [DRAIN.x2 + 0.1, DRAIN.z2 + 0.1, DRAIN.x1 - 0.1, DRAIN.z2 + 0.1], [DRAIN.x1 - 0.1, DRAIN.z2 + 0.1, DRAIN.x1 - 0.1, DRAIN.z1 - 0.1], [DRAIN.x2 + 0.1, DRAIN.z1 - 0.1, DRAIN.x2 + 0.1, DRAIN.z2 + 0.1]] as const) kit.wall(conc, ax, az, bx, bz, top, -0.3 - top, 0.2);
    this.ladder(steel, DRAIN.x2 - 0.05, (DRAIN.z1 + DRAIN.z2) / 2, TY, 0, -Math.PI / 2);
    // Pipes, bulbs, debris
    for (const [y, r, m] of [[TY + 2.1, 0.12, rust], [TY + 1.8, 0.07, steel], [TY + 0.35, 0.09, rust]] as const) B.add(cylinderBetween(v3(16.05, y, -7), v3(16.05, y, 20.6), r, 10), m);
    for (let z = -5; z <= 20; z += 4) B.box(steel, { x: 16.15, y: TY + 1.95, z }, { x: 0.1, y: 0.5, z: 0.05 }, 0, null);
    for (const z of [-3, 4.5, 11, 18]) kit.bulb(bulb, steel, 14.25, TY + 2.15, z, 0xffa860, z === 11 ? 0.6 : 1.4, 6, 'tunnel');
    kit.bulb(bulb, steel, 20, TY + 2.15, 20.55, 0xffa860, 1.2, 6, 'tunnel');
    // Valves
    for (const [vx, vz] of [[14.25, 0.5], [16.15, 6.6]] as const) {
      const wheel = new THREE.TorusGeometry(0.18, 0.025, 6, 16);
      wheel.rotateY(Math.PI / 2);
      wheel.translate(vx + (vx < 15 ? 0.12 : -0.12), TY + 1.15, vz);
      B.add(wheel, L.plain(0xb02a20, 0.5, 0.3));
      B.add(cylinderBetween(v3(vx, TY + 1.15, vz), v3(vx + (vx < 15 ? 0.12 : -0.12), TY + 1.15, vz), 0.03, 6), steel);
      B.add(cylinderBetween(v3(vx + (vx < 15 ? 0.05 : -0.05), TY + 0.2, vz), v3(vx + (vx < 15 ? 0.05 : -0.05), TY + 2.2, vz), 0.06, 8), rust);
    }
    // Leaking steam pipe across the tunnel at z 3.6
    B.add(cylinderBetween(v3(14.2, TY + 2.25, 3.6), v3(16.2, TY + 2.25, 3.6), 0.1, 10), rust);
    // Flood water
    this.floodWater = new Water(w, { rect: { x0, z0: flood0 - 1, x1, z1: flood1 + 1 }, y: TY + 0.06, color: 0x1a1d16, opacity: 0.92 });
    this.waters.push(this.floodWater);
    // Grate (bolted bars) at z 15.6
    this.grate = new THREE.Group();
    w.root.add(this.grate);
    kit.bars(steel, x0 + 0.1, 15.6, x1 - 0.1, 15.6, TY, TH - 0.05, 0.16, this.grate, false);
    for (const y of [TY + 0.3, TY + 1.3, TY + 2.2]) { const r = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.2, 0.06, 0.06), steel); r.position.set((x0 + x1) / 2, y, 15.6); this.grate.add(r); }
    this.grateCol = w.physics.addBox({ x: (x0 + x1) / 2, y: TY + TH / 2, z: 15.6 }, { x: x1 - x0, y: TH, z: 0.12 }, 0, { blocksSight: false, blocksCamera: false, surface: 'metal' });
    // Old debris
    const crate = await w.model('crate');
    kit.instance(crate, [{ p: [14.5, TY, 18.6], yaw: 0.4 }, { p: [14.6, TY + 0.3, 18.9], yaw: 1.2 }, { p: [22.6, TY, 21.0], yaw: 0.2 }]);
    const barrels = await w.model('oil_barrels');
    kit.place(barrels, [14.7, TY, -6.5], 0.3);
    w.physics.addBox({ x: 14.7, y: TY + 0.45, z: -6.5 }, { x: 0.9, y: 0.9, z: 1.3 }, 0.3, {});
  }

  /** Visual ladder (two rails + rungs) against a wall; yaw = facing direction of the climber. */
  private ladder(mat: THREE.Material, x: number, z: number, y0: number, y1: number, yaw: number, parent?: THREE.Group): void {
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.22);
    const add = (geo: THREE.BufferGeometry) => { if (parent) parent.add(new THREE.Mesh(geo, mat)); else this.P.kit.batch.add(geo, mat); };
    add(cylinderBetween(v3(x - r.x, y0, z - r.z), v3(x - r.x, y1 + 0.9, z - r.z), 0.025, 6));
    add(cylinderBetween(v3(x + r.x, y0, z + r.z), v3(x + r.x, y1 + 0.9, z + r.z), 0.025, 6));
    for (let y = y0 + 0.3; y < y1 + 0.5; y += 0.3) add(cylinderBetween(v3(x - r.x, y, z - r.z), v3(x + r.x, y, z + r.z), 0.018, 5));
  }

  // ------------------------------------------------------------------ scaffold
  private async buildScaffold(): Promise<void> {
    const w = this.g.world;
    const kit = this.P.kit;
    const L = w.mats;
    const [steel, planks, cloth] = await Promise.all([
      L.pbr('steel', { scale: 1, color: 0x8a8d90, metalness: 0.6, roughness: 0.5 }),
      L.pbr('planks', { scale: 0.8, color: 0x8a7a62 }),
      Promise.resolve(L.plain(0x5c5f48, 0.95)),
    ]);
    const B = kit.batch;
    const { x0, x1, z0, z1 } = SCAFF;
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [z0, z1 - 0.05]) B.add(cylinderBetween(v3(x, 0, z), v3(x, P2Y + 1.1, z), 0.03, 6), steel);
    for (const y of [P1Y, P2Y]) {
      kit.box(planks, [(x0 + x1) / 2, y - 0.04, (z0 + z1) / 2], [x1 - x0, 0.08, z1 - z0 + 0.05], 0, { surface: 'wood' }, { uvRotate: true });
      // guard rails on the open (south) side
      B.add(cylinderBetween(v3(x0, y + 1.0, z0), v3(x1, y + 1.0, z0), 0.025, 6), steel);
      B.add(cylinderBetween(v3(x0, y + 0.5, z0), v3(x1, y + 0.5, z0), 0.02, 6), steel);
      w.physics.addBox({ x: (x0 + x1) / 2, y: y + 0.55, z: z0 - 0.02 }, { x: x1 - x0, y: 1.1, z: 0.06 }, 0, { blocksSight: false, blocksCamera: false, walkable: false });
      w.physics.addBox({ x: x0 - 0.02, y: y + 0.55, z: (z0 + z1) / 2 }, { x: 0.06, y: 1.1, z: z1 - z0 }, 0, { blocksSight: false, blocksCamera: false, walkable: false });
      w.physics.addBox({ x: x1 + 0.02, y: y + 0.55, z: (z0 + z1) / 2 }, { x: 0.06, y: 1.1, z: z1 - z0 }, 0, { blocksSight: false, blocksCamera: false, walkable: false });
    }
    for (let i = 0; i < 2; i++) B.add(cylinderBetween(v3(x0, i * P1Y + 0.1, z0), v3((x0 + x1) / 2, (i + 1) * P1Y - 0.1, z0), 0.02, 5), steel);
    // Fixed ladder P1 -> P2 (west end)
    this.ladder(steel, x0 + 0.45, z1 - 0.12, P1Y, P2Y, 0);
    // Pulled-up ladder (lowered by the first climber), east end
    this.lowLadder = new THREE.Group();
    this.ladder(steel, x1 - 0.45, z0 - 0.35, 0, P1Y, Math.PI, this.lowLadder);
    this.lowLadder.position.y = P1Y + 0.1;
    this.lowLadder.rotation.x = 0;
    w.root.add(this.lowLadder);
    // Dim work lamp so the scaffolding reads in the dark.
    kit.bulb(L.emissive(0xffc070, 3), steel, x1 - 0.2, P2Y + 0.9, z1 - 0.1, 0xffb060, 1.1, 5, 'scaffold');
    // Tarp on the wall and a pallet of cement bags
    kit.box(cloth, [(x0 + x1) / 2, 3.2, 43.66], [x1 - x0 + 0.6, 6.0, 0.04], 0, false);
    // Blanket thrown over the razor wire (hidden until used)
    this.blanket = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.2), L.plain(0x6e7072, 1));
    this.blanket.position.set(3.4, 6.45, 44.0);
    this.blanket.visible = false;
    this.blanket.castShadow = true;
    w.root.add(this.blanket);
    // Cover props in the no-man's land
    const crate = await w.model('crate');
    const barrels = await w.model('oil_barrels');
    for (const [x, z, yaw] of [[22.9, 18.5, 0.1], [22.7, 31.0, 1.4], [16.5, 42.9, 0.3], [9.0, 43.0, -0.2]] as const) {
      kit.place(barrels, [x, 0, z], yaw);
      w.physics.addBox({ x, y: 0.45, z }, { x: 1.1, y: 0.9, z: 1.4 }, yaw, {});
    }
    kit.instance(crate, [{ p: [22.0, 0, 26.5], yaw: 0.2 }, { p: [22.1, 0.3, 26.6], yaw: 1.0 }, { p: [22.9, 0, 36.2], yaw: 0.5 }, { p: [12.0, 0, 43.0], yaw: 0.1 }, { p: [12.4, 0.3, 43.1], yaw: 0.7 }]);
    for (const [x, z] of [[22.1, 26.5], [22.9, 36.2], [12.2, 43.0]] as const) w.physics.addBox({ x, y: 0.4, z }, { x: 0.9, y: 0.8, z: 0.6 }, 0, {});
    // Generator box with a hum
    kit.box(L.plain(0x46524a, 0.6, 0.3), [22.8, 0.7, 39.2], [1.2, 1.4, 1.8], 0, {});
    w.ambientLoop('amb_fan', 0.25, v3(22.8, 1, 39.2));
  }

  // ------------------------------------------------------------------ outside
  private async buildOutside(): Promise<void> {
    const g = this.g;
    const w = g.world;
    const riverD = (x: number, z: number) => distToPath(x, z, RIVER).d;
    const height = (x: number, z: number) => {
      const dz = Math.max(0, z - 44);
      let h = -0.6 - dz * 0.08 + fbm(x * 0.04, z * 0.04, 4, 2) * 1.6 * smooth(44, 60, z);
      // Across the river the land rises again into forest.
      const rz = distToPath(x, z, RIVER);
      const across = z > 118 + (x * 0.05);
      if (across) h = RIVER_Y + 1.0 + Math.min(14, (rz.d - 8) * 0.25) + fbm(x * 0.05, z * 0.05, 4, 5) * 2.5;
      // River channel
      const bank = smooth(6, 13, rz.d);
      const bed = RIVER_Y - 1.6 + Math.min(1.2, rz.d * 0.12);
      h = THREE.MathUtils.lerp(bed, Math.max(h, RIVER_Y + 0.6), bank);
      return h;
    };
    this.terrain = new Terrain({
      x0: -80, z0: 44, size: 176, res: 89, height,
      layers: [
        { set: 'grass_sparse', scale: 0.18, tint: 0x9aa18a, surface: 'grass', roughness: 0.95 },
        { set: 'forest_floor', scale: 0.22, surface: 'leaves', roughness: 1 },
        { set: 'rock_face', scale: 0.12, tint: 0x8a8a86, surface: 'gravel', roughness: 0.9 },
        { set: 'mud', scale: 0.25, tint: 0x8a7a62, surface: 'mud', roughness: 0.6 },
      ],
      weights: (x, z, h, slope) => {
        const rd = riverD(x, z);
        const mud = smooth(13, 7, rd) + (h < RIVER_Y + 1.2 ? 0.6 : 0);
        const rock = smooth(0.35, 0.65, slope) * 1.4;
        const forest = smooth(58, 75, z) * (0.6 + 0.4 * fbm(x * 0.06, z * 0.06, 2, 9));
        return [1 - forest * 0.7, forest, rock, mud];
      },
      occlusion: (x, z) => smooth(58, 80, z) * 0.6,
      chunk: 32,
    });
    await this.terrain.build(w);
    this.waters.push(new Water(w, { path: RIVER, width: 15, y: RIVER_Y, color: 0x101c1c, flow: [1, 0.08], opacity: 0.9 }));
    // Trees and rocks
    const items: FoliageItem[] = [
      { model: 'tree_fir_a', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'tree_fir_b', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'fir_big', impostor: true, collider: 0.35, colliderHeight: 5 },
      { model: 'tree_hornbeam_a', impostor: true, collider: 0.2 },
      { model: 'shrub_a', near: 45, shadow: false },
      { model: 'boulder_b', near: 70, collider: 0.9, colliderHeight: 1.2 },
      { model: 'shrub_c', near: 45, shadow: false },
    ];
    const pl = scatter({
      x0: -78, z0: 50, x1: 94, z1: 218, spacing: 5.2, seed: 22,
      height: (x, z) => this.terrain.height(x, z),
      density: (x, z) => {
        const rd = riverD(x, z);
        if (rd < 10) return 0;
        if (z < 54) return 0;
        // Kill zone below the wall is sparse; the slope gets denser toward the river.
        const base = z < 70 ? 0.18 : z < 110 ? 0.4 : 0.75;
        // Keep a clear run from the scaffold.
        if (Math.abs(x - 4) < 5 && z < 66) return 0;
        return base * (0.6 + 0.4 * fbm(x * 0.05, z * 0.05, 2, 3));
      },
      pick: (r, _x, z) => (r < 0.1 ? 5 : r < 0.18 ? 4 : r < 0.24 ? 6 : z > 118 ? (r < 0.45 ? 2 : r < 0.75 ? 0 : 1) : r < 0.5 ? 0 : r < 0.8 ? 1 : 3),
      scale: (item, r) => (item === 2 ? 0.7 + r * 0.4 : item >= 4 ? 0.7 + r * 0.5 : 1.1 + r * 0.6),
    });
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, pl);
    w.tickers.add((dt) => this.foliage?.update(dt, g.cam.camera.position));
  }

  // ================================================================== interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    // Cells: open the vents
    I.add({ id: 'vent_c16', who: 'elias', pos: v3(12.7, 0, -10.0), radius: 1.2, label: 'Unscrew the vent (under the bunk)', icon: 'tool', mode: 'hold', holdTime: 3.0, pose: 'kneel', facing: Math.PI * 0.8,
      enabled: () => this.flags.phase === 'cells' && !this.flags.vent_elias, onUse: () => g.session.request('ventOpen', { who: 'elias' }) });
    I.add({ id: 'vent_c17', who: 'jax', pos: v3(12.7, 0, -7.4), radius: 1.2, label: 'Pull the loose vent', icon: 'tool', mode: 'hold', holdTime: 1.2, pose: 'kneel', facing: Math.PI * 0.8,
      enabled: () => this.flags.phase === 'cells' && !this.flags.vent_jax, onUse: () => g.session.request('ventOpen', { who: 'jax' }) });
    I.add({ id: 'crawl_c16', who: 'elias', pos: v3(12.7, 0, -10.0), radius: 1.2, label: 'Crawl into the chase', icon: 'climb', enabled: () => this.flags.phase === 'cells' && !!this.flags.vent_elias, onUse: () => this.crawlVent('elias') });
    I.add({ id: 'crawl_c17', who: 'jax', pos: v3(12.7, 0, -7.4), radius: 1.2, label: 'Crawl into the chase', icon: 'climb', enabled: () => this.flags.phase === 'cells' && !!this.flags.vent_jax, onUse: () => this.crawlVent('jax') });
    // Hatch: both lift
    const hx = (HATCH.x1 + HATCH.x2) / 2, hz = (HATCH.z1 + HATCH.z2) / 2;
    I.add({ id: 'hatch_a', coop: 'hatch', role: 'a', pos: v3(hx, 0, hz - 1.0), radius: 1.1, label: 'Lift the hatch', icon: 'coop', mode: 'hold', holdTime: 1.6, pose: 'pick_low', facing: 0, stand: v3(hx - 0.1, 0, hz - 1.0),
      enabled: () => this.flags.phase === 'chase' && !this.flags.hatchOpen });
    I.add({ id: 'hatch_b', coop: 'hatch', role: 'b', pos: v3(hx, 0, hz + 0.95), radius: 1.1, label: 'Lift the hatch', icon: 'coop', mode: 'hold', holdTime: 1.6, pose: 'pick_low', facing: Math.PI, stand: v3(hx + 0.1, 0, hz + 0.95),
      enabled: () => this.flags.phase === 'chase' && !this.flags.hatchOpen });
    I.add({ id: 'hatch_down', pos: v3(hx, 0, hz - 0.2), radius: 1.3, label: 'Climb down the shaft', icon: 'climb', priority: 2,
      enabled: () => !!this.flags.hatchOpen && this.g.local.body.pos.y > -0.5, onUse: () => this.climbShaft(true) });
    // Valves: keep holding to shut off the steam
    I.add({ id: 'valve1', pos: v3(14.6, TY, 0.5), radius: 1.1, label: 'Hold the valve shut', icon: 'hand', mode: 'hold', holdTime: Infinity, pose: 'use', poseCtx: { k: { height: 1.15 } }, facing: -Math.PI / 2,
      enabled: () => this.flags.phase === 'tunnel', onHold: (on) => g.session.request('valve', { v: 1, on }) });
    I.add({ id: 'valve2', pos: v3(15.8, TY, 6.6), radius: 1.1, label: 'Hold the valve shut', icon: 'hand', mode: 'hold', holdTime: Infinity, pose: 'use', poseCtx: { k: { height: 1.15 } }, facing: Math.PI / 2,
      enabled: () => this.flags.phase === 'tunnel', onHold: (on) => g.session.request('valve', { v: 2, on }) });
    // Grate: Jax holds, Elias unscrews (timed co-op)
    I.add({ id: 'grate_hold', who: 'jax', coop: 'grate', role: 'holder', pos: v3(15.6, TY, 15.0), radius: 1.2, label: 'Hold the grate steady', icon: 'coop', mode: 'hold', holdTime: 3.5, pose: 'push', facing: 0, stand: v3(15.6, TY, 15.05),
      enabled: () => this.flags.phase === 'tunnel' && !this.flags.grateOpen });
    I.add({ id: 'grate_bolts', who: 'elias', coop: 'grate', role: 'bolts', pos: v3(14.6, TY, 15.0), radius: 1.2, label: 'Unscrew the bolts', icon: 'tool', mode: 'hold', holdTime: 3.5, pose: 'use', poseCtx: { k: { height: 0.9 } }, facing: 0, stand: v3(14.6, TY, 15.1),
      enabled: () => this.flags.phase === 'tunnel' && !this.flags.grateOpen });
    // Drain: push up (loud), then climb out
    const dx = (DRAIN.x1 + DRAIN.x2) / 2, dz = (DRAIN.z1 + DRAIN.z2) / 2;
    I.add({ id: 'drain_push', pos: v3(dx, TY, dz), radius: 1.3, label: 'Push the drain grate open', icon: 'hand',
      enabled: () => this.flags.phase === 'tunnel' && !!this.flags.grateOpen && !this.flags.drainOpen, onUse: () => g.session.request('drainOpen', {}) });
    I.add({ id: 'drain_up', pos: v3(dx, TY, dz), radius: 1.3, label: 'Climb out', icon: 'climb', priority: 1,
      enabled: () => !!this.flags.drainOpen && this.g.local.body.pos.y < -1, onUse: () => this.climbDrain() });
    // Scaffold
    I.add({ id: 'sc_give', coop: 'scaff', role: 'giver', pos: v3(2.3, 0, 41.9), radius: 1.3, label: 'Give a boost', icon: 'coop', mode: 'hold', pose: 'boost_give', facing: 0, stand: v3(2.3, 0, 41.95),
      enabled: () => this.flags.phase === 'yard' && !this.flags.firstUp, onHold: (on) => { this.scaffRole = on ? 'giver' : null; } });
    I.add({ id: 'sc_climb', coop: 'scaff', role: 'climber', pos: v3(2.3, 0, 41.3), radius: 1.3, label: 'Climb onto the scaffolding', icon: 'climb', mode: 'hold', facing: 0, stand: v3(2.3, 0, 41.3),
      enabled: () => this.flags.phase === 'yard' && !this.flags.firstUp, onHold: (on) => { this.scaffRole = on ? 'climber' : null; } });
    I.add({ id: 'sc_ladder', pos: v3(SCAFF.x1 - 0.5, P1Y, 42.9), radius: 1.2, label: 'Lower the ladder', icon: 'hand', facing: Math.PI,
      enabled: () => !!this.flags.firstUp && !this.flags.ladderDown, onUse: () => g.session.request('ladderDown', {}) });
    I.add({ id: 'sc_up1', pos: v3(SCAFF.x1 - 0.45, 0, 41.85), radius: 1.1, label: 'Climb the ladder', icon: 'climb',
      enabled: () => !!this.flags.ladderDown && this.g.local.body.pos.y < 1, onUse: () => this.climb([v3(SCAFF.x1 - 0.45, 0, 41.95), v3(SCAFF.x1 - 0.45, P1Y, 42.1), v3(SCAFF.x1 - 0.6, P1Y, 42.9)], 0) });
    I.add({ id: 'sc_up2', pos: v3(SCAFF.x0 + 0.45, P1Y, 43.1), radius: 1.1, label: 'Climb to the top level', icon: 'climb',
      enabled: () => this.flags.phase === 'yard' && Math.abs(this.g.local.body.pos.y - P1Y) < 0.5, onUse: () => this.climb([v3(SCAFF.x0 + 0.45, P1Y, 43.2), v3(SCAFF.x0 + 0.45, P2Y, 43.2), v3(SCAFF.x0 + 0.9, P2Y, 42.9)], 0) });
    I.add({ id: 'sc_blanket', who: 'elias', pos: v3(3.4, P2Y, 43.2), radius: 1.3, label: 'Throw the blanket over the wire', icon: 'hand', facing: 0,
      enabled: () => this.flags.phase === 'yard' && !this.flags.blanket && Math.abs(this.g.local.body.pos.y - P2Y) < 0.5, onUse: () => g.session.request('blanket', {}) });
  }

  private crawlVent(who: CharacterId): void {
    const z = who === 'elias' ? -11.25 : -8.65;
    const g = this.g;
    g.local.runScript([
      { to: v3(12.9, 0, z + 0.6), dur: 0.5, yaw: Math.PI / 2 },
      { to: v3(13.6, 0, z), dur: 1.0, yaw: Math.PI / 2, pose: 'crawl', poseCtx: { k: { speed: 0.6 } }, anim: 0.6 },
      { to: v3(14.6, 0, z), dur: 1.4, yaw: Math.PI / 2, pose: 'crawl', poseCtx: { k: { speed: 0.6 } }, anim: 0.6 },
      { to: v3(15.2, 0, z + 0.3), dur: 0.7, yaw: 0, anim: 0.9 },
    ], () => g.session.request('inChase', { who }));
    g.audio.play('vent_crawl', { pos: v3(14, 0.4, z), volume: 0.55 });
  }

  private climbShaft(down: boolean): void {
    const g = this.g;
    const hx = (HATCH.x1 + HATCH.x2) / 2;
    if (!down) return;
    const ladderZ = HATCH.z2 - 0.4;
    g.local.runScript([
      { to: v3(hx, 0, ladderZ), dur: 0.5, yaw: 0 },
      { to: v3(hx, -1.6, ladderZ), dur: 1.3, yaw: 0, pose: 'climb', poseCtx: { points: { ledge: v3(hx, 0.1, HATCH.z2) }, k: { phase: 0.5 } } },
      { to: v3(hx, TY, ladderZ), dur: 1.3, yaw: 0, pose: 'climb', poseCtx: (t) => ({ points: { ledge: v3(hx, TY + 2.0 - t * 0.5, HATCH.z2) }, k: { phase: 0.5 + t * 0.4 } }) },
      { to: v3(hx + (g.localChar === 'elias' ? -0.4 : 0.4), TY, -4.0), dur: 1.0, anim: 1.1 },
    ], () => g.session.request('inTunnel', { who: g.localChar }));
    g.audio.play('metal_hit', { pos: v3(hx, -1, ladderZ), volume: 0.35 });
  }

  private climbDrain(): void {
    const g = this.g;
    const dx = (DRAIN.x1 + DRAIN.x2) / 2, dz = (DRAIN.z1 + DRAIN.z2) / 2;
    g.local.runScript([
      { to: v3(DRAIN.x2 - 0.4, TY, dz), dur: 0.4, yaw: Math.PI / 2 },
      { to: v3(DRAIN.x2 - 0.4, -1.4, dz), dur: 1.4, yaw: Math.PI / 2, pose: 'climb', poseCtx: { points: { ledge: v3(DRAIN.x2, 0.1, dz) }, k: { phase: 0.4 } } },
      { to: v3(dx, 0, dz + 0.4), dur: 1.0, yaw: 0, pose: 'climb', poseCtx: (t) => ({ points: { ledge: v3(dx, 0.1, dz + 0.5) }, k: { phase: 0.7 + t * 0.3 } }) },
      { to: v3(dx, 0, dz + 1.4), dur: 0.7, crouch: true, anim: 0.9 },
    ], () => { g.local.body.crouched = true; g.session.request('outDrain', { who: g.localChar }); });
  }

  private climb(pts: THREE.Vector3[], yaw: number): void {
    const g = this.g;
    const [a, b, c] = pts;
    g.local.runScript([
      { to: a, dur: 0.4, yaw },
      { to: b, dur: Math.max(1, Math.abs(b.y - a.y) * 0.55), yaw, pose: 'climb', poseCtx: (t) => ({ points: { ledge: v3(b.x, a.y + (b.y - a.y) * t + 1.6, b.z + 0.3) }, k: { phase: t } }) },
      { to: c, dur: 0.6, yaw, anim: 0.8 },
    ]);
    g.audio.play('metal_hit', { pos: a, volume: 0.25 });
  }

  // ================================================================== triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'steam_near', min: [14, TY - 1, -1.5], max: [16.4, TY + 2, 2.5], who: 'any', enabled: () => this.flags.phase === 'tunnel' });
    this.addTrigger({ id: 'water_near', min: [14, TY - 1, 7.5], max: [16.4, TY + 2, 9.5], who: 'any', enabled: () => this.flags.phase === 'tunnel' });
    this.addTrigger({ id: 'grate_near', min: [14, TY - 1, 13.6], max: [16.4, TY + 2, 15.5], who: 'any', enabled: () => this.flags.phase === 'tunnel' });
    this.addTrigger({ id: 'drain_near', min: [16.5, TY - 1, 20.4], max: [23.4, TY + 2, 22.6], who: 'any', enabled: () => this.flags.phase === 'tunnel' && !!this.flags.grateOpen });
    this.addTrigger({ id: 'scaff_near', min: [-2, -1, 41.2], max: [9, 3, 43.7], who: 'any', enabled: () => this.flags.phase === 'yard' });
    this.addTrigger({ id: 'top_both', min: [SCAFF.x0, P2Y - 0.4, SCAFF.z0 - 0.2], max: [SCAFF.x1, P2Y + 1.5, SCAFF.z1], who: 'both', enabled: () => this.flags.phase === 'yard' && !!this.flags.blanket });
    this.addTrigger({ id: 'river', min: [-80, -20, 104], max: [100, 10, 140], who: 'both', enabled: () => this.flags.phase === 'outside' });
  }

  onTrigger(id: string, _who: CharacterId | 'both'): void {
    if (!this.authority) return;
    switch (id) {
      case 'steam_near': this.say('steam'); setTimeout(() => this.say('steam_tip'), 6500); this.objective('Shut off the steam: one holds a valve while the other gets past', [15.2, TY + 1.2, 3.6]); break;
      case 'water_near': this.say('water'); break;
      case 'grate_near': this.say('grate'); this.objective('Hold the grate and unscrew the bolts together', [15.2, TY + 1.2, 15.6]); break;
      case 'drain_near': this.say('shift'); setTimeout(() => this.say('drain_loud'), 9000); this.objective('Push open the drain grate — wait until the guard is far away', [22.5, TY + 1.5, 22]); break;
      case 'scaff_near': this.say('scaff'); setTimeout(() => this.say('boost_tip'), 5000); this.objective('Climb the scaffolding: boost your partner, then lower the ladder', [3.5, 2.5, 42.6]); break;
      case 'top_both': this.cutscene('cs2_wall'); break;
      case 'river': this.cutscene('cs2_river'); break;
    }
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    C.cs2_intro = {
      id: 'cs2_intro', music: 'music_night',
      start: () => {
        placeChar(g, 'elias', v3(13.0, 0.55, -10.6), Math.PI);
        placeChar(g, 'jax', v3(13.0, 0.55, -8.0), Math.PI);
        poseChar(g, 'elias', 'lying');
        poseChar(g, 'jax', 'lying');
        npcPlace(g, 'vance', v3(9.4, 0, -14), Math.PI / 2);
      },
      beats: [
        { dur: 5, fade: 'in', shot: () => shot(v3(-6, 6.5, 2), v3(9.5, 1, -12), 5, { fov: 46, toEnd: v3(9.5, 1, -10) }),
          lines: [{ who: 'narrator', text: 'Redmoor. 2:04 a.m.', dur: 3 }] },
        { dur: 4.5, shot: () => shot(v3(12.3, 1.3, -12.0), v3(13.0, 0.7, -10.6), 4.5, { fov: 34, fromEnd: v3(12.3, 1.2, -11.6) }),
          run: () => { poseChar(g, 'elias', null); placeChar(g, 'elias', v3(12.6, 0, -10.1), Math.PI * 0.6); g.audio.play('metal_hit', { pos: v3(14, 1, -9.6), volume: 0.3 }); },
          lines: [{ who: 'elias', text: '(two knocks on the wall)', dur: 2 }] },
        { dur: 4, shot: () => shot(v3(12.3, 1.3, -6.5), v3(13.0, 0.7, -8.0), 4, { fov: 34 }),
          run: () => { poseChar(g, 'jax', null); placeChar(g, 'jax', v3(12.6, 0, -7.4), Math.PI * 0.6); g.audio.play('metal_hit', { pos: v3(14, 1, -9.6), volume: 0.3, delay: 0.6 }); },
          lines: [{ who: 'jax', text: '(two knocks back) ...Let\'s go, professor.', dur: 3 }] },
        { dur: 4, shot: () => shot(v3(7.5, 1.6, -15.0), v3(9.4, 1.3, -11.0), 4, { fov: 40 }),
          lines: [{ who: 'elias', text: 'Vance walks the row every few minutes. Wait for his light to pass.', dur: 3.6 }] },
      ],
      end: () => {
        clipChar(g, 'elias', null);
        if (this.authority) this.objective('Wait for Vance to pass, then open the vent behind your bunk');
      },
    };
    C.cs2_tunnel = {
      id: 'cs2_tunnel',
      start: () => { placeChar(g, 'elias', v3(15.0, TY, -4.2), 0); placeChar(g, 'jax', v3(15.5, TY, -3.2), 0.3); },
      beats: [
        { dur: 4, shot: () => shot(v3(15.2, TY + 1.6, 4), v3(15.2, TY + 1.0, -4), 4, { fov: 44, fromEnd: v3(15.2, TY + 1.5, 2) }) },
        { shot: () => shot(v3(14.6, TY + 1.55, -0.6), v3(15.3, TY + 1.35, -3.8), 16, { fov: 40, fromEnd: v3(14.7, TY + 1.5, -1.2) }), lines: [
          { who: 'jax', text: 'You\'ve been digging?', anim: 'talk' },
          { who: 'elias', text: 'Not me. A hundred years of rain did the digging. They bricked these drains up in the sixties.' },
          { who: 'elias', text: 'They didn\'t do a very good job.' },
          { who: 'jax', text: 'Lucky us.' },
        ] },
      ],
      end: () => { if (this.authority) this.objective('Follow the old storm tunnel north', [15.2, TY + 1.2, 3.6]); },
    };
    C.cs2_wall = {
      id: 'cs2_wall', music: 'music_chase', skippable: false,
      start: () => {
        placeChar(g, 'elias', v3(3.0, P2Y, 43.1), 0);
        placeChar(g, 'jax', v3(4.0, P2Y, 43.0), 0);
      },
      beats: [
        { dur: 3.2, shot: () => shot(v3(3.5, P2Y + 0.6, 39.5), v3(3.5, P2Y + 1.4, 43.4), 3.2, { fov: 42 }),
          run: () => {
            run(g, 'elias', [{ to: v3(3.0, 6.1, 43.75), dur: 1.4, yaw: 0, pose: 'climb', poseCtx: { points: { ledge: v3(3.0, 6.1, 44) }, k: { phase: 0.8 } } }, { to: v3(3.0, 6.15, 44.0), dur: 1.2, yaw: 0, crouch: true }]);
            run(g, 'jax', [{ to: v3(4.0, 6.1, 43.75), dur: 1.6, yaw: 0, pose: 'climb', poseCtx: { points: { ledge: v3(4.0, 6.1, 44) }, k: { phase: 0.8 } } }, { to: v3(4.0, 6.15, 44.0), dur: 1.2, yaw: 0, crouch: true }]);
          } },
        { dur: 2.6, shot: () => shot(v3(10, 7.5, 50), v3(3.5, 6.2, 44), 2.6, { fov: 38 }),
          run: () => { const s = this.searchlights[0]; s.track = v3(3.5, 6.2, 44); s.period = 6; },
          lines: [{ who: 'towerguard', text: 'ON THE WALL! NORTH WALL!', dur: 2 }] },
        { dur: 2.4, shot: () => closeUp(g, 'jax', 2.4, 1.0, 0.3, { fov: 34 }),
          run: () => { g.audio.play('alarm_loop', { bus: 'sfx', volume: 0.6, loop: true }); g.audio.gunshot(v3(19, 8, 38), 0.8, true); },
          lines: [{ who: 'jax', text: 'Jump!', dur: 1.4 }] },
        { dur: 2.0, shot: () => shot(v3(8, 1.0, 52), v3(3.5, 3.0, 45), 2.0, { fov: 46 }),
          run: () => {
            run(g, 'elias', [{ to: v3(3.0, 1.0, 46.6), dur: 0.7, yaw: 0, arc: 0.6, pose: 'knockdown' }, { to: v3(3.0, -0.9, 47.5), dur: 0.5, yaw: 0, pose: 'kneel' }]);
            run(g, 'jax', [{ to: v3(4.6, 1.0, 46.9), dur: 0.8, yaw: 0, arc: 0.6, pose: 'knockdown' }, { to: v3(4.6, -0.9, 47.8), dur: 0.5, yaw: 0, pose: 'kneel' }]);
            g.audio.play('land', { pos: v3(3.5, -0.5, 47), volume: 0.8, delay: 1.1 });
          } },
      ],
      end: () => {
        poseChar(g, 'elias', null);
        poseChar(g, 'jax', null);
        if (this.authority) {
          this.saveCheckpoint('outside');
          g.session.emit('restart', { checkpoint: 'outside' });
        }
      },
    };
    C.cs2_river = {
      id: 'cs2_river', music: 'music_sad', skippable: true,
      start: () => {
        const e = g.body('elias').pos, j = g.body('jax').pos;
        const ex = THREE.MathUtils.clamp(e.x, -30, 50), jx = THREE.MathUtils.clamp(j.x, -30, 50);
        const ez = distToPath(ex, 100, RIVER).d; void ez;
        placeChar(g, 'elias', v3(ex, this.terrain.height(ex, 106), 106), 0);
        placeChar(g, 'jax', v3(ex + 1.4, this.terrain.height(ex + 1.4, 106.3), 106.3), 0);
        void jx;
      },
      beats: [
        { dur: 3, shot: () => { const p = g.body('elias').pos; return shot(v3(p.x + 4, p.y + 1.5, p.z + 8), v3(p.x + 0.7, p.y + 1.3, p.z), 3, { fov: 40 }); },
          run: () => { for (let i = 0; i < 4; i++) setTimeout(() => g.audio.gunshot(v3(19, 8, 38), 0.7, true), i * 550); },
          lines: [{ who: 'elias', text: 'Can you swim?', dur: 1.8 }, { who: 'jax', text: 'Guess we\'re about to find out.', dur: 2 }] },
        { dur: 2.2, shot: () => { const p = g.body('elias').pos; return shot(v3(p.x - 6, p.y + 0.6, p.z + 12), v3(p.x, p.y, p.z + 9), 2.2, { fov: 44 }); },
          run: () => {
            for (const c of ['elias', 'jax'] as CharacterId[]) {
              const p = g.body(c).pos.clone();
              run(g, c, [{ to: v3(p.x, p.y, p.z + 5), dur: 0.8, anim: 5 }, { to: v3(p.x, RIVER_Y - 0.2, p.z + 9.5), dur: 0.7, arc: 1.2, yaw: 0 }]);
            }
            setTimeout(() => { g.audio.play('splash', { volume: 0.9 }); g.world.particles.emit('splash', g.body('elias').pos.clone().setY(RIVER_Y + 0.2), 40); }, 1400);
          } },
        { dur: 3.5, fade: 'out', shot: () => { const p = g.body('elias').pos; return shot(v3(p.x + 12, RIVER_Y + 3, p.z + 2), v3(p.x + 30, RIVER_Y, p.z + 4), 3.5, { fov: 40 }); },
          lines: [{ who: 'narrator', text: 'The river carried them east, past the lights, into the dark.', dur: 3.2 }] },
      ],
      end: () => {
        g.audio.stopMusic(2);
        if (this.authority) g.session.emit('chapterEnd', { next: 3 });
      },
    };
  }

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    const P = this.P;
    g.flags.combat = false;
    g.flags.jump = false;
    g.local.crawlMode = false;
    for (const c of P.cells) this.setDoorNow(c.id, 0);
    for (const n of g.npcs.values()) { n.reset(); n.enabled = false; n.body.visible = false; n.body.solid = false; }
    for (const f of this.flash.values()) f.dispose();
    this.flash.clear();
    const on = (ids: string[]) => {
      for (const i of ids) {
        const n = g.npcs.get(i);
        if (!n) continue;
        n.enabled = true; n.body.visible = true; n.body.solid = true;
        if (n.def.role === 'guard' && i !== 'pruitt' && i !== 'towerguard') this.flash.set(i, new Flashlight(g.world, n.body, 11, 0.3));
      }
    };
    const sl = this.searchlights[0];
    sl.track = null; sl.period = 22; sl.on = true;
    this.searchlights[1].on = false;
    this.steamOn = true;
    this.spotT = { elias: 0, jax: 0 };
    // Physical state by progress
    const ph = id;
    this.flags.phase = ph === 'cells' ? 'cells' : ph === 'chase' ? 'chase' : ph === 'tunnel' ? 'tunnel' : ph === 'yard' ? 'yard' : 'outside';
    const past = (p: string) => ['cells', 'chase', 'tunnel', 'yard', 'outside'].indexOf(ph) > ['cells', 'chase', 'tunnel', 'yard', 'outside'].indexOf(p);
    if (ph === 'cells') { delete this.flags.vent_elias; delete this.flags.vent_jax; delete this.flags.in_elias; delete this.flags.in_jax; }
    if (!past('chase')) delete this.flags.hatchOpen; else this.flags.hatchOpen = true;
    if (!past('tunnel')) { delete this.flags.grateOpen; delete this.flags.drainOpen; delete this.flags.out_elias; delete this.flags.out_jax; delete this.flags.tun_elias; delete this.flags.tun_jax; }
    else { this.flags.grateOpen = true; this.flags.drainOpen = true; }
    if (ph !== 'outside') { delete this.flags.firstUp; delete this.flags.ladderDown; delete this.flags.blanket; }
    this.applyHatch(this.flags.hatchOpen ? 1 : 0, true);
    this.applyDrain(this.flags.drainOpen ? 1 : 0, true);
    this.applyGrate(this.flags.grateOpen ? 1 : 0, true);
    this.lowLadder.position.y = this.flags.ladderDown ? 0 : P1Y + 0.1;
    this.blanket.visible = !!this.flags.blanket || ph === 'outside';
    for (const [k, v] of P.ventCovers) v.visible = !(past('cells') && (k === 'C-16' || k === 'C-17'));
    this.setRain(ph === 'yard' || ph === 'outside');
    switch (ph) {
      case 'cells': on(['vance', 'pruitt']); break;
      case 'chase': on(['vance', 'pruitt']); break;
      case 'tunnel': break;
      case 'yard': on(['briggs', 'towerguard']); break;
      case 'outside':
        on(['towerguard']);
        sl.track = null; sl.period = 7;
        this.searchlights[1].on = true;
        g.audio.playMusic('music_chase', 1);
        g.flags.sprint = true;
        this.shotT = 2.5;
        break;
    }
    if (ph === 'tunnel' || ph === 'yard' || ph === 'outside') g.audio.playMusic(ph === 'outside' ? 'music_chase' : 'music_stealth', 2);
  }

  private setDoorNow(id: string, t: number): void {
    const d = this.doors.get(id);
    if (!d) return;
    d.t = d.target = t;
    this.applyDoor(d);
  }

  private setRain(on: boolean): void {
    if (on === this.rainOn) return;
    this.rainOn = on;
    const w = this.g.world;
    if (on) { w.particles.enableRain(this.g.cam.camera, 0.7); this.rainLoop = w.ambientLoop('rain_loop', 0.35); }
    else { w.particles.disableRain(); this.rainLoop?.stop(1); this.rainLoop = null; }
  }
  private rainLoop: import('../engine/audio').Sound | null = null;

  private applyHatch(t: number, now = false): void {
    if (now) this.hatchT = t;
    const h = this.P.hatch!;
    h.rotation.z = this.hatchT * 1.75;
    if (this.P.hatchCol) this.P.hatchCol.enabled = this.hatchT < 0.5;
  }
  private applyDrain(t: number, now = false): void {
    if (now) this.drainT = t;
    const d = this.P.drain!;
    d.rotation.z = this.drainT * 1.85;
    if (this.P.drainCol) this.P.drainCol.enabled = this.drainT < 0.5;
  }
  private applyGrate(t: number, now = false): void {
    if (now) this.grateT = t;
    this.grate.position.x = -this.grateT * 0.0;
    this.grate.position.z = this.grateT * 0.9;
    this.grate.rotation.x = -this.grateT * 1.35;
    this.grate.position.y = -this.grateT * 0.3;
    this.grateCol.enabled = this.grateT < 0.5;
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'ventOpen': {
        const who = a.who as CharacterId;
        this.flags[`vent_${who}`] = true;
        const cell = who === 'elias' ? 'C-16' : 'C-17';
        const v = this.P.ventCovers.get(cell);
        if (v) { v.visible = false; g.audio.play('metal_sheet', { pos: v.position, volume: 0.45 }); }
        if (this.authority && this.flags.vent_elias && this.flags.vent_jax && !this.flags.saidVents) { this.flags.saidVents = true; this.say('vents'); }
        if (this.authority) g.session.emit('objective', { text: 'Crawl through the vent into the maintenance chase', marker: null });
        return true;
      }
      case 'inChase': {
        this.flags[`in_${a.who}`] = true;
        if (this.authority && this.flags.in_elias && this.flags.in_jax) {
          g.session.emit('flag', { k: 'phase', v: 'chase' });
          this.saveCheckpoint('chase');
          this.say('in_chase');
          this.objective('Lift the maintenance hatch together at the north end of the chase', [15.2, 0.4, -5.8]);
        }
        return true;
      }
      case 'coop': {
        const group = String(a.group);
        if (group === 'hatch') {
          this.flags.hatchOpen = true;
          g.audio.play('metal_heavy', { pos: v3(15.2, 0.2, -5.8), volume: 0.7 });
          g.audio.play('creak', { pos: v3(15.2, 0.2, -5.8), volume: 0.6 });
          if (this.authority) this.objective('Climb down into the tunnel', [15.2, -1, -5.8]);
        }
        if (group === 'grate') {
          this.flags.grateOpen = true;
          g.audio.play('metal_slam', { pos: v3(15.2, TY + 1, 15.6), volume: 0.7 });
          g.audio.play('tools', { pos: v3(14.6, TY + 1, 15.4), volume: 0.5 });
          if (this.authority) this.objective('Find the way up', [22.5, TY + 1.5, 22]);
        }
        if (group === 'scaff') this.doScaffBoost();
        return true;
      }
      case 'inTunnel': {
        this.flags[`tun_${a.who}`] = true;
        if (this.authority && this.flags.tun_elias && this.flags.tun_jax && this.flags.phase === 'chase') {
          this.saveCheckpoint('tunnel');
          g.session.emit('flag', { k: 'phase', v: 'tunnel' });
          this.cutscene('cs2_tunnel');
        }
        return true;
      }
      case 'valve': {
        this.flags[`valve${a.v}`] = !!a.on;
        const off = !!this.flags.valve1 || !!this.flags.valve2;
        if (off !== !this.steamOn) {
          this.steamOn = !off;
          g.audio.play(off ? 'switch' : 'creak', { pos: v3(15.2, TY + 1.2, a.v === 1 ? 0.5 : 6.6), volume: 0.4 });
        }
        return true;
      }
      case 'drainOpen': {
        this.flags.drainOpen = true;
        const p = v3((DRAIN.x1 + DRAIN.x2) / 2, 0, (DRAIN.z1 + DRAIN.z2) / 2);
        g.audio.play('metal_slam', { pos: p, volume: 0.9 });
        if (this.authority) {
          g.world.addNoise(p, 15, 'drain', 'impact');
          this.objective('Climb out — keep low', [p.x, 0.6, p.z]);
        }
        return true;
      }
      case 'outDrain': {
        this.flags[`out_${a.who}`] = true;
        if (this.authority && this.flags.out_elias && this.flags.out_jax && this.flags.phase === 'tunnel') {
          g.session.emit('flag', { k: 'phase', v: 'yard' });
          this.saveCheckpoint('yard');
          g.session.emit('yardStart', {});
        }
        return true;
      }
      case 'yardStart': {
        this.setRain(true);
        g.audio.playMusic('music_stealth', 2);
        const n = g.npcs.get('briggs');
        if (n && !n.enabled) { n.enabled = true; n.body.visible = true; n.body.solid = true; this.flash.set('briggs', new Flashlight(g.world, n.body, 11, 0.3)); }
        const tg = g.npcs.get('towerguard');
        if (tg) { tg.enabled = true; tg.body.visible = true; }
        if (this.authority) { this.say('yard_in'); this.objective('Reach the scaffolding on the north wall — stay out of the searchlight', [3.5, 1.5, 42.6]); }
        return true;
      }
      case 'ladderDown':
        this.flags.ladderDown = true;
        g.audio.play('metal_hit', { pos: v3(SCAFF.x1, 1, 42.3), volume: 0.6 });
        if (this.authority) this.objective('Both climb to the top level of the scaffolding', [2.0, P2Y + 0.5, 43]);
        return true;
      case 'blanket':
        this.flags.blanket = true;
        this.blanket.visible = true;
        g.audio.play('whoosh', { pos: this.blanket.position, volume: 0.5 });
        if (this.authority) {
          this.say('blanket');
          this.objective('Get over the wall together', [3.4, 6.6, 44]);
        }
        return true;
      case 'shot': {
        const who = a.who as CharacterId;
        const tower = v3(19, 8.4, 38);
        g.audio.gunshot(tower, 0.9, g.body(who).pos.distanceTo(tower) > 40);
        const b = g.body(who);
        const p = v3(Number(a.x), 0, Number(a.z));
        p.y = this.groundY(p.x, p.z) + 0.05;
        if (!a.hit) {
          g.world.particles.emit('dust', p, 10);
          g.world.particles.emit('debris', p, 4);
          g.audio.play('hit_soft', { pos: p, volume: 0.35 });
        } else {
          g.world.particles.emit('debris', b.chest(), 6, undefined, { color: [0.45, 0.05, 0.04] });
          if (who === g.localChar) { g.local.takeHit(22, Math.atan2(tower.x - b.pos.x, tower.z - b.pos.z) + Math.PI, 'heavy'); g.cam.addShake(0.35); }
        }
        return true;
      }
      case 'restarted':
        if (this.authority && String(a.checkpoint) === 'outside') { this.say('outside'); setTimeout(() => this.say('downed_hint'), 6000); }
        return true;
      case 'spotted':
        if (this.authority && ['cells', 'chase', 'yard'].includes(String(this.flags.phase))) {
          const who = a.who as CharacterId;
          setTimeout(() => { if (g.state === 'playing') g.session.emit('caught', { who, by: a.npc }); }, 800);
        }
        return true;
      case 'flag':
        if (a.k === 'phase' && a.v === 'outside') this.setRain(true);
        return true;
    }
    return false;
  }

  private doScaffBoost(): void {
    const g = this.g;
    this.flags.firstUp = true;
    const role = this.scaffRole;
    this.scaffRole = null;
    g.audio.play('grunt', { pos: v3(2.3, 1, 42), volume: 0.5 });
    // Each client animates its own character; the partner follows through snapshots.
    if (role === 'climber') {
      g.local.endCoopHold();
      g.local.runScript([
        { to: v3(2.3, 0.9, 42.1), dur: 0.7, yaw: 0, pose: 'climb', poseCtx: { points: { ledge: v3(2.3, P1Y + 0.1, 42.5) }, k: { phase: 0.3 } } },
        { to: v3(2.3, P1Y, 42.7), dur: 1.1, yaw: 0, pose: 'climb', poseCtx: (t) => ({ points: { ledge: v3(2.3, P1Y + 0.1, 42.6) }, k: { phase: 0.4 + t * 0.6 } }) },
        { to: v3(2.6, P1Y, 43.0), dur: 0.5, anim: 0.8 },
      ]);
    } else if (role === 'giver') {
      g.local.endCoopHold();
      g.local.runScript([
        { to: v3(2.3, 0, 41.95), dur: 1.0, yaw: 0, pose: 'boost_give', poseCtx: (t) => ({ k: { lift: t } }) },
        { to: v3(2.3, 0, 41.9), dur: 0.6, yaw: 0 },
      ]);
    }
    if (this.authority) setTimeout(() => this.objective('Lower the ladder for your partner', [SCAFF.x1 - 0.5, P1Y + 0.5, 42.6]), 1500);
  }
  private scaffRole: 'giver' | 'climber' | null = null;

  validate(type: string, a: unknown): boolean {
    const args = (a ?? {}) as Record<string, unknown>;
    if (type === 'ventOpen') return this.flags.phase === 'cells' && !this.flags[`vent_${args.who}`];
    if (type === 'drainOpen') return !!this.flags.grateOpen && !this.flags.drainOpen;
    if (type === 'ladderDown') return !!this.flags.firstUp && !this.flags.ladderDown;
    if (type === 'blanket') return !this.flags.blanket;
    return true;
  }

  // ================================================================== frame
  /** Cheap zone culling: the outdoors can't be seen from inside the walls, and vice versa for the tunnel. */
  private updateVisibility(): void {
    const c = this.g.cam.camera.position;
    const indoors = c.y < -0.8 || (c.z < 6.2 && c.x > -14.5 && c.x < 16.4) || (c.z < -22 && c.z > -42.5);
    const outsideVisible = !indoors;
    if (this.terrain && this.terrain.group.visible !== outsideVisible) {
      this.terrain.group.visible = outsideVisible;
      if (this.foliage) this.foliage.group.visible = outsideVisible;
      for (const w of this.waters) w.mesh.visible = outsideVisible || w === this.floodWater;
      for (const s of this.searchlights) s.culled = !outsideVisible;
    }
  }
  private waters: Water[] = [];
  private floodWater: Water | null = null;

  update(dt: number): void {
    const g = this.g;
    this.updateVisibility();
    // Animate hatch/drain/grate/ladder toward their states.
    const ease = (cur: number, tgt: number, sp: number) => cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), dt * sp);
    const hT = this.flags.hatchOpen ? 1 : 0, dT = this.flags.drainOpen ? 1 : 0, gT = this.flags.grateOpen ? 1 : 0;
    if (this.hatchT !== hT) { this.hatchT = ease(this.hatchT, hT, 1.2); this.applyHatch(hT); }
    if (this.drainT !== dT) { this.drainT = ease(this.drainT, dT, 2.5); this.applyDrain(dT); }
    if (this.grateT !== gT) { this.grateT = ease(this.grateT, gT, 1.5); this.applyGrate(gT); }
    const ly = this.flags.ladderDown ? 0 : P1Y + 0.1;
    if (this.lowLadder.position.y !== ly) this.lowLadder.position.y = ease(this.lowLadder.position.y, ly, 4);
    // Crawl-height inside the shaft areas.
    // Steam
    if (this.flags.phase === 'tunnel') {
      this.steamT -= dt;
      if (this.steamOn && this.steamT <= 0) {
        this.steamT = 0.08;
        g.world.particles.emit('steam', v3(14.4 + Math.random() * 1.6, TY + 2.2, 3.6), 3, v3(0, -1, 0), { speed: 2.5 });
      }
      if (this.steamOn) {
        this.steamSound ??= g.audio.play('amb_fan', { pos: v3(15.2, TY + 2, 3.6), volume: 0.55, loop: true, rate: 1.8 });
        const p = g.local.body.pos;
        if (p.z > 3.0 && p.z < 4.2 && p.y < TY + 1 && !g.local.scripted && g.local.state === 'free') {
          g.local.takeHit(28, p.z < 3.6 ? Math.PI : 0, 'heavy');
          g.local.teleport(v3(p.x, p.y, p.z < 3.6 ? 2.4 : 4.8));
          g.audio.play('grunt', { pos: p, volume: 0.6 });
        }
      } else if (this.steamSound) { this.steamSound.stop(0.5); this.steamSound = null; }
    } else if (this.steamSound) { this.steamSound.stop(0.5); this.steamSound = null; }
    // Thunder during rain
    if (this.rainOn) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 18 + Math.random() * 20;
        g.audio.play('thunder', { bus: 'ambience', volume: 0.45 });
        const sun = g.world.sun;
        if (sun) { const base = sun.intensity; sun.intensity = 3.5; setTimeout(() => { sun.intensity = base; }, 120); }
      }
    }
    if (!this.authority) return;
    // Searchlight detection
    if (this.flags.phase === 'yard') {
      for (const c of ['elias', 'jax'] as CharacterId[]) {
        const b = g.body(c);
        const sl = this.searchlights[0];
        const lit = inSearchlight(sl, b.pos) && g.world.physics.lineOfSight(sl.pos, b.chest());
        this.spotT[c] = lit ? this.spotT[c] + dt : Math.max(0, this.spotT[c] - dt * 0.5);
        if (this.spotT[c] > 0.7 && g.state === 'playing') {
          this.spotT[c] = 0;
          g.session.emit('dlg', { lines: [{ who: 'towerguard', text: 'Light on the north side! Hold it right there!', dur: 2 } satisfies Line], at: g.session.sharedNow() });
          g.session.emit('caught', { who: c, by: 'searchlight' });
        }
      }
    }
    // Outside: the tower fires at whoever it can see.
    if (this.flags.phase === 'outside' && g.state === 'playing' && !g.inCutscene) {
      this.shotT -= dt;
      const sl = this.searchlights[0];
      // Track the nearest player with the tower light.
      const e = g.body('elias').pos, j = g.body('jax').pos;
      sl.track = (Math.sin(g.world.time * 0.3) > 0 ? e : j).clone();
      if (this.shotT <= 0) {
        this.shotT = 0.9 + Math.random() * 1.1;
        const who: CharacterId = Math.random() < 0.5 ? 'elias' : 'jax';
        const b = g.body(who);
        if (b.pos.z < 104 && !(who === g.localChar ? g.local.state === 'downed' : g.remote.downed)) {
          const tower = v3(19, 8.4, 38);
          const los = g.world.physics.lineOfSight(tower, b.chest());
          const lit = this.searchlights.some((s) => inSearchlight(s, b.pos));
          const chance = !los ? 0 : lit ? 0.3 : 0.08;
          const hit = Math.random() < chance;
          const miss = v3(b.pos.x + (Math.random() - 0.5) * 3, 0, b.pos.z + (Math.random() - 0.5) * 3);
          g.session.emit('shot', { who, hit, x: miss.x, z: miss.z });
        }
      }
    }
  }
  private steamSound: import('../engine/audio').Sound | null = null;

  lightAt(p: THREE.Vector3): number {
    let l = this.P.kit.lightLevel(p, 0.12);
    for (const f of this.flash.values()) l += coneLight(f, p);
    for (const s of this.searchlights) if (inSearchlight(s, p)) l += 1.2;
    return Math.min(1.5, l);
  }

  suspicion(who: CharacterId, p: THREE.Vector3, npc: string): number {
    const ph = this.flags.phase;
    if (ph === 'cells' && npc === 'vance') {
      // In bed is fine; out of bed (near the vent, at the bars) is suspicious.
      const b = this.g.body(who);
      if (b.poseName === 'lying') return 0;
      return p.x > 10.4 ? (b.poseName === 'kneel' ? 1.6 : 0.8) : 1.5;
    }
    if (ph === 'chase' && npc === 'vance') return 0; // walls block the chase anyway
    if (ph === 'yard') return 1.2;
    return ph === 'tunnel' ? 0 : 1;
  }

  dispose(): void {
    for (const f of this.flash.values()) f.dispose();
    for (const s of this.searchlights) s.dispose();
    this.setRain(false);
    this.steamSound?.stop(0);
  }
}
