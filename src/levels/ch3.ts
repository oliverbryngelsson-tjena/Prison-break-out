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
import { BikeSystem } from '../game/bike';
import { SHOP, WEAPONS } from '../game/weapons';
import { SPEAKERS } from '../game/game';
import { cylinderBetween } from '../engine/geometry';
import { canvasTexture } from '../engine/materials';
import type { Line } from '../game/dialogue';

const RIVER: Array<[number, number]> = [[-180, -146], [-110, -152], [-50, -147], [0, -151], [60, -146], [120, -152], [190, -148]];
const RIVER_Y = -2.2;
const ROAD: Array<[number, number]> = [];
for (let x = -170; x <= 190; x += 10) ROAD.push([x, 112 + Math.sin(x / 40) * 5]);
const TRACK: Array<[number, number]> = [[-170, -98], [-90, -94], [-30, -96], [20, -92], [80, -97], [190, -94]];
const FARM = { x: 40, z: 58, r: 34 };
const CABIN = { x: -32, z: 152 }; // Jax's trailer in Black Hollow
/** Where Ray's car stops on the county road. */
const PICKUP = { x: 52, z: 112 + Math.sin(52 / 40) * 5 - 3 };
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
    farm: { spawn: { elias: { pos: [18, 0, 26], yaw: 0.6 }, jax: { pos: [20, 0, 25], yaw: 0.6 } }, objective: 'Steal clothes from the line — don\'t let the farmer see you', outfit: 'prison' },
    road: { spawn: { elias: { pos: [46, 0, 92], yaw: 0 }, jax: { pos: [48, 0, 91], yaw: 0 } }, objective: 'Get to the mile marker on the county road — stay out of the patrol\'s headlights', outfit: 'civil' },
    cabin: { spawn: { elias: { pos: [-28.5, 0, 146.5], yaw: -0.4 }, jax: { pos: [-26.8, 0, 147.2], yaw: -0.6 } }, objective: 'Find the cash Jax hid under his trailer', intro: 'cs3_trailer', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: true, sprint: true, combat: false, crouch: true };
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
    d.push({ id: 'dutch', char: 'dealer', role: 'story', name: 'Dutch', pos: [36, 0, 40], yaw: Math.PI, passive: true, idleClip: 'idle_wait' });
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    // Walk-and-talk (you keep control while they talk).
    D.plan = [
      { who: 'elias', text: 'We can\'t walk to Harlow in prison orange. We need a car, a phone, a miracle.' },
      { who: 'jax', text: 'We need Ray.', anim: 'talk' },
      { who: 'elias', text: 'Who\'s Ray?' },
      { who: 'jax', text: 'Visiting day, three weeks ago. The guy in the Raiders cap who cried a little.' },
      { who: 'elias', text: 'That was your cousin?' },
      { who: 'jax', text: 'I told him: if I ever get out, the county road past the Ashby farm, dusk. He\'s been watching the news every night since.', anim: 'talk_cool' },
      { who: 'elias', text: 'You planned this before you even met me.' },
      { who: 'jax', text: 'I planned to get out. You were the bonus. The guy with the map.', anim: 'laugh' },
          { who: 'elias', text: 'Then let\'s not keep Ray waiting.' },
    ];
    D.farm_arrive = [
      { who: 'elias', text: 'A farm. Clothes on the line, a barn, and one old man with very good eyes.' },
      { who: 'jax', text: 'We can\'t walk into town looking like a pumpkin patch.' },
      { who: 'elias', text: 'One each. Keep the hay bales between you and him. Then the barn.' },
    ];
    D.trailer_talk = [
      { who: 'jax', text: 'Home sweet home. Rent\'s cheap when you never pay it.' },
      { who: 'elias', text: 'Ray didn\'t want to come in?' },
      { who: 'jax', text: 'Ray doesn\'t want to know anything. Smartest man in our family.' },
      { who: 'jax', text: 'Cash is under the floor at the back. Panel\'s heavy — give me a hand.' },
    ];
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
      { who: 'jax', text: 'Then we wait for Ray where it can\'t see us. He\'ll be at the mile marker.' },
    ];
    D.road_tip = [{ who: 'narrator', text: 'Stay out of the patrol car\'s headlights. Move when it is far away.', dur: 3.5 }];
    D.pickup_go = [{ who: 'jax', text: 'Mile marker\'s just past the bend. Ray will flash his lights twice.' }];
    D.trailer_cash = [
      { who: 'jax', text: 'Got it. Eleven grand, give or take what the mice ate.' },
      { who: 'elias', text: 'You buried eleven thousand dollars under a trailer.' },
      { who: 'jax', text: 'Banks ask questions. Dirt doesn\'t.' },
    ];
    D.bikes_go = [{ who: 'jax', text: 'Dutch doesn\'t wait. Bikes are by the tarp — keys are in them, nobody comes out here.' }];
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
    this.bikes = new BikeSystem(g);
    await this.bikes.init({ headlights: true });
    for (const v of this.bikes.visuals.values()) v.root.visible = false;
    this.bikes.ctrl.onCrash = () => { /* a short ride: crashes just stop the bike */ };
    this.rayCar = await Car.create(w, { tint: 0x6a2a24 });
    this.rayCar.root.visible = false;
    this.dutchVan = await Car.create(w, { tint: 0x2c2f33 });
    this.dutchVan.root.visible = false;
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
      this.updateRayCar(dt, t);
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
    // Jax's trailer: an old single-wide on blocks, porch light, a lit window, a tarp for the bikes.
    void roof;
    const shell = await L.pbr('corrugated', { scale: 0.6, color: 0xb8b0a0, metalness: 0.35, roughness: 0.6 });
    kit.box(shell, [x, y + 1.75, z], [7.6, 2.7, 2.7], 0, { surface: 'metal' });
    for (const dx of [-3, 0, 3]) kit.box(L.plain(0x6e6a64, 0.95), [x + dx, y + 0.2, z], [0.4, 0.4, 2.4], 0, false);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), L.emissive(0xffd9a0, 2.2));
    win.position.set(x - 1.8, y + 2.0, z - 1.36); win.rotation.y = Math.PI;
    this.g.world.root.add(win);
    kit.box(L.plain(0x5a4630, 0.8), [x + 1.6, y + 1.5, z - 1.37], [0.9, 2.0, 0.04], 0, false); // door
    kit.stairs(logs, x + 1.6, z - 2.6, 0, 1.0, y, y + 0.4, 1.2, 'wood');
    kit.bulb(L.emissive(0xffd29a, 3), L.plain(0x333333, 0.6, 0.5), x + 2.4, y + 2.6, z - 1.5, 0xffc890, 2.2, 9, 'trailer');
    // Floor panel at the back (the cash)
    kit.box(L.plain(0x4a3a2a, 0.9), [x, y + 0.45, z + 1.45], [1.4, 0.06, 0.6], 0, false);
    // Tarp lean-to where the bikes live
    kit.box(L.plain(0x3d4a3a, 1), [x + 6.2, y + 2.1, z - 0.5], [3.6, 0.05, 3.2], 0, false);
    for (const [dx, dz] of [[4.5, -2], [7.9, -2], [4.5, 1], [7.9, 1]] as const) this.kit.batch.add(cylinderBetween(v3(x + dx, y, z + dz), v3(x + dx, y + 2.1, z + dz), 0.05, 6), L.plain(0x6a5a46, 0.9));
    this.gableMat = logs;
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
    // Jax's old basketball hoop by the trailer (mini-game): pole, backboard, rim and net.
    {
      const hx = x - 6.5, hz = z - 9.5, hy = this.y(hx, hz);
      const steelH = L.plain(0x55595c, 0.5, 0.6);
      kit.batch.add(cylinderBetween(v3(hx, hy, hz - 0.5), v3(hx, hy + 3.25, hz - 0.5), 0.07, 10), steelH);
      kit.batch.add(cylinderBetween(v3(hx, hy + 3.1, hz - 0.5), v3(hx, hy + 3.1, hz - 0.3), 0.05, 8), steelH);
      kit.box(L.plain(0xd8d4c8, 0.7), [hx, hy + 3.35, hz - 0.28], [1.6, 1.0, 0.05], 0, false);
      kit.box(L.plain(0xb0402a, 0.6), [hx, hy + 3.18, hz - 0.25], [0.5, 0.35, 0.02], 0, false);
      const rim = new THREE.TorusGeometry(0.23, 0.017, 6, 22);
      rim.rotateX(Math.PI / 2);
      rim.translate(hx, hy + 3.05, hz);
      kit.batch.add(rim, L.plain(0xc04020, 0.5, 0.4));
      const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.4, 12, 3, true), new THREE.MeshStandardMaterial({ color: 0xeeeeee, wireframe: true, transparent: true, opacity: 0.6 }));
      net.position.set(hx, hy + 2.84, hz);
      w.root.add(net);
      w.physics.addBox({ x: hx, y: hy + 1.6, z: hz - 0.5 }, { x: 0.2, y: 3.2, z: 0.2 }, 0, { surface: 'metal' });
      kit.batch.add(cylinderBetween(v3(hx, hy + 3.25, hz - 0.5), v3(hx, hy + 4.1, hz - 0.5), 0.04, 8), steelH);
      kit.bulb(L.emissive(0xffe0b0, 3), steelH, hx, hy + 4.15, hz - 0.3, 0xffdcaa, 2.6, 13, 'trailer');
      this.hoop = { rim: v3(hx, hy + 3.05, hz), spots: [v3(hx - 1.1, this.y(hx - 1.1, hz + 4.3), hz + 4.3), v3(hx + 1.1, this.y(hx + 1.1, hz + 4.3), hz + 4.3)] };
    }
    // Logs to sit on
    for (const [ox, oz, yaw] of [[-1.6, 0.3, 0.3], [1.5, -0.4, -0.2]] as const) this.kit.batch.add(cylinderBetween(v3(fx + ox - Math.cos(yaw) * 0.8, this.firePos.y + 0.22, fz + oz + Math.sin(yaw) * 0.8), v3(fx + ox + Math.cos(yaw) * 0.8, this.firePos.y + 0.22, fz + oz - Math.sin(yaw) * 0.8), 0.22, 8), bark);
  }
  private firePos = new THREE.Vector3();
  private hoop = { rim: v3(0, 0, 0), spots: [v3(0, 0, 0), v3(0, 0, 0)] as [THREE.Vector3, THREE.Vector3] };

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
    // Standing: thin collider at the base (removed once it falls). The walkable bridge is a slope
    // along the trunk, added when it lands.
    this.logStand = w.physics.addBox({ x: base.x, y: base.y + 2, z: base.z }, { x: 0.8, y: 4, z: 0.8 }, 0, { surface: 'wood' });
    this.logBase = base;
    this.applyLog(0);
  }
  private logBase = new THREE.Vector3();
  /** Scripted walk over the fallen pine, arms out for balance. */
  private crossLog(): void {
    const g = this.g, b = this.logBase, far = this.logFar();
    const side = g.localChar === 'elias' ? -0.6 : 0.6;
    const off = this.y(LOG_X + side, far.z + 1.6);
    g.local.runScript([
      { to: v3(LOG_X, b.y + 0.38, b.z + 0.5), dur: 0.6, yaw: 0, anim: 1.2 },
      { to: v3(LOG_X, far.y + 0.38, far.z - 0.5), dur: 6.0, yaw: 0, anim: 1.0, pose: 'balance' },
      { to: v3(LOG_X + side, off, far.z + 1.6), dur: 0.6, yaw: 0, anim: 1.4 },
    ]);
    g.audio.play('creak', { pos: b.clone().add(v3(0, 0, 7)), volume: 0.4 });
  }
  private logStand: import('../engine/physics').Box | null = null;
  private logRamp: import('../engine/physics').Box | null = null;
  /** Far end of the fallen log (top of the trunk). */
  private logFar(): THREE.Vector3 { return v3(LOG_X, this.y(LOG_X, this.logBase.z + 15), this.logBase.z + 15); }

  private applyLog(t: number): void {
    this.logT = t;
    // Fall north (rotate about X).
    const k = t * t;
    this.log.rotation.x = k * (Math.PI / 2 - 0.02);
    const down = t >= 0.99;
    if (this.logStand) this.logStand.enabled = !down;
    if (this.logRamp) this.logRamp.enabled = down;
    // Raise the far end slightly so it rests on the far rim.
    if (down) {
      const far = this.logFar().y;
      this.log.rotation.x = Math.PI / 2 - Math.atan2(far - this.logBase.y, 15);
      if (!this.logRamp) {
        // Walkable slope along the top of the trunk, from rim to rim.
        // Starts at ground level a metre before the trunk so you can step on from the rim.
        const z0 = this.logBase.z - 1.0, z1 = this.logBase.z + 15.2;
        const y0 = this.logBase.y + 0.02, y1 = far + 0.38;
        this.logRamp = this.g.world.physics.addRamp({ x: LOG_X, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, { x: 1.1, y: Math.abs(y1 - y0) + 0.3, z: z1 - z0 }, 0, 'z', y0, y1, { surface: 'wood' });
      }
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
    const on = this.flags.phase === 'road';
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

  /** Ray's car rolls in along the county road and stops at the pickup spot. */
  private updateRayCar(dt: number, t: number): void {
    if (!this.rayCar) return;
    const d = this.rayDrive;
    if (d) {
      // Shared clock, so the car is in the same place on both screens (and in step with the cutscene).
      const u = Math.min(1, Math.max(0, (this.g.session.sharedNow() - d.start) / 1000 / d.dur));
      const k = 1 - (1 - u) ** 2;
      void dt;
      const x = THREE.MathUtils.lerp(PICKUP.x + 70, PICKUP.x + 2, k);
      const z = 112 + Math.sin(x / 40) * 5 - 1.6;
      const x2 = x + 0.5, z2 = 112 + Math.sin(x2 / 40) * 5 - 1.6;
      this.rayCar.setPose(v3(x, this.y(x, z), z), Math.atan2(x - x2, z - z2), this.g.world.physics);
      this.rayCar.lightsOn = true;
    }
    if (this.rayCar.root.visible) this.rayCar.update(t);
    if (this.dutchVan.root.visible) this.dutchVan.update(t);
  }

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
    // Once it's down: press Use at the near end to walk across (balancing).
    I.add({ id: 'log_cross', pos: v3(lb.x, lb.y, lb.z - 0.3), radius: 1.8, label: 'Cross the log', icon: 'climb', priority: 2,
      enabled: () => !!this.flags.logDown && this.logT >= 0.99 && this.g.local.body.pos.z < lb.z + 1, onUse: () => this.crossLog() });
    I.add({ id: 'log_b', coop: 'log', role: 'b', pos: v3(lb.x + 0.7, lb.y, lb.z - 0.8), radius: 1.3, label: 'Push the dead pine', icon: 'coop', mode: 'hold', holdTime: 1.4, pose: 'push', facing: -0.3,
      enabled: () => this.flags.phase === 'ravine' && !this.flags.logDown });
    // Jax's trailer: lift the floor panel together, then the bikes.
    const ty = this.baseAt(CABIN.x, CABIN.z);
    for (const [role, dx] of [['a', -0.7], ['b', 0.7]] as const) {
      I.add({ id: `cash_${role}`, coop: 'cash', role, pos: v3(CABIN.x + dx, ty, CABIN.z + 2.1), radius: 1.2, label: 'Lift the floor panel', icon: 'coop', mode: 'hold', holdTime: 1.4, pose: 'pick_low', facing: Math.PI,
        enabled: () => this.flags.phase === 'cabin' && !this.flags.cash });
    }
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      const bp = this.bikeSpot(c);
      I.add({ id: `bike_${c}`, who: c, pos: bp.pos, radius: 1.6, label: 'Get on the bike', icon: 'hand',
        enabled: () => this.flags.phase === 'cabin' && !!this.flags.talked && !this.bikes.mounted,
        onUse: () => { this.bikes.parkedLocal = false; this.bikes.mount(bp.pos.clone(), bp.yaw); g.session.request('mounted', { who: c }); } });
    }
    // One game of HORSE before the bikes (optional).
    g.minigames.addHoops({ id: 'hoops_jax', rim: this.hoop.rim, spots: this.hoop.spots, enabled: () => this.flags.phase === 'cabin' && !this.bikes.mounted });
    // Dutch's guns, laid out behind his car: each of you picks one.
    I.add({ id: 'deal_guns', pos: this.dealPos, radius: 1.8, label: () => (this.flags[`picked_${g.localChar}`] ? 'Swap your weapon' : 'Pick a weapon'), icon: 'hand', priority: 4,
      enabled: () => this.flags.phase === 'dealer' && !g.hud.shopOpen, onUse: () => g.openWeaponShop('Dutch\'s guns — take one') });
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      I.add({ id: `clothes_${c}`, who: c, pos: v3(c === 'elias' ? 36.2 : 38.8, this.farmY, 58.6), radius: 1.4, label: 'Take clothes off the line', icon: 'hand', facing: Math.PI,
        enabled: () => this.flags.phase === 'farm' && !this.flags[`clothes_${c}`], onUse: () => { g.local.body.setPose('pick_low', {}, { restart: true }); g.session.request('clothes', { who: c }); } });
    }
  }

  /** Where each bike waits under the tarp. */
  private bikeSpot(c: CharacterId): { pos: THREE.Vector3; yaw: number } {
    const x = CABIN.x + (c === 'elias' ? 5.4 : 7.0), z = CABIN.z - 0.6;
    return { pos: v3(x, this.baseAt(CABIN.x, CABIN.z), z), yaw: -Math.PI / 2 - 0.3 };
  }
  private bikes!: BikeSystem;
  /** Seconds since both were riding (the short ride before 'Later…'). */
  private rideT = -1;

  // ================================================================== triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'bank_leave', min: [-60, -20, -128], max: [60, 30, -115], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'track', min: [-60, -20, -112], max: [60, 30, -100], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'scanner', min: [-60, -20, -80], max: [60, 30, -70], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'ravine', min: [-80, -20, -46], max: [80, 30, -38], who: 'any', enabled: () => this.flags.phase === 'bank' });
    this.addTrigger({ id: 'ravine_cross', min: [-80, -20, -22], max: [80, 30, -10], who: 'both', enabled: () => this.flags.phase === 'ravine' && !!this.flags.logDown });
    this.addTrigger({ id: 'farm', min: [FARM.x - 32, -20, FARM.z - 34], max: [FARM.x + 32, 30, FARM.z + 34], who: 'both', enabled: () => this.flags.phase === 'north' });
    this.addTrigger({ id: 'barn', min: [this.barn.x - 5.8, -20, this.barn.z - 7.8], max: [this.barn.x + 5.8, 40, this.barn.z + 3.4], who: 'both', enabled: () => this.flags.phase === 'farm' && !!this.flags.clothes_elias && !!this.flags.clothes_jax });
    // Ray picks them up at the mile marker on the county road.
    this.addTrigger({ id: 'pickup', min: [PICKUP.x - 9, -20, PICKUP.z - 9], max: [PICKUP.x + 9, 40, PICKUP.z + 4], who: 'both', enabled: () => this.flags.phase === 'road' });
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
        this.objective('Keep heading north — get clothes at the farm past the ridge, then meet Ray', [FARM.x, this.farmY + 2, FARM.z - 20]);
        this.say('plan');
        break;
      case 'farm':
        this.saveCheckpoint('farm');
        g.session.emit('flag', { k: 'phase', v: 'farm' });
        this.say('farm_arrive');
        this.objective('Steal clothes from the line — don\'t let the farmer see you', [38, this.farmY + 1.6, 58]);
        break;
      case 'barn': this.cutscene('cs3_barn'); break;
      case 'pickup': this.cutscene('cs3_pickup'); break;
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
          { who: 'jax', text: 'There\'s a phone back there. Time to call in that favour. Two minutes.', anim: 'talk' },
        ] },
        { dur: 2.2, shot: () => shot(v3(this.barn.x + 3, this.farmY + 1.7, this.barn.z + 4.2), v3(this.barn.x + 5.6, this.farmY + 1.4, this.barn.z + 6), 2.2, { fov: 38 }),
          run: () => { walkChar(g, 'jax', [v3(this.barn.x + 0.5, this.farmY + 0.1, this.barn.z + 3.5), v3(this.barn.x + 5.0, this.farmY + 0.1, this.barn.z + 6.0)], 1.4, () => { poseChar(g, 'jax', 'talk_phone'); }, Math.PI / 2); } },
        { shot: () => shot(v3(this.barn.x + 3.8, this.farmY + 1.65, this.barn.z + 5.0), v3(this.barn.x + 5.2, this.farmY + 1.6, this.barn.z + 6.05), 13, { fov: 34 }),
          run: () => { placeChar(g, 'jax', v3(this.barn.x + 5.1, this.farmY + 0.1, this.barn.z + 6.0), Math.PI / 2); poseChar(g, 'jax', 'talk_phone'); clipChar(g, 'jax', 'phone_listen', 'upper'); },
          lines: [
            { who: 'jax', text: '(quietly) Ray. It\'s me.', pause: 1.0 },
            { who: 'jax', text: 'Yeah, you saw the news. Both of us. ...I told you I would.', pause: 0.8 },
            { who: 'jax', text: 'County road, the mile marker past the Ashby farm. Dusk. Lights twice.', pause: 0.8 },
            { who: 'jax', text: 'And bring the car, Ray. Not the truck. The truck has your name on it.', pause: 0.6 },
          ] },
        { dur: 1.6, shot: () => closeUp(g, 'jax', 1.6, 0.9, 0.2, { fov: 32 }), run: () => { clipChar(g, 'jax', null, 'upper'); poseChar(g, 'jax', null); g.audio.play('switch', { pos: v3(this.barn.x + 5.8, this.farmY + 1.5, this.barn.z + 6), volume: 0.5 }); placeChar(g, 'elias', v3(this.barn.x + 1.4, this.farmY + 0.1, this.barn.z + 5.0), Math.PI / 2); } },
        { shot: () => twoShot(g, 'elias', 'jax', 9, 2.0, 1.45, 1), lines: [
          { who: 'elias', text: 'Who was that?' },
          { who: 'jax', text: 'Ray. He\'s coming. Dusk, at the county road.', anim: 'talk' },
          { who: 'elias', text: 'Just like that.' },
          { who: 'jax', text: 'Just like that. Let\'s go before the old man comes in for his tractor keys.', anim: 'shrug' },
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
          lines: [{ who: 'narrator', text: 'Black Hollow. Jax\'s trailer, forty miles from anywhere.', dur: 3.4 }] },
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
          { who: 'elias', text: 'Crane never goes anywhere without four men, and the four men never go anywhere without guns.', pause: 0.5 },
          { who: 'jax', text: 'Then we bring guns. I know a guy. Dutch. He sells to people who don\'t fill out forms.' },
          { who: 'elias', text: 'That\'s what the cash is for.' },
          { who: 'jax', text: 'That\'s what the cash is for.', pause: 0.8 },
          { who: 'elias', text: 'Victor has a little brother. Julius. Runs his building sites. Victor tells him everything.' },
          { who: 'jax', text: 'So we ask Julius where his big brother sleeps.' },
          { who: 'elias', text: 'We ask. Once. Nicely.' },
          { who: 'jax', text: 'And then?' },
          { who: 'elias', text: 'And then Victor Crane tells the truth. Or he never tells anything again.' },
        ] },
        { dur: 4, fade: 'out', shot: () => shot(v3(this.firePos.x, this.firePos.y + 10, this.firePos.z - 14), v3(this.firePos.x, this.firePos.y, this.firePos.z), 4, { fov: 40 }) },
      ],
      end: () => {
        poseChar(g, 'elias', null); poseChar(g, 'jax', null);
        if (this.authority) {
          g.session.emit('flag', { k: 'talked', v: true });
          this.say('bikes_go');
          this.objective('Take the bikes — Dutch is waiting', [CABIN.x + 6, this.baseAt(CABIN.x, CABIN.z) + 1.2, CABIN.z - 2]);
        }
      },
    };
    this.buildStoryCutscenes();
  }

  // ------------------------------------------------------------------ new story beats
  private buildStoryCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    // After the log: walking north, Jax reveals the plan he made on visiting day.
    // County road at dusk: Ray's car comes round the bend and picks them up.
    C.cs3_pickup = {
      id: 'cs3_pickup', music: 'music_explore',
      start: () => {
        this.setTOD('dusk');
        const y = this.baseAt(PICKUP.x, PICKUP.z);
        placeChar(g, 'elias', v3(PICKUP.x - 1.4, y, PICKUP.z - 2.2), 0.4);
        placeChar(g, 'jax', v3(PICKUP.x + 0.4, y, PICKUP.z - 2.6), 0.2);
        this.rayDrive = { start: g.session.sharedNow(), dur: 4.5 };
        this.rayCar.root.visible = true;
      },
      beats: [
        { dur: 4.6, shot: () => shot(v3(PICKUP.x - 8, this.baseAt(PICKUP.x, PICKUP.z) + 2.2, PICKUP.z - 8), v3(PICKUP.x + 8, this.baseAt(PICKUP.x, PICKUP.z) + 1.0, PICKUP.z + 3), 4.6, { fov: 44, toEnd: v3(PICKUP.x + 1, this.baseAt(PICKUP.x, PICKUP.z) + 1.0, PICKUP.z + 3) }),
          lines: [{ who: 'jax', text: 'Lights. Twice. That\'s him.', dur: 2.4 }] },
        { dur: 6.5, shot: () => twoShot(g, 'jax', 'elias', 6.5, 2.4, 1.4, 1), lines: [
          { who: 'ray', text: 'Get in, get in! That cruiser comes round every two minutes!', dur: 3.0 },
          { who: 'jax', text: 'Ray, you beautiful idiot.', dur: 2.0 },
        ] },
        { dur: 2.4, fade: 'out', run: () => { walkChar(g, 'elias', [v3(PICKUP.x + 1.2, this.baseAt(PICKUP.x, PICKUP.z), PICKUP.z + 0.6)], 1.3); walkChar(g, 'jax', [v3(PICKUP.x + 2.4, this.baseAt(PICKUP.x, PICKUP.z), PICKUP.z + 0.6)], 1.3); },
          shot: () => shot(v3(PICKUP.x - 4, this.baseAt(PICKUP.x, PICKUP.z) + 1.8, PICKUP.z - 5), v3(PICKUP.x + 2, this.baseAt(PICKUP.x, PICKUP.z) + 1.0, PICKUP.z + 1), 2.4, { fov: 40 }) },
      ],
      end: () => {
        this.rayDrive = null;
        if (this.authority) { this.saveCheckpoint('cabin'); g.session.emit('restart', { checkpoint: 'cabin' }); }
      },
    };
    // Black Hollow: Ray drops them at Jax's trailer.
    C.cs3_trailer = {
      id: 'cs3_trailer', music: 'music_night',
      start: () => { this.setTOD('night'); },
      beats: [
        { dur: 4.5, fade: 'in', shot: () => shot(v3(CABIN.x + 10, this.baseAt(CABIN.x, CABIN.z) + 4, CABIN.z - 12), v3(CABIN.x, this.baseAt(CABIN.x, CABIN.z) + 1.5, CABIN.z), 4.5, { fov: 44, fromEnd: v3(CABIN.x + 7, this.baseAt(CABIN.x, CABIN.z) + 2.6, CABIN.z - 9) }),
          lines: [{ who: 'narrator', text: 'Later. Black Hollow.', dur: 2.6 }] },
      ],
      end: () => { if (this.authority) this.say('trailer_talk'); if (this.authority) this.objective('Find the cash Jax hid under his trailer — lift the floor panel together', [CABIN.x, this.baseAt(CABIN.x, CABIN.z) + 1, CABIN.z + 2.2]); },
    };
    // Later: the arms deal at the old Ashby barn.
    C.cs3_dealer = {
      id: 'cs3_dealer', music: 'music_tension',
      start: () => {},
      beats: [
        // Fade out from the ride...
        { dur: 1.2, fade: 'out' },
        { dur: 4, fade: 'in', run: () => this.setupDeal(), shot: () => shot(v3(this.barn.x - 9, this.farmY + 3.2, this.barn.z - 16), v3(this.barn.x, this.farmY + 1.4, this.barn.z - 8), 4, { fov: 42 }),
          lines: [{ who: 'narrator', text: 'Later that night. The old Ashby barn.', dur: 3 }] },
        { shot: () => twoShot(g, 'jax', 'dutch', 30, 2.6, 1.5, 1), lines: [
          { who: 'dutch', text: 'The famous two. You\'re on every channel.', anim: 'talk_cool' },
          { who: 'jax', text: 'Then you know we\'re in a hurry, Dutch. It\'s all there.', anim: 'talk' },
          { who: 'dutch', text: '(counting) ...It\'s all there. Back of the car. Have a look, take what you like.', anim: 'talk' },
        ] },
      ],
      end: () => {
        this.setupDeal();
        this.flags.phase = 'dealer';
        if (this.authority) this.objective('Pick your weapons from the back of Dutch\'s car', [this.dealPos.x, this.dealPos.y + 1.2, this.dealPos.z]);
      },
    };
    C.cs3_deal_done = {
      id: 'cs3_deal_done', music: 'music_tension', skippable: true,
      start: () => {
        const b = this.barn, y = this.farmY;
        placeChar(g, 'elias', v3(b.x - 1.6, y, b.z - 9.4), 0.3);
        placeChar(g, 'jax', v3(b.x - 0.4, y, b.z - 9.0), 0.1);
        npcPlace(g, 'dutch', v3(b.x - 0.6, y, b.z - 6.8), Math.PI);
      },
      beats: [
        { shot: () => twoShot(g, 'dutch', 'jax', 20, 2.6, 1.5, -1), lines: [
          { who: 'dutch', text: 'Good choices. Don\'t point them at anything you\'re not ready to bury.', anim: 'talk_cool' },
          { who: 'elias', text: 'We won\'t.' },
          { who: 'dutch', text: 'And boys — you never met me.' },
          { who: 'jax', text: 'Never met who?', anim: 'laugh' },
        ] },
        { dur: 3.2, shot: () => closeUp(g, 'elias', 3.2, 1.0, -0.3, { fov: 34 }), run: () => { g.audio.play('switch', { volume: 0.5 }); },
          lines: [{ who: 'elias', text: 'Julius Crane. Tomorrow morning.', dur: 2.6 }] },
        { dur: 3, fade: 'out', shot: () => shot(v3(this.barn.x - 4, this.farmY + 6, this.barn.z - 20), v3(this.barn.x, this.farmY + 1, this.barn.z - 8), 3, { fov: 46 }) },
      ],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: 4 }); },
    };
  }

  /** Night at the barn: bikes parked, Dutch and his car, the guns laid out behind it. */
  private setupDeal(): void {
    const g = this.g;
    this.setTOD('night');
    if (this.bikes.mounted) this.bikes.dismount();
    const b = this.barn, y = this.farmY;
    this.bikes.park('elias', v3(b.x - 4.5, y, b.z - 11), 0.4);
    this.bikes.park('jax', v3(b.x - 3.0, y, b.z - 12), 0.2);
    placeChar(g, 'elias', v3(b.x - 1.6, y, b.z - 9.4), 0.3);
    placeChar(g, 'jax', v3(b.x - 0.4, y, b.z - 9.0), 0.1);
    const d = g.npcs.get('dutch');
    if (d) { d.enabled = true; d.body.visible = true; d.body.solid = true; npcPlace(g, 'dutch', v3(b.x - 0.6, y, b.z - 6.8), Math.PI); }
    this.dutchVan.root.visible = true;
    const carYaw = Math.PI * 0.55;
    const carP = v3(b.x + 2.6, y, b.z - 7.5);
    this.dutchVan.setPose(carP, carYaw, g.world.physics);
    // Open crate behind the car with the guns laid out on it.
    const back = v3(-Math.sin(carYaw), 0, -Math.cos(carYaw));
    this.dealPos.copy(carP).addScaledVector(back, 3.4);
    this.dealPos.y = y;
    if (!this.dealTable) {
      const w = g.world;
      const grp = new THREE.Group();
      const wood = w.mats.plain(0x6a4a2a, 0.8);
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.3), wood); top.position.y = 0.78; grp.add(top);
      for (const [x, z] of [[-0.9, -0.58], [0.9, -0.58], [-0.9, 0.58], [0.9, 0.58]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), wood); l.position.set(x, 0.39, z); grp.add(l); }
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.01, 1.2), w.mats.plain(0x24282c, 0.95)); cloth.position.y = 0.825; grp.add(cloth);
      w.physics.addBox({ x: this.dealPos.x, y: this.dealPos.y + 0.4, z: this.dealPos.z }, { x: 2.0, y: 0.8, z: 1.3 }, carYaw + Math.PI / 2, { surface: 'wood' });
      w.root.add(grp);
      this.dealTable = grp;
      // The guns, side by side across the cloth.
      SHOP.forEach((id, i) => {
        const gm = g.guns.displayModel(id);
        // Side by side across the cloth, full size, barrels along the table, lying on their sides.
        const L = WEAPONS[id].length;
        gm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        gm.position.set(-L / 2, 0.87, -0.51 + i * 0.17);
        grp.add(gm);
      });
    }
    this.dealTable.position.copy(this.dealPos);
    this.dealTable.rotation.y = carYaw + Math.PI / 2;
    // Dutch waits at the end of his table.
    if (d) npcPlace(g, 'dutch', this.dealPos.clone().addScaledVector(v3(Math.cos(carYaw), 0, -Math.sin(carYaw)), 1.8), carYaw + Math.PI);
  }
  private dealPos = new THREE.Vector3();
  private dealTable: THREE.Group | null = null;
  /** Ray's car driving in for the pickup (cutscene). */
  private rayDrive: { start: number; dur: number } | null = null;
  private rayCar!: Car;
  private dutchVan!: Car;

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
    // Trailer-phase state.
    if (this.bikes) {
      if (this.bikes.mounted) this.bikes.dismount();
      for (const v of this.bikes.visuals.values()) v.root.visible = false;
      this.bikes.parkedLocal = this.bikes.parkedRemote = false;
    }
    for (const k of ['cash', 'talked', 'mounted_elias', 'mounted_jax', 'picked_elias', 'picked_jax', 'dealDone']) delete this.flags[k];
    if (this.dealTable) this.dealTable.position.y = -100;
    this.rideT = -1;
    this.rayDrive = null;
    if (this.rayCar) this.rayCar.root.visible = false;
    if (this.dutchVan) this.dutchVan.root.visible = false;
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
        if (this.authority) setTimeout(() => { this.say('road'); this.objective('Get to the mile marker on the county road — stay out of the patrol\'s headlights', [PICKUP.x, this.baseAt(PICKUP.x, PICKUP.z) + 1, PICKUP.z]); }, 800);
        setTimeout(() => { if (this.authority) this.say('road_tip'); }, 7000);
        break;
      case 'cabin':
        // Jax's trailer at night: campfire going, the bikes under the tarp.
        this.setTOD('night');
        this.fire.visible = true;
        g.audio.playMusic('music_night', 2);
        for (const c of ['elias', 'jax'] as CharacterId[]) { const bp = this.bikeSpot(c); this.bikes.park(c, bp.pos, bp.yaw); }
        break;
    }
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'coop':
        if (a.group === 'cash') {
          this.flags.cash = true;
          g.audio.play('wood_break', { pos: v3(CABIN.x, this.baseAt(CABIN.x, CABIN.z) + 0.5, CABIN.z + 1.5), volume: 0.7 });
          if (this.authority) { this.say('trailer_cash'); setTimeout(() => this.cutscene('cs3_campfire'), 7500); }
          return true;
        }
        if (a.group === 'log') {
          this.flags.logDown = true;
          g.audio.play('creak', { pos: this.logBase, volume: 0.9 });
          setTimeout(() => { g.audio.play('big_crash', { pos: this.logBase.clone().add(v3(0, 0, 12)), volume: 0.8 }); g.cam.addShake(0.3); g.world.particles.emit('dust', this.logBase.clone().add(v3(0, 0.5, 14)), 30); }, 1100);
          if (this.authority) setTimeout(() => { this.say('log_done'); this.objective('Cross the log', [LOG_X, this.logBase.y + 1, ravZ(LOG_X)]); }, 1500);
          return true;
        }
        return false;
      case 'weaponPicked': {
        if (this.flags.phase !== 'dealer') return true;
        this.flags[`picked_${a.who}`] = true;
        const name = (a.who === g.localChar ? 'You' : SPEAKERS[String(a.who)]?.name ?? 'Your partner');
        g.hud.notify(`${name} took the ${WEAPONS[a.w as keyof typeof WEAPONS]?.name ?? 'gun'}`, 2.4);
        g.audio.play('switch', { pos: this.dealPos, volume: 0.6 });
        if (this.authority) {
          if (this.flags.picked_elias && this.flags.picked_jax) setTimeout(() => { if (this.flags.phase === 'dealer' && !this.flags.dealDone) { this.flags.dealDone = true; this.cutscene('cs3_deal_done'); } }, 1500);
          else g.session.emit('dlg', { lines: [{ who: 'dutch', text: 'Take your time. But not too much time.', dur: 2.4 }], at: g.session.sharedNow() + 600 });
        }
        return true;
      }
      case 'mounted': {
        this.flags[`mounted_${a.who}`] = true;
        if (this.authority && this.flags.mounted_elias && this.flags.mounted_jax && this.rideT < 0) { this.rideT = 0; this.objective('Ride out to meet Dutch'); }
        return true;
      }
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
        // Arriving at the trailer from the pickup (a checkpoint jump doesn't run its intro by itself).
        if (this.authority && a.checkpoint === 'cabin' && !this.g.cutscenes.played.has('cs3_trailer')) this.cutscene('cs3_trailer');
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
    // A short ride from the trailer, then 'Later…' at the arms deal.
    if (this.rideT >= 0 && this.flags.phase === 'cabin' && !g.inCutscene) {
      // A few seconds of riding out (time only counts while moving), then the fade to the deal.
      const moving = this.bikes.mounted && Math.abs(this.bikes.ctrl.speed) > 3;
      this.rideT += moving ? dt : dt * 0.15;
      if (this.rideT > 5) { this.rideT = -2; this.cutscene('cs3_dealer'); }
    }
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
