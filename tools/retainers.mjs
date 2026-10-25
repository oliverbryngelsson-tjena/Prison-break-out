// Finds what keeps old Game objects alive: loads two chapters, takes a heap snapshot and prints the
// shortest retainer path of each Game instance. Usage: node tools/retainers.mjs [baseUrl] [className]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`${BASE}?dev=solo&ch=1&cp=&render=0`, { timeout: 120000 });
await page.waitForFunction(() => window.__app?.state === 'game' && window.__app.game?.begun, null, { timeout: 300000, polling: 500 });
// Tag the first game so we can recognise it in the snapshot.
await page.evaluate(() => { window.__app.game.__old = new (class OldGameMarker {})(); });
await page.evaluate(() => { window.__app.startingGame = false; return window.__app.loadChapter(2, '', {}, 'elias'); });
await page.waitForFunction(() => window.__app?.state === 'game' && window.__app.game?.begun && window.__app.game.chapter.num === 2, null, { timeout: 300000, polling: 500 });
await page.waitForTimeout(2000);
await cdp.send('HeapProfiler.collectGarbage');
let chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const snap = JSON.parse(chunks.join(''));
chunks = null;
const m = snap.snapshot.meta;
const NF = m.node_fields.length, EF = m.edge_fields.length;
const nTypes = m.node_types[0], eTypes = m.edge_types[0];
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const firstEdge = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { firstEdge[i] = e; e += nodes[i * NF + 4] * EF; firstEdge[i + 1] = e; }
// reverse edges
const revCount = new Uint32Array(N);
for (let i = 0; i < N; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) revCount[edges[e + 2] / NF]++;
const revStart = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) revStart[i + 1] = revStart[i] + revCount[i];
const rev = new Uint32Array(revStart[N]);
const revEdge = new Uint32Array(revStart[N]);
const fill = new Uint32Array(N);
for (let i = 0; i < N; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) { const t = edges[e + 2] / NF; const k = revStart[t] + fill[t]++; rev[k] = i; revEdge[k] = e; }
const name = (i) => strings[nodes[i * NF + 1]];
const type = (i) => nTypes[nodes[i * NF]];
const edgeName = (e) => { const t = eTypes[edges[e]]; const v = edges[e + 1]; return t === 'element' || t === 'hidden' ? `[${v}]` : strings[v]; };
const target = process.argv[3] || 'OldGameMarker';
const games = [];
for (let i = 0; i < N; i++) if (type(i) === 'object' && name(i) === target) games.push(i);
console.log(target, 'instances:', games.length);
if (!games.length) { const seen = new Map(); for (let i = 0; i < N; i++) { const n = name(i); if (/OldGame/.test(n)) seen.set(type(i) + ':' + n, (seen.get(type(i) + ':' + n) || 0) + 1); } console.log([...seen].slice(0, 10)); }
// BFS from each target backwards to the root (node 0)
for (const g of games.slice(0, 3)) {
  const prev = new Int32Array(N).fill(-1), prevE = new Int32Array(N).fill(-1);
  const q = [g]; prev[g] = g;
  let found = -1;
  while (q.length) {
    const x = q.shift();
    if (x === 0) { found = x; break; }
    for (let k = revStart[x]; k < revStart[x + 1]; k++) {
      const r = rev[k], e = revEdge[k];
      if (prev[r] !== -1) continue;
      const et = eTypes[edges[e]];
      if (et === 'weak') continue;
      prev[r] = x; prevE[r] = e; q.push(r);
    }
  }
  if (found < 0) { console.log('no path'); continue; }
  const path = [];
  let x = 0;
  while (x !== g) { path.push(`${type(x)}:${name(x).slice(0, 40)} -[${edgeName(prevE[x])}]->`); x = prev[x]; }
  console.log(path.slice(0, 18).join('\n  '));
}
await browser.close();
