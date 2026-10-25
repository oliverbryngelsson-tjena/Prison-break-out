// Chapter 4 — The Revenge. Mia's scrapyard, then Crane's quarry at night: down the haul road, across the pit,
// up to the compound, lights out, the office, the truth — and sirens that come far too soon.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, run, clipChar, lookChar, shot, closeUp, twoShot, ots, poseChar, npcPlace, npcWalk, walkChar } from './cs';
import { Terrain, fbm, distToPath, smooth } from './terrain';
import { Foliage, scatter, type FoliageItem } from './foliage';
import { Flashlight, Searchlight, coneLight } from './lights';
import { Car } from './vehicles';
import { cylinderBetween } from '../engine/geometry';
import type { Line } from '../game/dialogue';

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
const YARD = { x: -112, z: -108 }; // Mia's scrapyard
const OFFICE = { x: 4, z: 82 };
const STAIR_X = -10;
const BELT_A = v3(30, FLOOR_Y + 1.5, 18); // conveyor bottom (pit floor)
const BELT_B = v3(40, RIM_Y + 6, 66); // conveyor top (rim, near the office)

export class Chapter4 extends Chapter {
  readonly num = 4;
  readonly title = 'The Revenge';
  readonly subtitle = 'Crane Aggregates, Harlow';
  music = 'music_stealth';
  outfit: 'prison' | 'civil' = 'civil';
  terrain!: Terrain;
  kit!: Kit;
  private foliage: Foliage | null = null;
  private flash = new Map<string, Flashlight>();
  private floods: Searchlight[] = [];
  private haulLen = 1;
  private sirenT = 0;
  private policeCars: Car[] = [];
  private craneCar!: Car;

  readonly checkpoints: Record<string, CheckpointDef> = {
    yard: { spawn: { elias: { pos: [YARD.x - 6, 0, YARD.z - 6], yaw: 0.7 }, jax: { pos: [YARD.x - 4, 0, YARD.z - 7.5], yaw: 0.7 } }, objective: 'Find Mia', intro: 'cs4_yard', outfit: 'civil' },
    rim: { spawn: { elias: { pos: [-52, 0, -48], yaw: 0.6 }, jax: { pos: [-50, 0, -50], yaw: 0.6 } }, objective: 'Get down into the quarry by the haul road', intro: 'cs4_rim', outfit: 'civil' },
    pit: { spawn: { elias: { pos: [30, 0, -8], yaw: -1.2 }, jax: { pos: [31, 0, -6], yaw: -1.2 } }, objective: 'Cross the pit to the stairs on the north wall', outfit: 'civil' },
    compound: { spawn: { elias: { pos: [STAIR_X - 1, 0, 61], yaw: 0 }, jax: { pos: [STAIR_X + 1, 0, 61], yaw: 0 } }, objective: 'Cut the floodlights — pull both breakers at the same time', outfit: 'civil' },
    office: { spawn: { elias: { pos: [OFFICE.x - 2, 0, OFFICE.z - 9], yaw: 0 }, jax: { pos: [OFFICE.x, 0, OFFICE.z - 9.5], yaw: 0 } }, objective: 'Get into Crane\'s office', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: false, sprint: true, combat: true, crouch: true };
    const d = this.npcDefs;
    d.push({ id: 'mia', char: 'mia', role: 'story', name: 'Mia', pos: [YARD.x + 3, 0, YARD.z + 4], yaw: Math.PI + 0.4, idleClip: 'idle', passive: true });
    const thug = (id: string, char: string, name: string, pos: [number, number], patrol?: Array<[number, number, number?, number?]>, extra: Partial<import('../game/npc').NpcDef> = {}) =>
      d.push({ id, char, role: 'thug', name, pos: [pos[0], 0, pos[1]], yaw: 0, hostile: true, hp: 60, damage: 9, vision: { range: 13, fov: 95 }, walk: 1.0, run: 3.6, loco: 'normal', patrol, ...extra });
    thug('t_pit1', 'thug1', 'Crane\'s man', [0, -4], [[0, -4, 3, 0], [-14, 6, 2], [-6, 20, 3, Math.PI / 2], [10, 10, 2]]);
    thug('t_pit2', 'thug3', 'Crane\'s man', [16, 24], [[16, 24, 4, Math.PI], [26, 8, 2], [8, -10, 3, Math.PI], [4, 14, 1]]);
    thug('t_ramp', 'thug2', 'Crane\'s man', [44, -24], [[44, -24, 4, Math.PI * 0.8], [36, -36, 2], [50, -10, 2]]);
    thug('t_gate', 'thug1', 'Crane\'s man', [-20, 70], [[-20, 70, 5, Math.PI], [-30, 86, 2], [-10, 92, 3, 0], [-6, 72, 2]]);
    thug('t_door', 'thug3', 'Crane\'s man', [OFFICE.x - 1.5, OFFICE.z - 5.6], undefined, { idleClip: 'idle_look', yaw: Math.PI });
    thug('t_yard', 'thug2', 'Crane\'s man', [20, 92], [[20, 92, 3, 0], [28, 74, 2], [14, 70, 3, Math.PI], [12, 96, 2]]);
    d.push({ id: 'kessler', char: 'bodyguard', role: 'thug', name: 'Kessler', pos: [OFFICE.x + 2.6, 0, OFFICE.z + 1.5], yaw: -Math.PI / 2, hostile: false, passive: true, hp: 120, damage: 14, noTakedown: true, run: 3.8, loco: 'normal', idleClip: 'idle_angry' });
    d.push({ id: 'office_a', char: 'thug1', role: 'thug', name: 'Crane\'s man', pos: [OFFICE.x - 3, 0, OFFICE.z + 2.5], yaw: Math.PI / 2, hostile: false, passive: true, hp: 60, damage: 10, idleClip: 'idle_look' });
    d.push({ id: 'crane', char: 'crane', role: 'story', name: 'Victor Crane', pos: [OFFICE.x, 0, OFFICE.z + 2.6], yaw: Math.PI, idleClip: 'sit_chair', passive: true, run: 4.2, loco: 'normal' });
    this.defineDialogue();
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.mia = [
      { who: 'mia', text: 'Eli. Oh my God, Eli.', anim: 'talk_sad' },
      { who: 'elias', text: 'Hi, Mimi.' },
      { who: 'mia', text: 'The police were here at six this morning. Twice. You\'re on every channel.', anim: 'talk_nervous' },
      { who: 'elias', text: 'This is Jax. He got me out. Or I got him out. It\'s been a long two days.' },
      { who: 'jax', text: 'Ma\'am.' },
      { who: 'mia', text: 'Crane plays cards every Thursday at the quarry office. Him, Kessler, a few of his boys. He thinks he owns the night up there.', anim: 'talk' },
      { who: 'mia', text: 'Dad\'s old dirt bikes are at the trailhead behind the north fence. Tanks are full. If this goes wrong — and it will — you ride.', anim: 'talk_nervous' },
      { who: 'elias', text: 'I just want him to say it, Mia. Once. On the record.' },
      { who: 'mia', text: 'Then take this.', anim: 'accept' },
      { who: 'narrator', text: 'Mia hands Elias her phone, recorder open.', dur: 3 },
    ];
    D.rim = [
      { who: 'jax', text: 'That\'s a lot of hole.' },
      { who: 'elias', text: 'Haul road goes all the way down. Then the maintenance stairs up the north face, right under his window.' },
    ];
    D.pit = [{ who: 'jax', text: 'Flashlights on the floor. Two of them. Maybe more.' }, { who: 'elias', text: 'Get behind them if you can. Quietly.' }];
    D.takedown_tip = [{ who: 'narrator', text: 'Sneak up behind an unaware guard and press Hit for a silent takedown.', dur: 4 }];
    D.stairs = [{ who: 'elias', text: 'Up the stairs. The compound is right at the top.' }];
    D.breakers = [
      { who: 'jax', text: 'Generator\'s feeding the floodlights. Two breakers.' },
      { who: 'elias', text: 'Together, or the backup kicks in. On three.' },
    ];
    D.dark = [{ who: 'jax', text: 'Lights out. Somebody\'s going to come check on that.' }];
    D.office_near = [{ who: 'elias', text: 'He\'s upstairs. I can see him through the window.' }];
    D.upstairs = [{ who: 'jax', text: 'Ready?' }, { who: 'elias', text: 'For six years.' }];
    D.fight = [{ who: 'narrator', text: 'Take down Kessler and his men.', dur: 3 }];
    D.chase = [{ who: 'jax', text: 'He\'s running for the conveyor!' }];
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/quarry.hdr', envIntensity: 0.12, background: 0x080b10,
      fog: { color: 0x0c1016, density: 0.012 },
      hemi: { sky: 0x2a3650, ground: 0x0e0c0a, intensity: 0.3 },
      sun: { color: 0x8ea6d8, intensity: 0.5, dir: [0.4, 0.8, -0.3], shadows: true },
      grade: { saturation: 0.82, contrast: 1.1, lift: [0.0, 0.005, 0.014], gain: [1.0, 1.0, 1.04], shadowTint: [0.9, 0.96, 1.12], highlightTint: [1.08, 1.0, 0.9], exposure: 1.12, bloom: 1.0, vignette: 0.6 },
      reverb: 0.35,
    });
    this.kit = new Kit(w);
    await this.buildTerrain();
    for (const cp of Object.values(this.checkpoints)) for (const sp of Object.values(cp.spawn)) if (sp.pos[1] === 0) sp.pos[1] = this.y(sp.pos[0], sp.pos[2]) + 0.05;
    for (const d of this.npcDefs) if (d.pos[1] === 0) d.pos[1] = this.y(d.pos[0], d.pos[2]) + 0.05;
    await this.buildYard();
    await this.buildPit();
    await this.buildCompound();
    await this.buildOffice();
    this.kit.initLightPool(Math.max(2, g.deps.renderer.q.maxLights - 1));
    this.kit.finish();
    w.ambientLoop('amb_wind', 0.25);
    w.ambientLoop('amb_factory', 0.2, v3(30, 0, 50));
    w.tickers.add((dt, t) => {
      this.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      const ground = (x: number, z: number) => this.groundAt(x, z);
      for (const f of this.flash.values()) f.update(ground);
      for (const s of this.floods) s.update(dt, g.session.sharedNow() / 1000, ground);
      this.foliage?.update(dt, g.cam.camera.position);
      for (const c of this.policeCars) c.update(t);
      this.craneCar.update(t);
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
    g.setNav(this.nav);
  }
  private nav!: import('../game/nav').NavGraph;

  private groundAt(x: number, z: number): number {
    const hit = this.g.world.physics.groundAt(x, z, 40);
    return hit ? hit.y : this.y(x, z);
  }

  /** Terraced pit, rim plateau, haul road and levelled pads. */
  private height(x: number, z: number): number {
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
    // Pads: compound and scrapyard
    const ox = x - 0, oz = z - 82;
    if (Math.abs(ox) < 52 && oz > -24 && oz < 34) h = THREE.MathUtils.lerp(h, RIM_Y, smooth(6, 0, Math.max(Math.abs(ox) - 46, -24 - oz + 6, oz - 28, 0)));
    const yd = Math.hypot(x - YARD.x, z - YARD.z);
    h = THREE.MathUtils.lerp(h, RIM_Y - 1, smooth(30, 22, yd));
    return h;
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
        { set: 'dry_ground', scale: 0.15, tint: 0x9a9284, surface: 'dirt', roughness: 0.95 },
        { set: 'gravel_sand', scale: 0.25, tint: 0xb0a898, surface: 'gravel', roughness: 0.9 },
        { set: 'rock_face', scale: 0.09, tint: 0xa09a90, surface: 'gravel', roughness: 0.9 },
        { set: 'grass_sparse', scale: 0.16, tint: 0x7f8a6a, surface: 'grass', roughness: 0.95 },
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
    // Forest beyond the rim (south/west), a few trees elsewhere.
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
        if (Math.hypot(x - YARD.x, z - YARD.z) < 28) return 0;
        return 0.55;
      },
      pick: (rr) => (rr < 0.07 ? 4 : rr < 0.15 ? 3 : rr < 0.5 ? 0 : rr < 0.8 ? 1 : 2),
      scale: (item, rr) => (item === 2 ? 0.7 + rr * 0.4 : 1.0 + rr * 0.6),
    });
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, pl);
    this.haulLenCalc();
  }

  // ------------------------------------------------------------------ Mia's scrapyard
  private async buildYard(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const yy = RIM_Y - 1;
    const [container, car, tire, barrels] = await Promise.all([w.model('container'), w.model('rust_car'), w.model('tire'), w.model('oil_barrels')]);
    const conts: Array<[number, number, number, number]> = [[-14, 6, 0.1, 0], [-14, -2, 0.1, 0], [-14, 6, 0.1, 2.8], [12, -10, 1.6, 0], [10, 10, 1.4, 0], [-4, 14, 0.05, 0]];
    for (const [dx, dz, yaw, up] of conts) {
      kit.place(container, [YARD.x + dx, yy + up, YARD.z + dz], yaw);
      if (up === 0) w.physics.addBox({ x: YARD.x + dx, y: yy + 1.4, z: YARD.z + dz }, { x: 6.1, y: 2.8, z: 3.2 }, yaw, { surface: 'metal' });
    }
    for (const [dx, dz, yaw] of [[2, -8, 0.4], [-6, 8, 1.8], [6, 4, 2.6], [-2, -12, 1.1]] as const) {
      kit.place(car, [YARD.x + dx, yy, YARD.z + dz], yaw);
      w.physics.addBox({ x: YARD.x + dx, y: yy + 0.65, z: YARD.z + dz }, { x: 4.4, y: 1.3, z: 1.8 }, yaw, { surface: 'metal' });
    }
    const tires: Array<{ p: [number, number, number]; yaw?: number }> = [];
    for (let i = 0; i < 14; i++) tires.push({ p: [YARD.x + 8 + (i % 4) * 0.75, yy + Math.floor(i / 4) * 0.26, YARD.z - 3 + (i % 2) * 0.3], yaw: Math.PI / 2 });
    kit.instance(tire, tires);
    kit.place(barrels, [YARD.x + 4, yy, YARD.z + 8], 0.6);
    // Mia's trailer office with a lit window
    const trailer = await L.pbr('corrugated', { scale: 0.6, color: 0xa0a8a4, metalness: 0.4, roughness: 0.6 });
    kit.box(trailer, [YARD.x + 4, yy + 1.4, YARD.z + 8.5], [7, 2.8, 2.8], 0, { surface: 'metal' });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), L.emissive(0xffcf8a, 2.2));
    win.position.set(YARD.x + 3, yy + 1.7, YARD.z + 7.08);
    win.rotation.y = Math.PI;
    w.root.add(win);
    kit.bulb(L.emissive(0xffd29a, 3), L.plain(0x333333, 0.6, 0.5), YARD.x + 0.4, yy + 2.6, YARD.z + 7.0, 0xffc890, 2.5, 10, 'yard');
  }

  // ------------------------------------------------------------------ pit: machinery, stairs, conveyor
  private async buildPit(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [excav, dozer, truck, steel, rust] = await Promise.all([
      w.model('excavator'), w.model('dozer'), w.model('dump_truck'),
      L.pbr('steel', { scale: 1, color: 0x6a6e72, metalness: 0.6, roughness: 0.55 }),
      L.pbr('metal_plate', { scale: 0.6, color: 0x8a5a3a, metalness: 0.3, roughness: 0.8 }),
    ]);
    const fy = (x: number, z: number) => this.y(x, z);
    kit.place(excav, [-16, fy(-16, 2), 2], 0.8);
    w.physics.addBox({ x: -16, y: fy(-16, 2) + 2, z: 2 }, { x: 7, y: 4, z: 2.6 }, 0.8, { surface: 'metal' });
    kit.place(dozer, [38, fy(38, -24), -24], 2.2);
    w.physics.addBox({ x: 38, y: fy(38, -24) + 1.6, z: -24 }, { x: 5.2, y: 3.2, z: 3.8 }, 2.2, { surface: 'metal' });
    for (const [x, z, yaw] of [[8, 4, 0.3], [18, 14, 2.4], [-6, 18, 1.5]] as const) {
      kit.place(truck, [x, fy(x, z), z], yaw);
      w.physics.addBox({ x, y: fy(x, z) + 1.6, z }, { x: 2.9, y: 3.2, z: 8.2 }, yaw, { surface: 'metal' });
    }
    // Gravel piles
    const gravel = await L.pbr('gravel', { scale: 0.5, color: 0xb0a898 });
    for (const [x, z, r, hgt] of [[-4, -16, 6, 3.5], [24, -4, 4.5, 2.6], [-22, 18, 5, 3]] as const) {
      const cone = new THREE.ConeGeometry(r, hgt, 20, 1);
      cone.translate(x, fy(x, z) + hgt / 2 - 0.1, z);
      kit.batch.add(cone, gravel);
      w.physics.addRamp({ x, y: fy(x, z) + hgt / 4, z }, { x: r * 1.2, y: hgt / 2, z: r * 1.2 }, 0, 'x', fy(x, z), fy(x, z) + hgt / 2, { surface: 'gravel', solid: true });
    }
    // Floodlight towers in the pit (portable light plants)
    for (const [x, z] of [[-2, 6], [22, 22], [36, -14]] as const) {
      const y0 = fy(x, z);
      kit.batch.add(cylinderBetween(v3(x, y0, z), v3(x, y0 + 7, z), 0.1, 8), steel);
      kit.box(steel, [x, y0 + 0.6, z], [1.2, 1.2, 2.2], 0, {});
      kit.box(L.emissive(0xfff2d8, 5), [x, y0 + 7.1, z], [1.4, 0.4, 0.2], 0, false);
      kit.fixtures.push({ pos: v3(x, y0 + 6.8, z), color: new THREE.Color(0xfff0d8), intensity: 22, range: 20, on: true, zone: 'pit' });
    }
    // Maintenance stairs up the north face (switchbacks with landings)
    const sx = STAIR_X;
    let yv = this.y(sx, 30);
    let z = 30;
    const flights = 4;
    const riseEach = (RIM_Y - yv) / flights;
    for (let i = 0; i < flights; i++) {
      const xOff = i % 2 === 0 ? 0 : 1.6;
      kit.stairs(steel, sx + xOff, z, 0, 1.4, yv, yv + riseEach, 5.2);
      z += 5.2;
      yv += riseEach;
      kit.slab(steel, sx - 0.7, z, sx + 2.3, z + 1.6, yv, 0.12, 'metal');
      kit.railing(steel, sx - 0.7, z + 1.6, sx + 2.3, z + 1.6, yv);
      z += 1.6;
    }
    this.stairTop = v3(sx + 0.8, yv, z);
    // Nav for the pit + compound
    const NavGraph = (await import('../game/nav')).NavGraph;
    this.nav = new NavGraph(w.physics);
    for (const [x, zz] of [[0, -4], [-14, 6], [-6, 20], [10, 10], [16, 24], [26, 8], [8, -10], [4, 14], [44, -24], [36, -36], [50, -10], [-20, 70], [-30, 86], [-10, 92], [-6, 72], [20, 92], [28, 74], [14, 70], [12, 96], [0, 76], [-10, 66], [4, 70]] as const) this.nav.add(x, this.y(x, zz), zz);
    this.nav.autoLink(16, 3);
    // Conveyor gantry from the pit floor up to the rim
    const a = BELT_A, b = BELT_B;
    const dir = b.clone().sub(a);
    const len = dir.length();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(dir.y / len);
    const n = Math.ceil(len / 3);
    for (let i = 0; i <= n; i++) {
      const p = a.clone().addScaledVector(dir, i / n);
      const groundY = this.y(p.x, p.z);
      if (p.y - groundY > 1) for (const s of [-1, 1]) kit.batch.add(cylinderBetween(v3(p.x + Math.cos(yaw) * 0.9 * s, groundY, p.z - Math.sin(yaw) * 0.9 * s), v3(p.x + Math.cos(yaw) * 0.9 * s, p.y - 0.4, p.z - Math.sin(yaw) * 0.9 * s), 0.08, 6), rust);
    }
    // Belt deck (walkable ramp) with side rails
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const deck = new THREE.BoxGeometry(1.6, 0.2, len);
    deck.applyMatrix4(new THREE.Matrix4().makeRotationX(-pitch));
    deck.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    deck.translate(mid.x, mid.y, mid.z);
    kit.batch.add(deck, L.plain(0x1e1e1e, 0.85));
    w.physics.addRamp({ x: mid.x, y: mid.y, z: mid.z }, { x: 1.6, y: Math.abs(b.y - a.y) + 0.2, z: Math.hypot(dir.x, dir.z) }, yaw, 'z', a.y + 0.1, b.y + 0.1, { surface: 'metal', solid: false });
    for (const s of [-1, 1]) kit.batch.add(cylinderBetween(v3(a.x + Math.cos(yaw) * 0.85 * s, a.y + 1.0, a.z - Math.sin(yaw) * 0.85 * s), v3(b.x + Math.cos(yaw) * 0.85 * s, b.y + 1.0, b.z - Math.sin(yaw) * 0.85 * s), 0.035, 6), steel);
  }
  private stairTop = new THREE.Vector3();

  // ------------------------------------------------------------------ compound: fence, containers, generator
  private async buildCompound(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [steel, chain, conc] = await Promise.all([
      L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
      Promise.resolve(new THREE.MeshStandardMaterial({ map: (await import('../engine/materials')).canvasTexture('chainLink', (await import('../engine/materials')).DRAW.chainLink, 256), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45, color: 0xb5b8ba })),
      L.pbr('concrete_grey', { scale: 0.4 }),
    ]);
    const Y = RIM_Y;
    // Fence along the pit edge with a gap at the stairs
    kit.fence(steel, chain, -46, 60, STAIR_X - 2, 60, Y, 2.6);
    kit.fence(steel, chain, STAIR_X + 4, 60, 46, 60, Y, 2.6);
    kit.fence(steel, chain, 46, 60, 46, 106, Y, 2.6);
    kit.fence(steel, chain, -46, 106, -46, 60, Y, 2.6);
    // Containers
    const container = await w.model('container');
    for (const [x, z, yaw, up] of [[-28, 70, 0, 0], [-28, 74, 0, 0], [-28, 70, 0, 2.8], [-18, 82, Math.PI / 2, 0], [-36, 90, 0.2, 0], [26, 88, Math.PI / 2, 0]] as const) {
      kit.place(container, [x, Y + up, z], yaw);
      if (up === 0) w.physics.addBox({ x, y: Y + 1.4, z }, { x: 6.1, y: 2.8, z: 3.2 }, yaw, { surface: 'metal' });
    }
    // Generator + two breaker boxes
    kit.box(L.plain(0x3c4a40, 0.6, 0.3), [24, Y + 1.0, 66], [2.4, 2.0, 1.4], 0, { surface: 'metal' });
    kit.box(L.plain(0x8a8a80, 0.5, 0.4), [20.6, Y + 1.3, 66], [0.5, 0.7, 0.25], 0, false);
    kit.box(L.plain(0x8a8a80, 0.5, 0.4), [27.4, Y + 1.3, 66], [0.5, 0.7, 0.25], 0, false);
    w.ambientLoop('amb_fan', 0.4, v3(24, Y + 1, 66));
    // Compound floodlights (killed by the breakers)
    for (const [x, z] of [[-30, 64], [30, 64], [-30, 100], [30, 100], [0, 64]] as const) {
      kit.batch.add(cylinderBetween(v3(x, Y, z), v3(x, Y + 9, z), 0.12, 8), steel);
      kit.box(L.emissive(0xfff0d0, 5), [x, Y + 9.1, z], [1.2, 0.3, 0.3], 0, false);
      kit.fixtures.push({ pos: v3(x, Y + 8.8, z), color: new THREE.Color(0xfff0d0), intensity: 30, range: 26, on: true, zone: 'compound' });
    }
    // Two sweeping floodlights on the office roof (stealth hazard until the power is cut)
    this.floods.push(new Searchlight(w, v3(OFFICE.x - 3, Y + 7.6, OFFICE.z - 3), [v3(-30, Y, 62), v3(0, Y, 64), v3(30, Y, 62), v3(0, Y, 70)], 18, 0.12));
    // Crane's car
    this.craneCar = await Car.create(w, { tint: 0x101418, headlights: false });
    this.craneCar.setPose(v3(OFFICE.x + 10, Y, OFFICE.z + 2), Math.PI, w.physics);
    // Police cars (hidden until the end)
    for (let i = 0; i < 3; i++) {
      const c = await Car.create(w, { police: true, collider: false });
      c.root.visible = false;
      this.policeCars.push(c);
    }
    void conc;
  }

  // ------------------------------------------------------------------ office: two storeys, exterior stairs
  private async buildOffice(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [wall, floor, steel, carpet] = await Promise.all([
      L.pbr('corrugated', { scale: 0.6, color: 0xc4c0b2, metalness: 0.3, roughness: 0.6 }),
      L.pbr('planks', { scale: 0.7, color: 0x8a6a4a }),
      L.pbr('steel', { scale: 1, color: 0x55595d, metalness: 0.6, roughness: 0.5 }),
      L.pbr('concrete_floor', { scale: 0.4, color: 0x5a4a44 }),
    ]);
    const { x, z } = OFFICE;
    const Y = RIM_Y, UP = Y + 3.2;
    // Ground floor (storage)
    kit.floor(carpet, x - 6, z - 4, x + 6, z + 4, Y + 0.05, 0.2);
    kit.wall(wall, x - 6, z - 4, x + 6, z - 4, Y, 3.2, 0.15, [{ at: 4.5, width: 1.1, bottom: 0, top: 2.2 }]);
    kit.wall(wall, x + 6, z + 4, x - 6, z + 4, Y, 3.2, 0.15);
    kit.wall(wall, x - 6, z + 4, x - 6, z - 4, Y, 3.2, 0.15);
    kit.wall(wall, x + 6, z - 4, x + 6, z + 4, Y, 3.2, 0.15);
    // Upper floor slab + walls with windows and a door on the south side (stairs land there)
    kit.slab(floor, x - 6.1, z - 4.1, x + 6.1, z + 4.1, UP, 0.2, 'wood');
    kit.wall(wall, x - 6, z - 4, x + 6, z - 4, UP, 3.0, 0.15, [{ at: 9.5, width: 1.0, bottom: 0, top: 2.2 }, { at: 3, width: 2.4, bottom: 1.0, top: 2.2 }, { at: 6.2, width: 1.6, bottom: 1.0, top: 2.2 }]);
    kit.wall(wall, x + 6, z + 4, x - 6, z + 4, UP, 3.0, 0.15, [{ at: 6, width: 3, bottom: 1.0, top: 2.2 }]);
    kit.wall(wall, x - 6, z + 4, x - 6, z - 4, UP, 3.0, 0.15);
    kit.wall(wall, x + 6, z - 4, x + 6, z + 4, UP, 3.0, 0.15, [{ at: 4, width: 1.0, bottom: 0, top: 2.2 }]);
    kit.ceiling(wall, x - 6.1, z - 4.1, x + 6.1, z + 4.1, UP + 3.0, 0.2);
    // Exterior stairs to the upper door (south face, east end)
    kit.stairs(steel, x + 2.6, z - 9.6, 0, 1.2, Y, UP, 4.8);
    kit.slab(steel, x + 1.9, z - 4.8, x + 4.2, z - 4.05, UP, 0.12, 'metal');
    kit.railing(steel, x + 1.9, z - 4.8, x + 4.2, z - 4.8, UP);
    // Rear stairs from the east door down to the conveyor top
    kit.slab(steel, x + 6.05, z - 0.8, x + 8, z + 0.8, UP, 0.12, 'metal');
    // Interior: desk, chairs, sofa, cabinets, lamps
    const desk = L.plain(0x3a2a1e, 0.6);
    kit.box(desk, [x, UP + 0.4, z + 1.7], [2.4, 0.8, 1.0], 0, { surface: 'wood' });
    const chair = await w.model('office_chair');
    kit.place(chair, [x, UP, z + 2.6], Math.PI);
    const sofa = await w.model('sofa_old');
    kit.place(sofa, [x - 4.4, UP, z - 1], Math.PI / 2);
    w.physics.addBox({ x: x - 4.4, y: UP + 0.45, z: z - 1 }, { x: 1.0, y: 0.9, z: 2.0 }, 0, {});
    for (const dx of [3.6, 4.4, 5.2]) kit.box(L.plain(0x5c6064, 0.5, 0.4), [x + dx, UP + 0.7, z + 3.6], [0.7, 1.4, 0.6], 0, {});
    // Card table with chips
    kit.box(L.plain(0x1e4a2a, 0.9), [x - 2.4, UP + 0.75, z + 1.8], [1.4, 0.06, 1.4], 0, false);
    kit.box(desk, [x - 2.4, UP + 0.37, z + 1.8], [0.2, 0.74, 0.2], 0, { surface: 'wood' });
    kit.bulb(L.emissive(0xffd29a, 3), steel, x - 2.4, UP + 2.6, z + 1.8, 0xffc98a, 3.2, 9, 'office');
    kit.bulb(L.emissive(0xffd29a, 3), steel, x + 2.5, UP + 2.6, z - 1, 0xffc98a, 2.6, 9, 'office');
    kit.bulb(L.emissive(0xffd29a, 3), steel, x + 2.6, Y + 2.6, z - 4.3, 0xffc98a, 2.0, 8, 'office');
    // Lit windows seen from outside
    const winM = L.emissive(0xffc98a, 1.6);
    for (const [wx, wz, ry] of [[x - 3, z - 4.09, Math.PI], [x + 0.2, z - 4.09, Math.PI], [x, z + 4.09, 0]] as const) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), winM); m.position.set(wx, UP + 1.6, wz); m.rotation.y = ry; w.root.add(m); }
  }

  // ================================================================== interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    I.add({ id: 'talk_mia', pos: v3(YARD.x + 3, this.y(YARD.x + 3, YARD.z + 4), YARD.z + 4), radius: 2.2, label: 'Talk to Mia', icon: 'talk',
      enabled: () => this.flags.phase === 'yard' && !this.flags.metMia, onUse: () => g.session.request('meetMia', {}) });
    I.add({ id: 'breaker_a', coop: 'breakers', role: 'a', pos: v3(20.6, RIM_Y, 65.4), radius: 1.2, label: 'Pull the breaker', icon: 'coop', mode: 'hold', holdTime: 1.0, pose: 'use', poseCtx: { k: { height: 1.3 } }, facing: 0,
      enabled: () => this.flags.phase === 'compound' && !this.flags.lightsOut });
    I.add({ id: 'breaker_b', coop: 'breakers', role: 'b', pos: v3(27.4, RIM_Y, 65.4), radius: 1.2, label: 'Pull the breaker', icon: 'coop', mode: 'hold', holdTime: 1.0, pose: 'use', poseCtx: { k: { height: 1.3 } }, facing: 0,
      enabled: () => this.flags.phase === 'compound' && !this.flags.lightsOut });
  }

  // ================================================================== triggers
  private buildTriggers(): void {
    const H = (x: number, z: number) => this.y(x, z);
    this.addTrigger({ id: 'haul_mid', min: [-10, -40, -60], max: [70, 40, -20], who: 'any', enabled: () => this.flags.phase === 'rim' });
    this.addTrigger({ id: 'floor', min: [-30, FLOOR_Y - 2, -30], max: [40, FLOOR_Y + 3, 30], who: 'both', enabled: () => this.flags.phase === 'rim' });
    this.addTrigger({ id: 'stairs', min: [STAIR_X - 3, FLOOR_Y - 2, 26], max: [STAIR_X + 4, FLOOR_Y + 8, 34], who: 'any', enabled: () => this.flags.phase === 'pit' });
    this.addTrigger({ id: 'top', min: [STAIR_X - 6, RIM_Y - 1, 58], max: [STAIR_X + 8, RIM_Y + 4, 66], who: 'both', enabled: () => this.flags.phase === 'pit' });
    this.addTrigger({ id: 'office_near', min: [OFFICE.x - 8, RIM_Y - 1, OFFICE.z - 14], max: [OFFICE.x + 8, RIM_Y + 3, OFFICE.z - 4.2], who: 'any', enabled: () => this.flags.phase === 'office' });
    this.addTrigger({ id: 'upstairs', min: [OFFICE.x + 1.6, RIM_Y + 2.8, OFFICE.z - 5.2], max: [OFFICE.x + 4.6, RIM_Y + 4.5, OFFICE.z - 3.6], who: 'both', enabled: () => this.flags.phase === 'office' });
    this.addTrigger({ id: 'gantry', min: [-200, -50, -200], max: [200, 60, 200], who: 'any', enabled: () => this.flags.phase === 'chase' && this.onBelt() });
    void H;
  }

  private onBelt(): boolean {
    const bs = this.g.bodies();
    const a = BELT_A, b = BELT_B;
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      const p = bs[c].pos;
      const ab = b.clone().sub(a);
      const t = p.clone().sub(a).dot(ab) / ab.lengthSq();
      if (t > 0.05 && t < 0.75) {
        const q = a.clone().addScaledVector(ab, t);
        if (Math.hypot(q.x - p.x, q.z - p.z) < 1.4 && Math.abs(q.y - p.y) < 2) return true;
      }
    }
    return false;
  }

  onTrigger(id: string): void {
    if (!this.authority) return;
    const g = this.g;
    switch (id) {
      case 'haul_mid': this.say('pit'); setTimeout(() => this.say('takedown_tip'), 5000); break;
      case 'floor':
        this.saveCheckpoint('pit');
        g.session.emit('flag', { k: 'phase', v: 'pit' });
        this.objective('Cross the pit to the stairs on the north wall', [STAIR_X, FLOOR_Y + 1.5, 30]);
        break;
      case 'stairs': this.say('stairs'); break;
      case 'top':
        this.saveCheckpoint('compound');
        g.session.emit('flag', { k: 'phase', v: 'compound' });
        this.say('breakers');
        this.objective('Cut the floodlights — pull both breakers at the same time', [24, RIM_Y + 1.5, 66]);
        break;
      case 'office_near': this.say('office_near'); break;
      case 'upstairs': this.cutscene('cs4_crane'); break;
      case 'gantry': this.cutscene('cs4_fall'); break;
    }
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    const UP = RIM_Y + 3.2;
    C.cs4_yard = {
      id: 'cs4_yard', music: 'music_sad',
      start: () => {},
      beats: [
        { dur: 5, fade: 'in', shot: () => shot(v3(YARD.x - 20, RIM_Y + 6, YARD.z - 20), v3(YARD.x, RIM_Y, YARD.z), 5, { fov: 44, toEnd: v3(YARD.x + 2, RIM_Y, YARD.z + 2) }),
          lines: [{ who: 'narrator', text: 'Harlow. Varga Salvage, after dark.', dur: 3.2 }] },
      ],
      end: () => { if (this.authority) this.objective('Find Mia', [YARD.x + 3, RIM_Y + 1, YARD.z + 4]); },
    };
    C.cs4_mia = {
      id: 'cs4_mia', music: 'music_sad',
      start: () => {
        const p = v3(YARD.x + 3, this.y(YARD.x + 3, YARD.z + 4), YARD.z + 4);
        npcPlace(g, 'mia', p, Math.PI + 0.4);
        placeChar(g, 'elias', v3(p.x - 0.6, p.y, p.z - 1.6), 0.2);
        placeChar(g, 'jax', v3(p.x - 2.2, p.y, p.z - 2.0), 0.5);
        lookChar(g, 'elias', p.clone().add(v3(0, 1.6, 0)));
      },
      beats: [
        { shot: () => twoShot(g, 'elias', 'mia', 50, 2.3, 1.5, 1), lines: this.dialogues.mia },
        { dur: 3, fade: 'out', shot: () => shot(v3(YARD.x - 4, RIM_Y + 2, YARD.z - 6), v3(YARD.x + 3, RIM_Y + 1.3, YARD.z + 4), 3, { fov: 40 }) },
      ],
      end: () => {
        lookChar(g, 'elias', null);
        if (this.authority) { this.saveCheckpoint('rim'); g.session.emit('restart', { checkpoint: 'rim' }); }
      },
    };
    C.cs4_rim = {
      id: 'cs4_rim', music: 'music_stealth',
      start: () => {},
      beats: [
        { dur: 6, fade: 'in', shot: () => shot(v3(-60, RIM_Y + 8, -58), v3(10, FLOOR_Y + 4, 20), 6, { fov: 44, toEnd: v3(4, RIM_Y, 70) }),
          lines: [{ who: 'narrator', text: 'Crane Aggregates. Thursday night.', dur: 3 }] },
        { shot: () => twoShot(g, 'elias', 'jax', 7, 2.5, 1.4, 1), lines: this.dialogues.rim },
      ],
      end: () => { if (this.authority) this.objective('Get down into the quarry by the haul road', [HAUL[20][0], this.y(HAUL[20][0], HAUL[20][1]) + 1.5, HAUL[20][1]]); },
    };
    C.cs4_crane = {
      id: 'cs4_crane', music: 'music_tension', skippable: true,
      start: () => {
        const { x, z } = OFFICE;
        placeChar(g, 'elias', v3(x + 1.0, UP, z - 2.2), Math.PI * 0.95);
        placeChar(g, 'jax', v3(x + 2.6, UP, z - 2.8), -Math.PI * 0.9);
        npcPlace(g, 'crane', v3(x, UP, z + 2.6), Math.PI);
        npcPlace(g, 'kessler', v3(x + 3.6, UP, z + 1.2), -Math.PI / 2 - 0.4);
        npcPlace(g, 'office_a', v3(x - 3.2, UP, z + 1.0), Math.PI / 2 + 0.3);
        clipChar(g, 'elias', null);
      },
      beats: [
        { dur: 3, shot: () => shot(v3(OFFICE.x + 3.4, UP + 1.7, OFFICE.z - 3.4), v3(OFFICE.x, UP + 1.2, OFFICE.z + 2.4), 3, { fov: 40 }),
          run: () => { g.audio.play('door_open', { pos: v3(OFFICE.x + 3.5, UP + 1, OFFICE.z - 4), volume: 0.8 }); } },
        { shot: () => ots(g, 'elias', 'crane', 22, 1), lines: [
          { who: 'crane', text: 'Elias Varga. You look terrible. Prison food?', anim: 'talk_assured' },
          { who: 'elias', text: 'Tom Harlan. Say it.' },
          { who: 'crane', text: 'Say what? That Tom was a good accountant who couldn\'t count? He was going to ruin everything, Elias. Years of work.', anim: 'talk' },
          { who: 'elias', text: 'So you killed him.' },
          { who: 'crane', text: 'I had a problem dealt with. And you were standing so conveniently close to it.', anim: 'talk_assured' },
        ] },
        { shot: () => closeUp(g, 'crane', 18, 1.3, -0.3, { fov: 34 }), run: () => { lookChar(g, 'jax', g.npcs.get('crane')!.body.head()); }, lines: [
          { who: 'crane', text: 'And who\'s this? ...Rourke. Danny Rourke\'s little brother. Well. Small world.', anim: 'talk' },
          { who: 'crane', text: 'Tell me, Jax — does your friend here know who\'s holding your leash?', anim: 'talk_assured', pause: 0.6 },
          { who: 'elias', text: '...What is he talking about?' },
        ] },
        { dur: 2.2, shot: () => closeUp(g, 'jax', 2.2, 1.0, 0.3, { fov: 32 }), lines: [{ who: 'jax', text: 'Shut your mouth.', dur: 1.6, anim: 'talk_angry' }] },
        { dur: 2.6, shot: () => twoShot(g, 'jax', 'crane', 2.6, 3.0, 1.4, 1),
          run: () => { walkChar(g, 'jax', [v3(OFFICE.x + 0.6, UP, OFFICE.z + 1.0)], 3.5); g.audio.play('punch_heavy', { pos: v3(OFFICE.x, UP + 1.5, OFFICE.z + 2), volume: 0.9, delay: 0.7 }); g.cam.addShake(0.3); },
          lines: [{ who: 'crane', text: 'Kessler!', dur: 1.2 }] },
      ],
      end: () => { if (this.authority) g.session.emit('officeFight', {}); },
    };
    C.cs4_fall = {
      id: 'cs4_fall', music: 'music_sad', skippable: false,
      start: () => {
        const a = BELT_A, b = BELT_B;
        const p = a.clone().lerp(b, 0.45);
        const dir = b.clone().sub(a).setY(0).normalize();
        const yaw = Math.atan2(-dir.x, -dir.z);
        npcPlace(g, 'crane', p.clone().addScaledVector(b.clone().sub(a).normalize(), -1.2), yaw);
        placeChar(g, 'jax', p.clone(), yaw);
        placeChar(g, 'elias', p.clone().addScaledVector(b.clone().sub(a).normalize(), 3.0), yaw);
      },
      beats: [
        { shot: () => twoShot(g, 'jax', 'crane', 9, 3.0, 1.2, 1), lines: [
          { who: 'crane', text: 'You think you\'re the good guy here? Ask him, Elias. Ask him who he calls at night.', anim: 'talk_angry' },
          { who: 'jax', text: 'Last time. Shut. Up.', anim: 'talk_angry' },
        ] },
        { dur: 2.4, shot: () => shot(BELT_A.clone().lerp(BELT_B, 0.45).add(v3(5, 1, -3)), BELT_A.clone().lerp(BELT_B, 0.42), 2.4, { fov: 40 }),
          run: () => { g.audio.play('punch', { volume: 0.9, delay: 0.3 }); g.audio.play('grunt', { volume: 0.8, delay: 0.9 }); g.cam.addShake(0.25); },
          lines: [{ who: 'crane', text: 'Rourke—!', dur: 1.2 }] },
        { dur: 3.2, shot: () => shot(BELT_A.clone().lerp(BELT_B, 0.45).add(v3(-6, -6, -4)), BELT_A.clone().lerp(BELT_B, 0.4).add(v3(0, -4, 0)), 3.2, { fov: 46 }),
          run: () => {
            const n = g.npcs.get('crane');
            if (n && this.authority) { const p = n.body.pos.clone(); n.walkTo(p.clone().add(v3(1.5, 0, 0)), 3); }
            const n2 = g.npcs.get('crane');
            if (n2) { n2.body.setPose('knockdown', {}, { restart: true }); }
            setTimeout(() => { const c = g.npcs.get('crane'); if (c) { c.body.pos.y = this.y(c.body.pos.x, c.body.pos.z); c.body.setPose('lying', {}, { restart: true }); } g.audio.play('body_fall', { volume: 1 }); g.audio.play('big_crash', { volume: 0.5 }); }, 1600);
          },
          lines: [{ who: 'elias', text: 'JAX!', dur: 1.2 }] },
        { shot: () => closeUp(g, 'jax', 7, 1.0, 0.3, { fov: 34 }), lines: [
          { who: 'jax', text: '...He slipped. I had his arm. He slipped.', anim: 'talk_sad' },
          { who: 'elias', text: 'I had it. On the phone. Everything he said.', pause: 0.4 },
        ] },
        { dur: 4, shot: () => shot(v3(OFFICE.x - 20, RIM_Y + 8, OFFICE.z + 30), v3(OFFICE.x, RIM_Y, OFFICE.z), 4, { fov: 44 }),
          run: () => this.policeArrive(),
          lines: [{ who: 'marsh', text: '(megaphone) This is Detective Marsh, state police! Everybody on the ground! Now!', dur: 3.6, radio: true }] },
        { shot: () => twoShot(g, 'elias', 'jax', 6, 2.4, 1.4, 1), lines: [
          { who: 'elias', text: 'How did they get here so fast?' },
          { who: 'jax', text: 'Doesn\'t matter. Mia\'s bikes — north fence. GO!', anim: 'talk_angry' },
        ] },
      ],
      end: () => {
        if (this.authority) {
          const p: import('../../shared/protocol').Progress = { chapter: 5, checkpoint: '', flags: { recording: true }, savedAt: Date.now(), playTime: 0 };
          void p;
          g.session.emit('chapterEnd', { next: 5 });
        }
      },
    };
  }

  private policeArrive(): void {
    const g = this.g;
    const pts = [v3(-30, RIM_Y, 104), v3(-10, RIM_Y, 108), v3(14, RIM_Y, 104)];
    this.policeCars.forEach((c, i) => {
      c.root.visible = true;
      c.sirenOn = true;
      c.setPose(pts[i], Math.PI + (i - 1) * 0.4);
    });
    this.siren ??= g.audio.siren();
    this.siren?.set(v3(-10, RIM_Y + 1, 104), 0.7);
    for (const f of this.kit.fixtures) if (f.zone === 'compound') f.on = true;
  }
  private siren: ReturnType<import('../engine/audio').AudioManager['siren']> = null;

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    g.flags.combat = id !== 'yard';
    for (const n of g.npcs.values()) { n.reset(); n.enabled = false; n.body.visible = false; n.body.solid = false; n.hostile = !!n.def.hostile; }
    for (const f of this.flash.values()) f.dispose();
    this.flash.clear();
    for (const c of this.policeCars) { c.root.visible = false; c.sirenOn = false; }
    this.siren?.stop(); this.siren = null;
    const on = (ids: string[], torch = false) => {
      for (const i of ids) {
        const n = g.npcs.get(i);
        if (!n) continue;
        n.enabled = true; n.body.visible = true; n.body.solid = true;
        if (torch) this.flash.set(i, new Flashlight(g.world, n.body, 12, 0.3));
      }
    };
    this.flags.phase = id;
    const order = ['yard', 'rim', 'pit', 'compound', 'office'];
    const past = (p: string) => order.indexOf(id) > order.indexOf(p);
    if (!past('compound')) delete this.flags.lightsOut; else this.flags.lightsOut = true;
    this.applyLights();
    switch (id) {
      case 'yard': on(['mia']); delete this.flags.metMia; g.audio.playMusic('music_sad', 2); break;
      case 'rim': on(['t_pit1', 't_pit2', 't_ramp'], true); on(['t_gate', 't_door', 't_yard'], true); g.audio.playMusic('music_stealth', 2); break;
      case 'pit': on(['t_pit1', 't_pit2', 't_ramp'], true); on(['t_gate', 't_door', 't_yard'], true); g.audio.playMusic('music_stealth', 2); break;
      case 'compound': on(['t_gate', 't_door', 't_yard'], true); g.audio.playMusic('music_stealth', 2); break;
      case 'office': on(['t_door']); on(['kessler', 'office_a', 'crane']); g.audio.playMusic('music_tension', 2); break;
    }
    if (id === 'office' || id === 'compound') on(['kessler', 'office_a', 'crane']);
    // Indoor NPCs stand upstairs.
    const UP = RIM_Y + 3.2;
    for (const k of ['kessler', 'office_a', 'crane']) {
      const n = g.npcs.get(k);
      if (n) { n.body.pos.y = UP; (n as unknown as { homePos: THREE.Vector3 }).homePos.y = UP; }
    }
  }

  private applyLights(): void {
    const off = !!this.flags.lightsOut;
    for (const f of this.kit.fixtures) if (f.zone === 'compound') f.on = !off;
    for (const s of this.floods) s.on = !off;
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'meetMia':
        this.flags.metMia = true;
        if (this.authority) this.cutscene('cs4_mia');
        return true;
      case 'coop':
        if (a.group === 'breakers') {
          this.flags.lightsOut = true;
          this.applyLights();
          g.audio.play('switch', { pos: v3(24, RIM_Y + 1.3, 66), volume: 0.8 });
          g.audio.play('metal_slam', { pos: v3(24, RIM_Y + 1.3, 66), volume: 0.5 });
          if (this.authority) {
            this.say('dark');
            this.saveCheckpoint('office');
            g.session.emit('flag', { k: 'phase', v: 'office' });
            this.objective('Get into Crane\'s office — take out the man at the door', [OFFICE.x + 2.6, RIM_Y + 3.5, OFFICE.z - 4.4]);
            // The door guard goes to check the generator.
            const n = g.npcs.get('t_door');
            if (n) n.distract(v3(24, RIM_Y, 64), 12);
          }
          return true;
        }
        return false;
      case 'officeFight': {
        g.flags.combat = true;
        for (const id of ['kessler', 'office_a']) {
          const n = g.npcs.get(id);
          if (!n) continue;
          n.hostile = true;
          const d = this.npcDefs.find((x) => x.id === id)!;
          d.passive = false;
          n.awareness.jax = n.awareness.elias = 1;
          n.target = id === 'kessler' ? 'jax' : 'elias';
          n.setState('combat');
        }
        g.audio.playMusic('music_action', 1);
        if (this.authority) { this.say('fight'); this.objective('Take down Kessler and his man'); }
        return true;
      }
      case 'ko': {
        if (!this.authority) return true;
        const k = g.npcs.get('kessler'), o = g.npcs.get('office_a');
        if (g.flags.combat && this.flags.phase === 'office' && k && o && !k.alive && !o.alive && !this.flags.fightWon) {
          g.session.emit('flag', { k: 'fightWon', v: true });
          g.session.emit('craneRuns', {});
        }
        return true;
      }
      case 'craneRuns': {
        this.flags.phase = 'chase';
        const n = g.npcs.get('crane');
        if (n) {
          n.body.model.stop('full', 0.2);
          if (this.authority) {
            const UP = RIM_Y + 3.2;
            n.walkTo(v3(OFFICE.x + 7.2, UP, OFFICE.z), 4.2, () => n.walkTo(BELT_B.clone(), 4, () => n.walkTo(BELT_A.clone().lerp(BELT_B, 0.42), 3.5)));
          }
        }
        if (this.authority) { this.say('chase'); this.objective('Catch Crane on the conveyor', BELT_B.toArray() as [number, number, number]); }
        g.audio.playMusic('music_chase', 1);
        return true;
      }
      case 'spotted':
        return true;
      case 'restarted':
        return true;
    }
    return false;
  }

  validate(type: string): boolean {
    if (type === 'meetMia') return !this.flags.metMia;
    return true;
  }

  update(_dt: number): void {
    const g = this.g;
    // Crouching behind containers/machinery in the dark hides you better: no concealment zones here, light matters.
    g.local.body.concealed = false;
  }

  lightAt(p: THREE.Vector3): number {
    let l = this.kit.lightLevel(p, 0.12);
    for (const f of this.flash.values()) l += coneLight(f, p) * 0.7;
    for (const s of this.floods) if (s.on && Math.hypot(p.x - s.target.x, p.z - s.target.z) < 6) l += 1;
    return Math.min(1.4, l);
  }

  suspicion(): number { return 1; }

  dispose(): void {
    for (const f of this.flash.values()) f.dispose();
    for (const s of this.floods) s.dispose();
    this.siren?.stop();
  }
}
