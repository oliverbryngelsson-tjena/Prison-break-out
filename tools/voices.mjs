// Records every dialogue line with its speaker's voice (see src/game/voices.ts).
//
// Usage: node --experimental-strip-types tools/voices.mjs [--list]
// Needs a Python env with kokoro-onnx + soundfile (PY=/path/to/python), the Kokoro-82M q8 ONNX model
// (KOKORO_MODEL=…/kokoro-q8.onnx, npm package kokoro-q8-shards joined) and a voices .npz built from the
// voice tensors in npm package kokoro-local-runtime (KOKORO_VOICES=…/voices.npz). Also ffmpeg.
// Output: public/assets/audio/voice/<key>.mp3 and public/audio/voice/manifest.json. Unchanged lines are kept.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { voiceFor, voiceKey, lineDuration, BARKS, BARK_DUR, QUIPS, QUIP_DUR, CAST, POOLS } from '../src/game/voices.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/assets/audio/voice');
const files = [...walk(path.join(ROOT, 'src/levels')), ...walk(path.join(ROOT, 'src/game'))];

function* walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

// ---- tiny source scanner: find object literals and read string/number fields from them
function readString(s, i) {
  const q = s[i];
  if (q !== '\'' && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[++j];
      if (n === 'n') out += '\n';
      else if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(j + 1, j + 5), 16)); j += 4; }
      else out += n;
      continue;
    }
    if (q === '`' && c === '$' && s[j + 1] === '{') return { dynamic: true, end: j };
    if (c === q) return { value: out, end: j };
    out += c;
  }
  return null;
}
function skipString(s, i) { const r = readString(s, i); if (!r) return i; if (r.dynamic) { let d = 0; for (let j = r.end; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return skipString('`' + s.slice(j + 1), 0) + j; } } return r.end; }
function enclosingObject(s, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = s[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) return objectFrom(s, i); depth--; }
  }
  return null;
}
function objectFrom(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' || c === '"' || c === '`') { i = skipString(s, i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { start, end: i, body: s.slice(start + 1, i) };
  }
  return null;
}
/** Top-level field of an object body: string value, number, or undefined. */
function field(body, name) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\'' || c === '"' || c === '`') { i = skipString(body, i); continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 0 && body.startsWith(name, i) && /[\s,{]/.test(body[i - 1] ?? ' ') && /^\s*:/.test(body.slice(i + name.length))) {
      let j = i + name.length; while (body[j] !== ':') j++; j++; while (/\s/.test(body[j])) j++;
      const str = readString(body, j);
      if (str) return str.dynamic ? undefined : str.value;
      const num = /^[0-9.]+/.exec(body.slice(j));
      return num ? Number(num[0]) : undefined;
    }
  }
  return undefined;
}

// ---- NPC roles (id -> role) from NPC definitions
const roles = {};
const sources = files.map((f) => ({ f, s: fs.readFileSync(f, 'utf8') }));
for (const { s } of sources) {
  for (const m of s.matchAll(/role:\s*'([a-z]+)'/g)) {
    const o = enclosingObject(s, m.index);
    const id = o && field(o.body, 'id');
    if (typeof id === 'string') roles[id] = m[1];
  }
}

// ---- dialogue lines
const jobs = new Map();
function add(who, role, text, dur, ch) {
  const spoken = text.replace(/\([^)]*\)/g, ' ').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  if (!/[a-z0-9]/i.test(spoken)) return;
  const v = voiceFor(who, role);
  const key = voiceKey(v.v, text);
  const target = lineDuration({ text, dur });
  const prev = jobs.get(key);
  if (prev) { prev.target = Math.min(prev.target, target); if (prev.ch !== ch) prev.ch = 0; return; }
  jobs.set(key, { key, voice: v.v, speed: v.speed ?? 1, lang: v.v[0] === 'b' ? 'en-gb' : 'en-us', text: spoken, target, ch });
}
for (const { f, s } of sources) {
  const ch = Number(/ch(\d)\.ts$/.exec(f)?.[1] ?? 0);
  for (const m of s.matchAll(/who:\s*'([a-z_0-9]+)'/g)) {
    const o = enclosingObject(s, m.index);
    if (!o) continue;
    const text = field(o.body, 'text');
    if (typeof text !== 'string') continue;
    const dur = field(o.body, 'dur');
    add(m[1], roles[m[1]], text, typeof dur === 'number' ? dur : undefined, ch);
  }
}
// Barks: every NPC voice that can say them.
const roleVoices = {};
for (const [role, pool] of Object.entries(POOLS)) roleVoices[role] = new Set(pool);
for (const [id, role] of Object.entries(roles)) (roleVoices[role] ??= new Set()).add(voiceFor(id, role).v);
const voiceOwner = {}; // a speaker id that maps to each voice, for add()
for (const [role, set] of Object.entries(roleVoices)) {
  if (role === 'story' || role === 'dog') continue;
  for (const v of set) {
    const alert = BARKS.alert[role] ?? BARKS.alert.other;
    for (const text of [...BARKS.suspicious, ...alert, ...BARKS.lost, ...BARKS.search, ...BARKS.hit, ...BARKS.attack]) {
      if (!text) continue;
      const key = voiceKey(v, text);
      if (!jobs.has(key)) jobs.set(key, { key, voice: v, speed: 1, lang: v[0] === 'b' ? 'en-gb' : 'en-us', text, target: BARK_DUR, ch: 0 });
      voiceOwner[v] = role;
    }
  }
}
for (const who of ['elias', 'jax']) for (const text of QUIPS[who]) add(who, undefined, text, QUIP_DUR, 0);

const list = [...jobs.values()];
if (process.argv.includes('--list')) {
  for (const j of list) console.log(j.ch, j.voice, j.target.toFixed(1), j.text);
  console.log(list.length, 'lines;', new Set(list.map((j) => j.voice)).size, 'voices');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).clips : {};
const todo = list.filter((j) => !(old[j.key] && old[j.key].t === +j.target.toFixed(2) && fs.existsSync(path.join(OUT, j.key + '.mp3'))));
console.log(`${list.length} lines, ${todo.length} to record`);
let made = {};
if (todo.length) {
  const PY = process.env.PY || 'python3';
  const r = spawnSync(PY, ['-I', path.join(ROOT, 'tools/voices_worker.py'), process.env.KOKORO_MODEL, process.env.KOKORO_VOICES, OUT],
    { input: JSON.stringify(todo), stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error('worker failed'); process.exit(1); }
  made = JSON.parse(r.stdout.toString());
}
const clips = {};
for (const j of list) {
  const c = made[j.key] ?? old[j.key];
  if (c) clips[j.key] = { ...c, c: j.ch };
}
// Remove recordings no longer used.
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !clips[f.slice(0, -4)]) fs.rmSync(path.join(OUT, f));
fs.writeFileSync(manifestPath, JSON.stringify({ rate: 30, clips }));
const bytes = Object.keys(clips).reduce((n, k) => n + fs.statSync(path.join(OUT, k + '.mp3')).size, 0);
console.log(`${Object.keys(clips).length} clips, ${(bytes / 1e6).toFixed(1)} MB`);
