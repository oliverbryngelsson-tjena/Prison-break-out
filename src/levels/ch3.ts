// Chapter 3 — On the Run. Dawn on the river, a manhunt in the woods, a stolen change of clothes,
// a phone call Jax doesn't explain, and a campfire where the two discover they hate the same man.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, run, clipChar, lookChar, shot, closeUp, twoShot, poseChar, npcPlace, walkChar } from './cs';
import { Terrain, fbm, distToPath, smooth } from './terrain';
import { Water } from './water';
import { Foliage, scatter, type FoliageItem, type Placement } from './foliage';
import { Flashlight, coneLight } from './lights';
import { Car, Path } from './vehicles';
import { cylinderBetween } from '../engine/geometry';
import { canvasTexture } from '../engine/materials';
import type { Line } from '../game/dialogue';

const RIVER: Array<[number, number]> = [[-180, -146], [-110, -152], [-50, -147], [0, -151], [60, -146], [120, -152], [190, -148]];
const RIVER_Y = -2.2;
const ROAD: Array<[number, number]> = [];
for (let x = -170; x <= 190; x += 10) ROAD.push([x, 112 + Math.sin(x / 40) * 5]);
const TRACK: Array<[number, number]> = [[-170, -98], [-90, -94], [-30, -96], [20, -92], [80, -97], [190, -94]];
const FARM = { x: 40, z: 58, r: 34 };
const CABIN = { x: -32, z: 152 };
const ravZ = (x: number) => -30 + Math.sin(x / 30) * 4;
const LOG_X = 8;

type TOD = 'dawn' | 'day' | 'dusk' | 'night';
const TODS: Record<TOD, { sun: number; sunI: number; dir: [number, number, number]; sky: number; ground: number; hemiI: number; fog: number; dens: number; bg: number; env: number; exposure: number; sat: number }> = {
  dawn: { sun: 0xffb27e, sunI: 1.7, dir: [-0.85, 0.28, 0.35], sky: 0x9aaac4, ground: 0x3a3028, hemiI: 0.55, fog: 0xa3a6aa, dens: 0.014, bg: 0x9ca7b2, env: 0.45, exposure: 1.0, sat: 0.85 },
  day: { sun: 0xfff3de, sunI: 2.8, dir: [0.45, 1, 0.35], sky: 0xcfe0f2, ground: 0x55493a, hemiI: 0.62, fog: 0xbac6cf, dens: 0.006, bg: 0xaabccb, env: 0.6, exposure: 1.0, sat: 0.95 },
  dusk: { sun: 0xff8f52, sunI: 1.5, dir: [0.9, 0.2, -0.35], sky: 0x7d6e90, ground: 0x2a2220, hemiI: 0.45, fog: 0x6d5c66, dens: 0.012, bg: 0x5d4d5b, env: 0.35, exposure: 1.05, sat: 0.9 },
  night: { sun: 0x8fa8d8, sunI: 0.35, dir: [-0.3, 0.8, 0.4], sky: 0x24324a, ground: 0x0a0806, hemiI: 0.22, fog: 0x0a0e14, dens: 0.028, bg: 0x06080c, env: 0.1, exposure: 1.15, sat: 0.8 },
};

interface Cover { x: number; z: number; r: number }

export class Chapter3 extends Chapter {
  readonly num = 3;
  readonly title = 'On the Run';
  readonly subtitle = 'Pell County, the next morning';
  music = 'music_explore';
  terrain!: Terrain;
  kit!: Kit;
  private foliage: Foliage | null = null;
  private flash = new Map<string, Flashlight>();
  private covers: Cover[] = [];
  private cruiser!: Car;
  private patrol!: Car;
  private patrolPath!: Path;
  private log!: THREE.Group;
  private logCol!: import('../engine/physics').Box;
  private logT = 0;
  private clothes: THREE.Object3D[] = [];
  private fire!: THREE.Group;
  private fireLight!: THREE.PointLight;
  private fireT = 0;
  private tod: TOD = 'dawn';
  private roadSpotT: Record<CharacterId, number> = { elias: 0, jax: 0 };

  readonly checkpoints: Record<string, CheckpointDef> = {
    bank: { spawn: { elias: { pos: [-2, 0, -139], yaw: 0.1 }, jax: { pos: [1.5, 0, -138.5], yaw: -0.2 } }, objective: 'Get away from the river before the search teams arrive', intro: 'cs3_wake', outfit: 'prison' },
    ravine: { spawn: { elias: { pos: [LOG_X - 1, 0, -23], yaw: 0 }, jax: { pos: [LOG_X + 1, 0, -22.5], yaw: 0 } }, objective: 'Head north through the woods', outfit: 'prison' },
    farm: { spawn: { elias: { pos: [18, 0, 26], yaw: 0.6 }, jax: { pos: [20, 0, 25], yaw: 0.6 } }, objective: 'Steal clothes from the line — don\'t let the farmer see you', intro: 'cs3_farm', outfit: 'prison' },
    road: { spawn: { elias: { pos: [46, 0, 92], yaw: 0 }, jax: { pos: [48, 0, 91], yaw: 0 } }, objective: 'Cross the county road without being seen', outfit: 'civil' },
    cabin: { spawn: { elias: { pos: [-20, 0, 132], yaw: -0.6 }, jax: { pos: [-18, 0, 131], yaw: -0.6 } }, objective: 'Follow the stream to the hunting cabin', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: false, sprint: true, combat: false, crouch: true };
    const d = this.npcDefs;
    d.push({ id: 'cole', char: 'cop1', role: 'police', name: 'Deputy Cole', pos: [-24, 0, -97], yaw: Math.PI, catches: true, vision: { range: 15, fov: 95 }, walk: 1.0,
      patrol: [[-24, -97, 5, Math.PI], [-10, -106, 2], [6, -112, 4, Math.PI], [-12, -104, 1]] });
    d.push({ id: 'price', char: 'cop2', role: 'police', name: 'Deputy Price', pos: [-34, 0, -93], yaw: Math.PI * 0.7, idleClip: 'phone_talk', catches: true, vision: { range: 13, fov: 90 } });
    d.push({ id: 'reyes', char: 'cop3', role: 'police', name: 'Deputy Reyes', pos: [30, 0, -70], yaw: Math.PI, catches: true, vision: { range: 15, fov: 95 }, walk: 1.05,
      patrol: [[30, -70, 3, Math.PI], [42, -88, 2], [24, -96, 1], [12, -78, 3, -Math.PI / 2], [18, -62, 1]] });
    d.push({ id: 'hale', char: 'swat', role: 'police', name: 'Trooper Hale', pos: [-40, 0, -60], yaw: Math.PI / 2, catches: true, vision: { range: 16, fov: 95 }, walk: 1.0,
      patrol: [[-40, -60, 4, Math.PI / 2], [-14, -56, 2], [-4, -70, 3, Math.PI], [-26, -74, 1]] });
    d.push({ id: 'walt', char: 'thug2', role: 'guard', name: 'Walt Ashby', pos: [56, 0, 62], yaw: Math.PI / 2, catches: true, vision: { range: 17, fov: 100 }, walk: 0.9,
      patrol: [[56, 62, 7, Math.PI / 2], [44, 72, 5, 0], [30, 56, 6, -Math.PI / 2], [46, 52, 2]] });
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.bank = [
      { who: 'elias', text: 'They\'ll walk the banks first. Dogs, deputies, the works. We need trees between us and the water.' },
      { who: 'jax', text: 'Lead the way, professor. You\'re the one who reads maps for fun.' },
    ];
    D.track = [
      { who: 'jax', text: 'Cruiser on the fire road. Two of them.' },
      { who: 'elias', text: 'Stay low in the brush. They see orange, it\'s over.' },
    ];
    D.scanner = [
      { who: 'radio', text: '...all units, ten-eighty in progress on Route Nine... repeat, ten-eighty...', radio: true, dur: 3.2 },
      { who: 'jax', text: 'Ten-eighty. That\'s a pursuit. Not us — somebody else is having a worse day.' },
      { who: 'elias', text: 'You know their codes?' },
      { who: 'jax', text: 'I\'ve spent a lot of nights in the back of their cars. You pick things up.', pause: 0.4 },
    ];
    D.ravine = [
      { who: 'jax', text: 'Well, that\'s a canyon.' },
      { who: 'elias', text: 'That dead pine on the edge. If we both push, it\'ll fall across.' },
    ];
    D.log_tip = [{ who: 'narrator', text: 'Both players push the dead tree at the same time.', dur: 3.5 }];
    D.log_done = [{ who: 'jax', text: 'Nature\'s bridge. Don\'t look down.' }];
    D.farm_line = [{ who: 'jax', text: 'Line\'s full. Shirts, jeans. Somebody\'s about to be robbed by two very polite convicts.' }];
    D.clothes_one = [{ who: 'elias', text: 'Got mine. Now yours — and stay behind the bales.' }];
    D.clothes_both = [{ who: 'jax', text: 'Barn. Before he turns around.' }];
    D.road = [
      { who: 'elias', text: 'County road. That cruiser makes a loop every minute or so.' },
      { who: 'jax', text: 'Then we cross when its back is turned. Simple.' },
    ];
    D.road_tip = [{ who: 'narrator', text: 'Stay out of the headlights. Cross when the patrol car is far away.', dur: 3.5 }];
    D.stream = [{ who: 'elias', text: 'There\'s a hunting cabin up this stream. Empty this time of year.' }];
    D.walt_spot = [{ who: 'walt', text: 'Hey! Who\'s out there? Martha, call the sheriff!', dur: 2.6 }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/farm.hdr', envIntensity: 0.5, background: TODS.dawn.bg,
      fog: { color: TODS.dawn.fog, density: TODS.dawn.dens },
      hemi: { sky: TODS.dawn.sky, ground: TODS.dawn.ground, intensity: TODS.dawn.hemiI },
      sun: { color: TODS.dawn.sun, intensity: TODS.dawn.sunI, dir: TODS.dawn.dir, shadows: true },
      grade: { saturation: 0.85, contrast: 1.05, lift: [0.01, 0.01, 0.015], gain: [1.03, 1.0, 0.96], shadowTint: [0.94, 0.98, 1.06], highlightTint: [1.06, 1.0, 0.92], bloom: 0.6, vignette: 0.5 },
      reverb: 0.15,
    });
    this.kit = new Kit(w);
    await this.buildTerrain();
    // Snap spawn points and NPCs onto the terrain.
    for (const cp of Object.values(this.checkpoints)) for (const sp of Object.values(cp.spawn)) sp.pos[1] = this.y(sp.pos[0], sp.pos[2]) + 0.05;
    for (const d of this.npcDefs) d.pos[1] = this.y(d.pos[0], d.pos[2]) + 0.05;
    await this.buildFarm();
    await this.buildCabin();
    await this.buildLog();
    await this.buildVehicles();
    this.kit.initLightPool(Math.max(1, g.deps.renderer.q.maxLights - 2));
    this.kit.finish();
    w.ambientLoop('amb_wind', 0.3);
    w.ambientLoop('amb_water', 0.45, v3(0, -1, -150));
    w.tickers.add((dt, t) => {
      this.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      const ground = (x: number, z: number) => this.terrain.height(x, z);
      for (const f of this.flash.values()) f.update(ground);
      this.foliage?.update(dt, g.cam.camera.position);
      this.updateCars(t);
      this.updateFire(dt);
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
  }

  private height(x: number, z: number): number {
    let h = 2 + fbm(x * 0.011, z * 0.011, 4, 7) * 9 + z * 0.025;
    h += fbm(x * 0.05, z * 0.05, 2, 3) * 0.8;
    // River valley
    const rd = distToPath(x, z, RIVER).d;
    const bank = smooth(8, 22, rd);
    h = THREE.MathUtils.lerp(RIVER_Y - 1.4 + Math.min(1.2, rd * 0.15), Math.max(h, RIVER_Y + 0.8), bank);
    // Ravine
    const vd = Math.abs(z - ravZ(x));
    h -= 7 * smooth(6.5, 2.2, vd);
    // Roads and the farm/cabin clearings are levelled.
    const tr = distToPath(x, z, TRACK).d;
    h = THREE.MathUtils.lerp(h, this.baseAt(x, -95) , smooth(7, 3, tr) * 0.6);
    const rr = distToPath(x, z, ROAD).d;
    h = THREE.MathUtils.lerp(h, this.baseAt(x, 112), smooth(9, 4, rr));
    const fd = Math.hypot(x - FARM.x, z - FARM.z);
    h = THREE.MathUtils.lerp(h, this.baseAt(FARM.x, FARM.z), smooth(FARM.r + 10, FARM.r - 4, fd));
    const cd = Math.hypot(x - CABIN.x, z - CABIN.z);
    h = THREE.MathUtils.lerp(h, this.baseAt(CABIN.x, CABIN.z), smooth(16, 8, cd));
    return h;
  }
  private baseAt(x: number, z: number): number { return 2 + fbm(x * 0.011, z * 0.011, 4, 7) * 9 + z * 0.025; }
  /** Ground height convenience used by placement code. */
  y(x: number, z: number): number { return this.terrain ? this.terrain.height(x, z) : this.height(x, z); }

  private async buildTerrain(): Promise<void> {
    const g = this.g, w = g.world;
    this.terrain = new Terrain({
      x0: -180, z0: -175, size: 370, res: 186, height: (x, z) => this.height(x, z),
      layers: [
        { set: 'grass_sparse', scale: 0.16, tint: 0xa3ab8a, surface: 'grass', roughness: 0.95 },
        { set: 'forest_floor', scale: 0.2, surface: 'leaves', roughness: 1 },
        { set: 'rock_face', scale: 0.1, tint: 0x8d8a84, surface: 'gravel', roughness: 0.9 },
        { set: 'gravel', scale: 0.3, tint: 0xa09684, surface: 'gravel', roughness: 0.85 },
      ],
      weights: (x, z, _h, slope) => {
        const road = Math.max(smooth(6, 3, distToPath(x, z, ROAD).d), smooth(4.5, 2, distToPath(x, z, TRACK).d), smooth(16, 9, distToPath(x, z, RIVER).d));
        const rock = smooth(0.3, 0.6, slope) * 1.6;
        const fd = Math.hypot(x - FARM.x, z - FARM.z);
        const meadow = smooth(FARM.r + 6, FARM.r - 6, fd) + smooth(12, 6, Math.hypot(x - CABIN.x, z - CABIN.z)) * 0.6;
        const forest = (0.7 + 0.3 * fbm(x * 0.03, z * 0.03, 2, 5)) * (1 - meadow);
        return [0.35 + meadow, forest, rock, road * 1.5];
      },
      occlusion: (x, z) => (1 - smooth(FARM.r + 4, FARM.r - 4, Math.hypot(x - FARM.x, z - FARM.z))) * 0.5,
    });
    await this.terrain.build(w);
    new Water(w, { path: RIVER, width: 22, y: RIVER_Y, color: 0x1e2c2a, flow: [1, 0.05], opacity: 0.9 });
    // Stream to the cabin and a pond beside it
    new Water(w, { rect: { x0: CABIN.x - 22, z0: CABIN.z + 6, x1: CABIN.x - 8, z1: CABIN.z + 22 }, y: this.baseAt(CABIN.x, CABIN.z) - 0.25, color: 0x1a2622, opacity: 0.92 });
    // Cover clusters (bushes you can crouch in)
    const coverPts: Cover[] = [
      { x: -6, z: -122, r: 4 }, { x: 8, z: -116, r: 3.5 }, { x: -14, z: -108, r: 4 }, { x: 14, z: -100, r: 3.5 }, { x: -2, z: -88, r: 4.5 }, { x: 10, z: -82, r: 3.5 },
      { x: -10, z: -76, r: 4 }, { x: 4, z: -66, r: 4 }, { x: -18, z: -64, r: 3.5 }, { x: 16, z: -56, r: 4 }, { x: 0, z: -48, r: 4 },
      // farm approach
      { x: 26, z: 40, r: 3.5 }, { x: 32, z: 47, r: 3 },
      // road edges
      { x: 40, z: 104, r: 3.5 }, { x: 52, z: 103, r: 3 }, { x: 46, z: 122, r: 3.5 },
    ];
    this.covers = coverPts;
    const items: FoliageItem[] = [
      { model: 'tree_fir_a', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'tree_fir_b', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'fir_big', impostor: true, collider: 0.35, colliderHeight: 5 },
      { model: 'tree_hornbeam_a', impostor: true, collider: 0.2 },
      { model: 'tree_oak_a', impostor: true, collider: 0.3 },
      { model: 'bush_a', near: 60, shadow: false },
      { model: 'bush_b', near: 60, shadow: false },
      { model: 'boulder_b', near: 70, collider: 0.9, colliderHeight: 1.2 },
      { model: 'boulder_d', near: 60, collider: 0.6, colliderHeight: 1 },
    ];
    const clear = (x: number, z: number) => {
      if (distToPath(x, z, RIVER).d < 16) return true;
      if (distToPath(x, z, ROAD).d < 7 || distToPath(x, z, TRACK).d < 5) return true;
      if (Math.hypot(x - FARM.x, z - FARM.z) < FARM.r + 2) return true;
      if (Math.hypot(x - CABIN.x, z - CABIN.z) < 13) return true;
      if (Math.abs(z - ravZ(x)) < 6) return true;
      if (Math.abs(x - LOG_X) < 6 && Math.abs(z - ravZ(LOG_X)) < 12) return true;
      return false;
    };
    const trees = scatter({
      x0: -176, z0: -170, x1: 186, z1: 192, spacing: 6.2, seed: 33, height: (x, z) => this.y(x, z),
      density: (x, z) => (clear(x, z) ? 0 : 0.55 + 0.35 * fbm(x * 0.02, z * 0.02, 2, 1)),
      pick: (r, x, z) => (r < 0.08 ? 7 : r < 0.12 ? 8 : z > 80 ? (r < 0.5 ? 0 : r < 0.75 ? 1 : 2) : r < 0.35 ? 0 : r < 0.55 ? 1 : r < 0.7 ? 3 : r < 0.85 ? 4 : 2),
      scale: (item, r) => (item >= 7 ? 0.7 + r * 0.5 : item === 2 ? 0.6 + r * 0.4 : item === 4 ? 1.8 + r * 0.5 : 1.0 + r * 0.6),
    });
    const bushes: Placement[] = [];
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const c of coverPts) {
      const n = Math.round(c.r * 3);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * c.r;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        bushes.push({ item: rnd() < 0.5 ? 5 : 6, x, z, y: this.y(x, z), yaw: rnd() * 6.28, s: 0.9 + rnd() * 0.5 });
      }
    }
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, [...trees, ...bushes]);
    // Forest floor: dead trunks, fallen branches, small boulders and a few hornbeams.
    const debrisItems: FoliageItem[] = [
      { model: 'dead_trunk', near: 45, collider: 0.18, colliderHeight: 2 },
      { model: 'branches', near: 30, shadow: false },
      { model: 'boulder_a', near: 60, collider: 0.8, colliderHeight: 0.9 },
      { model: 'boulder_c', near: 45, shadow: false },
      { model: 'tree_hornbeam_c', impostor: true, collider: 0.2 },
    ];
    const debris = scatter({
      x0: -176, z0: -170, x1: 186, z1: 192, spacing: 11, seed: 71, height: (x, z) => this.y(x, z),
      density: (x, z) => (clear(x, z) ? 0 : 0.45),
      pick: (r) => (r < 0.22 ? 0 : r < 0.6 ? 1 : r < 0.74 ? 2 : r < 0.88 ? 3 : 4),
      scale: (item, r) => (item === 4 ? 1.1 + r * 0.5 : 0.8 + r * 0.5),
    });
    await this.foliage.add(debrisItems, debris);
  }

  // ------------------------------------------------------------------ farm
  private async buildFarm(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [planks, dark, roof, white, conc, corr] = await Promise.all([
      L.pbr('planks', { scale: 0.7, color: 0xb04a36 }),
      L.pbr('dark_planks', { scale: 0.6 }),
      L.pbr('roof_tiles', { scale: 0.5, color: 0x6a5a52 }),
      L.pbr('painted_plaster', { scale: 0.5, color: 0xe6e0d0 }),
      L.pbr('concrete_grey', { scale: 0.4 }),
      L.pbr('corrugated', { scale: 0.5, color: 0x8c8c86, metalness: 0.5, roughness: 0.6 }),
    ]);
    const fy = this.baseAt(FARM.x, FARM.z);
    this.farmY = fy;
    // Farmhouse at (24, 66): 9 x 8, two floors, gabled roof
    const hx = 22, hz = 70;
    kit.box(conc, [hx, fy + 0.2, hz], [9.4, 0.4, 8.4], 0, {});
    kit.wall(white, hx - 4.5, hz - 4, hx + 4.5, hz - 4, fy + 0.4, 5.6, 0.25, [{ at: 4.5, width: 1.1, bottom: 0, top: 2.2 }, { at: 2, width: 1.2, bottom: 1.0, top: 2.2 }, { at: 7, width: 1.2, bottom: 1.0, top: 2.2 }, { at: 2, width: 1.0, bottom: 3.4, top: 4.6 }, { at: 7, width: 1.0, bottom: 3.4, top: 4.6 }]);
    kit.wall(white, hx + 4.5, hz + 4, hx - 4.5, hz + 4, fy + 0.4, 5.6, 0.25);
    kit.wall(white, hx - 4.5, hz + 4, hx - 4.5, hz - 4, fy + 0.4, 5.6, 0.25, [{ at: 4, width: 1.2, bottom: 1.0, top: 2.2 }]);
    kit.wall(white, hx + 4.5, hz - 4, hx + 4.5, hz + 4, fy + 0.4, 5.6, 0.25, [{ at: 4, width: 1.2, bottom: 1.0, top: 2.2 }]);
    this.gableMat = white;
    this.roofHalves(roof, hx, fy + 6.0, hz, 9.4, 9.0, 2.0);
    // Porch (with an old radio on a crate)
    kit.box(dark, [hx, fy + 0.35, hz - 5.2], [6, 0.15, 2.2], 0, { surface: 'wood' });
    kit.box(L.plain(0x5a4630, 0.8), [hx + 2.2, fy + 0.65, hz - 5.6], [0.5, 0.45, 0.4], 0, {});
    kit.box(L.plain(0x2c2a26, 0.5, 0.2), [hx + 2.2, fy + 1.0, hz - 5.6], [0.34, 0.22, 0.16], 0, false);
    for (const x of [-2.8, 2.8]) kit.box(dark, [hx + x, fy + 1.6, hz - 6.1], [0.15, 2.5, 0.15], 0, {});
    kit.box(roof, [hx, fy + 2.95, hz - 5.3], [6.4, 0.12, 2.6], 0, false);
    // Glowing windows (on in the evening)
    this.windowMat = L.emissive(0xffcf8a, 0);
    for (const x of [-2.5, 2.5]) for (const y of [1.6, 4.0]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.windowMat); m.position.set(hx + x, fy + 0.4 + y, hz - 4.14); m.rotation.y = Math.PI; w.root.add(m); }
    // Barn at (50, 76): 12 x 16, big door on the south side, back room with the phone
    const bx = 50, bz = 80;
    this.barn = { x: bx, z: bz };
    kit.floor(await L.pbr('gravel_sand', { scale: 0.35, color: 0x8a7a62 }), bx - 6, bz - 8, bx + 6, bz + 8, fy + 0.1, 0.2, 'gravel');
    kit.wall(planks, bx - 6, bz - 8, bx + 6, bz - 8, fy, 6, 0.2, [{ at: 6, width: 4, bottom: 0, top: 4.2 }]);
    kit.wall(planks, bx + 6, bz + 8, bx - 6, bz + 8, fy, 6, 0.2);
    kit.wall(planks, bx - 6, bz + 8, bx - 6, bz - 8, fy, 6, 0.2, [{ at: 12, width: 1.2, bottom: 0, top: 2.2 }]);
    kit.wall(planks, bx + 6, bz - 8, bx + 6, bz + 8, fy, 6, 0.2);
    this.gableMat = planks;
    this.roofHalves(corr, bx, fy + 6, bz, 12.6, 16.6, 3.2);
    kit.wall(planks, bx - 6, bz + 3.5, bx + 6, bz + 3.5, fy, 3, 0.15, [{ at: 6, width: 1.2, bottom: 0, top: 2.2 }]);
    kit.bulb(L.emissive(0xffd29a, 3), L.plain(0x333333, 0.6, 0.5), bx, fy + 2.8, bz + 5.8, 0xffcf90, 1.8, 7, 'barn');
    kit.bulb(L.emissive(0xffd29a, 3), L.plain(0x333333, 0.6, 0.5), bx, fy + 4.5, bz - 2, 0xffcf90, 2.4, 10, 'barn');
    // Wall phone in the back room
    kit.box(L.plain(0x2c2a26, 0.5), [bx + 5.85, fy + 1.45, bz + 6.0], [0.08, 0.3, 0.2], 0, false);
    kit.box(L.plain(0x111111, 0.4), [bx + 5.78, fy + 1.55, bz + 6.0], [0.06, 0.06, 0.22], 0, false);
    // Hay bales, tractor, water tower, fences
    const hay = await w.model('hay_bale');
    const hayX: Array<{ p: [number, number, number]; yaw?: number }> = [];
    for (const [x, z, n] of [[bx - 4, bz - 3, 3], [bx - 4, bz + 1, 2], [32, 50, 3], [30, 44, 2], [36, 46, 2]] as const) {
      for (let i = 0; i < n; i++) hayX.push({ p: [x + (i % 2) * 0.7, fy + Math.floor(i / 2) * 0.65, z + i * 1.25], yaw: 0 });
      w.physics.addBox({ x: x + 0.3, y: fy + 0.6, z: z + (n - 1) * 0.6 }, { x: 1.4, y: 1.3, z: n * 1.25 }, 0, { surface: 'grass' });
    }
    kit.instance(hay, hayX);
    const tractor = await w.model('tractor');
    kit.place(tractor, [60, fy, 62], -Math.PI / 2, 1.1);
    w.physics.addBox({ x: 60, y: fy + 1.1, z: 62 }, { x: 2.6, y: 2.2, z: 3.8 }, 0, { surface: 'metal' });
    const tower = await w.model('water_tower');
    kit.place(tower, [62, fy, 86], 0.4);
    w.physics.addBox({ x: 62, y: fy + 5, z: 86 }, { x: 3.4, y: 10, z: 3.4 }, 0.4, {});
    const barrow = await w.model('wheelbarrow');
    kit.place(barrow, [44, fy, 68], 1.2);
    const shed = await w.model('shed');
    kit.place(shed, [32, fy, 86.5], Math.PI);
    w.physics.addBox({ x: 32, y: fy + 1.15, z: 86.5 }, { x: 4.2, y: 2.3, z: 2.8 }, 0, { surface: 'wood' });
    // Fence around the yard (posts + rails) with gaps
    const fence = (pts: Array<[number, number]>) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx2, bz2] = pts[i + 1];
        const len = Math.hypot(bx2 - ax, bz2 - az), n = Math.max(1, Math.round(len / 2.5));
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx2 - ax) * k / n, z = az + (bz2 - az) * k / n;
          kit.box(dark, [x, this.y(x, z) + 0.6, z], [0.14, 1.2, 0.14], 0, {});
        }
        for (const hh of [0.5, 1.0]) kit.batch.add(cylinderBetween(v3(ax, this.y(ax, az) + hh, az), v3(bx2, this.y(bx2, bz2) + hh, bz2), 0.035, 5), dark);
      }
    };
    fence([[10, 40], [10, 92], [36, 92]]);
    fence([[56, 92], [74, 92], [74, 40], [52, 40]]);
    // Clothesline between two posts, with clothes to take
    const cx0 = 34, cx1 = 42, cz = 58;
    for (const x of [cx0, cx1]) kit.box(dark, [x, fy + 1.1, cz], [0.12, 2.2, 0.12], 0, {});
    kit.batch.add(cylinderBetween(v3(cx0, fy + 2.05, cz), v3(cx1, fy + 2.05, cz), 0.01, 4), L.plain(0xdddddd, 0.6));
    const cloth = (key: string, col: string, kind: 'shirt' | 'jeans') => canvasTexture(key, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.fillStyle = col;
      if (kind === 'shirt') { c.fillRect(s * 0.2, s * 0.15, s * 0.6, s * 0.8); c.fillRect(0, s * 0.15, s * 0.22, s * 0.35); c.fillRect(s * 0.78, s * 0.15, s * 0.22, s * 0.35); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.01; for (let y = s * 0.2; y < s * 0.95; y += s * 0.08) { c.beginPath(); c.moveTo(s * 0.2, y); c.lineTo(s * 0.8, y); c.stroke(); } }
      else { c.fillRect(s * 0.18, 0, s * 0.64, s * 0.3); c.fillRect(s * 0.18, s * 0.3, s * 0.28, s * 0.7); c.fillRect(s * 0.54, s * 0.3, s * 0.28, s * 0.7); }
    }, 128);
    const items: Array<[number, string, 'shirt' | 'jeans']> = [[35, '#5b6f8a', 'shirt'], [36.2, '#3d4f6e', 'jeans'], [37.6, '#8a5a3a', 'shirt'], [38.8, '#2f3a4d', 'jeans'], [40.2, '#d8d2c2', 'shirt']];
    for (const [x, col, kind] of items) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9), new THREE.MeshStandardMaterial({ map: cloth(`cloth_${col}_${kind}`, col, kind), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }));
      m.position.set(x, fy + 1.6, cz);
      m.castShadow = true;
      w.root.add(m);
      this.clothes.push(m);
      w.tickers.add((_dt, t) => { m.rotation.x = Math.sin(t * 1.3 + x) * 0.12; });
    }
  }
  private farmY = 0;
  private gableMat: THREE.Material | null = null;
  private barn = { x: 0, z: 0 };
  private windowMat!: THREE.MeshStandardMaterial;

  /** Two sloped roof panels (gable along z). */
  private roofHalves(mat: THREE.Material, cx: number, y: number, cz: number, wx: number, wz: number, rise: number): void {
    const half = wx / 2;
    const ang = Math.atan2(rise, half);
    const len = Math.hypot(half, rise) + 0.3;
    for (const s of [-1, 1]) {
      const geo = new THREE.BoxGeometry(len, 0.14, wz);
      const m = new THREE.Matrix4().makeRotationZ(-s * ang);
      geo.applyMatrix4(m);
      geo.translate(cx + s * half / 2, y + rise / 2, cz);
      this.kit.batch.add(geo, mat);
    }
    // Gable ends: triangles closing the roof at both ends.
    for (const zz of [cz - wz / 2 + 0.3, cz + wz / 2 - 0.3]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([cx - half, y, zz, cx + half, y, zz, cx, y + rise, zz], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, wx, 0, half, rise], 2));
      tri.setIndex([0, 1, 2, 2, 1, 0]);
      tri.computeVertexNormals();
      this.kit.batch.add(tri, this.gableMat ?? mat);
    }
    this.g.world.physics.addBox({ x: cx, y: y + rise / 2, z: cz }, { x: wx, y: rise, z: wz }, 0, { walkable: false });
  }

  // ------------------------------------------------------------------ cabin + campfire
  private async buildCabin(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [logs, roof, bark] = await Promise.all([
      L.pbr('dark_planks', { scale: 0.6, color: 0x9a7a5a }),
      L.pbr('roof_tiles', { scale: 0.5, color: 0x4a443e }),
      L.pbr('bark_pine', { scale: 0.8 }),
    ]);
    const y = this.baseAt(CABIN.x, CABIN.z);
    const { x, z } = CABIN;
    kit.floor(logs, x - 3, z - 3.5, x + 3, z + 3.5, y + 0.3, 0.3, 'wood');
    kit.wall(logs, x - 3, z - 3.5, x + 3, z - 3.5, y + 0.3, 2.6, 0.2, [{ at: 3, width: 1.0, bottom: 0, top: 2.0 }]);
    kit.wall(logs, x + 3, z + 3.5, x - 3, z + 3.5, y + 0.3, 2.6, 0.2);
    kit.wall(logs, x - 3, z + 3.5, x - 3, z - 3.5, y + 0.3, 2.6, 0.2, [{ at: 3.5, width: 1.0, bottom: 1.0, top: 1.8 }]);
    kit.wall(logs, x + 3, z - 3.5, x + 3, z + 3.5, y + 0.3, 2.6, 0.2);
    this.gableMat = logs;
    this.roofHalves(roof, x, y + 2.9, z, 6.6, 7.6, 1.6);
    // Campfire ring in front of the cabin
    const fx = x + 1, fz = z - 7;
    this.firePos = v3(fx, this.y(fx, fz), fz);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      kit.box(L.plain(0x6b6660, 0.95), [fx + Math.cos(a) * 0.75, this.firePos.y + 0.1, fz + Math.sin(a) * 0.75], [0.3, 0.2, 0.25], a, false);
    }
    this.fire = new THREE.Group();
    this.fire.position.copy(this.firePos);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      const g2 = cylinderBetween(v3(Math.cos(a) * 0.45, 0.05, Math.sin(a) * 0.45), v3(-Math.cos(a) * 0.45, 0.18, -Math.sin(a) * 0.45), 0.06, 6);
      this.fire.add(new THREE.Mesh(g2, bark));
    }
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), L.emissive(0xff6a1a, 3));
    ember.scale.y = 0.4;
    this.fire.add(ember);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.04, 0.9 - i * 0.15, 8, 1, true), flameMat);
      fl.position.set((i - 1) * 0.12, 0.45, (i % 2) * 0.08);
      fl.name = 'flame';
      this.fire.add(fl);
    }
    this.fire.visible = false;
    w.root.add(this.fire);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 14, 2);
    this.fireLight.position.copy(this.firePos).add(v3(0, 0.8, 0));
    w.scene.add(this.fireLight);
    // Logs to sit on
    for (const [ox, oz, yaw] of [[-1.6, 0.3, 0.3], [1.5, -0.4, -0.2]] as const) this.kit.batch.add(cylinderBetween(v3(fx + ox - Math.cos(yaw) * 0.8, this.firePos.y + 0.22, fz + oz + Math.sin(yaw) * 0.8), v3(fx + ox + Math.cos(yaw) * 0.8, this.firePos.y + 0.22, fz + oz - Math.sin(yaw) * 0.8), 0.22, 8), bark);
  }
  private firePos = new THREE.Vector3();

  private updateFire(dt: number): void {
    if (!this.fire.visible) { this.fireLight.intensity = 0; return; }
    this.fireT += dt;
    const t = this.fireT;
    this.fireLight.intensity = 5.5 + Math.sin(t * 13) * 0.9 + Math.sin(t * 7.3) * 0.7 + Math.random() * 0.4;
    for (const c of this.fire.children) if (c.name === 'flame') { c.scale.y = 0.8 + Math.random() * 0.45; c.rotation.y += dt * 2; }
    if (Math.random() < dt * 8) this.g.world.particles.emit('sparks', this.firePos.clone().add(v3(0, 0.4, 0)), 1, v3(0, 1, 0), { speed: 1.2 });
    if (Math.random() < dt * 3) this.g.world.particles.emit('smoke', this.firePos.clone().add(v3(0, 1.0, 0)), 1, v3(0, 1, 0), { speed: 0.6 });
  }

  // ------------------------------------------------------------------ log bridge
  private async buildLog(): Promise<void> {
    const w = this.g.world, L = w.mats;
    const bark = await L.pbr('bark_pine', { scale: 0.7 });
    const z0 = ravZ(LOG_X) - 7.5;
    const base = v3(LOG_X, this.y(LOG_X, z0), z0);
    this.log = new THREE.Group();
    this.log.position.copy(base);
    const len = 15;
    const trunk = new THREE.Mesh(cylinderBetween(v3(0, 0, 0), v3(0, len, 0), 0.38, 10), bark);
    trunk.castShadow = true; trunk.receiveShadow = true;
    this.log.add(trunk);
    // A few dead branches
    for (let i = 0; i < 6; i++) {
      const yy = 5 + i * 1.5, a = i * 2.1;
      this.log.add(new THREE.Mesh(cylinderBetween(v3(0, yy, 0), v3(Math.cos(a) * 1.4, yy + 0.8, Math.sin(a) * 1.4), 0.06, 5), bark));
    }
    w.root.add(this.log);
    // Standing: thin collider at the base; bridge collider enabled when fallen.
    w.physics.addBox({ x: base.x, y: base.y + 2, z: base.z }, { x: 0.8, y: 4, z: 0.8 }, 0, { surface: 'wood' });
    const mid = base.clone().add(v3(0, 0.25, len / 2));
    this.logCol = w.physics.addBox({ x: mid.x, y: base.y + 0.1, z: mid.z }, { x: 0.9, y: 0.5, z: len }, 0, { surface: 'wood' });
    this.logCol.enabled = false;
    this.logBase = base;
    this.applyLog(0);
  }
  private logBase = new THREE.Vector3();

  private applyLog(t: number): void {
    this.logT = t;
    // Fall north (rotate about X).
    const k = t * t;
    this.log.rotation.x = k * (Math.PI / 2 - 0.02);
    this.logCol.enabled = t >= 0.99;
    // Raise the far end slightly so it rests on the far rim.
    if (t >= 0.99) {
      const far = this.y(LOG_X, this.logBase.z + 15);
      this.log.rotation.x = Math.PI / 2 - Math.atan2(far - this.logBase.y, 15);
      this.g.world.physics.move(this.logCol, LOG_X, (this.logBase.y + far) / 2 + 0.25, this.logBase.z + 7.5);
    }
  }

  // ------------------------------------------------------------------ vehicles
  private async buildVehicles(): Promise<void> {
    const w = this.g.world;
    this.cruiser = await Car.create(w, { police: true });
    const p = v3(-30, 0, -95.5);
    p.y = this.y(p.x, p.z);
    this.cruiser.setPose(p, Math.PI / 2 + 0.15, w.physics);
    this.cruiser.sirenOn = true;
    this.patrol = await Car.create(w, { police: true });
    const road = ROAD.map(([x, z]) => v3(x, 0, z + 1.8));
    const back = [...ROAD].reverse().map(([x, z]) => v3(x, 0, z - 1.8));
    const pts = [...road, ...back].map((q) => q.setY(this.y(q.x, q.z)));
    this.patrolPath = new Path(pts, true);
  }

  private updateCars(t: number): void {
    const g = this.g;
    this.cruiser.update(t);
    const on = this.flags.phase === 'road' || this.flags.phase === 'cabin';
    this.patrol.root.visible = on;
    if (!on) { this.patrol.lightsOn = false; return; }
    this.patrol.lightsOn = true;
    const shared = g.session.sharedNow() / 1000;
    const { pos, yaw } = this.patrolPath.at(shared * 13);
    pos.y = this.y(pos.x, pos.z);
    this.patrol.setPose(pos, yaw, g.world.physics);
    this.patrol.update(t);
    this.patrolSound ??= g.audio.engine('car');
    this.patrolSound?.set(1800, 0.3, 0.5, pos);
  }
  private patrolSound: ReturnType<import('../engine/audio').AudioManager['engine']> = null;

  // ================================================================== interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    const lb = this.logBase;
    g.extras.addMemory({ id: 'c3_river', pos: v3(-1, this.y(-1, -141.5), -141.5), radius: 2.2, label: 'Look at the river', enabled: () => this.flags.phase === 'bank', lines: [
      { who: 'jax', text: 'You okay? You\'re staring.' },
      { who: 'elias', text: 'Six years. I forgot rivers make noise.' },
      { who: 'jax', text: 'Enjoy it on the move. Dogs can\'t smell poetry.' },
    ] });
    g.extras.addMemory({ id: 'c3_radio', pos: v3(24.5, this.farmY, 64.2), radius: 1.4, label: 'Listen to the radio', enabled: () => this.flags.phase === 'farm', lines: [
      { who: 'narrator', radio: true, text: '…two inmates escaped Redmoor overnight. Elias Varga, convicted in the killing of Tom Harlan, and Jax Rourke…', dur: 4.4 },
      { who: 'narrator', radio: true, text: '…police ask residents not to approach them.', dur: 2.6 },
      { who: 'jax', text: 'They spelled my name right. That\'s something.' },
    ] });
    I.add({ id: 'log_a', coop: 'log', role: 'a', pos: v3(lb.x - 0.7, lb.y, lb.z - 0.8), radius: 1.3, label: 'Push the dead pine', icon: 'coop', mode: 'hold', holdTime: 1.4, pose: 'push', facing: 0.3,
      enabled: () => this.flags.phase === 'ravine' && !this.flags.logDown });
    I.add({ id: 'log_b', coop: 'log', role: 'b', pos: v3(lb.x + 0.7, lb.y, lb.z - 0.8), radius: 1.3, label: 'Push the dead pine', icon: 'coop', mode: 'hold', holdTime: 1.4, pose: 'push', facing: -0.3,
      enabled: () => this.flags.phase === 'ravine' && !this.flags.logDown });
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      I.add({ id: `clothes_${c}`, who: c, pos: v3(c === 'elias' ? 36.2 : 38.8, this.farmY, 58.6), radius: 1.4, label: 'Take clothes off the line', icon: 'hand', facing: Math.PI,
        enabled: () => this.flags.phase === 'farm' && !this.flags[`clothes_${c}`], onUse: () => { g.local.body.setPose('pick_low', {}, { restart: true }); g.session.request('clothes', { who: c }); } });
    }
  }

  // ================================================================== triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'bank_leave', min: [-60, -20, -128], max: [60, 30, -115], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'track', min: [-60, -20, -112], max: [60, 30, -100], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'scanner', min: [-60, -20, -80], max: [60, 30, -70], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'ravine', min: [-80, -20, -46], max: [80, 30, -38], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'ravine_cross', min: [-80, -20, -22], max: [80, 30, -10], who: 'both', enabled: () => this.flags.phase === 'ravine' && !!this.flags.logDown });
    this.addTrigger({ id: 'farm', min: [FARM.x - 32, -20, FARM.z - 34], max: [FARM.x + 32, 30, FARM.z + 34], who: 'both', enabled: () => this.flags.phase === 'north' });
    this.addTrigger({ id: 'barn', min: [this.barn.x - 5.8, -20, this.barn.z - 7.8], max: [this.barn.x + 5.8, 40, this.barn.z + 3.4], who: 'both', enabled: () => this.flags.phase === 'farm' && !!this.flags.clothes_elias && !!this.flags.clothes_jax });
    this.addTrigger({ id: 'road_crossed', min: [-80, -20, 121], max: [120, 40, 140], who: 'both', enabled: () => this.flags.phase === 'road' });
    this.addTrigger({ id: 'cabin', min: [CABIN.x - 9, -20, CABIN.z - 12], max: [CABIN.x + 9, 40, CABIN.z + 4], who: 'both', enabled: () => this.flags.phase === 'cabin' });
  }

  onTrigger(id: string): void {
    if (!this.authority) return;
    const g = this.g;
    switch (id) {
      case 'bank_leave': this.say('bank'); break;
      case 'track': this.say('track'); this.objective('Sneak past the deputies — crouch in the bushes to stay hidden', [0, 2, -60]); break;
      case 'scanner': this.say('scanner'); break;
      case 'ravine':
        g.session.emit('flag', { k: 'phase', v: 'ravine' });
        this.say('ravine');
        setTimeout(() => this.say('log_tip'), 6000);
        this.objective('Push the dead pine across the ravine together', [this.logBase.x, this.logBase.y + 1.5, this.logBase.z]);
        break;
      case 'ravine_cross':
        this.saveCheckpoint('ravine');
        g.session.emit('flag', { k: 'phase', v: 'north' });
        this.objective('Keep heading north — there\'s a farm past the ridge', [FARM.x, this.farmY + 2, FARM.z - 20]);
        break;
      case 'farm':
        this.saveCheckpoint('farm');
        g.session.emit('flag', { k: 'phase', v: 'farm' });
        this.cutscene('cs3_farm');
        break;
      case 'barn': this.cutscene('cs3_barn'); break;
      case 'road_crossed':
        this.saveCheckpoint('cabin');
        g.session.emit('flag', { k: 'phase', v: 'cabin' });
        this.say('stream');
        this.objective('Follow the stream to the hunting cabin', [CABIN.x, this.baseAt(CABIN.x, CABIN.z) + 2, CABIN.z]);
        break;
      case 'cabin': this.cutscene('cs3_campfire'); break;
    }
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    C.cs3_wake = {
      id: 'cs3_wake', music: 'music_sad',
      start: () => {
        this.setTOD('dawn');
        placeChar(g, 'elias', v3(-2, this.y(-2, -141), -141), 0.4);
        placeChar(g, 'jax', v3(1.8, this.y(1.8, -142.5), -142.5), -0.3);
        poseChar(g, 'elias', 'lying');
        poseChar(g, 'jax', 'sit_ground');
      },
      beats: [
        { dur: 5, fade: 'in', shot: () => shot(v3(20, 3, -150), v3(0, 0.5, -141), 5, { fov: 40, toEnd: v3(0, 0.5, -140) }),
          lines: [{ who: 'narrator', text: 'Dawn. Eleven miles downstream.', dur: 3 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 14, 3.0, 1.0, 1), run: () => { lookChar(g, 'jax', g.body('elias').head()); },
          lines: [
            { who: 'jax', text: 'Professor. Hey. You alive?', anim: 'talk' },
            { who: 'elias', text: '...Define alive.' },
            { who: 'jax', text: 'Breathing. Complaining. Wearing orange.', anim: 'laugh' },
            { who: 'elias', text: 'Then yes. Unfortunately.' },
          ] },
        { dur: 3.5, shot: () => shot(v3(-6, 1.6, -144), v3(2, 1.2, -138), 3.5, { fov: 42 }),
          run: () => { poseChar(g, 'elias', null); poseChar(g, 'jax', null); g.audio.play('dog_bark', { volume: 0.4, pos: v3(-80, 2, -150) }); },
          lines: [{ who: 'elias', text: 'Dogs. Upriver. We move.', dur: 2.6 }] },
      ],
      end: () => { lookChar(g, 'jax', null); if (this.authority) this.objective('Get away from the river before the search teams arrive', [0, 2, -110]); },
    };
    C.cs3_farm = {
      id: 'cs3_farm', music: 'music_explore',
      start: () => { this.setTOD('day'); },
      beats: [
        { dur: 5, shot: () => shot(v3(14, this.farmY + 6, 30), v3(40, this.farmY + 1.5, 62), 5, { fov: 42, toEnd: v3(42, this.farmY + 1.5, 64) }),
          lines: [{ who: 'elias', text: 'A farm. Clothes on the line, a barn, and one old man with very good eyes.', dur: 4.4 }] },
        { dur: 3.6, shot: () => shot(v3(52, this.farmY + 1.8, 56), v3(58, this.farmY + 1.4, 62), 3.6, { fov: 36 }), run: () => npcPlace(g, 'walt', v3(56, this.farmY, 62), Math.PI / 2),
          lines: [{ who: 'walt', text: '(whistling)', dur: 2 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 8, 2.4, 1.4, -1), lines: [
          { who: 'jax', text: 'We can\'t walk into town looking like a pumpkin patch.' },
          { who: 'elias', text: 'One each. Keep the hay bales between you and him. Then the barn.' },
        ] },
      ],
      end: () => { if (this.authority) this.objective('Steal clothes from the line — don\'t let the farmer see you', [38, this.farmY + 1.6, 58]); },
    };
    C.cs3_barn = {
      id: 'cs3_barn', music: 'music_sad',
      start: () => {
        const b = this.barn;
        placeChar(g, 'elias', v3(b.x - 2, this.farmY + 0.1, b.z - 1), 0.4);
        placeChar(g, 'jax', v3(b.x + 1.5, this.farmY + 0.1, b.z - 0.5), -0.6);
      },
      beats: [
        { dur: 3, fade: 'out', shot: () => shot(v3(this.barn.x, this.farmY + 3, this.barn.z - 6), v3(this.barn.x, this.farmY + 1.2, this.barn.z), 3, { fov: 44 }) },
        { dur: 2.5, fade: 'in', shot: () => shot(v3(this.barn.x - 3, this.farmY + 1.6, this.barn.z - 4), v3(this.barn.x, this.farmY + 1.3, this.barn.z - 0.6), 2.5, { fov: 40 }),
          run: () => { g.session.authority && g.session.emit('outfit', { who: 'elias', v: 'civil' }); g.session.authority && g.session.emit('outfit', { who: 'jax', v: 'civil' }); } },
        { shot: () => twoShot(g, 'elias', 'jax', 7, 2.2, 1.45, 1), lines: [
          { who: 'jax', text: 'How do I look?', anim: 'shrug' },
          { who: 'elias', text: 'Like a man who stole a farmer\'s Sunday shirt.' },
          { who: 'jax', text: 'There\'s a phone back there. I\'ll keep watch on the road. Two minutes.', anim: 'talk' },
        ] },
        { dur: 2.2, shot: () => shot(v3(this.barn.x + 3, this.farmY + 1.7, this.barn.z + 4.2), v3(this.barn.x + 5.6, this.farmY + 1.4, this.barn.z + 6), 2.2, { fov: 38 }),
          run: () => { walkChar(g, 'jax', [v3(this.barn.x + 0.5, this.farmY + 0.1, this.barn.z + 3.5), v3(this.barn.x + 5.0, this.farmY + 0.1, this.barn.z + 6.0)], 1.4, () => { poseChar(g, 'jax', 'talk_phone'); }, Math.PI / 2); } },
        { shot: () => shot(v3(this.barn.x + 3.8, this.farmY + 1.65, this.barn.z + 5.0), v3(this.barn.x + 5.2, this.farmY + 1.6, this.barn.z + 6.05), 13, { fov: 34 }),
          run: () => { placeChar(g, 'jax', v3(this.barn.x + 5.1, this.farmY + 0.1, this.barn.z + 6.0), Math.PI / 2); poseChar(g, 'jax', 'talk_phone'); clipChar(g, 'jax', 'phone_listen', 'upper'); },
          lines: [
            { who: 'jax', text: '(quietly) It\'s me.', pause: 1.2 },
            { who: 'jax', text: 'We\'re out. Both of us. ...No. Not yet.', pause: 1.0 },
            { who: 'jax', text: 'He hasn\'t said. He doesn\'t trust anybody. ...I know what I signed.', pause: 0.8 },
            { who: 'jax', text: 'Just— give me time. I\'ll call when I can.', pause: 0.6 },
          ] },
        { dur: 1.6, shot: () => closeUp(g, 'jax', 1.6, 0.9, 0.2, { fov: 32 }), run: () => { clipChar(g, 'jax', null, 'upper'); poseChar(g, 'jax', null); g.audio.play('switch', { pos: v3(this.barn.x + 5.8, this.farmY + 1.5, this.barn.z + 6), volume: 0.5 }); placeChar(g, 'elias', v3(this.barn.x + 1.4, this.farmY + 0.1, this.barn.z + 5.0), Math.PI / 2); } },
        { shot: () => twoShot(g, 'elias', 'jax', 9, 2.0, 1.45, 1), lines: [
          { who: 'elias', text: 'Who was that?' },
          { who: 'jax', text: 'My cousin. In Harlow. Figured he could lend us a car.', anim: 'talk' },
          { who: 'elias', text: 'And?' },
          { who: 'jax', text: 'Didn\'t pick up. Left a message. Let\'s go before the old man comes in for his tractor keys.', anim: 'shrug' },
        ] },
        { dur: 2.5, fade: 'out', shot: () => shot(v3(this.barn.x, this.farmY + 4, this.barn.z - 12), v3(this.barn.x, this.farmY + 2, this.barn.z), 2.5, { fov: 46 }) },
      ],
      end: () => {
        if (this.authority) {
          g.session.emit('outfit', { who: 'elias', v: 'civil' });
          g.session.emit('outfit', { who: 'jax', v: 'civil' });
          this.saveCheckpoint('road');
          g.session.emit('restart', { checkpoint: 'road' });
        }
      },
    };
    C.cs3_campfire = {
      id: 'cs3_campfire', music: 'music_sad', skippable: true,
      start: () => {
        this.setTOD('night');
        this.fire.visible = true;
        const f = this.firePos;
        placeChar(g, 'elias', v3(f.x - 1.6, f.y, f.z + 0.3), Math.PI / 2 - 0.3);
        placeChar(g, 'jax', v3(f.x + 1.5, f.y, f.z - 0.4), -Math.PI / 2 - 0.2);
        poseChar(g, 'elias', 'sit_ground');
        poseChar(g, 'jax', 'sit_ground');
        g.audio.play('crowd_cheer', { volume: 0 });
      },
      beats: [
        { dur: 5, fade: 'in', shot: () => shot(v3(this.firePos.x + 6, this.firePos.y + 3, this.firePos.z - 8), v3(this.firePos.x, this.firePos.y + 0.8, this.firePos.z), 5, { fov: 42, fromEnd: v3(this.firePos.x + 4, this.firePos.y + 2, this.firePos.z - 6) }),
          lines: [{ who: 'narrator', text: 'Night. A hunting cabin twenty miles from Harlow.', dur: 3.4 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 60, 3.0, 0.9, 1), lines: [
          { who: 'jax', text: 'So. Victor Crane.', pause: 0.6 },
          { who: 'elias', text: 'I kept his books for nine years. Crane Development. Roads, bridges, a shopping mall that never got built.' },
          { who: 'elias', text: 'There were two sets of books. The second one was full of money that came from nowhere and went to people with no faces.' },
          { who: 'jax', text: 'And you said something.' },
          { who: 'elias', text: 'I told my partner, Tom Harlan. We were going to the state attorney on a Monday.', pause: 0.6 },
          { who: 'elias', text: 'Sunday night Tom was dead in my garage. My gun. My prints. My twenty-five years.', anim: 'talk_sad', pause: 1.2 },
          { who: 'jax', text: '...I\'m sorry.', anim: 'listen_sad' },
          { who: 'elias', text: 'Your turn. You flinched when I said his name. In the vent, that first night.', look: 'jax' },
        ] },
        { shot: () => closeUp(g, 'jax', 40, 1.0, 0.25, { fov: 34 }), lines: [
          { who: 'jax', text: 'My brother Danny drove for him. Just a driver. Didn\'t ask what was in the trunk.', pause: 0.5 },
          { who: 'jax', text: 'One night a pickup went bad. Cops everywhere. Crane\'s guys walked away. Danny was left holding the wheel.' },
          { who: 'jax', text: 'County lockup. Two days later they said Danny hung himself in his cell.', pause: 1.0 },
          { who: 'jax', text: 'Danny was scared of the dark, Elias. Slept with the hall light on till he was twenty. He didn\'t hang himself.', anim: 'talk_angry', pause: 1.2 },
          { who: 'elias', text: 'Crane made a phone call.' },
          { who: 'jax', text: 'Crane made a phone call.' },
        ] },
        { shot: () => twoShot(g, 'jax', 'elias', 40, 2.6, 1.0, -1), lines: [
          { who: 'elias', text: 'The ballistics on Tom never matched. The bullet was from a different lot than the box in my drawer. My lawyer couldn\'t get it in front of the jury.', pause: 0.5 },
          { who: 'jax', text: 'Yeah. The lot numbers. Somebody at the lab buried that.', pause: 1.5 },
          { who: 'elias', text: '...That was never in the papers, Jax.', look: 'jax', pause: 1.5 },
          { who: 'jax', text: 'You hear things in county. Lawyers talk. Guards talk.', anim: 'shrug', pause: 0.8 },
          { who: 'elias', text: 'Mm.', pause: 1.5 },
          { who: 'elias', text: 'My sister Mia runs a scrapyard in Harlow. She\'ll hide us. And she knows where Crane spends his nights.' },
          { who: 'jax', text: 'And then?' },
          { who: 'elias', text: 'And then he tells the truth. Or he never tells anything again.' },
        ] },
        { dur: 4, fade: 'out', shot: () => shot(v3(this.firePos.x, this.firePos.y + 10, this.firePos.z - 14), v3(this.firePos.x, this.firePos.y, this.firePos.z), 4, { fov: 40 }) },
      ],
      end: () => {
        poseChar(g, 'elias', null); poseChar(g, 'jax', null);
        if (this.authority) g.session.emit('chapterEnd', { next: 4 });
      },
    };
  }

  // ================================================================== time of day
  setTOD(t: TOD): void {
    this.tod = t;
    const w = this.g.world, s = TODS[t];
    if (w.sun) { w.sun.color.setHex(s.sun); w.sun.intensity = s.sunI; w.sun.userData.dir = new THREE.Vector3(...s.dir).normalize(); }
    if (w.hemi) { w.hemi.color.setHex(s.sky); w.hemi.groundColor.setHex(s.ground); w.hemi.intensity = s.hemiI; }
    const fog = w.scene.fog as THREE.FogExp2 | null;
    if (fog) { fog.color.setHex(s.fog); fog.density = s.dens; }
    w.scene.background = new THREE.Color(s.bg);
    w.scene.environmentIntensity = s.env;
    this.g.deps.renderer.setGrade({ saturation: s.sat, contrast: 1.06, exposure: s.exposure, lift: [0.01, 0.01, 0.015], gain: [1.03, 1.0, 0.96], bloom: t === 'night' ? 1.0 : 0.6, vignette: t === 'night' ? 0.62 : 0.5 });
    this.windowMat.emissiveIntensity = t === 'dusk' || t === 'night' ? 2.2 : 0;
    this.setRain(false);
  }
  private setRain(_on: boolean): void { /* clear weather in chapter 3 */ }

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    g.flags.combat = false;
    for (const n of g.npcs.values()) { n.reset(); n.enabled = false; n.body.visible = false; n.body.solid = false; }
    for (const f of this.flash.values()) f.dispose();
    this.flash.clear();
    const on = (ids: string[], torches = false) => {
      for (const i of ids) {
        const n = g.npcs.get(i);
        if (!n) continue;
        n.enabled = true; n.body.visible = true; n.body.solid = true;
        if (torches) this.flash.set(i, new Flashlight(g.world, n.body, 12, 0.3));
      }
    };
    this.fire.visible = false;
    const phaseOf: Record<string, string> = { bank: 'bank', ravine: 'ravine', farm: 'farm', road: 'road', cabin: 'cabin' };
    this.flags.phase = phaseOf[id] ?? 'bank';
    const past = (p: string) => ['bank', 'ravine', 'farm', 'road', 'cabin'].indexOf(id) > ['bank', 'ravine', 'farm', 'road', 'cabin'].indexOf(p);
    if (!past('ravine')) delete this.flags.logDown; else this.flags.logDown = true;
    if (id === 'ravine') this.flags.logDown = true;
    if (!past('farm')) { delete this.flags.clothes_elias; delete this.flags.clothes_jax; }
    this.applyLog(this.flags.logDown ? 1 : 0);
    for (let i = 0; i < this.clothes.length; i++) this.clothes[i].visible = !(past('farm') || (i === 1 && this.flags.clothes_elias) || (i === 3 && this.flags.clothes_jax));
    this.roadSpotT = { elias: 0, jax: 0 };
    switch (id) {
      case 'bank': case 'ravine':
        this.setTOD('dawn');
        on(['cole', 'price', 'reyes', 'hale'], true);
        g.audio.playMusic('music_stealth', 2);
        break;
      case 'farm':
        this.setTOD('day');
        on(['walt']);
        g.audio.playMusic('music_explore', 2);
        break;
      case 'road':
        this.setTOD('dusk');
        g.audio.playMusic('music_stealth', 2);
        if (this.authority) setTimeout(() => { this.say('road'); this.objective('Cross the county road without being seen', [46, this.baseAt(46, 112) + 1, 112]); }, 800);
        setTimeout(() => { if (this.authority) this.say('road_tip'); }, 7000);
        break;
      case 'cabin':
        this.setTOD('night');
        g.audio.playMusic('music_night', 2);
        break;
    }
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'coop':
        if (a.group === 'log') {
          this.flags.logDown = true;
          g.audio.play('creak', { pos: this.logBase, volume: 0.9 });
          setTimeout(() => { g.audio.play('big_crash', { pos: this.logBase.clone().add(v3(0, 0, 12)), volume: 0.8 }); g.cam.addShake(0.3); g.world.particles.emit('dust', this.logBase.clone().add(v3(0, 0.5, 14)), 30); }, 1100);
          if (this.authority) setTimeout(() => { this.say('log_done'); this.objective('Cross the log', [LOG_X, this.logBase.y + 1, ravZ(LOG_X)]); }, 1500);
          return true;
        }
        return false;
      case 'clothes': {
        const who = a.who as CharacterId;
        this.flags[`clothes_${who}`] = true;
        this.clothes[who === 'elias' ? 1 : 3].visible = false;
        this.clothes[who === 'elias' ? 0 : 2].visible = false;
        g.audio.play('whoosh', { pos: v3(38, this.farmY + 1.5, 58), volume: 0.4 });
        if (this.authority) {
          if (this.flags.clothes_elias && this.flags.clothes_jax) { this.say('clothes_both'); this.objective('Get into the barn together', [this.barn.x, this.farmY + 2, this.barn.z - 8]); }
          else this.say(who === 'elias' ? 'clothes_one' : 'farm_line');
        }
        return true;
      }
      case 'spotted': {
        if (!this.authority) return true;
        const who = a.who as CharacterId;
        if (a.npc === 'walt') g.session.emit('dlg', { lines: this.dialogues.walt_spot, at: g.session.sharedNow() });
        setTimeout(() => { if (g.state === 'playing') g.session.emit('caught', { who, by: a.npc }); }, 900);
        return true;
      }
      case 'restarted':
        return true;
      case 'flag':
        return true;
    }
    return false;
  }

  validate(type: string, a: unknown): boolean {
    const args = (a ?? {}) as Record<string, unknown>;
    if (type === 'clothes') return this.flags.phase === 'farm' && !this.flags[`clothes_${args.who}`];
    return true;
  }

  // ================================================================== frame
  update(dt: number): void {
    const g = this.g;
    // Log falling animation
    if (this.flags.logDown && this.logT < 1) this.applyLog(Math.min(1, this.logT + dt * 0.9));
    // Concealment: crouched inside a bush cluster
    const lb = g.local.body;
    lb.concealed = lb.crouched && this.covers.some((c) => Math.hypot(lb.pos.x - c.x, lb.pos.z - c.z) < c.r);
    if (!this.authority) return;
    // Road: the patrol car spots anyone in its headlights or right next to it.
    if (this.flags.phase === 'road' && g.state === 'playing') {
      for (const c of ['elias', 'jax'] as CharacterId[]) {
        const b = g.body(c);
        const cone = this.patrol.cones[0];
        const lit = coneLight(cone, b.pos, 0.9) > 0.2 && !b.concealed;
        const close = b.pos.distanceTo(this.patrol.root.position) < 4.5;
        this.roadSpotT[c] = lit || close ? this.roadSpotT[c] + dt : Math.max(0, this.roadSpotT[c] - dt);
        if (this.roadSpotT[c] > 0.45) {
          this.roadSpotT[c] = 0;
          g.session.emit('dlg', { lines: [{ who: 'cop', text: 'Hey — you two! Stop right there!', dur: 2 } satisfies Line], at: g.session.sharedNow() });
          g.session.emit('caught', { who: c, by: 'patrol' });
        }
      }
    }
  }

  lightAt(p: THREE.Vector3): number {
    const base = this.tod === 'night' ? 0.15 : this.tod === 'dusk' ? 0.45 : this.tod === 'dawn' ? 0.6 : 1;
    let l = base;
    for (const f of this.flash.values()) l += coneLight(f, p) * 0.6;
    return Math.min(1.4, l);
  }

  suspicion(_who: CharacterId, _p: THREE.Vector3, _npc: string): number {
    // Escaped convicts in orange: anyone who sees them reacts.
    return this.flags.phase === 'farm' ? 1.2 : 1.1;
  }

  dispose(): void {
    for (const f of this.flash.values()) f.dispose();
    this.patrolSound?.stop();
  }
}
