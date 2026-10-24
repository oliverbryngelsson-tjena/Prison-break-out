// Rocketbox character pipeline: FBX -> optimized GLB with PBR materials.
//
// Usage: node tools/build-characters.mjs [id ...]
// Requires: Rocketbox repo at $ROCKETBOX (default /home/user/microsoft/microsoft-rocketbox)
//           FBX2glTF binary at $FBX2GLTF (the npm package `fbx2gltf` ships one)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CAST } from './cast.mjs';

const ROCKETBOX = process.env.ROCKETBOX || '/home/user/microsoft/microsoft-rocketbox';
const FBX2GLTF = process.env.FBX2GLTF || findFbx2gltf();
const OUT = path.resolve('public/assets/characters');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chars-'));

function findFbx2gltf() {
  const cands = [
    'node_modules/fbx2gltf/bin/Linux/FBX2glTF',
    path.join(os.tmpdir(), 'FBX2glTF'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('FBX2glTF binary not found; set FBX2GLTF=/path/to/FBX2glTF');
}

// Mask categories written into the UV mask image.
const CAT = { clothes: 1, hands: 2, shoes: 3, neck: 4 };
function classifyJoint(name) {
  if (/Hand|Finger/.test(name)) return CAT.hands;
  if (/Foot|Toe/.test(name)) return CAT.shoes;
  if (/Head|Neck|Jaw|Eye|Mouth|Lip|Cheek|Nose|Brow|Tongue|Caninus|Masseter/.test(name)) return CAT.neck;
  return CAT.clothes;
}

function rasterMask(prim, joints, size) {
  const mask = new Uint8Array(size * size);
  const uv = prim.getAttribute('TEXCOORD_0');
  const j0 = prim.getAttribute('JOINTS_0');
  const w0 = prim.getAttribute('WEIGHTS_0');
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : uv.getCount();
  const a = [0, 0], b = [0, 0], c = [0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
  for (let t = 0; t < n; t += 3) {
    const vi = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
    const score = new Map();
    for (const v of vi) {
      j0.getElement(v, jj); w0.getElement(v, ww);
      for (let k = 0; k < 4; k++) score.set(jj[k], (score.get(jj[k]) || 0) + ww[k]);
    }
    let best = -1, bw = -1;
    for (const [j, w] of score) if (w > bw) { bw = w; best = j; }
    const cat = classifyJoint(joints[best]?.getName() || '');
    uv.getElement(vi[0], a); uv.getElement(vi[1], b); uv.getElement(vi[2], c);
    fillTri(mask, size, a, b, c, cat);
  }
  // Dilate so that texels just outside UV islands get a category too.
  for (let it = 0; it < 6; it++) {
    const copy = mask.slice();
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (copy[i]) continue;
      const v = copy[i - 1] || copy[i + 1] || copy[i - size] || copy[i + size];
      if (v) mask[i] = v;
    }
  }
  return mask;
}

function fillTri(mask, size, a, b, c, val) {
  const P = [a, b, c].map((p) => [p[0] * size, p[1] * size]);
  const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
  const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
    const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 >= -0.01 && w1 >= -0.01 && w2 >= -0.01) mask[y * size + x] = val;
  }
}

function texFile(dir, matName, suffix) {
  const f = path.join(dir, 'Textures', `${matName}_${suffix}.tga`);
  return fs.existsSync(f) ? f : null;
}

async function encode(pngPath, { size, quality = 82, alpha = false }) {
  let img = sharp(pngPath);
  if (size) img = img.resize(size, size);
  return img.webp({ quality, alphaQuality: alpha ? 90 : 100, effort: 5 }).toBuffer();
}

async function buildOne(entry, io) {
  const dir = path.join(ROCKETBOX, 'Assets', entry.src);
  const name = path.basename(entry.src);
  const fbx = path.join(dir, 'Export', `${name}.fbx`);
  const raw = path.join(TMP, `${entry.id}_raw`);
  execFileSync(FBX2GLTF, ['-b', '-i', fbx, '-o', raw], { stdio: 'pipe' });
  const doc = await io.read(raw + '.glb');
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const root = doc.getRoot();

  // Remove helper nodes that are not part of the skin.
  for (const n of root.listNodes()) if (n.getName() === 'Bip01 Footsteps') n.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const a of root.listAnimations()) a.dispose();

  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const mesh = root.listMeshes()[0];
  const size = entry.tex || 1024;
  const maskSize = 1024;
  const jobs = [];
  const matInfo = [];
  let bodyMask = null;

  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const mname = mat.getName();
    const isOpacity = /opacity/.test(mname);
    const isBody = /_body$/.test(mname);
    const info = { mat, mname, isOpacity, isBody, files: {} };
    if (isBody && entry.variants) {
      const mask = rasterMask(prim, joints, maskSize);
      bodyMask = path.join(TMP, `${entry.id}_mask.png`);
      await sharp(Buffer.from(mask), { raw: { width: maskSize, height: maskSize, channels: 1 } }).png().toFile(bodyMask);
      if (process.env.DEBUG_MASK) {
        const vis = Buffer.from(mask.map((v) => v * 60));
        await sharp(vis, { raw: { width: maskSize, height: maskSize, channels: 1 } }).png().toFile(path.join(OUT, `${entry.id}_mask_debug.png`));
      }
    }
    if (isOpacity) {
      const src = texFile(dir, mname, 'color');
      if (src) { info.files.color = path.join(TMP, `${entry.id}_${mname}_c.png`); jobs.push({ kind: 'rgba', src, out: info.files.color, size }); }
    } else {
      const c = texFile(dir, mname, 'color');
      const nrm = texFile(dir, mname, 'normal');
      const sp = texFile(dir, mname, 'specular');
      const head = texFile(dir, mname.replace(/_[a-z]+$/, '_head'), 'color');
      const tsize = isBody || /head/.test(mname) ? size : Math.min(size, 512);
      if (c) {
        if (isBody && entry.variants) {
          for (const [vname, v] of Object.entries(entry.variants)) {
            const out = path.join(TMP, `${entry.id}_${vname}_body.png`);
            const job = { kind: 'color', src: c, out, size: tsize };
            if (v) {
              const rules = {};
              if (v.clothes) rules[CAT.clothes] = { mode: 'tint', color: v.clothes, contrast: v.contrast ?? 0.9, keep: v.keep ?? 0.06 };
              if (v.hands) rules[CAT.hands] = v.hands === 'SKIN' ? { mode: 'skin', color: 'SKIN' } : { mode: 'tint', color: v.hands };
              if (v.shoes) rules[CAT.shoes] = { mode: 'tint', color: v.shoes, contrast: 1.0 };
              job.recolor = { mask: bodyMask, head, rules, keys: v.keys, protectSkin: v.protectSkin !== false };
            }
            jobs.push(job);
            info.files[`variant_${vname}`] = out;
          }
        } else {
          info.files.color = path.join(TMP, `${entry.id}_${mname}_c.png`);
          jobs.push({ kind: 'color', src: c, out: info.files.color, size: tsize });
        }
      }
      if (nrm) {
        info.files.normal = path.join(TMP, `${entry.id}_${mname}_n.png`);
        const job = { kind: 'normal', src: nrm, out: info.files.normal, size: tsize, flipGreen: !!entry.flipGreen };
        const defV = entry.variants?.[entry.default];
        if (isBody && defV?.hands === 'SKIN') job.flattenMask = { mask: bodyMask, value: CAT.hands };
        jobs.push(job);
      }
      if (sp) {
        info.files.rough = path.join(TMP, `${entry.id}_${mname}_r.png`);
        jobs.push({ kind: 'rough', src: sp, out: info.files.rough, size: Math.min(tsize, 512), range: /head/.test(mname) ? [0.42, 0.75] : [0.45, 0.95] });
      }
    }
    matInfo.push(info);
  }

  execFileSync('python3', ['-I', path.resolve('tools/tex.py')], { input: JSON.stringify(jobs), stdio: ['pipe', 'pipe', 'inherit'] });

  const manifest = { file: `${entry.id}.glb`, sex: entry.sex, role: entry.role, variants: {} };
  for (const info of matInfo) {
    const { mat, files } = info;
    mat.setMetallicFactor(0).setRoughnessFactor(1);
    const colorFile = files.color || files[`variant_${entry.default}`];
    if (colorFile) {
      const t = doc.createTexture(`${info.mname}_color`).setMimeType('image/webp').setImage(await encode(colorFile, { alpha: info.isOpacity, quality: info.isOpacity ? 85 : 82 }));
      mat.setBaseColorTexture(t);
    }
    if (files.normal) {
      const t = doc.createTexture(`${info.mname}_normal`).setMimeType('image/webp').setImage(await encode(files.normal, { quality: 90 }));
      mat.setNormalTexture(t);
    }
    if (files.rough) {
      const t = doc.createTexture(`${info.mname}_rough`).setMimeType('image/webp').setImage(await encode(files.rough, { quality: 80 }));
      mat.setMetallicRoughnessTexture(t);
    } else if (!info.isOpacity) {
      mat.setRoughnessFactor(0.75);
    }
    if (info.isOpacity) {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.35).setDoubleSided(true).setRoughnessFactor(0.65);
    }
    if (info.isBody && entry.variants) {
      for (const vname of Object.keys(entry.variants)) {
        if (vname === entry.default) continue;
        const fname = `${entry.id}_${vname}_body.webp`;
        fs.writeFileSync(path.join(OUT, fname), await encode(files[`variant_${vname}`], { quality: 82 }));
        manifest.variants[vname] = { material: info.mname, map: fname };
      }
      manifest.variants[entry.default] = { material: info.mname, map: null };
      manifest.defaultVariant = entry.default;
    }
  }

  // Measure rest height and hip height for animation retargeting.
  const bip = root.listNodes().find((n) => n.getName() === 'Bip01');
  manifest.hipY = bip ? bip.getTranslation()[1] : 0.9;
  const pos = mesh.listPrimitives()[0].getAttribute('POSITION');
  let maxZ = -Infinity;
  for (const p of mesh.listPrimitives()) {
    const pa = p.getAttribute('POSITION'); const v = [0, 0, 0];
    for (let i = 0; i < pa.getCount(); i++) { pa.getElement(i, v); maxZ = Math.max(maxZ, v[2]); }
  }
  manifest.height = +maxZ.toFixed(3); // mesh is Z-up inside a -90deg X node
  void pos;

  await doc.transform(weld(), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path.join(OUT, `${entry.id}.glb`), doc);
  return manifest;
}

async function main() {
  await MeshoptEncoder.ready;
  fs.mkdirSync(OUT, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const want = process.argv.slice(2);
  const manifestPath = path.join(OUT, 'manifest.json');
  const all = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  for (const entry of CAST) {
    if (want.length && !want.includes(entry.id)) continue;
    process.stdout.write(`building ${entry.id} (${entry.src}) ... `);
    all[entry.id] = await buildOne(entry, io);
    const kb = (fs.statSync(path.join(OUT, `${entry.id}.glb`)).size / 1024).toFixed(0);
    console.log(`${kb} KB`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(all, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
