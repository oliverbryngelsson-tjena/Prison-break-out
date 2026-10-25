// Weapon models: "Free CC0 Guns & Explosives Pack" by 3dmodelscc0 (CC0 1.0).
// Source: FBX + base-colour maps from github.com/Paumen/lp-sources (repacked copy of the itch.io pack,
// kits/sources/Guns_Explosives_Pack_3dmodelscc0). Convert each FBX with FBX2glTF first:
//   FBX2glTF --binary --input AK47.fbx --output $GUNS_GLB/AK47
// then run:  GUNS_GLB=... GUNS_TEX=<dir with the pack's folders> node tools/import-weapons.mjs
//
// Output: public/assets/models/weapon_<id>.glb, normalised so the rear of the gun is at the origin,
// the barrel points along +Z and y = 0 is the bore line. Real-world size is kept.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const GLB = process.env.GUNS_GLB;
const TEX = process.env.GUNS_TEX;
if (!GLB || !TEX) throw new Error('set GUNS_GLB and GUNS_TEX');
const OUT = path.resolve('public/assets/models');

// file: converted GLB name; tex: base colour map; drop: loose parts to remove (pistol magazines are
// stored outside the grip in the source); bore: bore height as a fraction of the gun's height from the top.
const GUNS = [
  { id: 'ak47', file: 'AK47', tex: 'AK-47/AK47_Base_Color.png', title: 'AK-47', bore: 0.2 },
  { id: 'm4', file: 'M4A1', tex: 'M4A1/M4A1_Base_Color.png', title: 'M4A1', bore: 0.28 },
  { id: 'sniper', file: 'Sniper', tex: 'Sniper/Sniper_Base_Color.png', title: 'Sniper', bore: 0.36 },
  { id: 'shotgun', file: 'Shotgun', tex: 'Shotgun/Shotgun_Base_Color.png', title: 'Shotgun', bore: 0.12 },
  { id: 'pistol', file: 'Makarov', tex: 'Pistol_MK/Makarov_Base_Color.png', title: 'Makarov', drop: ['Magazine'], bore: 0.12 },
  { id: 'smg', file: 'Grease_Gun', tex: 'GreaseGun/Grease_Gun_Base_Color.png', title: 'Grease Gun', bore: 0.12 },
  { id: 'suomi', file: 'Suomi_KP', tex: 'Suomi_KP/Suomi_KP_Base_Color.png', title: 'Suomi KP', bore: 0.12 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'models.json'), 'utf8'));
const creditsPath = path.resolve('public/assets/credits.json');
const credits = JSON.parse(fs.readFileSync(creditsPath, 'utf8')).filter((c) => !(c.files ?? []).some((f) => f.startsWith('models/weapon_')));

for (const gun of GUNS) {
  const doc = await io.read(path.join(GLB, `${gun.file}.glb`));
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  // Remove parts that aren't assembled in the source.
  for (const n of root.listNodes()) if (gun.drop?.includes(n.getName())) n.dispose();
  // One base colour map for every material (the FBX export lost most of them).
  const png = fs.readFileSync(path.join(TEX, gun.tex));
  const img = await sharp(png).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
  const tex = doc.createTexture(gun.id).setImage(img).setMimeType('image/png');
  for (const t of root.listTextures()) if (t !== tex) t.dispose();
  for (const m of root.listMaterials()) {
    m.setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0.55).setRoughnessFactor(0.48).setAlphaMode('OPAQUE');
  }
  // Wrap everything in one node: turn the barrel to +Z, rear at z = 0, bore at y = 0, centred in x.
  const pivot = doc.createNode('weapon');
  for (const n of [...scene.listChildren()]) { scene.removeChild(n); pivot.addChild(n); }
  scene.addChild(pivot);
  pivot.setRotation([0, 1, 0, 0]); // 180° about Y: the source barrels point down -Z
  const b = getBounds(scene);
  const h = b.max[1] - b.min[1];
  pivot.setTranslation([-(b.min[0] + b.max[0]) / 2, -(b.max[1] - h * gun.bore), -b.min[2]]);
  await doc.transform(dedup(), prune(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `weapon_${gun.id}.glb`);
  await io.write(out, doc);
  const nb = getBounds(doc.getRoot().listScenes()[0]);
  const size = nb.max.map((v, i) => +(v - nb.min[i]).toFixed(3));
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const kb = Math.round(fs.statSync(out).size / 1024);
  meta[`weapon_${gun.id}`] = { file: `models/weapon_${gun.id}.glb`, size, tris, kb };
  credits.push({
    kind: 'model', title: gun.title, author: '3dmodelscc0', link: 'https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack',
    license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    via: 'github.com/Paumen/lp-sources (repacked copy)', files: [`models/weapon_${gun.id}.glb`],
  });
  console.log(gun.id, size, `${tris} tris`, `${kb} KB`);
}
fs.writeFileSync(path.join(OUT, 'models.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(creditsPath, JSON.stringify(credits, null, 1));
