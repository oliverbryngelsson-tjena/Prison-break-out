// Chapter 5 — The Garage. Crane Motors on Dock Street, near midnight. Victor Crane knows you're coming:
// two lookouts in the street, an ambush inside, Victor running out the back to the dock, the end of
// Victor Crane, his safe — and the police at the front door before you can leave by it.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, shot, closeUp, twoShot, ots, poseChar, npcPlace, lookChar } from './cs';
import { Car } from './vehicles';
import { BikeSystem } from '../game/bike';
import { cylinderBetween } from '../engine/geometry';
import type { NpcDef } from '../game/npc';

/** Garage shell (x0..x1, z0..z1), mezzanine height and the yard behind it. */
const G = { x0: 0, x1: 30, z0: 10, z1: 32, h: 7 };
const UPY = 3.4;
const MEZZ = { x0: 0, x1: 13.6, z0: 24, z1: 32 };
const STAIRS = { x: 13, z0: 16.4, z1: 24 };
const SIDE_DOOR = { x: 25.6, z: G.z0 };
const BACK_DOOR = { x: 26.6, z: G.z1 };
const SAFE = { x: 1.3, z: 30.4 };
const DOCK_Z = 58;
const BIKES: Record<CharacterId, { pos: [number, number, number]; yaw: number }> = {
  elias: { pos: [2.0, 0, 40.5], yaw: Math.PI * 0.85 },
  jax: { pos: [4.0, 0, 41.2], yaw: Math.PI * 0.85 },
};
const INSIDE = ['kessler', 'moreno1', 'moreno2', 'g4', 'g5', 'g6', 'g7'];
const OUTSIDE = ['look1', 'look2'];
const COPS = ['cop_a', 'cop_b', 'cop_c'];

export class Chapter5 extends Chapter {
  readonly num = 5;
  readonly title = 'The Garage';
  readonly subtitle = 'Crane Motors, Dock Street, 11:50 p.m.';
  music = 'music_tension';
  outfit: 'prison' | 'civil' = 'civil';
  kit!: Kit;
  bikes!: BikeSystem;
  private policeCars: Car[] = [];
  private siren: ReturnType<import('../engine/audio').AudioManager['siren']> = null;
  private money: THREE.Mesh | null = null;
  private safeDoor: THREE.Object3D | null = null;
  private nav!: import('../game/nav').NavGraph;
  /** Victor shoots back while he runs (authority timer). */
  private craneFireT = 0;

  readonly checkpoints: Record<string, CheckpointDef> = {
    street: { spawn: { elias: { pos: [-31, 0, 1.5], yaw: Math.PI / 2 }, jax: { pos: [-31.5, 0, 3.2], yaw: Math.PI / 2 } }, objective: 'Take out Crane\'s lookouts', intro: 'cs5_arrive', outfit: 'civil' },
    shootout: { spawn: { elias: { pos: [SIDE_DOOR.x - 0.6, 0, G.z0 + 1.6], yaw: 0 }, jax: { pos: [SIDE_DOOR.x + 0.7, 0, G.z0 + 1.2], yaw: 0 } }, objective: 'Kill Crane\'s men', outfit: 'civil' },
    chase: { spawn: { elias: { pos: [STAIRS.x - 1.2, 0, STAIRS.z0 - 1], yaw: 0.6 }, jax: { pos: [STAIRS.x + 1.2, 0, STAIRS.z0 - 1.4], yaw: 0.6 } }, objective: 'Don\'t let Crane get away!', outfit: 'civil' },
    safe: { spawn: { elias: { pos: [SAFE.x + 2.2, UPY, SAFE.z - 1.6], yaw: -Math.PI / 2 }, jax: { pos: [SAFE.x + 3.2, UPY, SAFE.z - 2.6], yaw: -Math.PI / 2 }, }, objective: 'Open Crane\'s safe — together', outfit: 'civil' },
    escape: { spawn: { elias: { pos: [BACK_DOOR.x - 1, 0, BACK_DOOR.z + 2], yaw: Math.PI }, jax: { pos: [BACK_DOOR.x + 1, 0, BACK_DOOR.z + 2.5], yaw: Math.PI } }, objective: 'Get to Crane\'s dirt bikes in the yard!', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: true, sprint: true, combat: true, crouch: true };
    const d = this.npcDefs;
    const gunman = (id: string, char: string, name: string, pos: [number, number, number], yaw: number, w: string, extra: Partial<NpcDef> = {}) =>
      d.push({ id, char, role: 'thug', name, pos, yaw, hostile: true, hp: 60, vision: { range: 22, fov: 120 }, walk: 1.1, run: 3.4, loco: 'normal',
        gun: { w, dmg: w === 'shotgun' ? 18 : w === 'ak47' ? 11 : 9, rate: w === 'smg' ? 0.9 : w === 'shotgun' ? 2.0 : 1.5, acc: w === 'shotgun' ? 0.55 : 0.45, range: w === 'shotgun' ? 12 : 24 }, ...extra });
    // Lookouts in the street.
    gunman('look1', 'thug3', 'Lookout', [4, 0, 4], -Math.PI / 2, 'pistol', { patrol: [[4, 4, 3, -Math.PI / 2], [18, 5, 2], [28, 4, 3, Math.PI / 2], [18, 5, 2]], vision: { range: 15, fov: 100 } });
    gunman('look2', 'thug2', 'Lookout', [27.8, 0, 8.4], Math.PI, 'smg', { idleClip: 'idle_look', vision: { range: 15, fov: 100 } });
    // The ambush inside.
    gunman('kessler', 'bodyguard', 'Kessler', [9.5, UPY, 24.6], Math.PI, 'ak47', { hp: 170, noTakedown: true });
    gunman('moreno1', 'thug1', 'Moreno', [6, 0, 19.2], Math.PI, 'smg');
    gunman('moreno2', 'thug2', 'Moreno', [18.5, 0, 28], Math.PI, 'shotgun', { hp: 75 });
    gunman('g4', 'thug3', 'Crane\'s man', [3.2, 0, 13.8], Math.PI / 2, 'm4');
    gunman('g5', 'dealer', 'Crane\'s man', [20.5, 0, 22.6], Math.PI, 'pistol');
    gunman('g6', 'thug1', 'Crane\'s man', [11.5, 0, 29], Math.PI, 'ak47');
    gunman('g7', 'thug2', 'Crane\'s man', [28.4, 0, 29.6], -Math.PI * 0.8, 'smg');
    // Victor himself (not a target until he runs).
    d.push({ id: 'crane', char: 'crane', role: 'story', name: 'Victor Crane', pos: [7, UPY, 24.7], yaw: Math.PI, passive: true, hp: 110, run: 4.0, loco: 'normal', noTakedown: true, gun: { w: 'shotgun', dmg: 14, rate: 2.2, acc: 0.25, range: 14 } });
    // Police at the end: they don't shoot, they catch.
    for (const [i, id] of COPS.entries()) d.push({ id, char: ['cop1', 'cop2', 'cop3'][i], role: 'police', name: 'Officer', pos: [SIDE_DOOR.x + i * 0.8 - 0.8, 0, 4 - i], yaw: 0, hostile: false, catches: true, vision: { range: 30, fov: 160 }, run: 4.6, loco: 'guard' });
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.lookouts_down = [{ who: 'jax', text: 'Street\'s clear. Side door.', dur: 2.2 }];
    D.fight_tip = [{ who: 'narrator', text: 'Hold Shoot to keep firing. Stay behind cover — crouch behind cars and benches.', dur: 4.2 }];
    D.half = [{ who: 'elias', text: 'Half of them down! Keep moving!', dur: 2.2 }];
    D.kessler = [{ who: 'kessler', text: 'Mr. Crane pays me to keep you off those stairs!', dur: 2.8 }];
    D.crane_taunt = [{ who: 'crane', text: 'Thirty years I built this! You think two convicts take it from me?', dur: 3.4 }];
    D.crane_cornered = [{ who: 'crane', text: 'Stay back! STAY BACK!', dur: 1.8 }];
    D.police = [{ who: 'radio', text: 'All units, shots fired at Crane Motors, Dock Street. Approach with caution.', radio: true, dur: 3.8 }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/night_city.hdr', envIntensity: 0.18, background: 0x07090d,
      fog: { color: 0x0b0e14, density: 0.018 },
      hemi: { sky: 0x3a4a68, ground: 0x14110e, intensity: 0.75 },
      sun: { color: 0x9ab2e0, intensity: 0.6, dir: [-0.3, 0.8, 0.5], shadows: true },
      grade: { saturation: 0.85, contrast: 1.1, lift: [0.0, 0.004, 0.012], gain: [1.02, 1.0, 1.0], shadowTint: [0.9, 0.96, 1.12], highlightTint: [1.1, 1.0, 0.88], exposure: 1.4, bloom: 1.1, vignette: 0.55 },
      reverb: 0.45,
    });
    this.kit = new Kit(w);
    await this.buildStreet();
    await this.buildGarage();
    await this.buildYard();
    this.kit.initLightPool(Math.max(2, g.deps.renderer.q.maxLights - 1));
    this.kit.finish();
    // Nav: street, garage floor, mezzanine, yard.
    const NavGraph = (await import('../game/nav')).NavGraph;
    this.nav = new NavGraph(w.physics);
    for (const [x, z] of [[-20, 2], [-6, 2], [6, 3], [18, 3], [28, 3], [38, 2], [SIDE_DOOR.x, 8.5], [SIDE_DOOR.x, 11.8], [27, 14], [22, 16], [16, 13], [9, 13], [3, 16], [3, 22], [9, 22.5], [16, 22], [24, 22], [28, 25], [24, 30], [16, 30.5], [7, 26.5], [BACK_DOOR.x, 30.5], [BACK_DOOR.x, 34], [20, 38], [10, 42], [4, 47], [14, 50], [26, 46], [32, 40]] as const) this.nav.add(x, 0, z);
    for (const [x, z] of [[3, 25], [9, 25], [12.8, 25]] as const) this.nav.add(x, UPY, z);
    this.nav.autoLink(14, 0.6);
    g.setNav(this.nav);
    this.bikes = new BikeSystem(g);
    await this.bikes.init({ headlights: true });
    this.bikes.ctrl.onCrash = () => { /* a few metres in the yard: crashes just stop the bike */ };
    for (let i = 0; i < 3; i++) {
      const c = await Car.create(w, { police: true, collider: false });
      c.root.visible = false;
      this.policeCars.push(c);
    }
    w.ambientLoop('amb_water', 0.3, v3(15, -1, DOCK_Z + 6));
    w.ambientLoop('amb_wind', 0.15);
    w.tickers.add((dt, t) => {
      this.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      for (const c of this.policeCars) c.update(t);
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
  }

  // ------------------------------------------------------------------ Dock Street
  private async buildStreet(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [asphalt, paving, brick, conc, steel] = await Promise.all([
      L.pbr('asphalt', { scale: 0.12 }), L.pbr('paving', { scale: 0.3, color: 0x9a968e }), L.pbr('brick_red', { scale: 0.35, color: 0x9a8070 }),
      L.pbr('concrete_wall', { scale: 0.3, color: 0x8a8680 }), L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
    ]);
    kit.floor(asphalt, -70, -6, 70, 6, 0, 0.2, 'asphalt');
    kit.floor(paving, -70, 6, 70, G.z0, 0.02, 0.2, 'concrete');
    kit.floor(paving, -70, -12, 70, -6, 0.02, 0.2, 'concrete');
    // Warehouses across the street and either side of the garage (solid blocks).
    for (const [x0, x1, h] of [[-70, -42, 12], [-40, -14, 9], [-12, 18, 14], [20, 44, 10], [46, 70, 13]] as const) kit.box(brick, [(x0 + x1) / 2, h / 2, -18], [x1 - x0 - 0.6, h, 12], 0, { surface: 'concrete' });
    for (const [x0, x1, h] of [[-70, -36, 11], [-34, -4, 9], [36, 70, 12]] as const) kit.box(conc, [(x0 + x1) / 2, h / 2, 21], [x1 - x0 - 0.6, h, 22], 0, { surface: 'concrete' });
    // Lit windows here and there so the street reads at night.
    const winA = L.emissive(0xffcf8a, 1.4), winB = L.emissive(0xbfd4ff, 0.9);
    const rnd = kit.rand(55);
    for (let x = -66; x < 68; x += 4.5) for (const fl of [3.2, 6.4]) {
      if (rnd() < 0.55) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), rnd() < 0.7 ? winA : winB);
      m.position.set(x + rnd(), fl, -11.95);
      w.root.add(m);
    }
    // Street lights (pool lights) and a dumpster to start behind.
    for (const x of [-50, -26, -2, 22, 46]) {
      kit.batch.add(cylinderBetween(v3(x, 0, 6.6), v3(x, 6, 6.6), 0.09, 8), steel);
      kit.batch.add(cylinderBetween(v3(x, 6, 6.6), v3(x, 6, 5.2), 0.06, 6), steel);
      kit.box(L.emissive(0xffcf8a, 3.2), [x, 5.92, 5.1], [0.5, 0.12, 0.3], 0, false);
      kit.fixtures.push({ pos: v3(x, 5.7, 5.1), color: new THREE.Color(0xffc98a), intensity: 16, range: 15, on: true, zone: 'street' });
    }
    const dumpster = await w.model('dumpster');
    kit.place(dumpster, [-27.5, 0, 4.2], Math.PI / 2);
    w.physics.addBox({ x: -27.5, y: 0.75, z: 4.2 }, { x: 1.95, y: 1.5, z: 1.2 }, Math.PI / 2, { surface: 'metal' });
    // Parked cars along the curb (cover for the lookout fight).
    const sedan = await w.model('sedan');
    for (const [x, yaw] of [[-12, 0.02], [10, -0.03], [36, 0.04]] as const) {
      kit.place(sedan, [x, 0, 7.6], Math.PI / 2 + yaw);
      w.physics.addBox({ x, y: 0.75, z: 7.6 }, { x: 5.0, y: 1.5, z: 1.9 }, yaw, { surface: 'metal' });
    }
  }

  // ------------------------------------------------------------------ Crane Motors
  private async buildGarage(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [wall, floor, steel, planks, corr] = await Promise.all([
      L.pbr('concrete_wall', { scale: 0.3, color: 0x9a968c }), L.pbr('concrete_floor', { scale: 0.25, color: 0x6a6660 }),
      L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }), L.pbr('planks', { scale: 0.6, color: 0x7a5a3a }),
      L.pbr('corrugated', { scale: 0.6, color: 0x8a8e90, metalness: 0.4, roughness: 0.55 }),
    ]);
    const { x0, x1, z0, z1, h } = G;
    kit.floor(floor, x0, z0, x1, z1, 0.04, 0.2, 'concrete');
    // Front wall: roller door (closed) and the side door; back wall with the back door.
    kit.wall(wall, x0, z0, x1, z0, 0, h, 0.3, [{ at: 11, width: 6, bottom: 0, top: 4.6 }, { at: SIDE_DOOR.x - x0, width: 1.2, bottom: 0, top: 2.2 }]);
    kit.box(corr, [x0 + 11, 2.3, z0 + 0.05], [6, 4.6, 0.12], 0, { surface: 'metal' }); // roller door
    kit.wall(wall, x1, z1, x0, z1, 0, h, 0.3, [{ at: x1 - BACK_DOOR.x, width: 1.2, bottom: 0, top: 2.2 }]);
    kit.wall(wall, x0, z1, x0, z0, 0, h, 0.3);
    kit.wall(wall, x1, z0, x1, z1, 0, h, 0.3);
    kit.ceiling(corr, x0, z0, x1, z1, h, 0.25);
    kit.textSign(['CRANE MOTORS', 'REPAIRS · PARTS · TOWING'], [x0 + 11, 5.6, z0 - 0.2], 9, Math.PI, '#1b2430', '#e8d6a0');
    // Mezzanine with Victor's office; stairs up from the shop floor; railings.
    kit.slab(planks, MEZZ.x0, MEZZ.z0, MEZZ.x1, MEZZ.z1, UPY, 0.2, 'wood');
    for (const x of [3, 7, 11]) kit.batch.add(cylinderBetween(v3(x, 0, MEZZ.z0 + 0.2), v3(x, UPY, MEZZ.z0 + 0.2), 0.1, 8), steel);
    kit.stairs(steel, STAIRS.x, STAIRS.z0, 0, 1.2, 0, UPY, STAIRS.z1 - STAIRS.z0);
    kit.railing(steel, MEZZ.x0, MEZZ.z0, STAIRS.x - 0.65, MEZZ.z0, UPY);
    kit.railing(steel, MEZZ.x1, MEZZ.z0 + 0.6, MEZZ.x1, MEZZ.z1, UPY);
    // Office: walls with a doorway and a window onto the shop floor.
    kit.wall(wall, 0, 25.2, 9, 25.2, UPY, 3.2, 0.15, [{ at: 6.6, width: 1.1, bottom: 0, top: 2.2 }, { at: 3, width: 3, bottom: 1.0, top: 2.2 }]);
    kit.wall(wall, 9, 25.2, 9, z1, UPY, 3.2, 0.15);
    kit.box(L.plain(0x3a2a1e, 0.6), [4.2, UPY + 0.4, 29.6], [2.2, 0.8, 1.0], 0, { surface: 'wood' }); // desk
    const chair = await w.model('office_chair');
    kit.place(chair, [4.2, UPY, 30.6], Math.PI);
    // The safe: a heavy steel box with a door that swings open.
    kit.box(L.plain(0x3c4044, 0.45, 0.7), [SAFE.x, UPY + 0.55, SAFE.z], [0.9, 1.1, 0.9], 0, { surface: 'metal' });
    const pivot = new THREE.Group();
    pivot.position.set(SAFE.x + 0.45, UPY + 0.55, SAFE.z - 0.42);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.8), L.plain(0x4a4e52, 0.4, 0.75));
    door.position.set(0.03, 0, 0.42);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), L.plain(0xb8b0a0, 0.3, 0.8));
    dial.rotation.z = Math.PI / 2; dial.position.set(0.07, 0.1, 0.42);
    pivot.add(door, dial);
    pivot.rotation.y = 0;
    w.root.add(pivot);
    this.safeDoor = pivot;
    this.money = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.35), L.plain(0x2a3a2a, 0.9));
    this.money.position.set(SAFE.x, UPY + 0.35, SAFE.z);
    this.money.visible = false;
    w.root.add(this.money);
    // Cover on the shop floor: cars, benches, barrels, crates, tyres.
    const [sedan, barrels, crate, tire] = await Promise.all([w.model('sedan'), w.model('oil_barrels'), w.model('crate'), w.model('tire')]);
    for (const [x, z, yaw] of [[6, 16.6, Math.PI / 2], [20.5, 19.4, 0.25]] as const) {
      kit.place(sedan, [x, 0.04, z], yaw);
      w.physics.addBox({ x, y: 0.75, z }, { x: 1.9, y: 1.5, z: 5.0 }, yaw, { surface: 'metal' });
    }
    const bench = L.plain(0x3a3e44, 0.6, 0.4);
    for (const [x, z, yaw] of [[27.6, 15.5, Math.PI / 2], [27.6, 26.5, Math.PI / 2], [2.6, 11.6, 0], [15.5, 26.6, 0]] as const) {
      kit.box(bench, [x, 0.48, z], [2.4, 0.96, 0.85], yaw, { surface: 'metal' });
      kit.box(steel, [x, 1.5, z + (yaw ? 0 : 0.35)], [yaw ? 0.1 : 2.2, 1.1, yaw ? 2.2 : 0.08], 0, false); // tool board
    }
    for (const [x, z] of [[16.5, 29.5], [23, 12.4], [9.5, 30.8]] as const) { kit.place(barrels, [x, 0.04, z], 0.4); w.physics.addBox({ x, y: 0.45, z }, { x: 1.4, y: 0.9, z: 1.4 }, 0, { surface: 'metal' }); }
    for (const [x, z, n] of [[10.5, 20.5, 2], [24, 17.5, 1], [18, 25, 2], [3.5, 21, 1]] as const) {
      for (let k = 0; k < n; k++) kit.place(crate, [x, 0.04 + k * 0.82, z], k * 0.3);
      w.physics.addBox({ x, y: n * 0.41, z }, { x: 0.82, y: n * 0.82, z: 0.82 }, 0, { surface: 'wood' });
    }
    const tires: Array<{ p: [number, number, number]; yaw?: number }> = [];
    for (let i = 0; i < 6; i++) tires.push({ p: [12.8 + (i % 2) * 0.7, 0.04 + Math.floor(i / 2) * 0.26, 12.2], yaw: Math.PI / 2 });
    kit.instance(tire, tires);
    // Work lights: dark until the ambush throws the switch.
    for (const [x, z] of [[6, 14], [15, 14], [24, 14], [6, 22], [15, 21], [24, 24], [20, 30]] as const) kit.fixture(L.emissive(0xf4f6ff, 4), steel, x, h - 0.5, z, 0, 0xf0f2ff, 14, 13, 1.25, 'garage');
    kit.bulb(L.emissive(0xffd29a, 3), steel, 4.5, UPY + 2.7, 28.5, 0xffc98a, 3, 8, 'office');
    kit.bulb(L.emissive(0xffd29a, 3), steel, SIDE_DOOR.x, 2.8, z0 - 0.4, 0xffc98a, 2.5, 8, 'street');
  }

  // ------------------------------------------------------------------ the yard and the dock
  private async buildYard(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const mats = await import('../engine/materials');
    const [gravel, steel, conc] = await Promise.all([
      L.pbr('gravel_sand', { scale: 0.3, color: 0x8a8680 }), L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
      L.pbr('concrete_grey', { scale: 0.3 }),
    ]);
    const chain = new THREE.MeshStandardMaterial({ map: mats.canvasTexture('chainLink', mats.DRAW.chainLink, 256), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45, color: 0xb5b8ba });
    kit.floor(gravel, -8, G.z1, 38, DOCK_Z, 0.02, 0.2, 'gravel');
    kit.fence(steel, chain, -8, G.z1, -8, DOCK_Z, 0, 2.8);
    kit.fence(steel, chain, 38, G.z1, 38, DOCK_Z, 0, 2.8);
    kit.fence(steel, chain, G.x1, G.z1, 38, G.z1, 0, 2.8);
    kit.fence(steel, chain, -8, G.z1, G.x0, G.z1, 0, 2.8);
    // Dock edge: concrete lip with bollards; water below. A low invisible wall keeps everyone dry.
    kit.box(conc, [15, -0.6, DOCK_Z + 0.5], [46, 1.6, 1.0], 0, { surface: 'concrete' });
    for (let x = -6; x <= 36; x += 6) kit.batch.add(cylinderBetween(v3(x, 0, DOCK_Z - 0.3), v3(x, 0.7, DOCK_Z - 0.3), 0.16, 10), steel);
    w.physics.addBox({ x: 15, y: 0.6, z: DOCK_Z + 0.2 }, { x: 46, y: 1.2, z: 0.4 }, 0, { blocksSight: false, blocksCamera: false, walkable: false });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.08, metalness: 0.3 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(15, -1.4, DOCK_Z + 40);
    w.root.add(water);
    // Scrap: wrecks, a container, tyre piles.
    const [rust, container, tire] = await Promise.all([w.model('rust_car'), w.model('container'), w.model('tire')]);
    for (const [x, z, yaw] of [[30, 44, 0.6], [12, 46, -0.4], [22, 52, 1.6]] as const) {
      kit.place(rust, [x, 0.02, z], yaw);
      w.physics.addBox({ x, y: 0.65, z }, { x: 4.4, y: 1.3, z: 1.8 }, yaw, { surface: 'metal' });
    }
    kit.place(container, [-2.5, 0.02, 50], Math.PI / 2);
    w.physics.addBox({ x: -2.5, y: 1.4, z: 50 }, { x: 6.1, y: 2.8, z: 3.2 }, Math.PI / 2, { surface: 'metal' });
    const tires: Array<{ p: [number, number, number]; yaw?: number }> = [];
    for (let i = 0; i < 8; i++) tires.push({ p: [33 + (i % 3) * 0.7, 0.02 + Math.floor(i / 3) * 0.26, 36], yaw: Math.PI / 2 });
    kit.instance(tire, tires);
    for (const [x, z] of [[4, 36], [24, 40], [14, 54]] as const) {
      kit.batch.add(cylinderBetween(v3(x, 0, z), v3(x, 5.5, z), 0.08, 8), steel);
      kit.box(L.emissive(0xffcf8a, 3), [x, 5.5, z], [0.4, 0.12, 0.25], 0, false);
      kit.fixtures.push({ pos: v3(x, 5.3, z), color: new THREE.Color(0xffc98a), intensity: 12, range: 13, on: true, zone: 'yard' });
    }
  }

  // ================================================================== interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    for (const [role, who, label, dx] of [['a', 'elias', 'Turn the dial', 0.9], ['b', 'jax', 'Pull the handle', 0.9]] as const) {
      I.add({ id: `safe_${role}`, coop: 'safe', role, who, pos: v3(SAFE.x + dx, UPY, SAFE.z + (role === 'a' ? -0.25 : 0.35)), radius: 1.5, label, icon: 'coop', mode: 'hold', holdTime: 2.6, pose: 'use', poseCtx: { k: { height: 1.0 } }, facing: -Math.PI / 2,
        enabled: () => this.flags.phase === 'safe' && !this.flags.safeOpen });
    }
    I.add({ id: 'take_money', pos: v3(SAFE.x + 0.9, UPY, SAFE.z), radius: 1.6, label: 'Take the money', icon: 'hand', facing: -Math.PI / 2,
      enabled: () => this.flags.phase === 'safe' && !!this.flags.safeOpen && !this.flags.money, onUse: () => g.session.request('takeMoney', {}) });
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      const b = BIKES[c];
      I.add({ id: `bike_${c}`, who: c, pos: v3(...b.pos), radius: 1.7, label: 'Get on Crane\'s bike', icon: 'bike',
        enabled: () => this.flags.phase === 'escape' && !this.bikes.mounted,
        onUse: () => { this.bikes.parkedLocal = false; this.bikes.mount(v3(...b.pos), b.yaw); g.session.request('mounted', { who: c }); } });
    }
    I.add({ id: 'grab_crane', pos: v3(0, 0, 0), radius: 1.8, label: 'Grab Crane', icon: 'fist', priority: 6,
      enabled: () => this.flags.phase === 'chase', onUse: () => g.session.request('craneDown', {}) });
  }

  // ================================================================== triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'inside', min: [G.x0 + 14, -1, G.z0 + 0.3], max: [G.x1, 3, G.z0 + 7], who: 'both', enabled: () => this.flags.phase === 'street' });
    this.addTrigger({ id: 'near', min: [-14, -1, -6], max: [-4, 3, 8], who: 'any', enabled: () => this.flags.phase === 'street' });
  }

  onTrigger(id: string): void {
    if (!this.authority) return;
    switch (id) {
      case 'near': this.say('fight_tip'); break;
      case 'inside': this.cutscene('cs5_ambush'); break;
    }
  }

  // ================================================================== Victor's run (authority)
  private routeOut(): THREE.Vector3[] {
    return [v3(STAIRS.x, UPY, STAIRS.z1 + 0.3), v3(STAIRS.x, 0, STAIRS.z0 - 0.4), v3(17, 0, 21.5), v3(24.5, 0, 28.5), v3(BACK_DOOR.x, 0, G.z1 - 0.8), v3(BACK_DOOR.x, 0, G.z1 + 2), v3(20, 0, 38), v3(9, 0, 42.5), v3(5, 0, 50), v3(7, 0, DOCK_Z - 1.2)];
  }

  private runRoute(pts: THREE.Vector3[], i = 0): void {
    const n = this.g.npcs.get('crane');
    if (!n || !this.authority || this.flags.phase !== 'chase') return;
    if (i >= pts.length) {
      // Cornered at the edge of the dock.
      this.g.session.emit('dlg', { id: 'crane_cornered', at: this.g.session.sharedNow() + 100 });
      setTimeout(() => { if (this.flags.phase === 'chase') this.g.session.emit('craneDown', {}); }, 1600);
      return;
    }
    n.direct = true;
    n.walkTo(pts[i], 4.0, () => this.runRoute(pts, i + 1));
  }

  private show(ids: string[], on: boolean): void {
    for (const id of ids) {
      const n = this.g.npcs.get(id);
      if (!n) continue;
      n.enabled = on; n.body.visible = on; n.body.solid = on;
    }
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    C.cs5_arrive = {
      id: 'cs5_arrive', music: 'music_tension',
      start: () => {},
      beats: [
        { dur: 5.5, fade: 'in', shot: () => shot(v3(-6, 9, -10), v3(15, 2, 12), 5.5, { fov: 44, toEnd: v3(14, 2.4, 10) }),
          lines: [{ who: 'narrator', text: 'Crane Motors, Dock Street. Ten minutes to midnight.', dur: 3.6 }] },
        { shot: () => twoShot(g, 'jax', 'elias', 12, 2.4, 1.45, 1), lines: [
          { who: 'jax', text: 'Lights off, door shut. He\'s in there, and he\'s not alone.' },
          { who: 'elias', text: 'Two in the street. Then the side door.' },
          { who: 'jax', text: 'Whatever happens in there — I\'m glad it\'s you, Professor.' },
          { who: 'elias', text: 'Me too. Let\'s finish it.' },
        ] },
      ],
      end: () => { if (this.authority) this.objective('Take out Crane\'s lookouts', [16, 1.5, 5]); },
    };
    C.cs5_ambush = {
      id: 'cs5_ambush', music: 'music_action', skippable: true,
      start: () => {
        this.flags.phase = 'ambush';
        placeChar(g, 'elias', v3(SIDE_DOOR.x - 0.6, 0, G.z0 + 1.6), 0);
        placeChar(g, 'jax', v3(SIDE_DOOR.x + 0.7, 0, G.z0 + 1.2), 0);
        this.show(INSIDE, true);
        this.show(['crane'], true);
        npcPlace(g, 'crane', v3(7, UPY, 24.7), Math.PI);
        for (const f of this.kit.fixtures) if (f.zone === 'garage') f.on = false;
      },
      beats: [
        { dur: 2.6, shot: () => shot(v3(SIDE_DOOR.x - 1, 1.7, G.z0 + 0.6), v3(14, 1.5, 22), 2.6, { fov: 50 }),
          run: () => { g.audio.play('door_open', { pos: v3(SIDE_DOOR.x, 1, G.z0), volume: 0.7 }); } },
        { dur: 2.2, shot: () => shot(v3(16, 2.2, 15), v3(9, UPY + 1.4, 24.5), 2.2, { fov: 46 }),
          run: () => { g.audio.play('switch', { volume: 0.9 }); g.audio.play('metal_slam', { volume: 0.6, delay: 0.15 }); for (const f of this.kit.fixtures) if (f.zone === 'garage') f.on = true; } },
        { shot: () => closeUp(g, 'crane', 12, 1.2, -0.3, { fov: 36 }), lines: [
          { who: 'crane', text: 'Elias. Jax. I was beginning to think you\'d lost your nerve.', anim: 'talk_assured' },
          { who: 'crane', text: 'My little brother called me before your car even left the site. Julius never could keep his mouth shut.' },
          { who: 'elias', text: 'It\'s over, Victor.' },
          { who: 'crane', text: 'It\'s over when I say it\'s over.', anim: 'talk_angry' },
        ] },
        { dur: 2.4, shot: () => shot(v3(22, 2.6, 13), v3(10, 1.2, 22), 2.4, { fov: 48 }),
          run: () => { for (const id of INSIDE) { const n = g.npcs.get(id); if (n) n.body.yaw = Math.atan2(SIDE_DOOR.x - n.body.pos.x, SIDE_DOOR.z - n.body.pos.z); } },
          lines: [{ who: 'crane', text: 'Kill them.', dur: 1.4 }] },
      ],
      end: () => {
        this.show(INSIDE, true);
        for (const f of this.kit.fixtures) if (f.zone === 'garage') f.on = true;
        if (!this.authority) return;
        this.saveCheckpoint('shootout');
        g.session.emit('fightStart', {});
      },
    };
    C.cs5_crane = {
      id: 'cs5_crane', music: 'music_chase', skippable: true,
      start: () => {
        this.show(['crane'], true);
        g.guns.show('crane', true);
        npcPlace(g, 'crane', v3(10.5, UPY, 24.6), Math.PI);
        g.npcs.get('crane')?.body.setPose('aim', { k: { pitch: -0.25 } });
      },
      beats: [
        { dur: 3, shot: () => shot(v3(16, 1.6, 17), v3(10.5, UPY + 1.4, 24.6), 3, { fov: 40 }),
          lines: [{ who: 'crane', text: 'Thirty years I built this! You think two convicts take it from me?', dur: 2.8, anim: 'talk_angry' }] },
        { dur: 2.2, shot: () => shot(v3(12, UPY + 1.8, 22), v3(18, 0.8, 16), 2.2, { fov: 50 }),
          run: () => {
            const n = g.npcs.get('crane');
            if (!n) return;
            for (const k of [0, 1]) setTimeout(() => {
              const from = g.guns.muzzle('crane');
              const to = from.clone().add(v3(5 + k, -3.2, -6 + k * 2));
              g.guns.fire('crane', from, to, true);
            }, 250 + k * 850);
            g.cam.addShake(0.3);
          },
          lines: [{ who: 'jax', text: 'Get down!', dur: 1.2 }] },
        { dur: 2.4, shot: () => shot(v3(20, 1.8, 26), v3(14, UPY, 25), 2.4, { fov: 46 }),
          run: () => { const n = g.npcs.get('crane'); n?.body.clearPose(0.2); if (this.authority && n) { n.direct = true; n.walkTo(v3(STAIRS.x, UPY, STAIRS.z1 + 0.3), 4); } },
          lines: [{ who: 'elias', text: 'He\'s running! The back door!', dur: 2 }] },
      ],
      end: () => {
        if (this.authority) { this.saveCheckpoint('chase'); g.session.emit('chaseStart', {}); }
      },
    };
    C.cs5_end = {
      id: 'cs5_end', music: 'music_sad', skippable: true,
      start: () => {
        this.flags.phase = 'end';
        const n = g.npcs.get('crane');
        const p = n ? n.body.pos.clone() : v3(7, 0, DOCK_Z - 2);
        p.y = 0;
        if (n) { n.scriptTarget = null; n.direct = false; if (this.authority) n.setState('idle'); n.enabled = false; npcPlace(g, 'crane', p, 0); n.body.setPose('kneel', {}, { restart: true }); }
        g.guns.show('crane', false);
        // Face him from the yard side.
        placeChar(g, 'elias', p.clone().add(v3(-1.0, 0, -2.6)), 0.25);
        placeChar(g, 'jax', p.clone().add(v3(1.3, 0, -2.4)), -0.4);
        g.guns.show('elias', true); g.guns.show('jax', true);
        this.endPos.copy(p);
      },
      beats: [
        { shot: () => ots(g, 'elias', 'crane', 16, 1, { fov: 38 }), run: () => { poseChar(g, 'elias', 'aim', { k: { pitch: -0.35 } }); }, lines: [
          { who: 'crane', text: 'Elias... Nine years you kept my books, and you still can\'t add up what this costs you.', anim: 'talk' },
          { who: 'elias', text: 'Tom Harlan. Say it.' },
          { who: 'crane', text: 'Fine. I had Tom killed. I put the gun in your garage. It was business, Elias. It was always business.' },
          { who: 'jax', text: 'And Danny?', anim: 'talk_angry' },
        ] },
        { shot: () => closeUp(g, 'crane', 10, 1.1, 0.3, { fov: 34 }), run: () => { poseChar(g, 'jax', 'aim', { k: { pitch: -0.35 } }); lookChar(g, 'jax', g.npcs.get('crane')?.body.head() ?? null); }, lines: [
          { who: 'crane', text: 'Your brother talked too much in county lockup. One phone call. That\'s all it ever takes.' },
          { who: 'crane', text: 'You won\'t do it. A bookkeeper and a car thief. You\'re not killers.', pause: 0.6 },
          { who: 'jax', text: 'You made us whatever we are.', anim: 'talk_angry' },
        ] },
        { dur: 2.6, shot: () => shot(this.endPos.clone().add(v3(-9, 4, -8)), this.endPos.clone().add(v3(0, 0.8, 0)), 2.6, { fov: 40 }),
          run: () => {
            for (const [k, who] of (['jax', 'elias'] as const).entries()) setTimeout(() => { const from = g.guns.muzzle(who); g.guns.fire(who, from, this.endPos.clone().add(v3(0, 0.9, 0)), false); }, 700 + k * 260);
            setTimeout(() => { const n = g.npcs.get('crane'); n?.body.setPose('lying', {}, { restart: true }); g.audio.play('body_fall', { pos: this.endPos, volume: 0.9 }); }, 1100);
          } },
        { shot: () => twoShot(g, 'elias', 'jax', 9, 2.4, 1.5, -1), run: () => { poseChar(g, 'elias', null); poseChar(g, 'jax', null); lookChar(g, 'jax', null); }, lines: [
          { who: 'elias', text: '...It\'s done.', pause: 0.8 },
          { who: 'jax', text: 'Not yet. His safe. Then we never set foot in this town again.' },
        ] },
        { dur: 2.2, fade: 'out', shot: () => shot(this.endPos.clone().add(v3(-4, 6, -14)), this.endPos.clone().add(v3(0, 0.5, 0)), 2.2, { fov: 44 }) },
      ],
      end: () => {
        g.guns.show('elias', false); g.guns.show('jax', false);
        poseChar(g, 'elias', null); poseChar(g, 'jax', null);
        if (this.authority) { this.saveCheckpoint('safe'); g.session.emit('restart', { checkpoint: 'safe' }); }
      },
    };
    C.cs5_police = {
      id: 'cs5_police', music: 'music_chase', skippable: true,
      start: () => { this.policeArrive(); },
      beats: [
        { dur: 3.6, shot: () => shot(v3(-6, 4, -8), v3(16, 1.2, 4), 3.6, { fov: 46 }),
          lines: [{ who: 'radio', text: '(megaphone) This is the Harlow Police Department! Come out with your hands where we can see them!', dur: 3.4, radio: true }] },
        { shot: () => twoShot(g, 'jax', 'elias', 6, 2.4, 1.5, 1), lines: [
          { who: 'jax', text: 'Front\'s full of cops. Crane had bikes in the yard — the back door!', anim: 'talk_angry' },
          { who: 'elias', text: 'Go, go, go!' },
        ] },
      ],
      end: () => {
        if (!this.authority) return;
        this.saveCheckpoint('escape');
        g.session.emit('escapeStart', {});
      },
    };
    C.cs5_ride = {
      id: 'cs5_ride', music: 'music_chase', skippable: false,
      start: () => {},
      beats: [{ dur: 2.2, fade: 'out', shot: () => shot(v3(8, 3, 34), v3(3, 0.8, 44), 2.2, { fov: 50 }) }],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: 6 }); },
    };
  }
  private endPos = new THREE.Vector3();

  private policeArrive(): void {
    const g = this.g;
    const pts = [v3(4, 0, 2.5), v3(18, 0, 0.5), v3(-6, 0, 1.5)];
    this.policeCars.forEach((c, i) => {
      c.root.visible = true;
      c.sirenOn = true;
      c.setPose(pts[i], Math.PI / 2 + (i - 1) * 0.5);
    });
    this.siren ??= g.audio.siren();
    this.siren?.set(v3(8, 1, 1), 0.7);
  }

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    g.flags.combat = true;
    g.guns.playersArmed = true;
    this.craneFireT = 2;
    for (const n of g.npcs.values()) { n.reset(); n.direct = false; n.hostile = !!n.def.hostile; }
    for (const d of this.npcDefs) if (d.id === 'crane') d.passive = true;
    g.guns.show('crane', false);
    this.show(OUTSIDE, false); this.show(INSIDE, false); this.show(['crane'], false); this.show(COPS, false);
    for (const c of this.policeCars) { c.root.visible = false; c.sirenOn = false; }
    this.siren?.stop(); this.siren = null;
    if (this.bikes) {
      if (this.bikes.mounted) this.bikes.dismount();
      for (const c of ['elias', 'jax'] as CharacterId[]) this.bikes.park(c, v3(...BIKES[c].pos), BIKES[c].yaw);
    }
    for (const k of ['safeOpen', 'money', 'mounted_elias', 'mounted_jax', 'half', 'craneRan']) delete this.flags[k];
    if (this.safeDoor) this.safeDoor.rotation.y = 0;
    if (this.money) this.money.visible = false;
    const garageOn = id !== 'street';
    for (const f of this.kit.fixtures) if (f.zone === 'garage') f.on = garageOn;
    this.flags.phase = id;
    switch (id) {
      case 'street':
        this.show(OUTSIDE, true);
        g.audio.playMusic('music_tension', 2);
        break;
      case 'shootout':
        this.show(INSIDE, true);
        this.show(['crane'], true);
        this.startFight();
        break;
      case 'chase':
        this.show(['crane'], true);
        npcPlace(g, 'crane', v3(STAIRS.x, 0, STAIRS.z0 + 0.4), Math.PI);
        if (this.authority) setTimeout(() => { if (this.flags.phase === 'chase') g.session.emit('chaseStart', {}); }, 600);
        break;
      case 'safe':
        this.show(['crane'], false);
        g.audio.playMusic('music_sad', 2);
        break;
      case 'escape':
        this.flags.safeOpen = true; this.flags.money = true;
        if (this.safeDoor) this.safeDoor.rotation.y = -1.9;
        this.policeArrive();
        this.startEscape();
        break;
    }
  }

  private startFight(): void {
    const g = this.g;
    this.flags.phase = 'shootout';
    for (const id of INSIDE) {
      const n = g.npcs.get(id);
      if (!n || !n.alive) continue;
      n.hostile = true;
      n.awareness.jax = n.awareness.elias = 1;
      n.target = Math.random() < 0.5 ? 'jax' : 'elias';
      if (this.authority) n.setState('combat');
    }
    g.audio.playMusic('music_action', 1);
    if (this.authority) this.objective('Kill Crane\'s men', null);
  }

  private startChase(): void {
    const g = this.g;
    this.flags.phase = 'chase';
    const n = g.npcs.get('crane');
    if (!n) return;
    const d = this.npcDefs.find((x) => x.id === 'crane')!;
    d.passive = true; // he runs, he doesn't hunt
    n.hostile = true; // ...but you can shoot him down
    g.guns.show('crane', true);
    if (this.authority) {
      this.objective('Don\'t let Crane get away!', null);
      // Start from wherever he is on the route.
      const pts = this.routeOut();
      let k = 0, best = Infinity;
      pts.forEach((p, i) => { const dd = p.distanceTo(n.body.pos); if (dd < best) { best = dd; k = i; } });
      this.runRoute(pts, k);
    }
    g.audio.playMusic('music_chase', 0.8);
  }

  private startEscape(): void {
    const g = this.g;
    this.flags.phase = 'escape';
    // Officers come in the front: they catch, they don't shoot.
    for (const [i, id] of COPS.entries()) {
      const n = g.npcs.get(id);
      if (!n) continue;
      n.enabled = true; n.body.visible = true; n.body.solid = true;
      npcPlace(g, id, v3(SIDE_DOOR.x - 0.8 + i * 0.8, 0, G.z0 - 1.5 - i * 1.2), 0);
      n.awareness.jax = n.awareness.elias = 0.9;
    }
    if (this.authority) {
      this.objective('Get to Crane\'s dirt bikes in the yard!', [BIKES.elias.pos[0] + 1, 1.2, BIKES.elias.pos[2]]);
      this.say('police');
      // They come in a few seconds behind you.
      setTimeout(() => {
        for (const [i, id] of COPS.entries()) {
          const n = g.npcs.get(id);
          if (!n || this.flags.phase !== 'escape') continue;
          n.target = i % 2 ? 'jax' : 'elias';
          n.awareness[n.target] = 1;
          n.setState('alert');
        }
      }, 5000);
    }
    g.audio.playMusic('music_chase', 0.6);
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'fightStart':
        this.startFight();
        return true;
      case 'chaseStart':
        this.startChase();
        return true;
      case 'escapeStart':
        this.startEscape();
        return true;
      case 'ko': {
        if (!this.authority) return true;
        const id = String(a.npc);
        if (this.flags.phase === 'street' && OUTSIDE.every((o) => !g.npcs.get(o)?.alive)) {
          this.say('lookouts_down');
          this.objective('Get inside — the side door', [SIDE_DOOR.x, 1.4, SIDE_DOOR.z]);
        }
        if (this.flags.phase === 'shootout') {
          const left = INSIDE.filter((o) => g.npcs.get(o)?.alive);
          if (left.length <= 3 && !this.flags.half) { g.session.emit('flag', { k: 'half', v: true }); this.say('half'); }
          if (left.length === 1 && left[0] === 'kessler') this.say('kessler');
          if (!left.length) setTimeout(() => this.cutscene('cs5_crane'), 900);
        }
        if (id === 'crane' && this.flags.phase === 'chase') g.session.emit('craneDown', {});
        return true;
      }
      case 'craneDown':
        if (this.flags.phase !== 'chase') return true;
        this.flags.phase = 'end';
        if (this.authority) this.cutscene('cs5_end');
        return true;
      case 'coop':
        if (a.group === 'safe') {
          this.flags.safeOpen = true;
          g.audio.play('lock_open', { pos: v3(SAFE.x, UPY + 1, SAFE.z), volume: 0.9 });
          g.audio.play('creak', { pos: v3(SAFE.x, UPY + 1, SAFE.z), volume: 0.7, delay: 0.3 });
          if (this.money) this.money.visible = true;
          if (this.authority) this.objective('Take the money', [SAFE.x, UPY + 1, SAFE.z]);
          return true;
        }
        return false;
      case 'takeMoney':
        this.flags.money = true;
        if (this.money) this.money.visible = false;
        g.audio.play('paper', { pos: v3(SAFE.x, UPY + 1, SAFE.z), volume: 0.8 });
        g.hud.notify('Crane\'s money — and his second ledger', 3);
        if (this.authority) setTimeout(() => this.cutscene('cs5_police'), 1800);
        return true;
      case 'mounted':
        this.flags[`mounted_${a.who}`] = true;
        if (this.authority && this.flags.mounted_elias && this.flags.mounted_jax && this.flags.phase === 'escape') {
          this.flags.phase = 'riding';
          setTimeout(() => this.cutscene('cs5_ride'), 2500);
        }
        return true;
      case 'spotted':
        return true;
    }
    return false;
  }

  validate(type: string): boolean {
    if (type === 'craneDown') return this.flags.phase === 'chase';
    if (type === 'takeMoney') return this.flags.phase === 'safe' && !!this.flags.safeOpen && !this.flags.money;
    return true;
  }

  update(dt: number): void {
    const g = this.g;
    g.local.body.concealed = false;
    const n = g.npcs.get('crane');
    const grab = g.interact.items.get('grab_crane');
    if (n && grab) grab.pos.copy(n.body.pos);
    // The safe door swings open.
    if (this.safeDoor) {
      const want = this.flags.safeOpen ? -1.9 : 0;
      this.safeDoor.rotation.y += (want - this.safeDoor.rotation.y) * Math.min(1, dt * 2.5);
    }
    // Victor fires back over his shoulder while he runs (rarely hits).
    if (this.authority && this.flags.phase === 'chase' && n?.alive) {
      this.craneFireT -= dt;
      if (this.craneFireT <= 0) {
        this.craneFireT = 1.8 + Math.random() * 1.4;
        const targets = (['elias', 'jax'] as CharacterId[]).map((c) => ({ c, d: g.body(c).pos.distanceTo(n.body.pos) })).sort((x, y) => x.d - y.d);
        const t = targets[0];
        if (t.d < 16 && g.world.physics.lineOfSight(n.body.chest(), g.body(t.c).chest())) g.npcShoot(n, t.c, Math.random() < 0.22, 12);
      }
    }
    g.chapterHint = null;
  }

  lightAt(p: THREE.Vector3): number { return Math.min(1.4, this.kit.lightLevel(p, 0.2)); }

  suspicion(): number { return 1; }

  dispose(): void {
    this.siren?.stop();
  }
}
