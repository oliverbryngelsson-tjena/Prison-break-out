// Chapter 6 — The Getaway. Victor Crane's dirt bikes, his money, every cruiser in Harlow behind you,
// and a long ride through the forest (with plenty of jumps) to the ridge and the state line beyond.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, shot, closeUp, twoShot, poseChar } from './cs';
import { Terrain, fbm, smooth } from './terrain';
import { Water } from './water';
import { Foliage, scatter, type FoliageItem } from './foliage';
import { Car, Path } from './vehicles';
import { BikeSystem } from '../game/bike';
import { cylinderBetween } from '../engine/geometry';
import type { Line } from '../game/dialogue';

const CTRL: Array<[number, number]> = [
  [-240, -250], [-195, -205], [-222, -135], [-170, -72], [-100, -95], [-40, -150], [30, -172], [95, -122],
  [122, -52], [72, 2], [14, 24], [-36, 40], [40, 40], [128, 40], [150, 22], [184, 37], [238, 44], [252, 118], [226, 188], [250, 252],
];
const HWY_Z = 40;
const RIVER_X = (z: number) => 106 + Math.sin(z / 50) * 10;
const RIVER_Y = -1.6;
const DAM = { x: 250, z: 262 };
const ROADBLOCK_X = 150;

/** Dense centripetal Catmull-Rom through the control points. */
function densify(ctrl: Array<[number, number]>, step: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.ceil(len / step);
  return curve.getSpacedPoints(n);
}

export class Chapter6 extends Chapter {
  readonly num = 6;
  readonly title = 'The Getaway';
  readonly subtitle = 'Behind Crane Motors, 1:10 a.m.';
  music = 'music_chase';
  outfit: 'prison' | 'civil' = 'civil';
  terrain!: Terrain;
  kit!: Kit;
  bikes!: BikeSystem;
  private foliage: Foliage | null = null;
  private track: THREE.Vector3[] = [];
  private trackS: number[] = [];
  private trackPath!: Path;
  private cops: Array<{ car: Car; s: number; v: number; lane: number; siren: ReturnType<import('../engine/audio').AudioManager['siren']>; stuckT: number; active: boolean }> = [];
  private block: Car[] = [];
  private catchT: Record<CharacterId, number> = { elias: 0, jax: 0 };
  private respawnT = -1;
  private carsSyncT = 0;
  private sepWarn = false;
  private sepT = 0;
  private lastS: Record<CharacterId, number> = { elias: 0, jax: 0 };
  readonly checkpoints: Record<string, CheckpointDef> = {
    start: { spawn: { elias: { pos: [-243, 0, -258], yaw: 0.6 }, jax: { pos: [-238, 0, -260], yaw: 0.6 } }, objective: 'Get on the bikes!', intro: 'cs6_start', outfit: 'civil' },
    cp_farm: { spawn: { elias: { pos: [0, 0, 0], yaw: 0 }, jax: { pos: [0, 0, 0], yaw: 0 } }, objective: 'Lose the police — into the forest', outfit: 'civil' },
    cp_river: { spawn: { elias: { pos: [0, 0, 0], yaw: 0 }, jax: { pos: [0, 0, 0], yaw: 0 } }, objective: 'Lose the police — into the forest', outfit: 'civil' },
    cp_highway: { spawn: { elias: { pos: [0, 0, 0], yaw: 0 }, jax: { pos: [0, 0, 0], yaw: 0 } }, objective: 'Get around the roadblock', outfit: 'civil' },
    cp_climb: { spawn: { elias: { pos: [0, 0, 0], yaw: 0 }, jax: { pos: [0, 0, 0], yaw: 0 } }, objective: 'Up through the forest to the ridge', outfit: 'civil' },
  };
  /** Track distance of each checkpoint. */
  private cpS: Record<string, number> = { start: 8, cp_farm: 0, cp_river: 0, cp_highway: 0, cp_climb: 0 };

  constructor() {
    super();
    this.flagsDefault = { jump: true, sprint: true, combat: false, crouch: false };
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.go = [{ who: 'jax', text: 'Stay on my wheel! And don\'t you dare fall off!', dur: 2.8 }];
    D.farm = [{ who: 'elias', text: 'Across the fields! They can\'t follow us through the hay!', dur: 2.8 }];
    D.river = [{ who: 'jax', text: 'River! Gun it — don\'t stop in the middle!', dur: 2.6 }];
    D.highway = [{ who: 'radio', text: 'All units, suspects on two motorcycles, heading east on Route Nine. Roadblock is set at mile marker twelve.', radio: true, dur: 4.2 }];
    D.block = [{ who: 'elias', text: 'Roadblock! Off the road — the ditch, right side!', dur: 2.8 }];
    D.climb = [{ who: 'jax', text: 'Logging road. Where does it come out?', dur: 2.2 }, { who: 'elias', text: 'Over the ridge. Past that it\'s another state and nobody\'s looking.', dur: 3.4 }];
    D.crash_jax = [{ who: 'jax', text: 'I\'m okay! I\'m okay!', dur: 1.6 }];
    D.crash_elias = [{ who: 'elias', text: 'Still here! Keep going!', dur: 1.6 }];
    D.sep = [{ who: 'narrator', text: 'Stay together — don\'t leave your partner behind.', dur: 3 }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/sunset.hdr', envIntensity: 0.24, background: 0x111826,
      fog: { color: 0x131a26, density: 0.007 },
      hemi: { sky: 0x4a5c7c, ground: 0x15120e, intensity: 0.75 },
      sun: { color: 0xa9bde6, intensity: 1.05, dir: [-0.4, 0.75, -0.5], shadows: true },
      grade: { saturation: 0.85, contrast: 1.08, lift: [0.0, 0.008, 0.018], gain: [1.0, 1.0, 1.04], shadowTint: [0.9, 0.96, 1.12], highlightTint: [1.06, 1.0, 0.92], exposure: 1.15, bloom: 1.0, vignette: 0.55 },
      reverb: 0.1,
    });
    this.kit = new Kit(w);
    // Track centreline
    this.track = densify(CTRL, 4);
    let acc = 0;
    this.trackS = this.track.map((p, i) => (i ? (acc += p.distanceTo(this.track[i - 1])) : 0));
    this.buildGrid();
    this.computeTrackHeights();
    await this.buildTerrain();
    for (const p of this.track) p.y = this.terrain.height(p.x, p.z);
    this.trackPath = new Path(this.track.map((p) => p.clone()), false);
    // Checkpoints at fixed distances along the route.
    const L = this.trackS[this.trackS.length - 1];
    this.cpS = { start: 8, cp_farm: this.sNear(-40, -150), cp_river: this.sNear(122, -52), cp_highway: this.sNear(40, 40), cp_climb: this.sNear(238, 44) };
    for (const [id, s] of Object.entries(this.cpS)) {
      if (id === 'start') { for (const sp of Object.values(this.checkpoints.start.spawn)) sp.pos[1] = this.terrain.height(sp.pos[0], sp.pos[2]) + 0.1; continue; }
      const a = this.trackPath.at(s), side = this.side(s);
      this.checkpoints[id].spawn.elias = { pos: [a.pos.x - side.x * 1.6, this.terrain.height(a.pos.x - side.x * 1.6, a.pos.z - side.z * 1.6), a.pos.z - side.z * 1.6], yaw: a.yaw };
      this.checkpoints[id].spawn.jax = { pos: [a.pos.x + side.x * 1.6, this.terrain.height(a.pos.x + side.x * 1.6, a.pos.z + side.z * 1.6), a.pos.z + side.z * 1.6], yaw: a.yaw };
    }
    void L;
    await this.buildProps();
    this.kit.finish();
    this.bikes = new BikeSystem(g);
    await this.bikes.init({ headlights: true });
    this.bikes.ctrl.onCrash = (why) => this.onLocalCrash(why);
    this.bikes.ctrl.onLand = (impact) => { if (impact > 6) { g.audio.play('land', { pos: this.bikes.ctrl.pos, volume: Math.min(1, impact / 14) }); g.cam.addShake(Math.min(0.4, impact / 30)); } };
    for (let i = 0; i < 3; i++) {
      const car = await Car.create(w, { police: true });
      car.sirenOn = true;
      car.root.visible = false;
      this.cops.push({ car, s: -60 - i * 25, v: 0, lane: i % 2 ? 2.2 : -2.2, siren: null, stuckT: 0, active: false });
    }
    w.ambientLoop('amb_wind', 0.35);
    w.tickers.add((dt, t) => {
      this.foliage?.update(dt, g.cam.camera.position);
      for (const c of this.cops) c.car.update(t);
      for (const c of this.block) c.update(t);
    });
    this.buildTriggers();
    this.buildCutscenes();
  }

  private trackH: number[] = [];
  /** Smoothed height profile along the route with jump kickers. */
  private computeTrackHeights(): void {
    const raw = this.track.map((p) => this.baseH(p.x, p.z));
    const n = raw.length;
    const out = new Array<number>(n).fill(0);
    const W = 6;
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -W; k <= W; k++) { const j = Math.max(0, Math.min(n - 1, i + k)); s += raw[j]; c++; }
      out[i] = s / c;
    }
    // Highway section is flat-ish and the ford dips to the riverbed.
    for (let i = 0; i < n; i++) {
      const p = this.track[i];
      if (Math.abs(p.z - HWY_Z) < 4 && p.x > -40 && p.x < 140) out[i] = this.hwyH(p.x);
      const rd = Math.abs(p.x - RIVER_X(p.z));
      if (rd < 14) out[i] = THREE.MathUtils.lerp(out[i], RIVER_Y - 0.55, smooth(14, 7, rd));
    }
    // Kickers: [distance, height]
    const kick = (sAt: number, h: number, len = 7) => {
      for (let i = 0; i < n; i++) {
        const d = this.trackS[i] - sAt;
        if (d > -len && d <= 0) out[i] += h * (1 + d / len) ** 1.5;
      }
    };
    const total = this.trackS[n - 1];
    // Jumps all along the forest trail (none on the highway stretch or in the ford).
    const jumps: Array<[number, number]> = [[0.05, 1.3], [0.09, 1.8], [0.12, 1.6], [0.16, 2.2], [0.2, 1.6], [0.25, 1.9], [0.29, 1.4], [0.33, 1.6], [0.4, 2.0], [0.47, 1.6], [0.55, 1.8], [0.62, 1.6], [0.7, 2.3], [0.75, 1.5], [0.8, 2.0], [0.86, 1.6], [0.91, 2.2], [0.95, 1.5]];
    for (const [f, h] of jumps) {
      const i = Math.min(n - 1, this.trackS.findIndex((v) => v >= total * f));
      const p = this.track[Math.max(0, i)];
      if (Math.abs(p.z - HWY_Z) < 10 && p.x > -50 && p.x < 150) continue;
      if (Math.abs(p.x - RIVER_X(p.z)) < 20) continue;
      kick(total * f, h, h > 2 ? 9 : 7);
    }
    kick(this.sNearRaw(166, 28), 2.2, 9); // roadblock detour jump
    this.trackH = out;
  }
  private sNearRaw(x: number, z: number): number {
    let best = 0, bd = Infinity;
    this.track.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = this.trackS[i]; } });
    return best;
  }
  private sNear(x: number, z: number): number { return this.sNearRaw(x, z); }
  private side(s: number): THREE.Vector3 { const { yaw } = this.trackPath.at(s); return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); }

  private hwyH(x: number): number { return 2 + Math.sin(x / 120) * 3; }
  private baseH(x: number, z: number): number {
    let h = 4 + fbm(x * 0.006, z * 0.006, 4, 11) * 18 + fbm(x * 0.03, z * 0.03, 2, 2) * 1.5;
    // Valley toward the dam rises
    h += smooth(150, 300, z) * smooth(150, 260, x) * 10;
    return h;
  }

  private grid = new Map<number, number[]>();
  private static readonly GC = 16;
  private gridKey(cx: number, cz: number): number { return (cx + 1000) * 4096 + (cz + 1000); }
  private buildGrid(): void {
    this.grid.clear();
    this.track.forEach((p, i) => {
      const k = this.gridKey(Math.floor(p.x / Chapter6.GC), Math.floor(p.z / Chapter6.GC));
      let l = this.grid.get(k);
      if (!l) { l = []; this.grid.set(k, l); }
      l.push(i);
    });
  }
  /** Nearest dense track point within ~32 m (d = Infinity beyond that). */
  private nearestTrack(x: number, z: number): { d: number; i: number } {
    if (!this.grid.size) this.buildGrid();
    const cx = Math.floor(x / Chapter6.GC), cz = Math.floor(z / Chapter6.GC);
    let best = Infinity, bi = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const l = this.grid.get(this.gridKey(cx + dx, cz + dz));
      if (!l) continue;
      for (const i of l) {
        const p = this.track[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < best) { best = d; bi = i; }
      }
    }
    return { d: Math.sqrt(best), i: bi };
  }

  private height(x: number, z: number): number {
    let h = this.baseH(x, z);
    // River channel
    const rd = Math.abs(x - RIVER_X(z));
    h = THREE.MathUtils.lerp(RIVER_Y - 2.2, Math.max(h, RIVER_Y + 1.2), smooth(8, 20, rd));
    // Highway embankment
    const hd = Math.abs(z - HWY_Z);
    h = THREE.MathUtils.lerp(h, this.hwyH(x), smooth(16, 8, hd));
    // Track corridor
    const nt = this.nearestTrack(x, z);
    h = THREE.MathUtils.lerp(h, this.trackH[nt.i], smooth(10, 4.5, nt.d));
    return h;
  }

  private async buildTerrain(): Promise<void> {
    const g = this.g, w = g.world;
    this.terrain = new Terrain({
      x0: -300, z0: -300, size: 600, res: 201, height: (x, z) => this.height(x, z),
      layers: [
        { set: 'grass_sparse', scale: 0.12, tint: 0x8f9a7c, surface: 'grass', roughness: 0.95 },
        { set: 'mud_dry', scale: 0.2, tint: 0x9a8a72, surface: 'dirt', roughness: 0.9 },
        { set: 'rock_face', scale: 0.08, tint: 0x8d8a84, surface: 'gravel', roughness: 0.9 },
        { set: 'asphalt', scale: 0.15, surface: 'asphalt', roughness: 0.7 },
      ],
      weights: (x, z, _h, slope) => {
        const nt = this.nearestTrack(x, z);
        const hwy = smooth(8, 6, Math.abs(z - HWY_Z));
        const trk = smooth(5.5, 3, nt.d) * (1 - hwy);
        const river = smooth(14, 8, Math.abs(x - RIVER_X(z)));
        return [0.6, trk * 1.6 + river * 0.8, smooth(0.3, 0.6, slope) * 1.6, hwy * 2];
      },
      chunk: 40,
    });
    await this.terrain.build(w);
    // Mud near the river slows bikes.
    const base = this.terrain.hf.surfaceAt;
    this.terrain.hf.surfaceAt = (x, z) => (Math.abs(x - RIVER_X(z)) < 13 ? 'mud' : base(x, z));
    // River
    const rpts: Array<[number, number]> = [];
    for (let z = -300; z <= 300; z += 20) rpts.push([RIVER_X(z), z]);
    new Water(w, { path: rpts, width: 20, y: RIVER_Y, color: 0x16211f, flow: [0, 1], opacity: 0.88 });
    // Forest, avoiding the track, river, highway and fields.
    const items: FoliageItem[] = [
      { model: 'tree_fir_a', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'tree_fir_b', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'fir_big', impostor: true, collider: 0.35, colliderHeight: 5 },
      { model: 'tree_oak_c', impostor: true, collider: 0.3 },
      { model: 'bush_a', near: 40, shadow: false },
      { model: 'boulder_b', near: 60, collider: 0.9, colliderHeight: 1.2 },
    ];
    const field = (x: number, z: number) => x > -90 && x < 60 && z > -210 && z < -110;
    const pl = scatter({
      x0: -298, z0: -298, x1: 298, z1: 298, spacing: 8, seed: 55, height: (x, z) => this.terrain.height(x, z),
      density: (x, z) => {
        if (Math.abs(z - HWY_Z) < 18) return 0;
        if (Math.abs(x - RIVER_X(z)) < 14) return 0;
        if (field(x, z)) return 0.02;
        const nt = this.nearestTrack(x, z);
        if (nt.d < 11) return 0;
        return 0.5 + 0.3 * fbm(x * 0.02, z * 0.02, 2, 4);
      },
      pick: (r) => (r < 0.06 ? 5 : r < 0.12 ? 4 : r < 0.45 ? 0 : r < 0.75 ? 1 : r < 0.88 ? 2 : 3),
      scale: (item, r) => (item === 2 ? 0.6 + r * 0.4 : item === 3 ? 2 + r * 0.6 : 1 + r * 0.6),
    });
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, pl);
  }

  // ------------------------------------------------------------------ props: bridge, roadblock, fences, hay
  private async buildProps(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [conc, steel, asphalt] = await Promise.all([
      L.pbr('concrete_grey', { scale: 0.3, color: 0xa8a49a }),
      L.pbr('steel', { scale: 1, color: 0x7a7e82, metalness: 0.6, roughness: 0.5 }),
      L.pbr('asphalt', { scale: 0.15 }),
    ]);
    // Highway overpass where the track ducks under the old rail line (x ~ 72..14 segment)
    const bx = 44, bz = 12;
    const hy = this.terrain.height(bx, bz);
    kit.box(conc, [bx, hy + 6.2, bz], [16, 0.8, 9], -0.4, { surface: 'concrete' });
    for (const s of [-1, 1]) for (const o of [-3, 3]) {
      const px = bx + Math.cos(-0.4) * s * 7.2 + Math.sin(-0.4) * o, pz = bz - Math.sin(-0.4) * s * 7.2 + Math.cos(-0.4) * o;
      kit.box(conc, [px, hy + 3, pz], [0.9, 6, 0.9], -0.4, { surface: 'concrete' });
    }
    kit.box(steel, [bx, hy + 7.0, bz], [16, 0.9, 0.12], -0.4, false);
    // Highway guard rails (gaps where the track joins/leaves)
    for (const [x0, x1] of [[-300, -50], [-20, 120], [210, 300]] as const) {
      for (const zz of [HWY_Z - 7.5, HWY_Z + 7.5]) {
        const n = Math.round((x1 - x0) / 6);
        for (let i = 0; i <= n; i++) {
          const x = x0 + (x1 - x0) * i / n;
          kit.box(steel, [x, this.hwyH(x) + 0.4, zz], [0.12, 0.8, 0.12], 0, false);
        }
        kit.batch.add(cylinderBetween(v3(x0, this.hwyH(x0) + 0.7, zz), v3(x1, this.hwyH(x1) + 0.7, zz), 0.06, 5), steel);
      }
    }
    // Lane markings
    const paint = L.plain(0xe8e2c8, 0.6);
    for (let x = -296; x < 296; x += 12) kit.decal(paint, [x, this.hwyH(x) + 0.05, HWY_Z], 6, 0.18, 0, true);
    void asphalt;
    // Roadblock: two cruisers across the highway + spike strip
    for (const [dz, yaw] of [[-2.5, 0.3], [2.8, -0.25]] as const) {
      const car = await Car.create(w, { police: true });
      car.sirenOn = true;
      const p = v3(ROADBLOCK_X, this.hwyH(ROADBLOCK_X), HWY_Z + dz);
      car.setPose(p, Math.PI / 2 + yaw, w.physics);
      car.lightsOn = false;
      this.block.push(car);
    }
    for (let i = 0; i < 6; i++) {
      const cone = new THREE.ConeGeometry(0.22, 0.6, 10);
      cone.translate(ROADBLOCK_X - 6, this.hwyH(ROADBLOCK_X) + 0.3, HWY_Z - 6 + i * 2.2);
      kit.batch.add(cone, L.plain(0xff6a14, 0.5));
    }
    // Farm field hay bales + fences
    const hay = await w.model('hay_bale');
    const bales: Array<{ p: [number, number, number]; yaw?: number }> = [];
    let seed = 9;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 40; i++) {
      const x = -80 + rnd() * 130, z = -205 + rnd() * 90;
      const nt = this.nearestTrack(x, z);
      if (nt.d < 7) continue;
      bales.push({ p: [x, this.terrain.height(x, z), z], yaw: rnd() * 6.28 });
      w.physics.addBox({ x, y: this.terrain.height(x, z) + 0.35, z }, { x: 1.2, y: 0.7, z: 1.2 }, 0, { surface: 'grass' });
    }
    kit.instance(hay, bales);
    const tractor = await w.model('tractor');
    const tx = -10, tz = -190;
    kit.place(tractor, [tx, this.terrain.height(tx, tz), tz], 1.2, 1.1);
    w.physics.addBox({ x: tx, y: this.terrain.height(tx, tz) + 1.2, z: tz }, { x: 3.7, y: 2.4, z: 2.5 }, 1.2, { surface: 'metal' }); // tractor model 3.4 x 2.3, scaled 1.1
    // Trailhead tarp + Mia's note at the start
    const start = v3(-240, this.terrain.height(-240, -255), -255);
    kit.box(L.plain(0x3e4a3a, 0.95), [start.x + 1.5, start.y + 0.02, start.z - 2], [5, 0.04, 3.5], 0.6, false);
    // The ridge at the end of the trail: a weathered state-line marker.
    const dy = this.terrain.height(DAM.x - 6, DAM.z - 8);
    kit.box(conc, [DAM.x - 6, dy + 0.7, DAM.z - 8], [0.5, 1.4, 0.3], 0.3, { surface: 'concrete' });
    kit.bulb(L.emissive(0xffd29a, 3), steel, DAM.x - 6, dy + 1.6, DAM.z - 8.4, 0xffc98a, 1.6, 7, 'ridge');
    this.kit.initLightPool(1);
  }

  // ================================================================== triggers + cutscenes
  private buildTriggers(): void { /* progress is tracked by distance along the route in update() */ }

  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    const start = v3(-240, 0, -255);
    C.cs6_start = {
      id: 'cs6_start', music: 'music_chase', skippable: true,
      start: () => {
        start.y = this.terrain.height(start.x, start.z);
        placeChar(g, 'elias', v3(start.x - 2.2, this.terrain.height(start.x - 2.2, start.z - 3), start.z - 3), 0.6);
        placeChar(g, 'jax', v3(start.x + 1.2, this.terrain.height(start.x + 1.2, start.z - 4.4), start.z - 4.4), 0.4);
        const a = this.trackPath.at(this.cpS.start);
        const side = this.side(this.cpS.start);
        this.bikes.park('elias', a.pos.clone().addScaledVector(side, -1.6).setY(this.terrain.height(a.pos.x - side.x * 1.6, a.pos.z - side.z * 1.6)), a.yaw);
        this.bikes.park('jax', a.pos.clone().addScaledVector(side, 1.6).setY(this.terrain.height(a.pos.x + side.x * 1.6, a.pos.z + side.z * 1.6)), a.yaw);
        this.sirenStart ??= g.audio.siren();
        this.sirenStart?.set(v3(-280, 10, -290), 0.6);
      },
      beats: [
        { dur: 4, fade: 'in', shot: () => shot(v3(start.x + 10, start.y + 3, start.z + 8), v3(start.x, start.y + 0.8, start.z - 2), 4, { fov: 42 }),
          lines: [{ who: 'narrator', text: 'Behind Crane Motors: Victor\'s dirt bikes, a bag of his money, and every cruiser in Harlow.', dur: 4 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 7, 2.4, 1.4, 1), lines: [
          { who: 'jax', text: 'He won\'t be needing these.' },
          { who: 'elias', text: 'Into the trees. Cars can\'t follow us where we\'re going.' },
          { who: 'jax', text: 'Then hold on. GO!', anim: 'talk_excited' },
        ] },
      ],
      end: () => { this.sirenStart?.stop(); this.sirenStart = null; if (this.authority) g.session.emit('race', {}); },
    };
    C.cs6_free = {
      id: 'cs6_free', music: 'music_sad', skippable: true,
      start: () => {
        this.stopCops();
        this.bikes.dismount();
        const p = v3(DAM.x - 6, 0, DAM.z - 12);
        p.y = this.terrain.height(p.x, p.z);
        placeChar(g, 'elias', p.clone().add(v3(-1, 0, 0)), 0);
        placeChar(g, 'jax', p.clone().add(v3(1.2, 0, -0.6)), -0.2);
        this.bikes.park('elias', p.clone().add(v3(-3, 0, -3)), 0.4);
        this.bikes.park('jax', p.clone().add(v3(3, 0, -3.5)), -0.3);
      },
      beats: [
        { dur: 4.5, shot: () => shot(v3(DAM.x - 20, this.terrain.height(DAM.x - 20, DAM.z - 30) + 6, DAM.z - 30), v3(DAM.x - 6, this.terrain.height(DAM.x - 6, DAM.z - 12) + 1, DAM.z - 12), 4.5, { fov: 44 }),
          lines: [{ who: 'narrator', text: 'The top of the ridge. Behind them, the sirens turn back one by one.', dur: 4 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 24, 2.4, 1.4, -1), lines: [
          { who: 'jax', text: 'Listen to that. Nothing. No sirens.', anim: 'talk' },
          { who: 'elias', text: 'Victor kept the second ledger in that safe. Every name, every payment. Tom\'s handwriting on half of it.' },
          { who: 'jax', text: 'So the money buys us a long way from here.' },
          { who: 'elias', text: 'And the ledger goes to the state attorney. Thirty years too late, but it goes.' },
          { who: 'jax', text: 'Danny would have liked you, Professor.', anim: 'talk_sad' },
          { who: 'elias', text: 'Come on. It\'s downhill from here.' },
        ] },
        { dur: 6, fade: 'out', shot: () => shot(v3(DAM.x, this.terrain.height(DAM.x, DAM.z - 40) + 14, DAM.z - 40), v3(DAM.x, this.terrain.height(DAM.x, DAM.z) + 8, DAM.z), 6, { fov: 44 }),
          lines: [{ who: 'narrator', text: 'Two weeks later the Crane ledger reached every newspaper in the state. Elias Varga and Jax Rourke were never found.', dur: 5.6 }] },
      ],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: null, ending: 'free' }); },
    };
  }
  private sirenStart: ReturnType<import('../engine/audio').AudioManager['siren']> = null;

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    this.flags.phase = id === 'start' ? 'start' : 'race';
    this.catchT = { elias: 0, jax: 0 };
    this.respawnT = -1;
    this.sepWarn = false;
    // Everyone mounts at their checkpoint position.
    const sp = this.checkpoints[id].spawn[g.localChar];
    if (id !== 'start') {
      this.bikes.mount(v3(...sp.pos), sp.yaw);
      this.placeCops(this.cpS[id] - 70);
    } else {
      this.stopCops();
    }
    g.audio.playMusic('music_chase', 1.5);
  }

  private placeCops(s0: number): void {
    const g = this.g;
    this.cops.forEach((c, i) => {
      c.s = s0 - i * 22;
      c.v = 0;
      c.active = true;
      c.car.root.visible = c.s > 0;
      c.siren ??= g.audio.siren();
    });
  }
  private stopCops(): void {
    for (const c of this.cops) { c.active = false; c.car.root.visible = false; c.siren?.stop(); c.siren = null; c.car.collider && (c.car.collider.enabled = false); }
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'race': {
        this.flags.phase = 'race';
        const sp = this.checkpoints.start.spawn[g.localChar];
        const s = this.cpS.start;
        const at = this.trackPath.at(s);
        const side = this.side(s);
        const off = g.localChar === 'elias' ? -1.6 : 1.6;
        const p = at.pos.clone().addScaledVector(side, off);
        p.y = this.terrain.height(p.x, p.z);
        this.bikes.parkedLocal = false; this.bikes.parkedRemote = false;
        this.bikes.mount(p, at.yaw);
        void sp;
        this.placeCops(-40);
        if (this.authority) { this.say('go'); this.objective('Lose the police — into the forest'); }
        return true;
      }
      case 'cars': {
        if (this.authority) return true;
        const s = a.s as number[], v = a.v as number[];
        this.cops.forEach((c, i) => { if (s[i] !== undefined) { c.s = s[i]; c.v = v[i]; c.active = true; c.siren ??= g.audio.siren(); } });
        return true;
      }
      case 'progress': {
        const id = String(a.cp);
        if (this.authority) this.saveCheckpoint(id);
        return true;
      }
      case 'crash':
        if (a.who !== g.localChar && this.authority) this.say(a.who === 'jax' ? 'crash_jax' : 'crash_elias');
        return true;
      case 'restarted':
        return true;
    }
    return false;
  }

  private onLocalCrash(_why: string): void {
    const g = this.g;
    const c = this.bikes.ctrl;
    g.audio.play('big_crash', { pos: c.pos, volume: 0.7 });
    g.audio.play('grunt', { pos: c.pos, volume: 0.7 });
    g.cam.addShake(0.6);
    g.world.particles.emit('dust', c.pos.clone().add(v3(0, 0.4, 0)), 30);
    g.local.body.setPose('knockdown', {}, { restart: true });
    g.local.body.roll = 0; g.local.body.pitch = 0;
    this.respawnT = 1.8;
    g.session.request('crash', { who: g.localChar });
    if (g.deps.settings.vibration) navigator.vibrate?.(200);
  }

  private respawnLocal(): void {
    const g = this.g;
    const c = this.bikes.ctrl;
    const s = Math.max(4, this.trackPath.project(c.pos) - 6);
    const at = this.trackPath.at(s);
    const side = this.side(s);
    const p = at.pos.clone().addScaledVector(side, g.localChar === 'elias' ? -1.4 : 1.4);
    p.y = this.terrain.height(p.x, p.z);
    this.bikes.mount(p, at.yaw);
  }

  // ================================================================== frame
  update(dt: number): void {
    const g = this.g;
    if (this.flags.phase !== 'race' || g.state !== 'playing') return;
    // Local crash -> respawn on the track
    if (this.respawnT >= 0) {
      this.respawnT -= dt;
      if (this.respawnT < 0) this.respawnLocal();
    }
    // Progress along the route
    const myS = this.trackPath.project(g.local.body.pos);
    this.lastS[g.localChar] = myS;
    const otherS = this.trackPath.project(g.remote.body.pos);
    this.lastS[g.remoteChar] = otherS;
    this.updateCops(dt);
    if (!this.authority) return;
    // Checkpoints reached by both riders
    const both = Math.min(myS, otherS);
    const order = ['start', 'cp_farm', 'cp_river', 'cp_highway', 'cp_climb'];
    const curIdx = order.indexOf(this.checkpoint);
    for (const id of ['cp_farm', 'cp_river', 'cp_highway', 'cp_climb']) {
      if (order.indexOf(id) <= curIdx) continue;
      if (both > this.cpS[id] + 3 && !this.flags[`cp_${id}`]) {
        g.session.emit('flag', { k: `cp_${id}`, v: true });
        g.session.emit('progress', { cp: id });
        if (id === 'cp_farm') this.say('farm');
        if (id === 'cp_river') this.say('river');
        if (id === 'cp_highway') { this.say('highway'); setTimeout(() => this.say('block'), 9000); }
        if (id === 'cp_climb') this.say('climb');
      }
    }
    // Separation (co-op: stay together)
    const gap = Math.abs(myS - otherS);
    if (gap > 260 && !this.sepWarn) { this.sepWarn = true; this.say('sep'); }
    if (gap < 200) this.sepWarn = false;
    // Fail only if you stay that far apart (not on a one-frame jump from lag or a respawn).
    this.sepT = gap > 380 ? this.sepT + dt : 0;
    if (this.sepT > 2) { this.sepT = 0; g.session.emit('fail', { reason: 'You got separated.' }); }
    // Finish
    const total = this.trackS[this.trackS.length - 1];
    if (myS > total - 14 && otherS > total - 14 && !this.flags.finished) {
      g.session.emit('flag', { k: 'finished', v: true });
      this.cutscene('cs6_free');
    }
  }

  /** Police cars follow the route behind the slower rider; the authority simulates and syncs them. */
  private updateCops(dt: number): void {
    const g = this.g;
    const slow = Math.min(this.lastS.elias, this.lastS.jax);
    const total = this.trackS[this.trackS.length - 1];
    for (const [i, c] of this.cops.entries()) {
      if (!c.active) continue;
      if (this.authority) {
        // Rubber band: catch up when far, ease off when close; never pass the slow rider by much.
        const gap = slow - c.s - i * 14;
        const want = gap > 80 ? 30 : gap > 30 ? 22 : gap > 10 ? 17 : gap > 0 ? 12 : 6;
        c.v += (want - c.v) * Math.min(1, dt * 0.8);
        // The roadblock section is closed to pursuit for a moment (they're waiting there).
        c.s = Math.min(total - 20, c.s + c.v * dt);
      } else {
        c.s += c.v * dt;
      }
      const at = this.trackPath.at(Math.max(0, c.s));
      const side = this.side(Math.max(0, c.s));
      const p = at.pos.clone().addScaledVector(side, c.lane);
      p.y = this.terrain.height(p.x, p.z);
      c.car.root.visible = c.s > 0;
      if (c.car.collider) c.car.collider.enabled = c.s > 0;
      if (c.s > 0) c.car.setPose(p, at.yaw, g.world.physics);
      c.siren?.set(p.clone().setY(p.y + 1.5), 0.55, 0);
    }
    if (this.authority) {
      this.carsSyncT -= dt;
      if (this.carsSyncT <= 0) {
        this.carsSyncT = 0.25;
        g.session.emit('cars', { s: this.cops.map((c) => +c.s.toFixed(1)), v: this.cops.map((c) => +c.v.toFixed(1)) });
      }
      // A cruiser catches a stopped/crashed rider
      for (const ch of ['elias', 'jax'] as CharacterId[]) {
        const b = g.body(ch);
        const near = this.cops.some((c) => c.active && c.s > 0 && c.car.root.position.distanceTo(b.pos) < 4.5);
        const rb = g.remote.bike;
        const slowRider = ch === g.localChar ? (this.bikes.ctrl.crashed || Math.abs(this.bikes.ctrl.speed) < 3) : !g.remote.onBike || !rb || (rb[6] ?? 0) > 0.5 || Math.abs(rb[5] ?? 0) < 3;
        this.catchT[ch] = near && slowRider ? this.catchT[ch] + dt : Math.max(0, this.catchT[ch] - dt);
        if (this.catchT[ch] > 1.6) {
          this.catchT[ch] = 0;
          g.session.emit('dlg', { lines: [{ who: 'cop', text: 'Got one! Stay down!', dur: 1.8 } satisfies Line], at: g.session.sharedNow() });
          g.session.emit('caught', { who: ch, by: 'police' });
        }
      }
    }
  }

  lightAt(): number { return 0.5; }
  suspicion(): number { return 0; }

  dispose(): void {
    this.stopCops();
    this.bikes?.dispose();
    this.sirenStart?.stop();
  }
}

void closeUp; void poseChar;
