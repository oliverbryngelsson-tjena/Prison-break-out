// Chapter 6 — The Betrayal. Dawn at the Harlan Dam: the burner phone, the confession, the police,
// the run down to the turbine hall, and a fight that only one of them walks away from.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { Kit } from './kit';
import { v3, placeChar, run, clipChar, lookChar, shot, closeUp, twoShot, ots, poseChar, npcPlace, walkChar } from './cs';
import { Terrain, fbm, smooth } from './terrain';
import { Water } from './water';
import { Foliage, scatter, type FoliageItem } from './foliage';
import { Car, Path } from './vehicles';
import { cylinderBetween } from '../engine/geometry';
import type { Line } from '../game/dialogue';

const CREST_Y = 22;
const DAM_X0 = -64, DAM_X1 = 64;
const HOUSE = { x: -24, z: 0 };
const TOWER = { x: -58, z: 0 };
const HALL = { x: -40, z: -60, y: -10 }; // turbine hall interior (reached by the tower stairs)
const RES_Y = 19.2;

export class Chapter6 extends Chapter {
  readonly num = 6;
  readonly title = 'The Betrayal';
  readonly subtitle = 'Harlan Dam, first light';
  music = 'music_sad';
  outfit: 'prison' | 'civil' = 'civil';
  terrain!: Terrain;
  kit!: Kit;
  private foliage: Foliage | null = null;
  private cars: Car[] = [];
  private carPath!: Path;
  private carT = -1;
  private siren: ReturnType<import('../engine/audio').AudioManager['siren']> = null;
  private phone!: THREE.Mesh;
  private winner: CharacterId | null = null;

  readonly checkpoints: Record<string, CheckpointDef> = {
    dawn: { spawn: { elias: { pos: [HOUSE.x - 1.2, CREST_Y, HOUSE.z + 0.5], yaw: Math.PI / 2 }, jax: { pos: [HOUSE.x + 8, CREST_Y, HOUSE.z - 1.5], yaw: Math.PI / 2 } }, objective: '', intro: 'cs6_dawn', outfit: 'civil' },
    run: { spawn: { elias: { pos: [HOUSE.x - 6.5, CREST_Y, 0.5], yaw: -Math.PI / 2 }, jax: { pos: [HOUSE.x - 5, CREST_Y, -2.2], yaw: -Math.PI / 2 } }, objective: 'Run for the west tower!', outfit: 'civil' },
    hall: { spawn: { elias: { pos: [HALL.x - 4, HALL.y, HALL.z], yaw: Math.PI / 2 }, jax: { pos: [HALL.x + 4, HALL.y, HALL.z], yaw: -Math.PI / 2 } }, objective: '', intro: 'cs6_hall', outfit: 'civil' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: true, sprint: true, combat: false, crouch: false };
    const d = this.npcDefs;
    d.push({ id: 'marsh', char: 'marsh', role: 'police', name: 'Det. Lena Marsh', pos: [70, CREST_Y, 0], yaw: -Math.PI / 2, passive: true, idleClip: 'idle' });
    d.push({ id: 'cop_a', char: 'cop1', role: 'police', name: 'Officer', pos: [72, CREST_Y, 2], yaw: -Math.PI / 2, passive: true });
    d.push({ id: 'cop_b', char: 'swat', role: 'police', name: 'Officer', pos: [72, CREST_Y, -2], yaw: -Math.PI / 2, passive: true });
  }

  // ================================================================== build
  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/sunset.hdr', envIntensity: 0.5, background: 0x9a8e8c,
      fog: { color: 0xa39a96, density: 0.016 },
      hemi: { sky: 0xb0b8c8, ground: 0x3a3028, intensity: 0.55 },
      sun: { color: 0xffb88a, intensity: 1.9, dir: [0.9, 0.28, -0.4], shadows: true },
      grade: { saturation: 0.78, contrast: 1.06, lift: [0.015, 0.012, 0.015], gain: [1.04, 1.0, 0.96], shadowTint: [0.95, 0.97, 1.06], highlightTint: [1.08, 1.0, 0.9], exposure: 1.0, bloom: 0.8, vignette: 0.55 },
      reverb: 0.4,
    });
    this.kit = new Kit(w);
    await this.buildTerrain();
    for (const d of this.npcDefs) d.pos[1] = CREST_Y;
    await this.buildDam();
    await this.buildHall();
    this.kit.initLightPool(Math.max(1, g.deps.renderer.q.maxLights - 1));
    this.kit.finish();
    // Police cars come along the crest road from the east.
    this.carPath = new Path([v3(150, CREST_Y, -2), v3(90, CREST_Y, -1.5), v3(40, CREST_Y, -1.5), v3(-20, CREST_Y, -1.5)], false);
    for (let i = 0; i < 2; i++) {
      const c = await Car.create(w, { police: true });
      c.root.visible = false;
      this.cars.push(c);
    }
    w.ambientLoop('amb_water', 0.5, v3(0, -8, -30));
    w.ambientLoop('amb_wind', 0.3);
    w.tickers.add((dt, t) => {
      this.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      this.foliage?.update(dt, g.cam.camera.position);
      for (const c of this.cars) c.update(t);
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
  }

  private height(x: number, z: number): number {
    // Valley: reservoir to the north (z > 6), river gorge to the south, hills on both sides.
    const across = Math.abs(x);
    let h = -10 + smooth(50, 140, across) * 40 + fbm(x * 0.01, z * 0.01, 4, 6) * 8;
    if (z > 6) h = Math.min(h, RES_Y - 4 + smooth(60, 120, across) * 30);
    // The abutments meet the crest at the ends.
    if (across > DAM_X1 - 4) h = Math.max(h, CREST_Y - 0.1 - Math.max(0, across - DAM_X1 - 6) * 0.2);
    // The turbine hall is dug into the dam's base: keep the ground below its floor there.
    if (Math.abs(x - HALL.x) < 17 && Math.abs(z - HALL.z) < 12) h = Math.min(h, HALL.y - 0.4);
    return h;
  }

  private async buildTerrain(): Promise<void> {
    const g = this.g, w = g.world;
    this.terrain = new Terrain({
      x0: -220, z0: -220, size: 440, res: 111, height: (x, z) => this.height(x, z),
      layers: [
        { set: 'grass_sparse', scale: 0.14, tint: 0x8f9a7a, surface: 'grass', roughness: 0.95 },
        { set: 'forest_floor', scale: 0.18, surface: 'leaves', roughness: 1 },
        { set: 'rock_face', scale: 0.08, tint: 0x9a948c, surface: 'gravel', roughness: 0.9 },
        { set: 'gravel', scale: 0.25, surface: 'gravel', roughness: 0.9 },
      ],
      weights: (x, z, _h, slope) => [0.5, 0.5 * smooth(60, 120, Math.abs(x)), smooth(0.3, 0.55, slope) * 1.8, smooth(10, 4, Math.abs(z - 0)) * (Math.abs(x) > DAM_X1 ? 1 : 0)],
    });
    await this.terrain.build(w);
    new Water(w, { rect: { x0: -220, z0: 6, x1: 220, z1: 220 }, y: RES_Y, color: 0x2a3a3c, opacity: 0.92 });
    new Water(w, { rect: { x0: -20, z0: -220, x1: 20, z1: -14 }, y: -9.2, color: 0x20302e, flow: [0, -1], opacity: 0.9 });
    const items: FoliageItem[] = [
      { model: 'tree_fir_a', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'tree_fir_b', impostor: true, collider: 0.25, colliderHeight: 4 },
      { model: 'fir_big', impostor: true, collider: 0.35, colliderHeight: 5 },
    ];
    const pl = scatter({
      x0: -218, z0: -218, x1: 218, z1: 218, spacing: 8, seed: 66, height: (x, z) => this.terrain.height(x, z),
      density: (x, z) => (Math.abs(x) < DAM_X1 + 8 && Math.abs(z) < 16 ? 0 : z > 6 && this.terrain.height(x, z) < RES_Y + 0.5 ? 0 : Math.abs(x) < 24 && z < 0 ? 0 : Math.abs(x - HALL.x) < 22 && Math.abs(z - HALL.z) < 16 ? 0 : 0.5),
      pick: (r) => (r < 0.45 ? 0 : r < 0.85 ? 1 : 2),
      scale: (item, r) => (item === 2 ? 0.6 + r * 0.4 : 1 + r * 0.6),
    });
    this.foliage = new Foliage(w, g.deps.renderer.gl);
    await this.foliage.add(items, pl);
  }

  // ------------------------------------------------------------------ dam
  private async buildDam(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [conc, old, steel, rust] = await Promise.all([
      L.pbr('concrete_wall', { scale: 0.15, color: 0xb8b2a6 }),
      L.pbr('concrete_048', { scale: 0.3, color: 0x9a948a }),
      L.pbr('steel', { scale: 1, color: 0x6a6e72, metalness: 0.6, roughness: 0.5 }),
      L.pbr('metal_plate', { scale: 0.6, color: 0x8a5a3a, metalness: 0.3, roughness: 0.8 }),
    ]);
    // Wall: a thick concrete gravity dam, slightly battered on the downstream face.
    kit.box(conc, [0, (CREST_Y - 12) / 2 - 1, -1], [DAM_X1 - DAM_X0, CREST_Y + 10, 12], 0, { surface: 'concrete' });
    kit.box(old, [0, -6, -10], [DAM_X1 - DAM_X0 - 6, 10, 8], 0, { surface: 'concrete' });
    // Crest road + parapets
    kit.floor(old, DAM_X0 - 8, -5, DAM_X1 + 8, 5, CREST_Y, 0.4, 'concrete');
    for (const zz of [-5.2, 5.2]) {
      kit.box(conc, [0, CREST_Y + 0.55, zz], [DAM_X1 - DAM_X0 + 16, 1.1, 0.4], 0, { surface: 'concrete' });
    }
    // Lamp posts
    for (let x = DAM_X0 + 8; x <= DAM_X1 - 8; x += 16) {
      kit.batch.add(cylinderBetween(v3(x, CREST_Y, 4.6), v3(x, CREST_Y + 4.5, 4.6), 0.07, 6), steel);
      kit.box(L.emissive(0xffd29a, 1.2), [x, CREST_Y + 4.55, 4.2], [0.3, 0.12, 0.6], 0, false);
    }
    // Control house on the crest
    const hx = HOUSE.x, hz = HOUSE.z;
    kit.floor(old, hx - 3.5, hz - 2.5, hx + 3.5, hz + 3, CREST_Y + 0.05, 0.1);
    kit.wall(old, hx - 3.5, hz - 2.5, hx + 3.5, hz - 2.5, CREST_Y, 3, 0.2, [{ at: 5, width: 1, bottom: 0, top: 2.1 }]);
    kit.wall(old, hx + 3.5, hz + 3, hx - 3.5, hz + 3, CREST_Y, 3, 0.2, [{ at: 3.5, width: 2.4, bottom: 1, top: 2.2 }]);
    kit.wall(old, hx - 3.5, hz + 3, hx - 3.5, hz - 2.5, CREST_Y, 3, 0.2);
    kit.wall(old, hx + 3.5, hz - 2.5, hx + 3.5, hz + 3, CREST_Y, 3, 0.2, [{ at: 2.5, width: 1.2, bottom: 1, top: 2.2 }]);
    kit.ceiling(old, hx - 3.6, hz - 2.6, hx + 3.6, hz + 3.1, CREST_Y + 3, 0.25);
    kit.box(steel, [hx + 2.6, CREST_Y + 0.5, hz + 2.3], [1.4, 1, 0.6], 0, {});
    kit.box(L.plain(0x4a4436, 0.95), [hx - 2.2, CREST_Y + 0.25, hz + 1.5], [1.8, 0.3, 0.9], 0, false);
    // Jax's jacket with the burner phone on the bench
    this.phone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.14), L.plain(0x111111, 0.4, 0.2));
    this.phone.position.set(hx - 1.6, CREST_Y + 0.42, hz + 1.3);
    w.root.add(this.phone);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.11), L.emissive(0x9fd0ff, 1.5));
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = 0.007;
    this.phone.add(screen);
    // West tower with a door
    const tx = TOWER.x, tz = TOWER.z;
    kit.wall(conc, tx - 4, tz - 4, tx + 4, tz - 4, CREST_Y, 8, 0.4);
    kit.wall(conc, tx + 4, tz + 4, tx - 4, tz + 4, CREST_Y, 8, 0.4);
    kit.wall(conc, tx - 4, tz + 4, tx - 4, tz - 4, CREST_Y, 8, 0.4);
    kit.wall(conc, tx + 4, tz - 4, tx + 4, tz + 4, CREST_Y, 8, 0.4, [{ at: 4, width: 1.6, bottom: 0, top: 2.6 }]);
    kit.ceiling(conc, tx - 4.2, tz - 4.2, tx + 4.2, tz + 4.2, CREST_Y + 8, 0.4);
    // Plinth, string courses, corner piers, roof parapet, window slits and a lit door canopy.
    kit.box(old, [tx, CREST_Y + 0.45, tz], [8.7, 0.9, 8.7], 0, false);
    for (const hh of [3.0, 5.7]) kit.box(old, [tx, CREST_Y + hh, tz], [8.6, 0.22, 8.6], 0, false);
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.box(old, [tx + cx * 4.05, CREST_Y + 4.2, tz + cz * 4.05], [0.7, 8.4, 0.7], 0, false);
    for (const [cx, cz, lx, lz] of [[0, -4.15, 8.6, 0.3], [0, 4.15, 8.6, 0.3], [-4.15, 0, 0.3, 8.6], [4.15, 0, 0.3, 8.6]]) kit.box(old, [tx + cx, CREST_Y + 8.55, tz + cz], [lx, 0.7, lz], 0, false);
    const glass = L.plain(0x1c2228, 0.2, 0.6);
    for (const dz of [-2, 2]) for (const hh of [4.4, 7.0]) kit.box(glass, [tx + 4.22, CREST_Y + hh, tz + dz], [0.05, 1.1, 0.45], 0, false);
    for (const dx of [-2, 2]) kit.box(glass, [tx + dx, CREST_Y + 7.0, tz - 4.22], [0.45, 1.1, 0.05], 0, false);
    kit.box(steel, [tx + 4.75, CREST_Y + 2.85, tz], [1.1, 0.12, 2.4], 0, false);
    kit.bulb(L.emissive(0xffd9a8, 2.5), steel, tx + 4.35, CREST_Y + 2.65, tz, 0xffd9a8, 2, 7);
    kit.textSign(['HARLAN DAM', 'SERVICE STAIRS'], [tx + 4.22, CREST_Y + 3.6, tz + 2.2], 1.4, Math.PI / 2, '#2a3a2e');
    // Spillway gates and rusty machinery on the crest
    for (const x of [10, 22, 34]) {
      kit.box(rust, [x, CREST_Y + 2.2, 5.8], [8, 4.4, 1], 0, false);
      kit.batch.add(cylinderBetween(v3(x - 3, CREST_Y + 4.4, 5.8), v3(x + 3, CREST_Y + 4.4, 5.8), 0.25, 10), steel);
    }
    // Two parked bikes, out of fuel, at the east end
    void steel;
  }

  // ------------------------------------------------------------------ turbine hall (interior arena)
  private async buildHall(): Promise<void> {
    const w = this.g.world, kit = this.kit, L = w.mats;
    const [conc, floorM, steel, green, rust] = await Promise.all([
      L.pbr('concrete_grey', { scale: 0.3, color: 0x9a968c }),
      L.pbr('concrete_floor', { scale: 0.3, color: 0x8c8880 }),
      L.pbr('steel', { scale: 1, color: 0x5a5e62, metalness: 0.6, roughness: 0.5 }),
      L.pbr('painted_plaster', { scale: 0.5, color: 0x4e6a5a }),
      L.pbr('metal_plate', { scale: 0.6, color: 0x8a5a3a, metalness: 0.3, roughness: 0.8 }),
    ]);
    const { x, z, y } = HALL;
    const W = 28, D = 18, H = 11;
    kit.floor(floorM, x - W / 2, z - D / 2, x + W / 2, z + D / 2, y, 0.4);
    kit.wall(green, x - W / 2, z - D / 2, x + W / 2, z - D / 2, y, H, 0.4, [{ at: 4, width: 2.4, bottom: 5, top: 9 }, { at: 10, width: 2.4, bottom: 5, top: 9 }, { at: 16, width: 2.4, bottom: 5, top: 9 }, { at: 22, width: 2.4, bottom: 5, top: 9 }]);
    kit.wall(green, x + W / 2, z + D / 2, x - W / 2, z + D / 2, y, H, 0.4);
    kit.wall(conc, x - W / 2, z + D / 2, x - W / 2, z - D / 2, y, H, 0.4, [{ at: 9, width: 1.8, bottom: 0, top: 2.6 }]);
    kit.wall(conc, x + W / 2, z - D / 2, x + W / 2, z + D / 2, y, H, 0.4);
    kit.ceiling(conc, x - W / 2 - 0.2, z - D / 2 - 0.2, x + W / 2 + 0.2, z + D / 2 + 0.2, y + H, 0.4);
    // Three turbine housings along the back wall
    for (const dx of [-8, 0, 8]) {
      const c = new THREE.CylinderGeometry(2.4, 2.6, 2.2, 28);
      c.translate(x + dx, y + 1.1, z + 4.5);
      kit.batch.add(c, green);
      const cap = new THREE.CylinderGeometry(1.2, 1.6, 1.4, 24);
      cap.translate(x + dx, y + 2.9, z + 4.5);
      kit.batch.add(cap, steel);
      w.physics.addBox({ x: x + dx, y: y + 1.8, z: z + 4.5 }, { x: 4.6, y: 3.6, z: 4.6 }, 0, { surface: 'metal' });
    }
    // Catwalk on the front wall
    kit.slab(steel, x - W / 2 + 0.2, z - D / 2 + 0.2, x + W / 2 - 0.2, z - D / 2 + 1.8, y + 5, 0.12, 'metal');
    kit.railing(steel, x - W / 2 + 0.2, z - D / 2 + 1.8, x + W / 2 - 0.2, z - D / 2 + 1.8, y + 5);
    kit.stairs(steel, x + W / 2 - 2, z - D / 2 + 9, Math.PI, 1.2, y, y + 5, 7);
    // Gantry crane rail
    for (const zz of [z - D / 2 + 0.6, z + D / 2 - 0.6]) kit.box(rust, [x, y + H - 1.2, zz], [W, 0.5, 0.4], 0, false);
    kit.box(rust, [x + 3, y + H - 1.6, z], [0.6, 0.6, D - 1.2], 0, false);
    // Pipes, control panels, oil drums for cover
    for (const [dx, dz] of [[-11, -5], [11, -5], [-11, 2], [11, 2]] as const) kit.box(steel, [x + dx, y + 0.8, z + dz], [1.2, 1.6, 0.6], 0, {});
    const barrels = await w.model('oil_barrels');
    for (const [dx, dz, yaw] of [[-6, -5.5, 0.3], [5, -6.2, 1.1]] as const) { kit.place(barrels, [x + dx, y, z + dz], yaw); w.physics.addBox({ x: x + dx, y: y + 0.45, z: z + dz }, { x: 0.6, y: 0.9, z: 1.4 }, yaw, {}); }
    for (const dx of [-9, -3, 3, 9]) kit.fixture(L.emissive(0xeef4ff, 3), steel, x + dx, y + H - 0.4, z - 2, 0, 0xdde8ff, 2.4, 14, 1.6, 'hall');
    // Dawn light shafts through the high windows
    for (const at of [4, 10, 16, 22]) kit.shaft([x - W / 2 + at, y + 8, z - D / 2 + 0.3], new THREE.Vector3(-0.25, -0.75, 1).normalize(), 2.2, 12, 0xffd8b0, 0.07);
    // The gun on the floor (dropped in the struggle)
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.12), L.plain(0x1a1a1a, 0.4, 0.6));
    this.gun.position.set(x, y + 0.03, z - 2.5);
    this.gun.visible = false;
    w.root.add(this.gun);
  }
  private gun!: THREE.Mesh;

  // ================================================================== interactions / triggers
  private buildInteractions(): void { /* the chapter is driven by cutscenes and the run */ }

  private buildTriggers(): void {
    this.addTrigger({ id: 'tower', min: [TOWER.x + 3, CREST_Y - 1, TOWER.z - 3], max: [TOWER.x + 7, CREST_Y + 4, TOWER.z + 3], who: 'both', enabled: () => this.flags.phase === 'run' });
  }

  onTrigger(id: string): void {
    if (!this.authority) return;
    if (id === 'tower') this.cutscene('cs6_stairs');
  }

  // ================================================================== cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    const hx = HOUSE.x, hz = HOUSE.z;
    C.cs6_dawn = {
      id: 'cs6_dawn', music: 'music_sad', skippable: true,
      start: () => {
        placeChar(g, 'elias', v3(hx - 2.2, CREST_Y + 0.4, hz + 1.5), 0);
        poseChar(g, 'elias', 'lying');
        placeChar(g, 'jax', v3(hx + 9, CREST_Y, hz - 3.6), Math.PI);
        clipChar(g, 'jax', 'phone_text', 'upper');
      },
      beats: [
        { dur: 6, fade: 'in', shot: () => shot(v3(40, CREST_Y + 14, -60), v3(0, CREST_Y, 0), 6, { fov: 44, toEnd: v3(hx, CREST_Y, hz) }),
          lines: [{ who: 'narrator', text: 'First light over the Harlan Dam.', dur: 3 }] },
        { dur: 4, shot: () => closeUp(g, 'elias', 4, 1.1, 0.4, { fov: 34 }), run: () => { poseChar(g, 'elias', null); placeChar(g, 'elias', v3(hx - 2.0, CREST_Y, hz + 0.6), Math.PI / 2); } },
        { dur: 3.4, shot: () => shot(v3(hx - 2.4, CREST_Y + 1.4, hz + 0.2), v3(hx - 1.6, CREST_Y + 0.45, hz + 1.3), 3.4, { fov: 30 }),
          run: () => { walkChar(g, 'elias', [v3(hx - 1.6, CREST_Y, hz + 0.6)], 0.8, () => poseChar(g, 'elias', 'pick_low')); g.audio.play('ui_tick', { pos: this.phone.position, volume: 0.6, delay: 1.2 }); },
          lines: [{ who: 'narrator', text: 'Jax\'s jacket. A phone buzzing in the pocket.', dur: 3 }] },
        { shot: () => shot(v3(hx - 2.25, CREST_Y + 1.8, hz + 1.0), v3(hx - 1.1, CREST_Y + 1.25, hz + 0.55), 11, { fov: 30 }),
          run: () => { this.phone.visible = false; poseChar(g, 'elias', 'talk_phone'); },
          lines: [
            { who: 'narrator', text: 'L. MARSH — 4:12 AM: "Where are you? You were supposed to check in."', dur: 3.6 },
            { who: 'narrator', text: 'L. MARSH — 4:40 AM: "Crane is dead. This is not the deal, Rourke."', dur: 3.6 },
            { who: 'narrator', text: 'L. MARSH — 5:31 AM: "Bring Varga in or the deal is off. Your record, your brother\'s case. All of it."', dur: 4.2 },
          ] },
        { dur: 3, shot: () => shot(v3(hx + 5, CREST_Y + 1.6, hz - 1), v3(hx + 9, CREST_Y + 1.4, hz - 3.6), 3, { fov: 36 }),
          run: () => { poseChar(g, 'elias', null); clipChar(g, 'jax', null, 'upper'); placeChar(g, 'elias', v3(hx + 4.2, CREST_Y, hz - 2.6), Math.PI / 2); } },
        { shot: () => ots(g, 'elias', 'jax', 40, 1), lines: [
          { who: 'elias', text: 'Who is Lena Marsh?', pause: 1 },
          { who: 'jax', text: '...Elias.', anim: 'talk_sad' },
          { who: 'elias', text: '"Bring Varga in." Who is she, Jax?', anim: 'talk_angry' },
          { who: 'jax', text: 'State police. Organised crime. She came to me in county after Danny died.', anim: 'talk_nervous' },
          { who: 'jax', text: 'They knew you kept Crane\'s second set of books in your head. They needed a witness who\'d talk. They needed you.', anim: 'talk_nervous' },
          { who: 'jax', text: 'Get you out, get close, bring you in with the books. My record wiped. Danny\'s case reopened.', anim: 'talk_sad' },
          { who: 'elias', text: 'The transfer. The sealed envelope. "You know the deal." The phone in the barn.', pause: 0.5 },
          { who: 'elias', text: 'The lot numbers. You read my file.', anim: 'talk_angry' },
        ] },
        { shot: () => closeUp(g, 'jax', 22, 1.0, 0.25, { fov: 33 }), lines: [
          { who: 'jax', text: 'I didn\'t know you when I said yes. Then I did.', anim: 'talk_sad' },
          { who: 'jax', text: 'Every night since the vent, I\'ve been trying to figure out how to tell her no.', pause: 0.6 },
          { who: 'elias', text: 'Tom Harlan was my friend too. Then Crane. Then a jury. Now you.', look: 'jax' },
          { who: 'elias', text: 'Everybody I ever trusted sold me to somebody.', anim: 'talk_angry', pause: 1.2 },
        ] },
        { dur: 4, shot: () => shot(v3(110, CREST_Y + 6, -20), v3(60, CREST_Y + 1, 0), 4, { fov: 38 }),
          run: () => this.startCars(),
          lines: [{ who: 'marsh', text: '(megaphone) Rourke! Varga! This is Detective Marsh. Nobody has to get hurt today!', dur: 3.8, radio: true }] },
        { shot: () => twoShot(g, 'elias', 'jax', 4, 2.6, 1.5, 1), lines: [
          { who: 'jax', text: 'Elias, she can clear you. Mia\'s recording — it\'s enough!', anim: 'talk_nervous' },
          { who: 'elias', text: 'I\'m not going back in a cage.', anim: 'deny' },
        ] },
      ],
      end: () => {
        if (this.authority) { this.saveCheckpoint('run'); g.session.emit('restart', { checkpoint: 'run' }); }
      },
    };
    C.cs6_stairs = {
      id: 'cs6_stairs', music: 'music_tension', skippable: false,
      start: () => {},
      beats: [
        { dur: 2.5, fade: 'out', shot: () => shot(v3(TOWER.x + 12, CREST_Y + 3, TOWER.z - 6), v3(TOWER.x + 4, CREST_Y + 1.5, TOWER.z), 2.5, { fov: 42 }),
          run: () => { g.audio.play('door_slam', { pos: v3(TOWER.x + 4, CREST_Y + 1, TOWER.z), volume: 0.9 }); } },
      ],
      end: () => {
        if (this.authority) { this.saveCheckpoint('hall'); g.session.emit('restart', { checkpoint: 'hall' }); }
      },
    };
    C.cs6_hall = {
      id: 'cs6_hall', music: 'music_tension', skippable: true,
      start: () => {
        placeChar(g, 'elias', v3(HALL.x - 4, HALL.y, HALL.z - 1), Math.PI / 2);
        placeChar(g, 'jax', v3(HALL.x + 4, HALL.y, HALL.z - 1), -Math.PI / 2);
      },
      beats: [
        { dur: 4, fade: 'in', shot: () => shot(v3(HALL.x + 12, HALL.y + 6, HALL.z - 7), v3(HALL.x, HALL.y + 1.2, HALL.z - 1), 4, { fov: 46 }),
          lines: [{ who: 'narrator', text: 'The turbine hall. The only way out is through each other.', dur: 3.6 }] },
        { shot: () => ots(g, 'jax', 'elias', 14, -1), lines: [
          { who: 'jax', text: 'Let me walk you out. Please. I\'ll stand next to you the whole way.', anim: 'talk_sad' },
          { who: 'elias', text: 'Then you\'ll have to make me.', anim: 'talk_angry' },
          { who: 'jax', text: '...Don\'t do this.' },
          { who: 'elias', text: 'You already did.' },
        ] },
      ],
      end: () => { if (this.authority) g.session.emit('fightStart', {}); },
    };
    // Endings: the winner of the fight decides which one survives.
    C.cs6_end_elias = {
      id: 'cs6_end_elias', music: 'music_sad', skippable: false,
      start: () => {
        g.flags.combat = false;
        placeChar(g, 'jax', v3(HALL.x + 0.5, HALL.y, HALL.z - 1.6), -Math.PI / 2);
        poseChar(g, 'jax', 'downed');
        placeChar(g, 'elias', v3(HALL.x - 1.4, HALL.y, HALL.z - 1.4), Math.PI / 2);
        this.gun.visible = true;
      },
      beats: [
        { dur: 3, shot: () => shot(v3(HALL.x - 3, HALL.y + 0.6, HALL.z - 3.5), v3(HALL.x, HALL.y + 0.1, HALL.z - 2.5), 3, { fov: 36 }),
          run: () => { walkChar(g, 'elias', [v3(HALL.x - 0.4, HALL.y, HALL.z - 2.4)], 0.8, () => { poseChar(g, 'elias', 'pick_low'); this.gun.visible = false; }); } },
        { shot: () => ots(g, 'elias', 'jax', 14, 1), run: () => poseChar(g, 'elias', 'aim'), lines: [
          { who: 'jax', text: 'Go on. I\'d deserve it.', anim: 'talk_sad' },
          { who: 'elias', text: 'Why, Jax? Why couldn\'t you just tell me?', anim: 'talk_angry' },
          { who: 'jax', text: 'Because then you\'d have looked at me like that. ...Wait. In my jacket—', pause: 0.3 },
        ] },
        { dur: 2.2, shot: () => closeUp(g, 'elias', 2.2, 0.9, -0.3, { fov: 30 }),
          run: () => { setTimeout(() => { g.audio.gunshot(v3(HALL.x, HALL.y + 1, HALL.z - 2), 1.0); g.cam.addShake(0.5); }, 1100); } },
        { shot: () => shot(v3(HALL.x + 1.6, HALL.y + 0.5, HALL.z - 0.4), v3(HALL.x + 0.5, HALL.y + 0.2, HALL.z - 1.6), 16, { fov: 32 }),
          run: () => { poseChar(g, 'elias', 'kneel'); poseChar(g, 'jax', 'lying'); },
          lines: [
            { who: 'jax', text: 'Mia\'s phone. The recording. I was going to give it to Marsh... for you.', pause: 0.8 },
            { who: 'jax', text: 'It clears you, professor. All of it.', pause: 1.0 },
            { who: 'elias', text: 'No. No, no — Jax. Stay with me.', anim: 'talk_sad', pause: 0.8 },
            { who: 'jax', text: 'Tell Danny\'s judge... I found the guy who listens.', pause: 2.0 },
          ] },
        { dur: 4, shot: () => shot(v3(HALL.x - 12, HALL.y + 2, HALL.z + 5), v3(HALL.x, HALL.y + 0.6, HALL.z - 1.6), 4, { fov: 40 }),
          run: () => { g.audio.play('door_open', { pos: v3(HALL.x - 14, HALL.y + 1, HALL.z), volume: 0.9 }); },
          lines: [{ who: 'marsh', text: 'Drop it, Varga! ...Oh, God. Jax.', dur: 3.2 }] },
        { dur: 9, fade: 'out', shot: () => shot(v3(HALL.x, HALL.y + 9, HALL.z - 8), v3(HALL.x, HALL.y, HALL.z - 1.6), 9, { fov: 44 }),
          lines: [
            { who: 'narrator', text: 'Eight months later, Elias Varga was cleared of the murder of Tom Harlan.', dur: 4 },
            { who: 'narrator', text: 'He was convicted of the manslaughter of Jax Rourke. Every year, on release day, he visits two graves.', dur: 4.5 },
          ] },
      ],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: null, ending: 'elias_lives' }); },
    };
    C.cs6_end_jax = {
      id: 'cs6_end_jax', music: 'music_sad', skippable: false,
      start: () => {
        g.flags.combat = false;
        placeChar(g, 'elias', v3(HALL.x - 0.5, HALL.y, HALL.z - 1.6), Math.PI / 2);
        poseChar(g, 'elias', 'downed');
        placeChar(g, 'jax', v3(HALL.x + 1.4, HALL.y, HALL.z - 1.4), -Math.PI / 2);
        this.gun.visible = true;
      },
      beats: [
        { dur: 3, shot: () => shot(v3(HALL.x + 3, HALL.y + 0.6, HALL.z - 3.5), v3(HALL.x, HALL.y + 0.1, HALL.z - 2.5), 3, { fov: 36 }),
          run: () => { placeChar(g, 'elias', v3(HALL.x - 0.2, HALL.y, HALL.z - 2.3), Math.PI / 2); poseChar(g, 'elias', 'kneel'); this.gun.visible = false; },
          lines: [{ who: 'jax', text: 'Elias — put it down!', dur: 2 }] },
        { dur: 3.2, shot: () => twoShot(g, 'elias', 'jax', 3.2, 2.2, 1.0, 1),
          run: () => {
            run(g, 'jax', [{ to: v3(HALL.x + 0.3, HALL.y, HALL.z - 2.2), dur: 0.5, anim: 4 }, { to: v3(HALL.x + 0.2, HALL.y, HALL.z - 2.2), dur: 1.6, pose: 'choke', poseCtx: { points: { neck: v3(HALL.x - 0.2, HALL.y + 1.2, HALL.z - 2.3) } } }]);
            setTimeout(() => { g.audio.gunshot(v3(HALL.x, HALL.y + 1, HALL.z - 2.2), 1.0); g.cam.addShake(0.5); }, 1500);
          },
          lines: [{ who: 'elias', text: 'Let go of me!', dur: 1.4 }] },
        { shot: () => shot(v3(HALL.x - 1.6, HALL.y + 0.5, HALL.z - 0.4), v3(HALL.x - 0.4, HALL.y + 0.2, HALL.z - 1.8), 16, { fov: 32 }),
          run: () => { poseChar(g, 'elias', 'lying'); poseChar(g, 'jax', 'kneel'); placeChar(g, 'jax', v3(HALL.x + 0.4, HALL.y, HALL.z - 1.8), -Math.PI / 2); },
          lines: [
            { who: 'jax', text: 'No. No, no, no. I had it — the gun just—', anim: 'talk_sad', pause: 0.6 },
            { who: 'elias', text: 'Mia\'s phone... give it to her. Tell her... it wasn\'t for nothing.', pause: 1.2 },
            { who: 'jax', text: 'You tell her yourself. You hear me? Professor?', pause: 1.6 },
            { who: 'elias', text: '...Two a.m. ...Shift change.', pause: 2.2 },
          ] },
        { dur: 4, shot: () => shot(v3(HALL.x - 12, HALL.y + 2, HALL.z + 5), v3(HALL.x, HALL.y + 0.6, HALL.z - 1.6), 4, { fov: 40 }),
          run: () => { g.audio.play('door_open', { pos: v3(HALL.x - 14, HALL.y + 1, HALL.z), volume: 0.9 }); },
          lines: [{ who: 'marsh', text: 'Jax! Get away from him— ...Jax. It\'s over.', dur: 3.2 }] },
        { dur: 9, fade: 'out', shot: () => shot(v3(HALL.x, HALL.y + 9, HALL.z - 8), v3(HALL.x, HALL.y, HALL.z - 1.6), 9, { fov: 44 }),
          lines: [
            { who: 'narrator', text: 'With Mia\'s recording, Elias Varga was cleared of the murder of Tom Harlan. Posthumously.', dur: 4.5 },
            { who: 'narrator', text: 'Jax Rourke\'s record was wiped, as promised. Danny\'s case was reopened. He never drove again.', dur: 4.5 },
          ] },
      ],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: null, ending: 'jax_lives' }); },
    };
  }

  private startCars(): void {
    this.carT = 0;
    this.siren ??= this.g.audio.siren();
    for (const c of this.cars) { c.root.visible = true; c.sirenOn = true; }
  }

  // ================================================================== checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    this.flags.phase = id;
    g.flags.combat = false;
    delete this.flags.pvp;
    g.local.regen = true;
    for (const n of g.npcs.values()) { n.reset(); n.enabled = false; n.body.visible = false; n.body.solid = false; }
    this.winner = null;
    this.phone.visible = id === 'dawn';
    this.gun.visible = false;
    if (id === 'run') {
      this.startCars();
      this.carT = 4;
      if (this.authority) { this.objective('Run for the west tower!', [TOWER.x + 4, CREST_Y + 1.5, TOWER.z]); }
      g.audio.playMusic('music_chase', 1);
    } else {
      this.carT = -1;
      for (const c of this.cars) c.root.visible = false;
      this.siren?.stop(); this.siren = null;
    }
    if (id === 'hall') {
      for (const f of this.kit.fixtures) f.on = true;
      g.audio.playMusic('music_tension', 1);
    }
  }

  // ================================================================== events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'fightStart':
        this.flags.pvp = true;
        g.flags.combat = true;
        g.local.regen = false;
        g.local.body.hp = g.local.body.maxHp;
        g.audio.playMusic('music_action', 0.8);
        if (this.authority) this.objective('The final fight');
        g.hud.notify('Fight! Hit, block and dodge — the first one down loses.', 4);
        return true;
      case 'downed': {
        if (!this.flags.pvp) return false;
        if (this.winner) return true;
        const loser = a.who as CharacterId;
        this.winner = loser === 'elias' ? 'jax' : 'elias';
        if (this.authority) {
          g.session.emit('flag', { k: 'winner', v: this.winner });
          setTimeout(() => this.cutscene(this.winner === 'elias' ? 'cs6_end_elias' : 'cs6_end_jax'), 1500);
        }
        g.local.regen = true;
        delete this.flags.pvp;
        return true;
      }
      case 'restarted':
        return true;
    }
    return false;
  }

  update(dt: number): void {
    const g = this.g;
    // Police cars roll in along the crest during the run.
    if (this.carT >= 0) {
      this.carT += dt;
      this.cars.forEach((c, i) => {
        const s = Math.max(0, this.carT * 9 - i * 12);
        const at = this.carPath.at(s);
        const p = at.pos.clone();
        p.z += i ? 1.8 : -1.8;
        c.setPose(p, at.yaw, g.world.physics);
        if (i === 0) this.siren?.set(p.clone().setY(p.y + 1.5), 0.7);
      });
      // Caught on the crest if the cruisers reach the players.
      if (this.authority && this.flags.phase === 'run' && g.state === 'playing') {
        for (const ch of ['elias', 'jax'] as CharacterId[]) {
          const b = g.body(ch);
          if (this.cars.some((c) => c.root.position.distanceTo(b.pos) < 4)) {
            g.session.emit('dlg', { lines: [{ who: 'marsh', text: 'Down on the ground! Now!', dur: 2 } satisfies Line], at: g.session.sharedNow() });
            g.session.emit('caught', { who: ch, by: 'police' });
            break;
          }
        }
      }
    }
  }

  lightAt(): number { return 0.9; }
  suspicion(): number { return 0; }

  dispose(): void {
    this.siren?.stop();
  }
}

void lookChar; void npcPlace;
