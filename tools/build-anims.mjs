// Builds animation libraries (one GLB per skeleton sex) from Rocketbox animation FBX files.
// Every clip keeps only bone rotations + the root (Bip01) translation, so it can drive
// any Rocketbox avatar regardless of its proportions. Locomotion root motion is removed
// (in-place) and the original travel speed is stored in clips.json for foot-sync.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROCKETBOX = process.env.ROCKETBOX || '/home/user/microsoft/microsoft-rocketbox';
const FBX2GLTF = process.env.FBX2GLTF || 'node_modules/fbx2gltf/bin/Linux/FBX2glTF';
const OUT = path.resolve('public/assets/anims');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anims-'));
const ST = 'all_animations_max_motextr_static', XY = 'all_animations_max_motextr_xy', XYZ = 'all_animations_max_motextr_xyz';

const MALE = {
  walk: [XY, 'm_walk_neutral_01'], walk2: [XY, 'm_walk_neutral_02'], walk_slow: [XY, 'm_walk_slow_01'],
  walk_fast: [XY, 'm_walk_fast_01'], walk_cool: [XY, 'm_walk_cool_01'], walk_injured: [XY, 'm_walk_bruised'],
  run: [XY, 'm_run_neutral_01'], run_fast: [XY, 'm_run_fast_01'], run_slow: [XY, 'm_run_slow_01'], run_injured: [XY, 'm_run_injured'],
  crouch_in: [XY, 'm_crouch_in', { loop: false }], crouch_out: [XY, 'm_crouch_out', { loop: false }],
  crouch_idle: [ST, 'm_crouch_idle'], crouch_gestic: [ST, 'm_crouch_gestic'],
  idle: [ST, 'm_idle_neutral_01'], idle2: [ST, 'm_idle_neutral_02'], idle3: [ST, 'm_idle_neutral_03'],
  idle_angry: [ST, 'm_idle_angry_01'], idle_angry2: [ST, 'm_idle_angry_02'], idle_nervous: [ST, 'm_idle_nervous_01'],
  idle_look: [ST, 'm_idle_look_around_01'], idle_look2: [ST, 'm_idle_look_around_02'], idle_breathe: [ST, 'm_idle_breathe_01'],
  idle_wait: [ST, 'm_idle_waiting_01'], idle_scratch: [ST, 'm_idle_scratch_head_01'], idle_stretch: [ST, 'm_idle_stretch_arms_01'],
  idle_shake: [ST, 'm_idle_shake_arms_01'], idle_dust: [ST, 'm_idle_dust_01'], idle_yawn: [ST, 'm_idle_yawn_01'],
  talk: [ST, 'm_gestic_talk_neutral_01'], talk2: [ST, 'm_gestic_talk_neutral_02'], talk_angry: [XYZ, 'm_gestic_talk_angry_01'],
  talk_angry2: [XYZ, 'm_gestic_talk_angry_02'], talk_excited: [ST, 'm_gestic_talk_excited_01'], talk_nervous: [ST, 'm_gestic_talk_nervous_01'],
  talk_sad: [ST, 'm_gestic_talk_sad_01'], talk_cool: [ST, 'm_gestic_talk_cool'], talk_relaxed: [ST, 'm_gestic_talk_relaxed_01'],
  talk_assured: [XYZ, 'm_gestic_talk_self_assured_01'],
  listen: [ST, 'm_gestic_listen_neutral_01'], listen_angry: [ST, 'm_gestic_listen_angry_01'], listen_sad: [ST, 'm_gestic_listen_sad_01'],
  listen_nervous: [ST, 'm_gestic_listen_nervous_01'], deny: [ST, 'm_gestic_listen_deny_01'], accept: [ST, 'm_gestic_listen_accept_01'],
  shrug: [ST, 'm_gestic_shrug_01'], thoughtful: [ST, 'm_gestic_thoughtful_01'], laugh: [ST, 'm_gestic_laugh_low'], laugh_loud: [ST, 'm_gestic_laugh_loud'],
  knock_door: [ST, 'm_knock_door'], listen_door: [ST, 'm_listen_door'], try_door: [ST, 'm_try_door_inwards'],
  docs_check: [ST, 'm_documents_check'], docs_idle: [ST, 'm_documents_idle'],
  phone_talk: [ST, 'm_cell_phone_talk_01'], phone_listen: [ST, 'm_cell_phone_listen_01'], phone_text: [ST, 'm_cell_phone_textmessage'],
  drink: [ST, 'm_drink_drinking'], sit_chair: [ST, 'm_sit_chair_idle_neutral_01'], sit_chair_nervous: [ST, 'm_sit_chair_idle_nervous_01'],
  sit_table: [ST, 'm_sit_table_idle_neutral_01'], sit_table_relaxed: [ST, 'm_sit_table_idle_relaxed_01'],
  work_table: [ST, 'm_work_table'], work_mid: [ST, 'm_work_mid'], trolley: [ST, 'm_trolley_idle'],
  cheer: [ST, 'm_cheer_01'], clap: [ST, 'm_claphands_01'], hold_bag: [ST, 'm_hold_bag_idle'], newspaper: [ST, 'm_newspaper_hand_idle'],
  headphones: [ST, 'm_headphones_idle'], wave: [ST, 'm_wave_01'],
  turn_left: [XYZ, 'm_turn_left_90', { loop: false, keepRoot: true }], turn_right: [XYZ, 'm_turn_right_90', { loop: false, keepRoot: true }],
};
const FEMALE = {
  idle: [ST, 'f_idle_neutral_01'], idle_nervous: [ST, 'f_idle_nervous_01'], walk: [XY, 'f_walk_neutral_01'], run: [XY, 'f_run_neutral_01'],
  talk: [ST, 'f_gestic_talk_neutral_01'], talk_angry: [ST, 'f_gestic_talk_angry_01'], talk_sad: [ST, 'f_gestic_talk_sad_01'],
  listen: [ST, 'f_gestic_listen_neutral_01'], phone_talk: [ST, 'f_cell_phone_talk_01'],
};

const FACE = /MJaw|Eye|Mouth|Lip|Cheek|Nose|Brow|Tongue|Caninus|Masseter|Footsteps/;

function findFbx(folder, name) {
  for (const f of [folder, ST, XY, XYZ]) {
    const p = path.join(ROCKETBOX, 'Assets/Animations', f, `${name}.max.fbx`);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('missing ' + name);
}

async function buildLibrary(set, outName, io) {
  let target = null;
  const nodeByName = new Map();
  const info = {};
  for (const [clip, [folder, file, opts = {}]] of Object.entries(set)) {
    const fbx = findFbx(folder, file);
    const raw = path.join(TMP, `${outName}_${clip}`);
    execFileSync(FBX2GLTF, ['-b', '--anim-framerate', 'bake30', '-i', fbx, '-o', raw], { stdio: 'pipe' });
    const src = await io.read(raw + '.glb');
    if (!target) {
      target = src;
      for (const m of target.getRoot().listMeshes()) m.dispose();
      for (const n of target.getRoot().listNodes()) nodeByName.set(n.getName(), n);
    }
    const anim = src.getRoot().listAnimations()[0];
    if (!anim) { console.warn('no anim in', file); continue; }
    const out = target.createAnimation(clip);
    // Gather channels first so the clip can be trimmed to a clean loop.
    const chans = [];
    let times = null, duration = 0, speed = 0;
    for (const ch of anim.listChannels()) {
      const nodeName = ch.getTargetNode().getName();
      const p = ch.getTargetPath();
      if (FACE.test(nodeName) || p === 'scale' || p === 'weights') continue;
      if (p === 'translation' && nodeName !== 'Bip01') continue;
      const tnode = nodeByName.get(nodeName);
      if (!tnode) continue;
      const s = ch.getSampler();
      if (!times) times = Array.from(s.getInput().getArray());
      const arr = Array.from(s.getOutput().getArray());
      if (p === 'rotation') {
        for (let i = 4; i < arr.length; i += 4) {
          const d = arr[i] * arr[i - 4] + arr[i + 1] * arr[i - 3] + arr[i + 2] * arr[i - 2] + arr[i + 3] * arr[i - 1];
          if (d < 0) for (let k = 0; k < 4; k++) arr[i + k] = -arr[i + k];
        }
      }
      chans.push({ tnode, p, arr, size: p === 'rotation' ? 4 : 3 });
    }
    let nFrames = times.length;
    const loop = opts.loop !== false;
    const locomotion = folder === XY && loop;
    // Trim long looping clips to the frame (7..11 s) whose pose best matches frame 0.
    if (loop && !locomotion && times[nFrames - 1] > 11) {
      let best = nFrames - 1, bestD = Infinity;
      for (let f = 0; f < nFrames; f++) {
        if (times[f] < 7 || times[f] > 11) continue;
        let d = 0;
        for (const c of chans) {
          if (c.p !== 'rotation') { d += Math.hypot(c.arr[f * 3] - c.arr[0], c.arr[f * 3 + 1] - c.arr[1], c.arr[f * 3 + 2] - c.arr[2]) * 4; continue; }
          const dot = Math.abs(c.arr[f * 4] * c.arr[0] + c.arr[f * 4 + 1] * c.arr[1] + c.arr[f * 4 + 2] * c.arr[2] + c.arr[f * 4 + 3] * c.arr[3]);
          d += 1 - Math.min(1, dot);
        }
        if (d < bestD) { bestD = d; best = f; }
      }
      nFrames = best + 1;
    }
    duration = times[nFrames - 1];
    // Idle/gesture clips are smooth mocap: 15 fps is enough. Locomotion keeps 30 fps.
    const step = locomotion || !loop ? 1 : 2;
    const frames = [];
    for (let f = 0; f < nFrames; f += step) frames.push(f);
    if (frames[frames.length - 1] !== nFrames - 1) frames.push(nFrames - 1);
    const inputArr = new Float32Array(frames.map((f) => times[f] - times[0]));
    const input = target.createAccessor().setType('SCALAR').setArray(inputArr);
    const staticInput = target.createAccessor().setType('SCALAR').setArray(new Float32Array([0, inputArr[inputArr.length - 1]]));
    for (const c of chans) {
      let arr = c.arr;
      if (c.p === 'translation' && !opts.keepRoot) {
        const last = nFrames - 1;
        const dx = arr[last * 3] - arr[0], dz = arr[last * 3 + 2] - arr[2];
        if (locomotion) speed = Math.hypot(dx, dz) / Math.max(duration, 1e-3);
        const x0 = arr[0], z0 = arr[2];
        arr = arr.slice();
        for (let i = 0; i < nFrames; i++) {
          const t = nFrames > 1 ? i / (nFrames - 1) : 0;
          arr[i * 3] = arr[i * 3] - x0 - dx * t;
          arr[i * 3 + 2] = arr[i * 3 + 2] - z0 - dz * t;
        }
      }
      const sz = c.size;
      let keyFrames = frames;
      // Collapse channels that barely move (most finger bones) to two keys.
      let maxDev = 0;
      for (let f = 0; f < nFrames; f++) {
        if (sz === 4) maxDev = Math.max(maxDev, 1 - Math.abs(arr[f * 4] * arr[0] + arr[f * 4 + 1] * arr[1] + arr[f * 4 + 2] * arr[2] + arr[f * 4 + 3] * arr[3]));
        else maxDev = Math.max(maxDev, Math.hypot(arr[f * 3] - arr[0], arr[f * 3 + 1] - arr[1], arr[f * 3 + 2] - arr[2]) * 0.01);
      }
      const isStatic = maxDev < 2e-6;
      if (isStatic) keyFrames = [0, 0];
      let outArr;
      if (sz === 4) {
        outArr = new Int16Array(keyFrames.length * 4);
        keyFrames.forEach((f, i) => { for (let k = 0; k < 4; k++) outArr[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, arr[f * 4 + k])) * 32767); });
      } else {
        outArr = new Float32Array(keyFrames.length * 3);
        keyFrames.forEach((f, i) => { for (let k = 0; k < 3; k++) outArr[i * 3 + k] = arr[f * 3 + k]; });
      }
      const output = target.createAccessor().setType(sz === 4 ? 'VEC4' : 'VEC3').setArray(outArr).setNormalized(sz === 4);
      const sampler = target.createAnimationSampler().setInput(isStatic ? staticInput : input).setOutput(output).setInterpolation('LINEAR');
      out.addSampler(sampler);
      out.addChannel(target.createAnimationChannel().setTargetNode(c.tnode).setTargetPath(c.p).setSampler(sampler));
    }
    info[clip] = { duration: +duration.toFixed(3), speed: +speed.toFixed(3), loop, src: file };
    process.stdout.write('.');
  }
  // Drop the converted 'Take 001' animations that came with the first file.
  for (const a of target.getRoot().listAnimations()) if (a.getName() === 'Take 001') a.dispose();
  const bip = nodeByName.get('Bip01');
  const hipY = bip.getTranslation()[1];
  await target.transform(prune({ keepLeaves: true }));
  await io.write(path.join(OUT, `${outName}.glb`), target);
  console.log(` ${outName}: ${Object.keys(info).length} clips, ${(fs.statSync(path.join(OUT, outName + '.glb')).size / 1024).toFixed(0)} KB`);
  return { hipY, clips: info };
}

async function main() {
  await MeshoptEncoder.ready;
  fs.mkdirSync(OUT, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const result = {
    m: await buildLibrary(MALE, 'anims_m', io),
    f: await buildLibrary(FEMALE, 'anims_f', io),
  };
  fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(result, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
