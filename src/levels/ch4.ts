// Chapter 4 — The Brother. Crane Construction's quarry site on a working Monday morning:
// down the haul road among the crews, find Julius Crane in the pit, chase him up the north stairs
// and through the compound, get past his two biggest workers, drag him out of his car,
// tie him to a chair in the site office and make him say where Victor is hiding.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, closeUp, twoShot, ots, poseChar, npcPlace, shot, lookChar, clipChar, npcClip } from './cs';
import { Terrain, fbm, distToPath, smooth } from './terrain';
import { Foliage, scatter, type FoliageItem } from './foliage';
import { Car } from './vehicles';
import { cylinderBetween } from '../engine/geometry';
import type { NpcDef } from '../game/npc';

const RIM_Y = 10;
const FLOOR_Y = -14;
const PIT_R = 60;
// Haul road: from the SW rim spiralling down to the pit floor in the east.
const HAUL: Array<[number, number]> = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  const a = THREE.MathUtils.degToRad(215 + t * 165);
  const r = 63 - t * 31;
  HAUL.push([Math.cos(a) * r, Math.sin(a) * r]);
}
const OFFICE = { x: 4, z: 82 };
const UP = RIM_Y + 3.2;
const STAIR_X = -10;
// The stairs start just off the quarry floor and reach the rim plateau.
const STAIR_Z0 = 29.5, STAIR_Z1 = 29.5 + 4 * 6.8;
/** Where Julius is found (pit floor, by the trucks). */
const JULIUS0 = { x: 2, z: 10 };
/** Julius's car beside the site office. */
const CAR = { x: OFFICE.x + 10, z: OFFICE.z + 2 };
/** The interrogation chair (upstairs office, facing the door). */
const CHAIR = { x: OFFICE.x + 0.4, z: OFFICE.z - 0.6 };

export class Chapter4 extends Chapter {
  readonly num = 4;
  readonly title = 'The Brother';
  readonly subtitle = 'Crane Construction, Harlow quarry site';
  music = 'music_explore';
  outfit: 'prison' | 'civil' = 'civil';
  terrain!: Terrain;
  kit!: Kit;
  private foliage: Foliage | null = null;
  private haulLen = 1;
  private car!: Car;
  private ropes: THREE.Group | null = null;
  private nav!: import('../game/nav').NavGraph;
  /** Authority: Julius's run is in progress (leg index), so a re-join doesn't restart it. */
  private runLeg = -1;

  readonly checkpoints: Record<string, CheckpointDef> = {
    site: { spawn: { elias: { pos: [-52, 0, -48], yaw: 0.6 }, jax: { pos: [-50, 0, -50], yaw: 0.6 } }, objective: 'Find Julius Crane — he\'ll be down in the pit with the trucks', intro: 'cs4_site', outfit: 'civil' },
    brawl: { spawn: { elias: { pos: [STAIR_X - 0.5, 0, STAIR_Z1 - 2.5], yaw: 0 }, jax: { pos: [STAIR_X + 0.5, 0, STAIR_Z1 - 3.2], yaw: 0 } }, objective: 'Get past Julius\'s workers', outfit: 'civil' },
    office: { spawn: { elias: { pos: [CHAIR.x - 0.9, UP, CHAIR.z - 1.9], yaw: 0.2 }, jax: { pos: [CHAIR.x + 1.1, UP, CHAIR.z - 2.0], yaw: -0.3 } }, objective: 'Tie Julius to the chair', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: true, sprint: true, combat: true, crouch: true };
    const d = this.npcDefs;
    d.push({ id: 'julius', char: 'julius', role: 'story', name: 'Julius Crane', pos: [JULIUS0.x, 0, JULIUS0.z], yaw: Math.PI * 0.6, idleClip: 'docs_check', passive: true, walk: 1.2, run: 4.3, loco: 'normal' });
    // The crews: they just work (passive), a few walk their rounds.
    const wk = (id: string, char: string, x: number, z: number, yaw: number, clip?: string, patrol?: Array<[number, number, number?, number?]>, name = 'Worker') =>
      d.push({ id, char, role: 'story', name, pos: [x, 0, z], yaw, idleClip: clip, passive: true, walk: 1.0, loco: 'normal', patrol });
    wk('wk_pit1', 'worker1', -11.5, 6.5, -2.4, 'work_mid');
    wk('wk_pit2', 'worker2', JULIUS0.x + 1.6, JULIUS0.z + 1.4, -2.4, 'listen');
    wk('wk_pit3', 'worker4', 20, -4, 0, undefined, [[20, -4, 3], [31, 6, 4, 1.2], [14, 18, 2], [6, -2, 3]]);
    wk('wk_pit4', 'worker3', 19, -9.5, 0.9, 'work_table');
    wk('wk_pit5', 'worker2', 34, -20, -0.6, 'docs_check');
    wk('wk_flag', 'worker1', -45.5, -43.5, -2.4, 'idle_look', undefined, 'Flagman');
    wk('wk_haul', 'worker4', 2, -45, 0, undefined, [[2, -45, 2], [24, -38, 3, 0.5], [2, -45, 4, -1.5]]);
    wk('wk_c1', 'worker3', -26, 78.5, Math.PI / 2, 'work_table');
    wk('wk_c2', 'worker1', -20, 96, 0, undefined, [[-20, 96, 3], [0, 100, 2], [-6, 90, 3, Math.PI]]);
    wk('wk_c3', 'worker4', 28, 98.5, Math.PI, 'work_mid');
    wk('wk_c4', 'worker2', 19.5, 66.5, Math.PI / 2, 'idle_dust');
    // The two big lads Julius sets on you at the top of the stairs.
    const brute = (id: string, char: string, name: string, x: number, z: number): void => {
      d.push({ id, char, role: 'thug', name, pos: [x, 0, z], yaw: Math.PI, hostile: false, passive: true, hp: 75, damage: 8, vision: { range: 14, fov: 120 }, walk: 1.1, run: 3.8, loco: 'normal', idleClip: 'idle_dust' });
    };
    brute('sal', 'worker3', 'Big Sal', STAIR_X + 4, 67);
    brute('boone', 'worker1', 'Boone', STAIR_X - 4, 68);
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.pit = [
      { who: 'jax', text: 'Look at all these guys. Fifty hard hats and not one of them knows who signs their checks.' },
      { who: 'elias', text: 'Keep the guns in your jacket. They didn\'t do anything to us.' },
    ];
    D.flagman = [
      { who: 'wk_flag', text: 'Morning. Trucks have the right of way on the haul road, so stay on the inside.' },
      { who: 'jax', text: 'We\'re looking for Mr. Crane. Julius.' },
      { who: 'wk_flag', text: 'Down in the pit, by the trucks. Clipboard, yelling. You can\'t miss him.' },
    ];
    D.julius_car = [{ who: 'julius', text: 'Come on — start! Start, you piece of junk!', dur: 2.8 }];
    D.brawl_won = [{ who: 'jax', text: 'He\'s in the car! Get him out before it starts!' }];
    D.grab_tip = [{ who: 'narrator', text: 'Sprint to catch up, then press Use to grab him.', dur: 3.4 }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/farm.hdr', envIntensity: 0.55, background: 0xaabccb,
      fog: { color: 0xbac6cf, density: 0.0045 },
      hemi: { sky: 0xcfe0f2, ground: 0x55493a, intensity: 0.62 },
      sun: { color: 0xfff1da, intensity: 2.7, dir: [0.45, 1, 0.35], shadows: true },
      grade: { saturation: 0.95, contrast: 1.06, lift: [0.01, 0.01, 0.012], gain: [1.03, 1.0, 0.97], shadowTint: [0.95, 0.98, 1.05], highlightTint: [1.05, 1.0, 0.94], bloom: 0.5, vignette: 0.45 },
      reverb: 0.3,
    });
    this.kit = new Kit(w);
    await this.buildTerrain();
    for (const cp of Object.values(this.checkpoints)) for (const sp of Object.values(cp.spawn)) if (sp.pos[1] === 0) sp.pos[1] = this.groundY(sp.pos[0], sp.pos[2]) + 0.05;
    for (const d of this.npcDefs) if (d.pos[1] === 0) d.pos[1] = this.y(d.pos[0], d.pos[2]) + 0.05;
    await this.buildPit();
    await this.buildCompound();
    await this.buildOffice();
    this.kit.initLightPool(Math.max(2, g.deps.renderer.q.maxLights - 1));
    this.kit.finish();
    // Brawl spawns stand on the stairs.
    for (const sp of Object.values(this.checkpoints.brawl.spawn)) sp.pos[1] = this.stairProfile(sp.pos[2]) + 0.05;
    w.ambientLoop('amb_wind', 0.18);
    w.ambientLoop('amb_factory', 0.35, v3(10, FLOOR_Y, 6));
    w.ambientLoop('amb_factory', 0.25, v3(26, RIM_Y, 96));
    let toolT = 2;
    w.tickers.add((dt, t) => {
      this.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      this.foliage?.update(dt, g.cam.camera.position);
      this.car.update(t);
      // Site noise: hammers, grinders and drills somewhere nearby.
      toolT -= dt;
      if (toolT <= 0) {
        toolT = 1.5 + Math.random() * 3;
        const spots = [v3(-11.5, FLOOR_Y + 1, 6.5), v3(19, FLOOR_Y + 1, -9.5), v3(28, RIM_Y + 1, 98.5), v3(-26, RIM_Y + 1, 78.5)];
        const p = spots[Math.floor(Math.random() * spots.length)];
        if (p.distanceTo(g.cam.camera.position) < 45) g.audio.play('tools', { pos: p, volume: 0.45, jitter: 0.1, maxDist: 45 });
      }
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
    g.setNav(this.nav);
  }

  private groundY(x: number, z: number): number {
    const hit = this.g.world.physics.groundAt(x, z, 40);
    return hit ? hit.y : this.y(x, z);
  }

  /** Terraced pit, rim plateau, haul road and the levelled compound pad. */
  private height(x: number, z: number, carve = true): number {
    const r = Math.hypot(x, z) + fbm(x * 0.05, z * 0.05, 2, 4) * 2.5;
    let h = RIM_Y + fbm(x * 0.012, z * 0.012, 3, 9) * 4 * smooth(PIT_R + 6, PIT_R + 30, r);
    if (r < PIT_R + 2) {
      // Benches: floor below r 30, then 4 steps of 6 m with steep faces.
      const steps = [30, 38, 46, 54, PIT_R];
      let lv = FLOOR_Y;
      for (let i = 0; i < 4; i++) lv += 6 * smooth(steps[i], steps[i] + 2.2, r);
      h = THREE.MathUtils.lerp(lv, h, smooth(PIT_R - 1.5, PIT_R + 2, r));
    }
    // Haul road overrides the benches with a steady grade.
    const hr = distToPath(x, z, HAUL);
    const roadH = RIM_Y - (RIM_Y - FLOOR_Y) * Math.min(1, hr.t / this.haulLenCalc());
    h = THREE.MathUtils.lerp(h, roadH, smooth(6, 3.4, hr.d));
    // Compound pad
    const ox = x, oz = z - 82;
    if (Math.abs(ox) < 52 && oz > -24 && oz < 34) h = THREE.MathUtils.lerp(h, RIM_Y, smooth(6, 0, Math.max(Math.abs(ox) - 46, -24 - oz + 6, oz - 28, 0)));
    // Channel cut into the north face for the stairs, so rock never covers a step.
    if (carve && z > STAIR_Z0 - 2 && z < STAIR_Z1 + 1) {
      const out = Math.max(STAIR_X - 2.2 - x, x - (STAIR_X + 2.2), 0);
      if (out < 2.2) {
        const s = this.stairProfile(Math.min(Math.max(z, STAIR_Z0), STAIR_Z1));
        const depth = 0.3 * Math.min(1, Math.max(0, (z - STAIR_Z0) / 1.5));
        h = THREE.MathUtils.lerp(h, Math.min(h, s - depth), smooth(2.2, 0, out));
      }
    }
    return h;
  }
  private stairY0Cached: number | null = null;
  get stairY0(): number { return (this.stairY0Cached ??= this.height(STAIR_X, STAIR_Z0 - 2, false)); }
  /** Walking height along the stairs (one even flight). */
  private stairProfile(z: number): number {
    const t = THREE.MathUtils.clamp((z - STAIR_Z0) / (STAIR_Z1 - STAIR_Z0), 0, 1);
    return this.stairY0 + (RIM_Y - this.stairY0) * t;
  }
  private haulLenCached = 0;
  private haulLenCalc(): number {
    if (!this.haulLenCached) { let L = 0; for (let i = 1; i < HAUL.length; i++) L += Math.hypot(HAUL[i][0] - HAUL[i - 1][0], HAUL[i][1] - HAUL[i - 1][1]); this.haulLenCached = L; this.haulLen = L; }
    return this.haulLenCached;
  }
  y(x: number, z: number): number { return this.terrain ? this.terrain.height(x, z) : this.height(x, z); }

  private async buildTerrain(): Promise<void> {
    const g = this.g, w = g.world;
    this.terrain = new Terrain({
      x0: -150, z0: -150, size: 300, res: 151, height: (x, z) => this.height(x, z),
      layers: [
        { set: 'dry_ground', scale: 0.15, tint: 0xa89f8e, surface: 'dirt', roughness: 0.95 },
        { set: 'gravel_sand', scale: 0.25, tint: 0xc0b8a6, surface: 'gravel', roughness: 0.9 },
        { set: 'rock_face', scale: 0.09, tint: 0xaaa398, surface: 'gravel', roughness: 0.9 },
        { set: 'grass_sparse', scale: 0.16, tint: 0x8a9a6c, surface: 'grass', roughness: 0.95 },
      ],
      weights: (x, z, _h, slope) => {
        const r = Math.hypot(x, z);
        const inPit = smooth(PIT_R + 4, PIT_R - 2, r);
        const road = smooth(6, 3, distToPath(x, z, HAUL).d);
        const rock = smooth(0.32, 0.58, slope) * 1.8;
        const grass = (1 - inPit) * smooth(PIT_R + 8, PIT_R + 30, r) * (1 - smooth(52, 40, Math.abs(x))) * 0.8 + (1 - inPit) * 0.2;
        return [0.4 * (1 - inPit), inPit * 0.9 + road * 1.2, rock, grass];
      },
    });
    await this.terrain.build(w);
    const items: FoliageItem[] = [
      { model: 'tree_fir_a', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'tree_fir_b', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'fir_big', impostor: true, collider: 0.35, colliderHeight: 5 },
      { model: 'bush_b', near: 45, shadow: false },
      { model: 'boulder_b', near: 70, collider: 0.9, colliderHeight: 1.2 },
    ];
    const pl = scatter({
      x0: -148, z0: -148, x1: 148, z1: 148, spacing: 7, seed: 44, height: (x, z) => this.y(x, z),
      density: (x, z) => {
        const r = Math.hypot(x, z);
        if (r < PIT_R + 10) return 0;
        if (distToPath(x, z, HAUL).d < 8) return 0;
        if (Math.abs(x) < 56 && z > 52) return 0;
        if (Math.hypot(x + 52, z + 48) < 12) return 0;
        return 0.55;
      },
      pick: (rr) => (rr < 0.07 ? 4 : rr < 0.15 ? 3 : rr < 0.5 ? 0 : rr < 0.8 ? 1 : 2),
      scale: (item, rr) => (item === 2 ? 0.7 + rr * 0.4 : 1.0 + rr * 0.6),
    });
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, pl);
    this.haulLenCalc();
  }

  // ------------------------------------------------------------------ pit: machinery, cones, stairs
  private async buildPit(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [excav, dozer, truck, steel, wheelbarrow] = await Promise.all([
      w.model('excavator'), w.model('dozer'), w.model('dump_truck'),
      L.pbr('steel', { scale: 1, color: 0x6a6e72, metalness: 0.6, roughness: 0.55 }),
      w.model('wheelbarrow'),
    ]);
    const fy = (x: number, z: number) => this.y(x, z);
    kit.place(excav, [-16, fy(-16, 2), 2], 0.8);
    w.physics.addBox({ x: -16, y: fy(-16, 2) + 2, z: 2 }, { x: 7, y: 4, z: 2.6 }, 0.8, { surface: 'metal' });
    kit.place(dozer, [38, fy(38, -24), -24], 2.2);
    w.physics.addBox({ x: 38, y: fy(38, -24) + 1.6, z: -24 }, { x: 5.2, y: 3.2, z: 3.8 }, 2.2, { surface: 'metal' });
    for (const [x, z, yaw] of [[8, 2, 0.3], [18, 14, 2.4], [-6, 18, 1.5]] as const) {
      kit.place(truck, [x, fy(x, z), z], yaw);
      w.physics.addBox({ x, y: fy(x, z) + 1.6, z }, { x: 2.9, y: 3.2, z: 8.2 }, yaw, { surface: 'metal' });
    }
    // Gravel piles
    const gravel = await L.pbr('gravel', { scale: 0.5, color: 0xc0b8a8 });
    for (const [x, z, r, hgt] of [[-4, -16, 6, 3.5], [24, -4, 4.5, 2.6], [-22, 18, 5, 3]] as const) {
      const cone = new THREE.ConeGeometry(r, hgt, 20, 1);
      cone.translate(x, fy(x, z) + hgt / 2 - 0.1, z);
      kit.batch.add(cone, gravel);
      w.physics.addRamp({ x, y: fy(x, z) + hgt / 4, z }, { x: r * 1.2, y: hgt / 2, z: r * 1.2 }, 0, 'x', fy(x, z), fy(x, z) + hgt / 2, { surface: 'gravel', solid: true });
    }
    // Traffic cones along the haul road's foot and around the trucks.
    const coneMat = L.plain(0xff6a1a, 0.6);
    const white = L.plain(0xeeeeee, 0.6);
    for (const [x, z] of [[26, 14], [24, 17], [22, 20], [12, 22], [-2, 6], [-4, 9], [30, -12], [33, -15]] as const) {
      const y0 = fy(x, z);
      const c = new THREE.ConeGeometry(0.17, 0.62, 10);
      c.translate(x, y0 + 0.31, z);
      kit.batch.add(c, coneMat);
      const band = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10);
      band.translate(x, y0 + 0.36, z);
      kit.batch.add(band, white);
    }
    for (const [x, z, yaw] of [[-9.5, 7.5, 1.2], [21, -7.5, -0.4]] as const) kit.place(wheelbarrow, [x, fy(x, z), z], yaw);
    // Portable light plants (off in daylight, still a landmark).
    for (const [x, z] of [[-2, 6], [22, 22], [36, -14]] as const) {
      const y0 = fy(x, z);
      kit.batch.add(cylinderBetween(v3(x, y0, z), v3(x, y0 + 7, z), 0.1, 8), steel);
      kit.box(L.plain(0xd8c040, 0.6), [x, y0 + 0.6, z], [1.2, 1.2, 2.2], 0, {});
      kit.box(L.plain(0xdddddd, 0.4, 0.3), [x, y0 + 7.1, z], [1.4, 0.4, 0.2], 0, false);
    }
    // Maintenance stairs up the north face: one straight, even flight from the quarry floor to the rim.
    const sx = STAIR_X, W = 1.6;
    const y0 = this.stairY0, y1 = RIM_Y;
    kit.stairs(steel, sx, STAIR_Z0, 0, W, y0, y1, STAIR_Z1 - STAIR_Z0);
    for (const side of [-1, 1]) {
      const x = sx + side * (W / 2 + 0.06);
      kit.batch.add(cylinderBetween(v3(x, y0 + 1.0, STAIR_Z0), v3(x, y1 + 1.0, STAIR_Z1), 0.03, 8), steel);
      for (let k = 0; k <= 9; k++) {
        const t = k / 9, zz = STAIR_Z0 + (STAIR_Z1 - STAIR_Z0) * t, yy = y0 + (y1 - y0) * t;
        kit.batch.add(cylinderBetween(v3(x, yy, zz), v3(x, yy + 1.0, zz), 0.025, 6), steel);
      }
      w.physics.addBox({ x, y: (y0 + y1) / 2 + 0.6, z: (STAIR_Z0 + STAIR_Z1) / 2 }, { x: 0.08, y: y1 - y0 + 1.6, z: STAIR_Z1 - STAIR_Z0 }, 0, { blocksSight: false, blocksCamera: false, walkable: false, surface: 'metal' });
    }
    kit.box(steel, [sx, y1 - 0.06, STAIR_Z1 + 1.25], [W + 0.4, 0.12, 2.5], 0, false);
    const rimY = this.height(sx, STAIR_Z1 + 2.6, false);
    w.physics.addRamp({ x: sx, y: (y1 + rimY) / 2 - 0.2, z: STAIR_Z1 + 1.3 }, { x: W + 0.4, y: Math.abs(y1 - rimY) + 0.4, z: 2.6 }, 0, 'z', y1, rimY, { surface: 'metal' });
    // Nav for the pit + compound
    const NavGraph = (await import('../game/nav')).NavGraph;
    this.nav = new NavGraph(w.physics);
    for (const [x, zz] of [[0, -4], [-14, 6], [-6, 22], [10, 10], [16, 24], [26, 8], [8, -10], [4, 14], [44, -24], [36, -36], [50, -10], [-20, 70], [-30, 86], [-10, 92], [-6, 72], [20, 92], [28, 74], [14, 70], [12, 96], [0, 76], [-10, 66], [4, 70], [STAIR_X, 63]] as const) this.nav.add(x, this.y(x, zz), zz);
    this.nav.autoLink(16, 3);
  }

  // ------------------------------------------------------------------ compound: fence, containers, building frame
  private async buildCompound(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const mats = await import('../engine/materials');
    const [steel, conc, rebar] = await Promise.all([
      L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
      L.pbr('concrete_grey', { scale: 0.4 }),
      Promise.resolve(L.plain(0x6a3a22, 0.7, 0.4)),
    ]);
    const chain = new THREE.MeshStandardMaterial({ map: mats.canvasTexture('chainLink', mats.DRAW.chainLink, 256), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45, color: 0xb5b8ba });
    const Y = RIM_Y;
    kit.fence(steel, chain, -46, 60, STAIR_X - 2, 60, Y, 2.6);
    kit.fence(steel, chain, STAIR_X + 4, 60, 46, 60, Y, 2.6);
    kit.fence(steel, chain, 46, 60, 46, 106, Y, 2.6);
    kit.fence(steel, chain, -46, 106, -46, 60, Y, 2.6);
    kit.fence(steel, chain, -46, 106, 46, 106, Y, 2.6);
    const container = await w.model('container');
    for (const [x, z, yaw, up] of [[-28, 70, 0, 0], [-28, 74, 0, 0], [-28, 70, 0, 2.8], [-18, 82, Math.PI / 2, 0], [-36, 90, 0.2, 0], [26, 88, Math.PI / 2, 0]] as const) {
      kit.place(container, [x, Y + up, z], yaw);
      if (up === 0) w.physics.addBox({ x, y: Y + 1.4, z }, { x: 6.1, y: 2.8, z: 3.2 }, yaw, { surface: 'metal' });
    }
    // Generator
    kit.box(L.plain(0xd8c040, 0.6, 0.3), [24, Y + 1.0, 66], [2.4, 2.0, 1.4], 0, { surface: 'metal' });
    w.ambientLoop('amb_fan', 0.35, v3(24, Y + 1, 66));
    // A three-storey concrete frame going up at the back of the compound (the "construction" in Crane Construction).
    const fx0 = 16, fx1 = 40, fz0 = 94, fz1 = 104;
    for (let x = fx0; x <= fx1 + 0.1; x += 6) for (const z of [fz0, fz1]) {
      kit.box(conc, [x, Y + 5.25, z], [0.5, 10.5, 0.5], 0, { surface: 'concrete' });
    }
    for (const lv of [3.5, 7.0]) kit.box(conc, [(fx0 + fx1) / 2, Y + lv, (fz0 + fz1) / 2], [fx1 - fx0 + 0.6, 0.3, fz1 - fz0 + 0.6], 0, false);
    // Rebar sticking out of the top and pallets of block on the ground.
    for (let x = fx0; x <= fx1 + 0.1; x += 6) for (const z of [fz0, fz1]) for (const o of [-0.12, 0.12]) kit.batch.add(cylinderBetween(v3(x + o, Y + 10.5, z + o), v3(x + o, Y + 11.4, z + o), 0.015, 4), rebar);
    const block = L.plain(0x9a9690, 0.9);
    const pallet = L.plain(0x8a6a44, 0.85);
    for (const [x, z] of [[12, 98], [12, 101.5], [-2, 96], [-30, 100], [32, 72]] as const) {
      kit.box(pallet, [x, Y + 0.08, z], [1.2, 0.16, 1.0], 0, false);
      kit.box(block, [x, Y + 0.55, z], [1.1, 0.8, 0.9], 0, { surface: 'concrete' });
    }
    // Pipe stack
    const pipe = L.plain(0x3a5a7a, 0.5, 0.5);
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : 1, k = i % 3;
      const pz = 72 + k * 0.62 + row * 0.31, py = Y + 0.3 + row * 0.54;
      kit.batch.add(cylinderBetween(v3(-38, py, pz), v3(-32, py, pz), 0.3, 12), pipe);
    }
    w.physics.addBox({ x: -35, y: Y + 0.55, z: 72.9 }, { x: 6, y: 1.1, z: 1.9 }, 0, { surface: 'metal' });
    // Julius's car (the battery is flat, as it turns out).
    this.car = await Car.create(w, { tint: 0x6a1e1a, headlights: false });
    this.car.setPose(v3(CAR.x, Y, CAR.z), Math.PI, w.physics);
    // Site sign at the top of the haul road.
    kit.box(L.plain(0xf2c230, 0.6), [-47.5, this.y(-47.5, -45) + 2.0, -45], [3.2, 1.4, 0.1], 0.6, false);
    kit.batch.add(cylinderBetween(v3(-47.5 - 1.2, this.y(-47.5, -45), -45), v3(-47.5 - 1.2, this.y(-47.5, -45) + 1.4, -45), 0.05, 6), steel);
    kit.batch.add(cylinderBetween(v3(-47.5 + 1.2, this.y(-47.5, -45), -45), v3(-47.5 + 1.2, this.y(-47.5, -45) + 1.4, -45), 0.05, 6), steel);
  }

  // ------------------------------------------------------------------ office: two storeys, exterior stairs
  private async buildOffice(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [wall, floor, steel, carpet] = await Promise.all([
      L.pbr('corrugated', { scale: 0.6, color: 0xd4d0c2, metalness: 0.3, roughness: 0.6 }),
      L.pbr('planks', { scale: 0.7, color: 0x8a6a4a }),
      L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
      L.pbr('concrete_floor', { scale: 0.4, color: 0x5a4a44 }),
    ]);
    const { x, z } = OFFICE;
    const Y = RIM_Y;
    kit.floor(carpet, x - 6, z - 4, x + 6, z + 4, Y + 0.05, 0.2);
    kit.wall(wall, x - 6, z - 4, x + 6, z - 4, Y, 3.2, 0.15, [{ at: 4.5, width: 1.1, bottom: 0, top: 2.2 }]);
    kit.wall(wall, x + 6, z + 4, x - 6, z + 4, Y, 3.2, 0.15);
    kit.wall(wall, x - 6, z + 4, x - 6, z - 4, Y, 3.2, 0.15);
    kit.wall(wall, x + 6, z - 4, x + 6, z + 4, Y, 3.2, 0.15);
    kit.slab(floor, x - 6.1, z - 4.1, x + 6.1, z + 4.1, UP, 0.2, 'wood');
    kit.wall(wall, x - 6, z - 4, x + 6, z - 4, UP, 3.0, 0.15, [{ at: 9.5, width: 1.0, bottom: 0, top: 2.2 }, { at: 3, width: 2.4, bottom: 1.0, top: 2.2 }, { at: 6.2, width: 1.6, bottom: 1.0, top: 2.2 }]);
    kit.wall(wall, x + 6, z + 4, x - 6, z + 4, UP, 3.0, 0.15, [{ at: 6, width: 3, bottom: 1.0, top: 2.2 }]);
    kit.wall(wall, x - 6, z + 4, x - 6, z - 4, UP, 3.0, 0.15);
    kit.wall(wall, x + 6, z - 4, x + 6, z + 4, UP, 3.0, 0.15);
    kit.ceiling(wall, x - 6.1, z - 4.1, x + 6.1, z + 4.1, UP + 3.0, 0.2);
    // Exterior stairs to the upper door, railings on the landing's sides (not across the stairs).
    kit.stairs(steel, x + 3.5, z - 9.6, 0, 1.2, Y, UP, 4.8);
    kit.slab(steel, x + 2.75, z - 4.8, x + 4.25, z - 4.05, UP, 0.12, 'metal');
    kit.railing(steel, x + 2.75, z - 4.8, x + 2.75, z - 4.05, UP);
    kit.railing(steel, x + 4.25, z - 4.8, x + 4.25, z - 4.05, UP);
    // Interior: desk, plans table, cabinets, the chair in the middle of the room.
    const desk = L.plain(0x3a2a1e, 0.6);
    kit.box(desk, [x, UP + 0.4, z + 2.4], [2.4, 0.8, 1.0], 0, { surface: 'wood' });
    const chair = await w.model('office_chair');
    kit.place(chair, [x, UP, z + 3.3], Math.PI);
    kit.place(chair, [CHAIR.x, UP, CHAIR.z], Math.PI);
    kit.box(L.plain(0xd8d2c0, 0.8), [x - 3.6, UP + 0.86, z + 1.4], [2.0, 0.04, 1.2], 0, false); // blueprints
    kit.box(desk, [x - 3.6, UP + 0.42, z + 1.4], [1.9, 0.84, 1.1], 0, { surface: 'wood' });
    for (const dx of [3.6, 4.4, 5.2]) kit.box(L.plain(0x5c6064, 0.5, 0.4), [x + dx, UP + 0.7, z + 3.6], [0.7, 1.4, 0.6], 0, {});
    kit.bulb(L.emissive(0xfff2dc, 2.5), steel, x - 2.4, UP + 2.7, z + 1.0, 0xfff0d8, 2.4, 9, 'office');
    kit.bulb(L.emissive(0xfff2dc, 2.5), steel, x + 2.0, UP + 2.7, z - 1.4, 0xfff0d8, 2.0, 9, 'office');
    // Ropes for the chair (shown once he's tied).
    const rope = L.plain(0x9a8460, 0.95);
    const g = new THREE.Group();
    for (const [yy, r] of [[0.95, 0.24], [1.18, 0.23]] as const) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 5, 18), rope);
      t.rotation.x = Math.PI / 2;
      t.position.set(0, yy, 0.02);
      g.add(t);
    }
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 5, 10), rope);
      t.rotation.x = Math.PI / 2;
      t.position.set(s * 0.12, 0.2, 0.05);
      g.add(t);
    }
    g.position.set(CHAIR.x, UP, CHAIR.z);
    g.visible = false;
    w.root.add(g);
    this.ropes = g;
  }

  // ================================================================== interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    g.extras.addMemory({ id: 'c4_sign', pos: v3(-47.5, this.y(-47.5, -45), -44.2), radius: 1.8, label: 'Read the sign', enabled: () => this.flags.phase === 'site', lines: [
      { who: 'jax', text: '"Crane Construction. Building Harlow\'s future." He named a hole in the ground after himself.' },
      { who: 'elias', text: 'He\'s been filling holes with people for thirty years. Let\'s go.', anim: 'talk_angry' },
    ] });
    I.add({ id: 'talk_flag', pos: v3(-45.5, this.y(-45.5, -43.5), -43.5), radius: 2.2, label: 'Talk to the flagman', icon: 'talk',
      enabled: () => this.flags.phase === 'site' && !this.flags.askedFlag, onUse: () => g.session.request('askFlag', {}) });
    // Grab Julius while he runs (the point follows him every frame).
    I.add({ id: 'grab_julius', pos: v3(0, 0, 0), radius: 1.9, label: 'Grab Julius', icon: 'fist', priority: 6,
      enabled: () => this.flags.phase === 'chase' || (this.flags.phase === 'brawl' && !this.flags.inCar), onUse: () => g.session.request('grabJulius', {}) });
    I.add({ id: 'car_julius', pos: v3(CAR.x - 1.5, RIM_Y, CAR.z - 0.4), radius: 1.8, label: 'Drag Julius out of the car', icon: 'hand', priority: 6,
      enabled: () => this.flags.phase === 'brawl' && !!this.flags.inCar, onUse: () => g.session.request('grabJulius', {}) });
    I.add({ id: 'tie_julius', pos: v3(CHAIR.x, UP, CHAIR.z - 0.7), radius: 1.7, label: 'Tie Julius to the chair', icon: 'hand', mode: 'hold', holdTime: 2.2, pose: 'use', poseCtx: { k: { height: 0.9 } },
      enabled: () => this.flags.phase === 'office' && !this.flags.tied, onUse: () => g.session.request('tieJulius', {}) });
  }

  // ================================================================== triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'haul_mid', min: [-10, -40, -60], max: [70, 40, -20], who: 'any', enabled: () => this.flags.phase === 'site' });
    this.addTrigger({ id: 'spot', min: [JULIUS0.x - 15, FLOOR_Y - 3, JULIUS0.z - 15], max: [JULIUS0.x + 15, FLOOR_Y + 5, JULIUS0.z + 15], who: 'any', enabled: () => this.flags.phase === 'site' });
  }

  onTrigger(id: string): void {
    if (!this.authority) return;
    switch (id) {
      case 'haul_mid': this.say('pit'); break;
      case 'spot': this.cutscene('cs4_spotted'); break;
    }
  }

  // ================================================================== Julius's run (authority)
  /** Route from the pit floor up the north stairs (leg 0..4), then through the compound to his car. */
  private routeUp(): THREE.Vector3[] {
    return [
      v3(0, this.y(0, 22), 22),
      v3(STAIR_X, this.y(STAIR_X, 26), 26),
      v3(STAIR_X, this.stairY0, STAIR_Z0 - 0.6),
      v3(STAIR_X, RIM_Y, STAIR_Z1 + 0.4),
      v3(STAIR_X, RIM_Y, 63.5),
    ];
  }
  private routeCar(): THREE.Vector3[] {
    return [v3(-2, RIM_Y, 68), v3(9.6, RIM_Y, 73.5), v3(11.8, RIM_Y, 77.5), v3(11.8, RIM_Y, CAR.z - 0.4)];
  }

  private runRoute(pts: THREE.Vector3[], speed: number, done: () => void, i = 0): void {
    const n = this.g.npcs.get('julius');
    if (!n || !this.authority) return;
    if (i >= pts.length) { this.runLeg = -1; done(); return; }
    this.runLeg = i;
    n.direct = true;
    n.walkTo(pts[i], speed, () => this.runRoute(pts, speed, done, i + 1));
  }

  private showJulius(on: boolean): void {
    const n = this.g.npcs.get('julius');
    if (!n) return;
    n.enabled = on; n.body.visible = on; n.body.solid = on;
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    C.cs4_site = {
      id: 'cs4_site', music: 'music_explore',
      start: () => {},
      beats: [
        { dur: 6, fade: 'in', shot: () => shot(v3(-60, RIM_Y + 12, -60), v3(10, FLOOR_Y + 4, 10), 6, { fov: 46, toEnd: v3(6, FLOOR_Y, 24) }),
          lines: [{ who: 'narrator', text: 'Crane Construction, Harlow quarry site. Monday, 7:40 AM.', dur: 3.6 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 14, 2.6, 1.5, 1), lines: [
          { who: 'elias', text: 'Julius signs off on every load that leaves this place. Victor doesn\'t trust anybody else with the paperwork.' },
          { who: 'jax', text: 'So he knows where the bodies are buried.' },
          { who: 'elias', text: 'Some of them he poured the concrete over himself.', anim: 'talk_angry' },
          { who: 'jax', text: 'Haul road\'s that way. Act like you belong.' },
        ] },
      ],
      end: () => {
        if (this.authority) this.objective('Find Julius Crane — he\'ll be down in the pit with the trucks', [HAUL[20][0], this.y(HAUL[20][0], HAUL[20][1]) + 1.5, HAUL[20][1]]);
      },
    };
    C.cs4_spotted = {
      id: 'cs4_spotted', music: 'music_tension', skippable: true,
      start: () => {
        const jy = this.y(JULIUS0.x, JULIUS0.z);
        npcPlace(g, 'julius', v3(JULIUS0.x, jy, JULIUS0.z), Math.PI * 0.6);
        // The two of you walk up from the haul road.
        const ax = JULIUS0.x + 11, az = JULIUS0.z + 3;
        placeChar(g, 'elias', v3(ax, this.y(ax, az), az), -Math.PI / 2 - 0.2);
        placeChar(g, 'jax', v3(ax + 0.8, this.y(ax + 0.8, az + 1.3), az + 1.3), -Math.PI / 2 - 0.3);
      },
      beats: [
        { dur: 3.4, shot: () => shot(v3(JULIUS0.x - 3.5, this.y(JULIUS0.x, JULIUS0.z) + 1.7, JULIUS0.z - 2.5), v3(JULIUS0.x, this.y(JULIUS0.x, JULIUS0.z) + 1.4, JULIUS0.z), 3.4, { fov: 38, fromEnd: v3(JULIUS0.x - 3.0, this.y(JULIUS0.x, JULIUS0.z) + 1.65, JULIUS0.z - 2.0) }),
          lines: [{ who: 'julius', text: 'Forty loads by noon, Eddie. Forty. I don\'t care if you have to drive them yourself.', dur: 3.2 }] },
        { shot: () => twoShot(g, 'jax', 'elias', 6, 2.4, 1.5, -1), lines: [
          { who: 'jax', text: 'Hard hat, clipboard, his brother\'s nose. That\'s him.' },
          { who: 'elias', text: 'Julius!' },
        ] },
        { dur: 3.2, shot: () => closeUp(g, 'julius', 3.2, 1.1, 0.3, { fov: 34 }),
          run: () => { const n = g.npcs.get('julius'); if (n) { n.body.yaw = Math.PI / 2 + 0.2; n.body.model.stop('full', 0.3); } lookChar(g, 'elias', g.npcs.get('julius')?.body.head() ?? null); },
          lines: [{ who: 'julius', text: '...Oh, no. No, no, no. Victor said you\'d — no.', dur: 3.0 }] },
        { dur: 2.2, shot: () => shot(v3(JULIUS0.x + 6, this.y(JULIUS0.x, JULIUS0.z) + 2.2, JULIUS0.z - 5), v3(JULIUS0.x - 2, this.y(JULIUS0.x, JULIUS0.z) + 1.2, JULIUS0.z + 6), 2.2, { fov: 46 }),
          run: () => {
            g.audio.play('paper', { pos: v3(JULIUS0.x, this.y(JULIUS0.x, JULIUS0.z) + 1, JULIUS0.z), volume: 0.8 });
            if (this.authority) { const n = g.npcs.get('julius'); n?.walkTo(v3(0, this.y(0, 22), 22), 4.3); }
          },
          lines: [{ who: 'wk_pit2', text: 'Boss? Boss, where are you going?', dur: 1.8 }] },
      ],
      end: () => {
        lookChar(g, 'elias', null);
        this.flags.phase = 'chase';
        if (this.authority) {
          this.objective('Catch Julius!', null);
          g.session.emit('dlg', { lines: [{ who: 'jax', text: 'He\'s running for the stairs! Don\'t lose him!', dur: 2.6 }], at: g.session.sharedNow() + 100 });
          setTimeout(() => { if (this.flags.phase === 'chase') this.say('grab_tip'); }, 3500);
          g.audio.playMusic('music_chase', 0.6);
          this.runRoute(this.routeUp(), 4.3, () => { if (this.flags.phase === 'chase') this.cutscene('cs4_brutes'); });
        }
      },
    };
    C.cs4_brutes = {
      id: 'cs4_brutes', music: 'music_action', skippable: true,
      start: () => {
        this.flags.phase = 'brutes';
        npcPlace(g, 'julius', v3(STAIR_X + 0.4, RIM_Y, 64.5), Math.PI);
        npcPlace(g, 'sal', v3(STAIR_X + 1.1, RIM_Y, 61.6), Math.PI);
        npcPlace(g, 'boone', v3(STAIR_X - 1.1, RIM_Y, 61.9), Math.PI);
        for (const id of ['sal', 'boone']) npcClip(g, id, null);
        placeChar(g, 'elias', v3(STAIR_X - 0.35, this.stairProfile(STAIR_Z1 - 3.4), STAIR_Z1 - 3.4), 0);
        placeChar(g, 'jax', v3(STAIR_X + 0.35, this.stairProfile(STAIR_Z1 - 4.4), STAIR_Z1 - 4.4), 0);
      },
      beats: [
        { dur: 3.4, shot: () => shot(v3(STAIR_X + 3.5, RIM_Y + 1.9, 58.5), v3(STAIR_X, RIM_Y + 1.5, 64), 3.4, { fov: 40 }),
          lines: [{ who: 'julius', text: 'Sal! Boone! Those are the convicts from the news! Stop them!', dur: 3.2, anim: 'talk_angry' }] },
        { shot: () => ots(g, 'jax', 'sal', 6, 1), lines: [
          { who: 'sal', text: 'You heard the man. Turn around and walk back down.', anim: 'talk_angry' },
          { who: 'jax', text: 'We don\'t have a problem with you, big guy.' },
          { who: 'sal', text: 'You do now.', anim: 'talk_angry' },
        ] },
      ],
      end: () => {
        if (!this.authority) return;
        this.saveCheckpoint('brawl');
        g.session.emit('startBrawl', {});
      },
    };
    C.cs4_caught = {
      id: 'cs4_caught', music: 'music_tension', skippable: true,
      start: () => {
        this.flags.phase = 'caught';
        const n = g.npcs.get('julius');
        if (n) { n.scriptTarget = null; n.direct = false; if (this.authority) n.setState('idle'); n.body.model.stop('full', 0.2); }
        this.showJulius(true);
        n?.body.setPose('hands_up');
        // Wherever it happened, the camera finds the three of you together.
        const jb = n?.body.pos.clone() ?? v3(0, 0, 0);
        const eb = g.body('elias').pos, xb = g.body('jax').pos;
        const near = eb.distanceTo(jb) < xb.distanceTo(jb) ? 'elias' : 'jax';
        const other: CharacterId = near === 'elias' ? 'jax' : 'elias';
        const yaw = n?.body.yaw ?? 0;
        const fwd = v3(Math.sin(yaw), 0, Math.cos(yaw));
        placeChar(g, near, jb.clone().addScaledVector(fwd, -0.75), yaw);
        placeChar(g, other, jb.clone().addScaledVector(fwd, 1.2).add(v3(0.6, 0, 0)), yaw + Math.PI);
        poseChar(g, near, 'choke', { points: { neck: jb.clone().add(v3(0, 1.45, 0)) } });
        g.audio.play('body_fall', { pos: jb, volume: 0.6 });
        g.audio.play('grunt', { pos: jb.clone().add(v3(0, 1.5, 0)), volume: 0.7, delay: 0.1 });
        this.caughtBy = near;
      },
      beats: [
        { shot: () => twoShot(g, this.caughtBy, 'julius', 9, 2.4, 1.5, 1), lines: [
          { who: 'julius', text: 'Okay! Okay, okay — I give up! Don\'t hurt me!', anim: 'talk_nervous' },
          { who: 'elias', text: 'Nobody\'s getting hurt, Julius. Unless you lie to us.' },
          { who: 'julius', text: 'I\'m just a builder! I build things! Ask anybody!' },
          { who: 'elias', text: 'Your office. Upstairs. Walk.' },
        ] },
        { dur: 2.4, fade: 'out', shot: () => shot(v3(OFFICE.x - 14, RIM_Y + 7, OFFICE.z - 16), v3(OFFICE.x, RIM_Y + 3, OFFICE.z), 2.4, { fov: 44 }) },
      ],
      end: () => {
        poseChar(g, 'elias', null); poseChar(g, 'jax', null);
        g.npcs.get('julius')?.body.clearPose(0);
        if (this.authority) { this.saveCheckpoint('office'); g.session.emit('restart', { checkpoint: 'office' }); }
      },
    };
    C.cs4_chair = {
      id: 'cs4_chair', music: 'music_tension', skippable: true,
      start: () => {
        this.seatJulius(true);
        placeChar(g, 'elias', v3(CHAIR.x - 0.9, UP, CHAIR.z - 1.9), 0.3);
        placeChar(g, 'jax', v3(CHAIR.x + 1.1, UP, CHAIR.z - 2.0), -0.45);
        g.guns.show('elias', true); g.guns.show('jax', true);
        poseChar(g, 'jax', 'aim', { k: { pitch: -0.3 } });
      },
      beats: [
        { dur: 3.6, fade: 'in', shot: () => shot(v3(CHAIR.x + 2.6, UP + 2.3, CHAIR.z - 3.4), v3(CHAIR.x, UP + 1.0, CHAIR.z), 3.6, { fov: 40, fromEnd: v3(CHAIR.x + 2.2, UP + 2.0, CHAIR.z - 3.0) }),
          lines: [{ who: 'narrator', text: 'The site office. Door locked, blinds down.', dur: 3 }] },
        { shot: () => ots(g, 'jax', 'julius', 14, 1, { fov: 38 }), lines: [
          { who: 'jax', text: 'Morning, Julius. You know who we are.', anim: 'talk_cool' },
          { who: 'julius', text: 'You\'re the — from the news. Look, I pour concrete. I sign for trucks. That\'s all I do.', anim: 'talk_nervous' },
          { who: 'elias', text: 'I kept your brother\'s books for nine years. I know what you poured concrete over.' },
          { who: 'julius', text: 'If I tell you anything, Victor will kill me. You don\'t know him like I do.' },
        ] },
        { dur: 3.4, shot: () => closeUp(g, 'jax', 3.4, 1.0, 0.25, { fov: 32 }), run: () => { g.audio.play('switch', { pos: g.body('jax').chest(), volume: 0.7 }); poseChar(g, 'elias', 'aim', { k: { pitch: -0.3 } }); },
          lines: [{ who: 'jax', text: 'Look at me, Julius. Who\'s holding the gun right now?', dur: 3.0, anim: 'talk_angry' }] },
        { shot: () => closeUp(g, 'julius', 16, 1.0, -0.3, { fov: 34 }), lines: [
          { who: 'julius', text: '...Okay. Okay! The garage. Crane Motors, down on Dock Street.', anim: 'talk_nervous' },
          { who: 'julius', text: 'He moved everything there the night you two got out. The money, the books, the safe.' },
          { who: 'elias', text: 'Who\'s with him?' },
          { who: 'julius', text: 'All of them. Kessler. The Moreno brothers. Every gun he owns.' },
          { who: 'julius', text: 'He knows you\'re coming. He\'s been waiting for you for three days.', pause: 0.6 },
        ] },
        { shot: () => twoShot(g, 'elias', 'jax', 9, 2.4, 1.5, 1), run: () => { poseChar(g, 'elias', null); poseChar(g, 'jax', null); }, lines: [
          { who: 'jax', text: 'Good. Saves us knocking.' },
          { who: 'elias', text: 'If he calls ahead, Julius, we\'ll know. And we\'ll come back.', anim: 'talk_angry' },
          { who: 'julius', text: 'I won\'t! I swear I won\'t!' },
        ] },
        { dur: 3.2, fade: 'out', shot: () => shot(v3(CHAIR.x, UP + 2.6, CHAIR.z - 3.2), v3(CHAIR.x, UP + 0.9, CHAIR.z), 3.2, { fov: 46 }) },
      ],
      end: () => {
        poseChar(g, 'elias', null); poseChar(g, 'jax', null);
        g.guns.show('elias', false); g.guns.show('jax', false);
        if (this.authority) g.session.emit('chapterEnd', { next: 5 });
      },
    };
  }
  private caughtBy: CharacterId = 'jax';
  private caughtByOther(): CharacterId { return this.caughtBy === 'elias' ? 'jax' : 'elias'; }

  /** Julius sat in the middle of the office (tied once the ropes are on). */
  private seatJulius(tied: boolean): void {
    const g = this.g;
    const n = g.npcs.get('julius');
    if (!n) return;
    this.showJulius(true);
    n.scriptTarget = null;
    n.direct = false;
    if (this.authority) n.setState('idle');
    n.body.pos.set(CHAIR.x, UP, CHAIR.z + 0.08);
    n.body.yaw = Math.PI;
    n.enabled = false;
    n.body.model.play('sit_chair_nervous', { fade: 0.2 });
    if (this.ropes) this.ropes.visible = tied;
  }

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    g.flags.combat = true;
    g.guns.playersArmed = false;
    this.runLeg = -1;
    for (const n of g.npcs.values()) {
      n.reset(); n.direct = false;
      n.enabled = true; n.body.visible = true; n.body.solid = true;
      n.hostile = !!n.def.hostile;
    }
    for (const id of ['sal', 'boone']) { const d = this.npcDefs.find((x) => x.id === id)!; d.passive = true; }
    if (this.ropes) this.ropes.visible = false;
    this.flags.phase = id;
    delete this.flags.inCar;
    delete this.flags.tied;
    delete this.flags.brawlDone;
    delete this.flags.carObj;
    switch (id) {
      case 'site':
        delete this.flags.askedFlag;
        g.audio.playMusic('music_explore', 2);
        break;
      case 'brawl': {
        // Julius already ran off to his car; Sal and Boone block the top of the stairs.
        this.flags.inCar = true;
        this.showJulius(false);
        npcPlace(g, 'sal', v3(STAIR_X + 1.1, RIM_Y, 61.6), Math.PI);
        npcPlace(g, 'boone', v3(STAIR_X - 1.1, RIM_Y, 61.9), Math.PI);
        this.startBrawl();
        break;
      }
      case 'office':
        this.seatJulius(false);
        for (const n of g.npcs.values()) if (n.id === 'sal' || n.id === 'boone') { n.enabled = false; n.body.visible = false; n.body.solid = false; }
        g.audio.playMusic('music_tension', 2);
        break;
    }
  }

  private startBrawl(): void {
    const g = this.g;
    this.flags.phase = 'brawl';
    g.flags.combat = true;
    for (const id of ['sal', 'boone'] as const) {
      const n = g.npcs.get(id);
      if (!n) continue;
      const d = this.npcDefs.find((x) => x.id === id)! as NpcDef;
      d.passive = false;
      n.hostile = true;
      n.body.model.stop('full', 0.2);
      n.awareness.jax = n.awareness.elias = 1;
      n.target = id === 'sal' ? 'jax' : 'elias';
      if (this.authority) n.setState('combat');
    }
    g.audio.playMusic('music_action', 1);
    if (this.authority) this.objective('Get past Sal and Boone', null);
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    void args;
    switch (type) {
      case 'askFlag':
        this.flags.askedFlag = true;
        if (this.authority) this.say('flagman');
        return true;
      case 'grabJulius':
        if (this.authority) this.cutscene('cs4_caught');
        return true;
      case 'startBrawl': {
        this.startBrawl();
        // Julius runs on to his car while you deal with his workers.
        if (this.authority) this.runRoute(this.routeCar(), 3.6, () => g.session.emit('juliusInCar', {}));
        return true;
      }
      case 'juliusInCar':
        this.flags.inCar = true;
        this.showJulius(false);
        g.audio.play('door_slam', { pos: v3(CAR.x, RIM_Y + 1, CAR.z), volume: 0.8 });
        if (this.authority) {
          this.say('julius_car');
          this.brawlCheck();
        }
        return true;
      case 'ko':
        if (this.authority) this.brawlCheck();
        return true;
      case 'tieJulius':
        this.flags.tied = true;
        if (this.ropes) this.ropes.visible = true;
        g.audio.play('chain', { pos: v3(CHAIR.x, UP + 1, CHAIR.z), volume: 0.3, rate: 0.7 });
        if (this.authority) this.cutscene('cs4_chair');
        return true;
      case 'spotted':
        return true;
    }
    return false;
  }

  /** Authority: both workers down and Julius in his car → go and get him. */
  private brawlCheck(): void {
    const s = this.g.npcs.get('sal'), b = this.g.npcs.get('boone');
    if (this.flags.phase !== 'brawl' || !s || !b || s.alive || b.alive || this.flags.brawlDone) return;
    this.g.session.emit('flag', { k: 'brawlDone', v: true });
    this.say('brawl_won');
    this.objective(this.flags.inCar ? 'Drag Julius out of his car' : 'Catch Julius before he gets to his car', [CAR.x - 1.5, RIM_Y + 1.4, CAR.z - 0.4]);
    if (!this.flags.inCar) { /* he's still running: the car prompt appears when he gets in */ }
  }

  validate(type: string): boolean {
    if (type === 'askFlag') return !this.flags.askedFlag;
    if (type === 'grabJulius') return this.flags.phase === 'chase' || this.flags.phase === 'brawl';
    if (type === 'tieJulius') return this.flags.phase === 'office' && !this.flags.tied;
    return true;
  }

  update(_dt: number): void {
    const g = this.g;
    g.local.body.concealed = false;
    const n = g.npcs.get('julius');
    const grab = g.interact.items.get('grab_julius');
    if (n && grab) grab.pos.copy(n.body.pos);
    // Shown when the car prompt becomes available after the fight.
    if (this.flags.phase === 'brawl' && this.flags.inCar && this.flags.brawlDone && !this.flags.carObj && this.authority) {
      this.flags.carObj = true;
      this.objective('Drag Julius out of his car', [CAR.x - 1.5, RIM_Y + 1.4, CAR.z - 0.4]);
    }
    g.chapterHint = null;
  }

  serialize(): Record<string, unknown> {
    return { ...super.serialize(), runLeg: this.runLeg };
  }

  lightAt(p: THREE.Vector3): number { void p; return 1; }

  suspicion(): number { return 1; }

  dispose(): void {
    this.ropes?.removeFromParent();
  }
}
