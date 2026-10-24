// Two-instance debug harness: create + join a room via the real UI flow, start, then poll both clients.
// Usage: node tools/duo.mjs [baseUrl] [seconds] [chapter]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:5173/';
const SECS = +(process.argv[3] || 40);
const CH = +(process.argv[4] || 1);
const OUT = process.env.OUT || 'test-results/duo';
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

async function launch(label, name) {
  const browser = await chromium.launch({ args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await ctx.addInitScript((n) => localStorage.setItem('pbo.settings', JSON.stringify({ name: n, quality: 'low', tts: false, volumes: { master: 0 } })), name);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${label}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${label}] pageerror: ${e.message}\n${e.stack}`));
  const cdp = await ctx.newCDPSession(page);
  return { browser, page, logs, label, cdp };
}

const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function stack(c) {
  await c.cdp.send('Debugger.enable');
  const paused = new Promise((res) => c.cdp.once('Debugger.paused', res));
  await c.cdp.send('Debugger.pause');
  const ev = await timed(paused, 10000);
  const frames = ev.callFrames.slice(0, 12).map((f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`);
  await c.cdp.send('Debugger.resume');
  return frames;
}

const probe = () => {
  const a = window.__app, g = a.game;
  if (!g) return { app: a.state };
  return {
    app: a.state, st: g.state, begun: g.begun, auth: g.authority, me: g.localChar,
    cs: g.cutscenes.current?.id ?? null, cam: g.cam.mode, camPos: g.cam.camera.position.toArray().map((x) => +x.toFixed(1)),
    pos: g.local.body.pos.toArray().map((x) => +x.toFixed(2)), rpos: g.remote.body.pos.toArray().map((x) => +x.toFixed(2)),
    lstate: g.local.state, obj: g.objective.text.slice(0, 40), fps: Math.round(a.renderer.fps), away: g.partnerAway,
    ev: g.session.stats.eventsApplied, sin: g.session.stats.snapsIn, err: a.debug.lastError?.slice(0, 300),
  };
};

const A = await launch('A', 'Ana');
const B = await launch('B', 'Ben');
try {
  await A.page.goto(BASE, { timeout: 120000 });
  await A.page.waitForFunction(() => window.__ready && window.__app.net.status === 'online', null, { timeout: 240000 });
  await A.page.evaluate((ch) => window.__app['create'](ch), CH);
  await A.page.waitForFunction(() => window.__app.net.room?.code, null, { timeout: 20000 });
  const code = await A.page.evaluate(() => window.__app.net.room.code);
  await B.page.goto(`${BASE}?join=${code}`, { timeout: 120000 });
  await B.page.waitForFunction(() => window.__ready && window.__app.net.status === 'online', null, { timeout: 240000 });
  await B.page.evaluate((c) => window.__app['join'](c), code);
  await A.page.waitForFunction(() => window.__app.net.room?.players.length === 2, null, { timeout: 20000 });
  await A.page.evaluate(() => window.__app.net.ready(true));
  await B.page.evaluate(() => window.__app.net.ready(true));
  await A.page.waitForFunction(() => window.__app.net.room.players.every((p) => p.ready), null, { timeout: 20000 });
  await A.page.evaluate(() => window.__app.net.start());
  console.log('started room', code);
  const t0 = Date.now();
  let n = 0;
  while ((Date.now() - t0) / 1000 < SECS) {
    for (const c of [A, B]) {
      try {
        const r = await timed(c.page.evaluate(probe), 8000);
        console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4), c.label, JSON.stringify(r));
      } catch (e) {
        console.log(c.label, 'HUNG — stack:', (await stack(c).catch((x) => [String(x)])).join(' <- '));
      }
    }
    if (n++ % 4 === 1) {
      await timed(A.page.screenshot({ path: `${OUT}/A_${n}.png` }), 30000).catch(() => console.log('A screenshot timeout'));
      await timed(B.page.screenshot({ path: `${OUT}/B_${n}.png` }), 30000).catch(() => console.log('B screenshot timeout'));
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  console.log([...new Set([...A.logs, ...B.logs])].filter((l) => !/GPU stall|swiftshader|Automatic fallback/i.test(l)).slice(0, 25).join('\n').slice(0, 5000));
  await A.browser.close();
  await B.browser.close();
}
