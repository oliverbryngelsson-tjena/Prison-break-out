// Imports third-party assets (with licences) into public/assets.
//   node tools/import-assets.mjs [models|textures|audio|env|credits]...
// Sources are local clones of public repositories (see CREDITS.md for each asset's origin).
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, textureCompress, simplify, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HOME = '/home/user';
const SRC = {
  daggie: `${HOME}/89502147777r-wq/daggie`,
  moto: `${HOME}/gazlappy/motocross-bobness/assets`,
  oyl: `${HOME}/openzigs/onyourleft/apps/web/public/realistic`,
  snd: `${HOME}/lavenderdotpet/cc0-public-domain-sounds`,
  eztree: 'node_modules/@dgreenheck/ez-tree/src/lib/assets',
};
const OUT = path.resolve('public/assets');

// ---------------------------------------------------------------- licences
const L = {
  cc0: { license: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  ccby: { license: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  ccby3: { license: 'CC-BY-3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
  mit: { license: 'MIT', url: 'https://opensource.org/licenses/MIT' },
};
const DAGGIE = 'github.com/89502147777r-wq/Daggie (redistributed copy)';
const MOTO = 'github.com/gazlappy/motocross-bobness (redistributed copy)';
const OYL = 'github.com/openzigs/onyourleft (redistributed copy)';
const SNDREPO = 'github.com/lavenderdotpet/CC0-Public-Domain-Sounds';

// ---------------------------------------------------------------- models
// fit: scale so the largest horizontal extent (length) or the height matches.
const MODELS = [
  { id: 'bed_iron', src: `${SRC.daggie}/models/v_bed.glb`, fit: { length: 2.0 }, credit: ['Hospital Bed', 'loxfear', 'https://sketchfab.com/3d-models/hospital-bed-f8c13a19e84343e7b644c19f7b9488d3', L.ccby, DAGGIE] },
  { id: 'toilet', src: `${SRC.daggie}/models/v_toilet.glb`, fit: { height: 0.78 }, credit: ['Toilet', 'hippostance', 'https://sketchfab.com/3d-models/toilet-132a8ee2af3a40d39d270fbed3d3666c', L.ccby, DAGGIE] },
  { id: 'office_chair', src: `${SRC.daggie}/models/v_chair.glb`, fit: { height: 1.08 }, credit: ['Office Chair', 'nokillnando', 'https://sketchfab.com/3d-models/office-chair-b228a29fa84544c2be501c295653ffe7', L.ccby, DAGGIE] },
  { id: 'sofa_old', src: `${SRC.daggie}/models/v_sofa.glb`, fit: { length: 2.0 }, credit: ['Old Couch', 'oisougabo', 'https://sketchfab.com/3d-models/old-couch-443d9bb95e944afe8ebc4ff489e2886c', L.ccby, DAGGIE] },
  { id: 'dumpster', src: `${SRC.daggie}/models/v_bin.glb`, fit: { length: 1.95 }, credit: ['LOW POLY - DUMPSTER', 'Colin.Greenall', 'https://sketchfab.com/3d-models/low-poly-dumpster-093e5b05faa947729b1be24c013e563b', L.ccby, DAGGIE] },
  { id: 'oil_barrels', src: `${SRC.daggie}/models/o_barrel.glb`, fit: { height: 0.9 }, credit: ['Dirty oil barrel', 'ahmagh2e', 'https://sketchfab.com/3d-models/dirty-oil-barrel-5mb-b973a95ff3bb478a941ccb06a70b14bb', L.ccby, DAGGIE] },
  { id: 'tire', src: `${SRC.daggie}/models/o_tire.glb`, fit: { length: 0.68 }, credit: ['Old Dirty Tire', 'tahircakir', 'https://sketchfab.com/3d-models/old-dirty-tire-ec06c0af626746e7a44de65436037173', L.ccby, DAGGIE] },
  { id: 'hay_bale', src: `${SRC.daggie}/models/o_hay.glb`, fit: { length: 1.2 }, credit: ['Hay bale', 'NoodePoodle', 'https://sketchfab.com/3d-models/hay-bale-e01a6a0f9ed843279adfac2427c99679', L.ccby, DAGGIE] },
  { id: 'crate', src: `${SRC.daggie}/models/p_crate.glb`, fit: { length: 0.82 }, credit: ['Wooden Crate 01', 'Poly Haven', 'https://polyhaven.com/a/wooden_crate_01', L.cc0, DAGGIE] },
  { id: 'container', src: `${SRC.daggie}/models/s_container.glb`, fit: { length: 6.06 }, credit: ['Freight shipping container - Rusted', 'sousinho', 'https://sketchfab.com/3d-models/freight-shipping-container-rusted-2b787d1a02174d0bbca9eac34eb3a486', L.ccby, DAGGIE] },
  { id: 'rust_car', src: `${SRC.daggie}/models/s_rustcar.glb`, fit: { length: 4.4 }, credit: ['Abandoned Car - BMW E30 Sedan', 'roh3d', 'https://sketchfab.com/3d-models/abandoned-car-bmw-e30-sedan-32498418a32d43a78d0847ce4c55fcb0', L.ccby, DAGGIE] },
  { id: 'shed', src: `${SRC.daggie}/models/s_shed.glb`, fit: { length: 4.2 }, credit: ['Worn Shed PBR Game-Ready', 'donnichols', 'https://sketchfab.com/3d-models/worn-shed-pbr-game-ready-be6edd62e55a4f9a99da940fc164a5b9', L.ccby, DAGGIE] },
  { id: 'water_tower', src: `${SRC.daggie}/models/s_wtower.glb`, fit: { height: 11 }, credit: ['Water Tower', 'ahmagh2e', 'https://sketchfab.com/3d-models/water-tower-4e98f8c8fe4e4e9fae250a026974fe99', L.ccby, DAGGIE] },
  { id: 'dozer', src: `${SRC.daggie}/models/s_dozer.glb`, fit: { length: 5.4 }, simplify: 0.35, credit: ['Bulldozer Photogrammetry', 'bertanbaday', 'https://sketchfab.com/3d-models/bulldozer-photogrammetry-baa53594134f4a4f99d96ce4ba25492e', L.ccby, DAGGIE] },
  { id: 'excavator', src: `${SRC.daggie}/models/s_excav.glb`, fit: { length: 9.5 }, credit: ['Excavator', 'rhymone', 'https://sketchfab.com/3d-models/excavator-84cd8adb9d104010b10f3fa89e5f6a70', L.ccby, DAGGIE] },
  { id: 'tractor', src: `${SRC.daggie}/models/v_tractor.glb`, fit: { length: 3.4 }, credit: ['Tractor', 'le0tard', 'https://sketchfab.com/3d-models/tractor-278fc1e0516c401eba358d3aa2e55635', L.ccby, DAGGIE] },
  { id: 'wheelbarrow', src: `${SRC.daggie}/models/v_barrow.glb`, fit: { length: 1.45 }, credit: ['Wheelbarrow', 'i.aleksey.yakovlev', 'https://sketchfab.com/3d-models/wheelbarrow-c0dcebcb0d4b47bd98df534334f4caf6', L.ccby, DAGGIE] },
  { id: 'sedan', src: `${SRC.daggie}/models/o_car.glb`, fit: { length: 5.15 }, credit: ["Negotiator '80 - Low poly model", 'DanielZhabotinsky', 'https://sketchfab.com/3d-models/negotiator-80-low-poly-model-892b2684fb37442299bfad9222cf331c', L.ccby, DAGGIE] },
  { id: 'dump_truck', src: `${SRC.daggie}/models/o_truck.glb`, fit: { length: 8.4 }, credit: ['Shacman F3000 Dump Truck', 'benjamintang2012', 'https://sketchfab.com/3d-models/shacman-f3000-dump-truck-010b0518d3f946b98e2ae3bddf52fbd8', L.ccby, DAGGIE] },
  { id: 'fir_big', src: `${SRC.daggie}/models/s_fir.glb`, fit: { height: 13 }, credit: ['Fir tree', 'intice184', 'https://sketchfab.com/3d-models/fir-tree-0965de5def1342cd8b8b1a0fa5643e27', L.ccby, DAGGIE] },
  { id: 'boulder_a', src: `${SRC.daggie}/models/p_boulder2.glb`, credit: ['Namaqualand Boulder 02', 'Poly Haven', 'https://polyhaven.com/a/namaqualand_boulder_02', L.cc0, DAGGIE] },
  { id: 'boulder_b', src: `${SRC.daggie}/models/p_boulder3.glb`, credit: ['Namaqualand Boulder 03', 'Poly Haven', 'https://polyhaven.com/a/namaqualand_boulder_03', L.cc0, DAGGIE] },
  { id: 'boulder_c', src: `${SRC.daggie}/models/p_boulder5.glb`, credit: ['Namaqualand Boulder 05', 'Poly Haven', 'https://polyhaven.com/a/namaqualand_boulder_05', L.cc0, DAGGIE] },
  { id: 'rock_a', src: `${SRC.daggie}/models/p_rock7.glb`, credit: ['Rock 07', 'Poly Haven', 'https://polyhaven.com/a/rock_07', L.cc0, DAGGIE] },
  { id: 'rock_b', src: `${SRC.daggie}/models/p_rock9.glb`, credit: ['Rock 09', 'Poly Haven', 'https://polyhaven.com/a/rock_09', L.cc0, DAGGIE] },
  { id: 'branches', src: `${SRC.daggie}/models/p_branches.glb`, credit: ['Dry Branches Medium 01', 'Poly Haven', 'https://polyhaven.com/a/dry_branches_medium_01', L.cc0, DAGGIE] },
  { id: 'dead_trunk', src: `${SRC.daggie}/models/p_quiver.glb`, credit: ['Dead Quiver Trunk', 'Poly Haven', 'https://polyhaven.com/a/dead_quiver_trunk', L.cc0, DAGGIE] },
  { id: 'dirtbike', src: `${SRC.moto}/models/Bike/free_honda_crf_450_1k.glb`, keepNodes: true, simplify: 0.3, credit: ['(FREE) Honda CRF 450', 'Jacobdesigns', 'https://skfb.ly/oFqPG', L.ccby, MOTO] },
  { id: 'boulder_d', src: `${SRC.oyl}/boulder_01.glb`, ktx2: true, credit: ['Boulder 01', 'Poly Haven (Rico Cilliers)', 'https://polyhaven.com/a/boulder_01', L.cc0, OYL] },
  { id: 'shrub_a', src: `${SRC.oyl}/shrub_02_a.glb`, ktx2: true, credit: ['Shrub 02', 'Poly Haven (Rico Cilliers)', 'https://polyhaven.com/a/shrub_02', L.cc0, OYL] },
  { id: 'shrub_c', src: `${SRC.oyl}/shrub_02_c.glb`, ktx2: true, credit: ['Shrub 02', 'Poly Haven (Rico Cilliers)', 'https://polyhaven.com/a/shrub_02', L.cc0, OYL] },
  { id: 'tree_island', src: `${SRC.oyl}/island_tree_02.glb`, ktx2: true, credit: ['Island Tree 02', 'Poly Haven (Rob Tuytel, Rico Cilliers)', 'https://polyhaven.com/a/island_tree_02', L.cc0, OYL] },
  { id: 'tree_small', src: `${SRC.oyl}/tree_small_02.glb`, ktx2: true, credit: ['Tree Small 02', 'Poly Haven (Rico Cilliers)', 'https://polyhaven.com/a/tree_small_02', L.cc0, OYL] },
  { id: 'fir_sapling_a', src: `${SRC.oyl}/fir_sapling_medium_a.glb`, ktx2: true, credit: ['Fir Sapling Medium', 'Poly Haven (Rob Tuytel, Rico Cilliers)', 'https://polyhaven.com/a/fir_sapling_medium', L.cc0, OYL] },
  { id: 'fir_sapling_b', src: `${SRC.oyl}/fir_sapling_medium_b.glb`, ktx2: true, credit: ['Fir Sapling Medium', 'Poly Haven (Rob Tuytel, Rico Cilliers)', 'https://polyhaven.com/a/fir_sapling_medium', L.cc0, OYL] },
  ...['oak_a', 'oak_c', 'hornbeam_a', 'hornbeam_c', 'fir_a', 'fir_b'].map((n) => ({
    id: 'tree_' + n, src: `${SRC.oyl}/generated_${n}.glb`, ktx2: true,
    credit: [`Generated ${n.replace('_', ' ')} tree (EZ-Tree, ambientCG/Poly Haven textures)`, 'onyourleft contributors; textures ambientCG / Poly Haven', 'https://github.com/openzigs/onyourleft', L.cc0, OYL],
  })),
];

// ---------------------------------------------------------------- textures
// name -> { files: {c,n,r}, credit }
const T = (dir, base, map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, `${dir}/${base}${v}`]));
const TEXTURES = [
  { id: 'concrete_wall', files: T(`${SRC.daggie}/tex`, 'concrete_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Concrete Wall 008', 'Dario Barresi, Charlotte Baglioni (Poly Haven)', 'https://polyhaven.com/a/concrete_wall_008', L.cc0, DAGGIE] },
  { id: 'concrete_grey', files: T(`${SRC.daggie}/tex`, 'conc_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Concrete Wall 008 (greyscale)', 'Poly Haven', 'https://polyhaven.com/a/concrete_wall_008', L.cc0, DAGGIE] },
  { id: 'metal_plate', files: T(`${SRC.daggie}/tex`, 'metal_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Metal Plate 02', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/metal_plate_02', L.cc0, DAGGIE] },
  { id: 'steel', files: T(`${SRC.daggie}/tex`, 'steel_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Metal Plate 02 (greyscale)', 'Poly Haven', 'https://polyhaven.com/a/metal_plate_02', L.cc0, DAGGIE] },
  { id: 'plywood', files: T(`${SRC.daggie}/tex`, 'ply_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Plywood', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/plywood', L.cc0, DAGGIE] },
  { id: 'planks', files: T(`${SRC.daggie}/tex`, 'oak_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Brown Planks 03', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/brown_planks_03', L.cc0, DAGGIE] },
  { id: 'brick_red', files: T(`${SRC.daggie}/tex`, 'brick_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Red Brick 03', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/red_brick_03', L.cc0, DAGGIE] },
  { id: 'stone_wall', files: T(`${SRC.daggie}/tex`, 'stone_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Rustic Stone Wall 02', 'Amal Kumar (Poly Haven)', 'https://polyhaven.com/a/rustic_stone_wall_02', L.cc0, DAGGIE] },
  { id: 'asphalt', files: T(`${SRC.daggie}/tex`, 'asphalt_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Asphalt Pit Lane', 'Dimitrios Savva (Poly Haven)', 'https://polyhaven.com/a/asphalt_pit_lane', L.cc0, DAGGIE] },
  { id: 'asphalt_old', files: T(`${SRC.daggie}/tex`, 'g_road_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Asphalt 02', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/asphalt_02', L.cc0, DAGGIE] },
  { id: 'concrete_floor', files: T(`${SRC.daggie}/tex`, 'g_hall_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Concrete Floor Worn 001', 'Poly Haven', 'https://polyhaven.com/a/concrete_floor_worn_001', L.cc0, DAGGIE] },
  { id: 'dry_ground', files: T(`${SRC.daggie}/tex`, 'g_quarry_', { c: 'diff.jpg', n: 'nor.jpg', r: 'rough.jpg' }), credit: ['Dry Ground Rocks', 'Poly Haven', 'https://polyhaven.com/a/dry_ground_rocks', L.cc0, DAGGIE] },
  { id: 'mud', files: T(`${SRC.moto}/textures/terrain`, 'aerial_mud_1_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Aerial Mud 1', 'Poly Haven', 'https://polyhaven.com/a/aerial_mud_1', L.cc0, MOTO] },
  { id: 'mud_dry', files: T(`${SRC.moto}/textures/terrain`, 'brown_mud_dry_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Brown Mud Dry', 'Poly Haven', 'https://polyhaven.com/a/brown_mud_dry', L.cc0, MOTO] },
  { id: 'dirt_red', files: T(`${SRC.moto}/textures/terrain`, 'red_dirt_mud_01_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Red Dirt Mud 01', 'Poly Haven', 'https://polyhaven.com/a/red_dirt_mud_01', L.cc0, MOTO] },
  { id: 'rocky', files: T(`${SRC.moto}/textures/terrain`, 'rocky_terrain_02_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Rocky Terrain 02', 'Poly Haven', 'https://polyhaven.com/a/rocky_terrain_02', L.cc0, MOTO] },
  { id: 'grass_sparse', files: T(`${SRC.moto}/textures/terrain`, 'sparse_grass_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Sparse Grass', 'Amal Kumar (Poly Haven)', 'https://polyhaven.com/a/sparse_grass', L.cc0, MOTO] },
  { id: 'gravel_sand', files: T(`${SRC.moto}/textures/terrain`, 'gravelly_sand_', { c: 'diff.jpg', n: 'nor.jpg' }), credit: ['Gravelly Sand', 'Dario Barresi (Poly Haven)', 'https://polyhaven.com/a/gravelly_sand', L.cc0, MOTO] },
  { id: 'painted_plaster', files: T(SRC.oyl, 'PaintedPlaster017_', { c: 'diff_1k.ktx2', n: 'nor_gl_1k.ktx2' }), credit: ['PaintedPlaster017', 'ambientCG', 'https://ambientcg.com/view?id=PaintedPlaster017', L.cc0, OYL] },
  { id: 'concrete_048', files: T(SRC.oyl, 'Concrete048_', { c: 'diff_1k.ktx2', n: 'nor_gl_1k.ktx2' }), credit: ['Concrete048', 'ambientCG', 'https://ambientcg.com/view?id=Concrete048', L.cc0, OYL] },
  { id: 'gravel', files: T(SRC.oyl, 'Gravel035_', { c: 'diff_1k.ktx2', n: 'nor_gl_1k.ktx2' }), credit: ['Gravel035', 'ambientCG', 'https://ambientcg.com/view?id=Gravel035', L.cc0, OYL] },
  { id: 'paving', files: T(SRC.oyl, 'PavingStones136_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['PavingStones136', 'ambientCG', 'https://ambientcg.com/view?id=PavingStones136', L.cc0, OYL] },
  { id: 'rock_face', files: T(SRC.oyl, 'Rock026_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Rock026', 'ambientCG', 'https://ambientcg.com/view?id=Rock026', L.cc0, OYL] },
  { id: 'brick_wall', files: T(SRC.oyl, 'brick_wall_02_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Brick Wall 02', 'Dimitrios Savva (Poly Haven)', 'https://polyhaven.com/a/brick_wall_02', L.cc0, OYL] },
  { id: 'corrugated', files: T(SRC.oyl, 'corrugated_iron_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Corrugated Iron', 'Jenelle van Heerden, Dimitrios Savva (Poly Haven)', 'https://polyhaven.com/a/corrugated_iron', L.cc0, OYL] },
  { id: 'dark_planks', files: T(SRC.oyl, 'dark_planks_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Dark Planks', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/dark_planks', L.cc0, OYL] },
  { id: 'forest_floor', files: T(SRC.oyl, 'forest_leaves_02_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Forest Leaves 02', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/forest_leaves_02', L.cc0, OYL] },
  { id: 'rocks_ground', files: T(SRC.oyl, 'rocks_ground_05_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Rocks Ground 05', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/rocks_ground_05', L.cc0, OYL] },
  { id: 'old_stone', files: T(SRC.oyl, 'old_stone_wall_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Old Stone Wall', 'Charlotte Baglioni (Poly Haven)', 'https://polyhaven.com/a/old_stone_wall', L.cc0, OYL] },
  { id: 'grass_ktx', files: T(SRC.oyl, 'sparse_grass_', { c: 'diff_1k.ktx2', n: 'nor_gl_1k.ktx2' }), credit: ['Sparse Grass', 'Amal Kumar (Poly Haven)', 'https://polyhaven.com/a/sparse_grass', L.cc0, OYL] },
  { id: 'roof_tiles', files: T(SRC.oyl, 'grey_roof_tiles_02_', { c: 'diff_512.ktx2', n: 'nor_gl_512.ktx2' }), credit: ['Grey Roof Tiles 02', 'Rob Tuytel (Poly Haven)', 'https://polyhaven.com/a/grey_roof_tiles_02', L.cc0, OYL] },
  { id: 'bark_oak', files: T(`${SRC.eztree}/bark`, 'oak_', { c: 'color_1k.jpg', n: 'normal_1k.jpg', r: 'roughness_1k.jpg' }), credit: ['Bark Brown 02', 'Poly Haven', 'https://polyhaven.com/a/bark_brown_02', L.cc0, 'npm @dgreenheck/ez-tree (MIT)'] },
  { id: 'bark_pine', files: T(`${SRC.eztree}/bark`, 'pine_', { c: 'color_1k.jpg', n: 'normal_1k.jpg', r: 'roughness_1k.jpg' }), credit: ['Pine bark', 'TextureCan', 'https://www.texturecan.com/details/588/', L.cc0, 'npm @dgreenheck/ez-tree (MIT)'] },
];

// ---------------------------------------------------------------- environment maps
const ENVS = [
  { id: 'hangar', src: `${SRC.daggie}/env/hall_1k.hdr`, credit: ['Hangar Interior', 'Poly Haven', 'https://polyhaven.com/a/hangar_interior', L.cc0, DAGGIE] },
  { id: 'quarry', src: `${SRC.daggie}/env/quarry_1k.hdr`, credit: ['Quarry 01', 'Poly Haven', 'https://polyhaven.com/a/quarry_01', L.cc0, DAGGIE] },
  { id: 'night_city', src: `${SRC.daggie}/env/night_1k.hdr`, credit: ['Shanghai Bund', 'Poly Haven', 'https://polyhaven.com/a/shanghai_bund', L.cc0, DAGGIE] },
  { id: 'farm', src: `${SRC.oyl}/farm_field_2k.hdr`, credit: ['Farm Field', 'Dimitrios Savva, Jarod Guest (Poly Haven)', 'https://polyhaven.com/a/farm_field', L.cc0, OYL] },
  { id: 'sunset', src: `${SRC.daggie}/venice_sunset_1k.hdr`, credit: ['Venice Sunset', 'Greg Zaal (Poly Haven)', 'https://polyhaven.com/a/venice_sunset', L.cc0, DAGGIE] },
];

// ---------------------------------------------------------------- audio
const S = SRC.snd, D = `${SRC.daggie}/sfx`;
const range = (pre, n, pad = 2, from = 1, ext = '.ogg') => Array.from({ length: n }, (_, i) => `${pre}${String(i + from).padStart(pad, '0')}${ext}`);
const K = `${S}/kenney_impactsounds/Audio`;
const SOUNDS = {
  step_concrete: range(`${K}/footstep_concrete_`, 5, 3, 0),
  step_grass: range(`${K}/footstep_grass_`, 5, 3, 0),
  step_wood: range(`${K}/footstep_wood_`, 5, 3, 0),
  step_gravel: range(`${K}/footstep_snow_`, 5, 3, 0),
  step_carpet: range(`${K}/footstep_carpet_`, 5, 3, 0),
  step_metal: range(`${K}/impactMetal_light_`, 5, 3, 0),
  step_wet: range(`${S}/100-cc0-sfx-2/sfx100v2_footstep_wet_`, 3),
  step_mud: range(`${S}/25-CC0-mud-sfx/mud_`, 8),
  punch: range(`${K}/impactPunch_medium_`, 5, 3, 0),
  punch_heavy: range(`${K}/impactPunch_heavy_`, 5, 3, 0),
  hit_soft: range(`${K}/impactSoft_medium_`, 5, 3, 0),
  body_fall: [`${D}/thud1.mp3`, `${D}/thud2.mp3`, `${D}/thud3.mp3`],
  grunt: range(`${S}/80-CC0-creature-sfx-2/human_`, 8),
  whoosh: [`${D}/jump1.mp3`, `${D}/jump2.mp3`, `${D}/jump3.mp3`],
  whoosh_big: [`${D}/hdwhoosh2.mp3`, `${D}/hdwhoosh3.mp3`],
  door_open: [`${S}/100-CC0-wood-metal-SFX/metal_open_01.ogg`, `${S}/100-CC0-SFX/door_open.ogg`],
  door_close: [`${S}/100-CC0-wood-metal-SFX/metal_close_01.ogg`, ...range(`${S}/100-CC0-SFX/door_close_`, 4)],
  door_slam: [`${D}/vault1.mp3`, `${D}/vault2.mp3`, `${D}/vault3.mp3`],
  door_wood: range(`${S}/100-cc0-sfx-2/sfx100v2_door_`, 5),
  metal_slam: [`${S}/100-CC0-wood-metal-SFX/metal_slam_01.ogg`, ...range(`${S}/100-CC0-SFX/slam_`, 3)],
  creak: [`${D}/creak1.mp3`, `${D}/creak2.mp3`, `${D}/creak3.mp3`],
  keys: range(`${S}/100-CC0-wood-metal-SFX/keys_`, 7),
  lock_open: [`${S}/100-CC0-wood-metal-SFX/lock_open_01.ogg`, `${S}/100-cc0-sfx-2/sfx100v2_lock_open_01.ogg`, ...range(`${S}/100-CC0-SFX/key_open_`, 2)],
  tools: range(`${S}/100-CC0-wood-metal-SFX/tools_`, 12),
  metal_hit: [...range(`${S}/100-CC0-wood-metal-SFX/metal_hit_`, 5), `${D}/metal3.mp3`],
  metal_heavy: [`${D}/metal1.mp3`, `${D}/metal2.mp3`, ...range(`${K}/impactMetal_heavy_`, 3, 3, 0)],
  metal_sheet: range(`${S}/100-CC0-wood-metal-SFX/metal_sheet_`, 6),
  vent_crawl: range(`${K}/impactTin_medium_`, 5, 3, 0),
  metal_fall: range(`${S}/75-cc0-breaking-falling-hit-sfx/bfh1_metal_falling_`, 5),
  wood_hit: range(`${S}/100-CC0-wood-metal-SFX/wood_hit_`, 9),
  wood_break: [`${D}/wood1.mp3`, `${D}/wood2.mp3`, `${D}/wood3.mp3`],
  glass_break: [`${D}/glass1.mp3`, `${D}/glass2.mp3`, `${D}/glass3.mp3`],
  switch: [`${S}/100-CC0-SFX/switch_01.ogg`, `${S}/100-CC0-SFX/switch_02.ogg`, ...range(`${S}/100-cc0-sfx-2/sfx100v2_switch_`, 2)],
  paper: range(`${S}/100-CC0-SFX/paper_`, 4),
  dishes: range(`${S}/100-CC0-SFX/dishes_`, 4),
  toilet: [`${S}/100-CC0-SFX/toilet_01.ogg`, `${S}/100-CC0-SFX/toilet_02.ogg`],
  chain: range(`${S}/80-CC0-RPG-SFX/chain_`, 3),
  splash: [`${S}/100-CC0-SFX/splash_01.ogg`, `${S}/100-CC0-SFX/splash_02.ogg`],
  dog_bark: [`${S}/80-CC0-creature-SFX/barking_01.ogg`, `${S}/80-CC0-creature-SFX/barking_02.ogg`],
  thunder: [`${S}/100-cc0-sfx-2/sfx100v2_thunder_01.ogg`],
  bell: range(`${S}/100-CC0-SFX/bell_`, 3),
  gunshot: [`${S}/100-CC0-SFX/shot_01.ogg`, `${S}/100-CC0-SFX/shot_02.ogg`],
  car_crash: [`${D}/car1.mp3`, `${D}/car2.mp3`, `${D}/car3.mp3`],
  big_crash: [`${D}/truck1.mp3`, `${D}/truck2.mp3`, `${D}/truck3.mp3`],
  tire_hit: [`${D}/tires2.mp3`],
  land: [`${D}/land1.mp3`, `${D}/land2.mp3`],
  crowd_cheer: [`${D}/win1.mp3`, `${D}/win2.mp3`, `${D}/win3.mp3`],
  ui_tick: [`${D}/uitick1.mp3`, `${D}/uitick2.mp3`],
  ui_hit: [`${D}/uihit1.mp3`, `${D}/uihit2.mp3`, `${D}/uihit3.mp3`],
  ui_rise: [`${D}/uirise1.mp3`],
  sting: [`${D}/hdboom1.mp3`, `${D}/hdboom2.mp3`, `${D}/hdboom3.mp3`],
  alarm_loop: [`${S}/30-cc0-sfx-loops/alarm_01.ogg`],
  buzzer: [`${S}/30-cc0-sfx-loops/alarm_03.ogg`],
  rain_loop: [`${S}/40-cc0-water-splash-slime-sfx/loop_rain.ogg`],
  amb_hvac: [`${S}/bb - Fans and Drones (Jul 2021)/Air Vent.wav`],
  amb_fan: [`${S}/bb - Fans and Drones (Jul 2021)/Large Fan.wav`],
  amb_night: [`${S}/bb - Fans and Drones (Jul 2021)/Outside.wav`],
  amb_warehouse: [`${D}/amblab1.mp3`],
  amb_factory: [`${D}/amblab2.mp3`],
  amb_wind: [`${D}/hdwind1.mp3`, `${D}/ambsky2.mp3`],
  amb_road: [`${D}/road1.mp3`],
  amb_water: [`${S}/100-cc0-sfx-2/sfx100v2_loop_water_01.ogg`],
  engine_loop: [`${D}/hdengine1.mp3`],
  music_theme: [`${S}/Maximiliano-Stradex-Ambient/Theme_1.mp3`],
  music_explore: [`${S}/Maximiliano-Stradex-Ambient/Ambient_1.mp3`],
  music_sad: [`${S}/Maximiliano-Stradex-Ambient/Ambient_2.mp3`],
  music_tension: [`${S}/warfork-cc0/music/fvi-Chronos.ogg`],
  music_stealth: [`${S}/warfork-cc0/music/fvi-MeditatingBeat.ogg`],
  music_action: [`${S}/warfork-cc0/music/fvi-Fireworks.ogg`],
  music_chase: [`${S}/warfork-cc0/music/fvi-Goodnightmare.ogg`],
  music_night: [`${S}/warfork-cc0/music/fvi-3amWestEnd.ogg`],
};
const LOOPS = new Set(['rain_loop', 'amb_hvac', 'amb_fan', 'amb_night', 'amb_warehouse', 'amb_factory', 'amb_wind', 'amb_road', 'amb_water', 'engine_loop', 'alarm_loop']);
const SOUND_CREDITS = [
  ['Sound effects (footsteps, impacts, punches)', 'Kenney (kenney.nl), Impact Sounds', 'https://kenney.nl/assets/impact-sounds', L.cc0, SNDREPO],
  ['100 CC0 SFX, 100 CC0 SFX #2, 100 CC0 metal and wood SFX, 75 CC0 breaking/falling/hit SFX, 30 CC0 SFX loops', 'rubberduck (OpenGameArt)', 'https://opengameart.org/users/rubberduck', L.cc0, SNDREPO],
  ['80 CC0 creature SFX / RPG SFX, 25 CC0 mud SFX, 40 CC0 water SFX', 'rubberduck (OpenGameArt)', 'https://opengameart.org/users/rubberduck', L.cc0, SNDREPO],
  ['Fans and Drones (Jul 2021) — air vent, large fan, outside ambience', 'Bryan Bacorn (bb sample packs)', 'https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds', L.cc0, SNDREPO],
  ['Ambient music: Ambient 1, Ambient 2, Theme 1', 'Maximiliano Stradex', 'https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds', L.cc0, SNDREPO],
  ['Music: Chronos, Meditating Beat, Fireworks, Goodnightmare, 3am West End', 'Team Forbidden (Warfork)', 'https://github.com/Warfork/warfork-qfusion', L.cc0, SNDREPO],
  ['Metal door slams (vault1-3)', 'kyles, AudioPapkin, Sheyvan (Freesound)', 'https://freesound.org/people/kyles/sounds/406197/', L.cc0, DAGGIE],
  ['Metal creaks (creak1-3)', 'sophiehall3535, Crinkem, ingudios (Freesound)', 'https://freesound.org/people/sophiehall3535/sounds/245945/', L.cc0, DAGGIE],
  ['Body falls (thud1-3)', 'leonelmail, deleted_user_2104797, courtneyeck (Freesound)', 'https://freesound.org/people/leonelmail/sounds/504626/', L.cc0, DAGGIE],
  ['Glass, wood, metal impacts (glass1-3, wood1-3, metal1-3)', 'unfa, chewiesmissus, 221Beimesche, kevinkace, Deathscyp, egomassive, michorvath, wilhellboy, Rickplayer (Freesound)', 'https://freesound.org', L.cc0, DAGGIE],
  ['Car crashes (car1-3, truck1-3), tire hit (tires2), landing (land1-2)', 'squareal, magnuswaker, CogFireStudios, xkeril, craigsmith, qubodup, mmmtoop, Pól, sanlega (Freesound)', 'https://freesound.org', L.cc0, DAGGIE],
  ['Whooshes, UI ticks/hits, cinematic booms, crowd cheers, ambience loops', 'florianreichelt, PorkMuncher, ImATaco, Paul368, bolkmar, NenadSimic, Jofae, waveplaySFX, AudioPapkin, xkeril, magnuswaker, deleted_user_3277771, rhapsodize, qubodup, jayfrosting, misjoc, leonelmail, neilraouf, Elanor1995, priesjensen (Freesound)', 'https://freesound.org', L.cc0, DAGGIE],
  ['Wind loop (hdwind1), racing engine loop (hdengine1)', 'IgnasD, domasx2 (OpenGameArt)', 'https://opengameart.org/content/wind', L.cc0, DAGGIE],
];

// ---------------------------------------------------------------- helpers
const credits = [];
function addCredit([title, author, link, lic, via], files, kind) {
  credits.push({ kind, title, author, link, license: lic.license, licenseUrl: lic.url, via, files });
}

async function importModels(io) {
  fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
  const meta = {};
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  const prevMeta = fs.existsSync(path.join(OUT, 'models/models.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'models/models.json'), 'utf8')) : {};
  Object.assign(meta, prevMeta);
  for (const m of MODELS) {
    if (only && !only.has(m.id)) { if (prevMeta[m.id]) addCredit(m.credit, [prevMeta[m.id].file], 'model'); continue; }
    if (!fs.existsSync(m.src)) { console.warn('missing', m.src); continue; }
    const doc = await io.read(m.src);
    const root = doc.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    let b = getBounds(scene);
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    let s = 1;
    if (m.fit?.length) s = m.fit.length / Math.max(size[0], size[2]);
    if (m.fit?.height) s = m.fit.height / size[1];
    // Wrap in a node that scales and grounds the model.
    const wrap = doc.createNode(m.id).setScale([s, s, s]).setTranslation([-(b.min[0] + b.max[0]) / 2 * s, -b.min[1] * s, -(b.min[2] + b.max[2]) / 2 * s]);
    for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
    scene.addChild(wrap);
    for (const a of root.listAnimations()) a.dispose();
    const tf = [dedup(), weld()];
    if (m.simplify) tf.push(simplify({ simplifier: MeshoptSimplifier, ratio: m.simplify, error: 0.002 }));
    if (!m.ktx2) tf.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
    tf.push(prune({ keepLeaves: !!m.keepNodes }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await doc.transform(...tf);
    const file = `models/${m.id}.glb`;
    await io.write(path.join(OUT, file), doc);
    b = getBounds(doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]);
    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    meta[m.id] = { file, size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)), tris: Math.round(tris), kb: Math.round(fs.statSync(path.join(OUT, file)).size / 1024) };
    console.log('model', m.id, meta[m.id]);
    addCredit(m.credit, [file], 'model');
  }
  fs.writeFileSync(path.join(OUT, 'models/models.json'), JSON.stringify(meta, null, 1));
}

function importTextures() {
  fs.mkdirSync(path.join(OUT, 'tex'), { recursive: true });
  const meta = {};
  for (const t of TEXTURES) {
    const out = {};
    for (const [k, src] of Object.entries(t.files)) {
      if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
      const ext = path.extname(src);
      const file = `tex/${t.id}_${k}${ext}`;
      fs.copyFileSync(src, path.join(OUT, file));
      out[k] = file;
    }
    meta[t.id] = out;
    addCredit(t.credit, Object.values(out), 'texture');
  }
  fs.writeFileSync(path.join(OUT, 'tex/textures.json'), JSON.stringify(meta, null, 1));
  console.log('textures', Object.keys(meta).length);
}

function importEnv() {
  fs.mkdirSync(path.join(OUT, 'env'), { recursive: true });
  for (const e of ENVS) {
    const file = `env/${e.id}${path.extname(e.src)}`;
    fs.copyFileSync(e.src, path.join(OUT, file));
    addCredit(e.credit, [file], 'hdri');
  }
}

function importAudio() {
  fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });
  const bank = {};
  for (const [name, files] of Object.entries(SOUNDS)) {
    bank[name] = [];
    files.forEach((src, i) => {
      if (!fs.existsSync(src)) { console.warn('missing', src); return; }
      const music = name.startsWith('music_');
      const stereo = music || name.startsWith('amb_') || name === 'rain_loop';
      const out = `${name}${files.length > 1 ? '_' + (i + 1) : ''}.mp3`;
      const args = ['-v', 'error', '-y', '-i', src];
      if (!LOOPS.has(name) && !music) args.push('-af', 'silenceremove=start_periods=1:start_threshold=-55dB,loudnorm=I=-18:TP=-2');
      else if (!music) args.push('-af', 'loudnorm=I=-22:TP=-3');
      if (name.startsWith('amb_') && !name.includes('wind')) args.push('-t', '40');
      args.push('-ac', stereo ? '2' : '1', '-ar', '44100', '-b:a', music ? '128k' : stereo ? '112k' : '80k', path.join(OUT, 'audio', out));
      execFileSync('ffmpeg', args);
      bank[name].push(out);
    });
  }
  fs.writeFileSync(path.join(OUT, 'audio/bank.json'), JSON.stringify(bank, null, 1));
  for (const c of SOUND_CREDITS) addCredit(c, [], 'audio');
  console.log('audio', Object.keys(bank).length, 'groups');
}

function writeCredits() {
  const prev = fs.existsSync(path.join(OUT, 'credits.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'credits.json'), 'utf8')) : [];
  const kinds = new Set(credits.map((c) => c.kind));
  const merged = [...prev.filter((c) => !kinds.has(c.kind)), ...credits];
  fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(merged, null, 1));
}

async function main() {
  const want = new Set(process.argv.slice(2));
  const all = want.size === 0;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  if (all || want.has('textures')) importTextures();
  if (all || want.has('env')) importEnv();
  if (all || want.has('audio')) importAudio();
  if (all || want.has('models')) await importModels(io);
  writeCredits();
}
main().catch((e) => { console.error(e); process.exit(1); });
void flatten;
