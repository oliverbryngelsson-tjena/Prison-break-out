// Soak test: loads chapter checkpoints in solo dev mode and plays them with random input
// (walk, sprint, jump, crouch, attack, interact, camera), reporting crashes and falls through the world.
// Usage: node tools/soak.mjs [baseUrl] [secondsPerCheckpoint] [spec...]   spec = "3:bank,ravine"
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const SECS = Number(process.argv[3] || 60);
const specs = process.argv.slice(4).length ? process.argv.slice(4) : ['1:arrival,morning,yard,workshop,laundry,count', '2:cells,chase,tunnel,yard,outside', '3:bank,ravine,farm,road,cabin', '4:yard,rim,pit,compound,office', '5:start,cp_farm,cp_river,cp_highway,cp_climb', '6:dawn,run,hall'];
const RENDER = process.env.RENDER ?? '0';
const FPS = process.env.FPS ? `&fps=${process.env.FPS}` : '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (const spec of specs) {
  const [ch, cps] = spec.split(':');
  for (const cp of cps.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message} | ${String(e.stack).split('\n').slice(1, 4).join(' ').slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
    let res;
    try {
      await page.goto(`${BASE}?dev=solo&ch=${ch}&cp=${cp}&render=${RENDER}${FPS}`, { timeout: 120000 });
      await page.waitForFunction(() => window.__app?.state === 'game' && window.__app.game?.begun, null, { timeout: 300000, polling: 500 });
      res = await page.evaluate((secs) => new Promise((resolve) => {
        const app = window.__app, g = app.game;
        if (new URLSearchParams(location.search).has('fps')) g.flags.jump = true;
        const keys = ['KeyW', 'KeyW', 'KeyW', 'KeyA', 'KeyD', 'KeyS', 'ShiftLeft', 'Space', 'KeyC', 'KeyJ', 'KeyE', 'KeyQ'];
        const held = new Set();
        const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code }));
        const out = { falls: [], downs: 0, nan: 0, maxAir: 0, cutscenes: 0, minY: 1e9, maxY: -1e9, events: 0 };
        let air = 0, last = performance.now(), wasDowned = false;
        const t0 = performance.now();
        const tick = setInterval(() => {
          const now = performance.now(), dt = (now - last) / 1000; last = now;
          if (g.cutscenes.current) { ev('keydown', 'Enter'); setTimeout(() => ev('keyup', 'Enter'), 50); out.cutscenes++; }
          // Random key presses
          if (Math.random() < 0.35) {
            const k = keys[Math.floor(Math.random() * keys.length)];
            if (held.has(k)) { held.delete(k); ev('keyup', k); } else { held.add(k); ev('keydown', k); if (!['KeyW', 'KeyA', 'KeyD', 'KeyS', 'ShiftLeft'].includes(k)) setTimeout(() => { held.delete(k); ev('keyup', k); }, 80 + Math.random() * 400); }
          }
          app.input.virtual.look.x += (Math.random() - 0.4) * 40;
          const b = g.local.body;
          if (![b.pos.x, b.pos.y, b.pos.z].every(Number.isFinite)) out.nan++;
          out.minY = Math.min(out.minY, b.pos.y); out.maxY = Math.max(out.maxY, b.pos.y);
          if (g.local.state === 'free' && !b.grounded) air += dt; else air = 0;
          out.maxAir = Math.max(out.maxAir, air);
          if (air > 2.5 && out.falls.length < 5) { out.falls.push(b.pos.toArray().map((v) => +v.toFixed(1))); air = -100; }
          const downed = g.local.state === 'downed';
          if (downed && !wasDowned) out.downs++;
          wasDowned = downed;
          // Recover from fails/downs so the run continues.
          if (g.state === 'failed' || downed) { try { g.session.emit('restart', { checkpoint: g.chapter.checkpoint }); } catch { /* ignore */ } }
          if (now - t0 > secs * 1000) {
            clearInterval(tick);
            for (const k of held) ev('keyup', k);
            out.events = g.session.log.length;
            out.pos = b.pos.toArray().map((v) => +v.toFixed(1));
            out.err = app.debug.lastError?.slice(0, 300) ?? null;
            out.frames = app.debug.frames;
            resolve(out);
          }
        }, 250);
      }), SECS);
    } catch (e) { res = { error: String(e.message).slice(0, 200) }; }
    const fail = errs.length || res.err || res.error || res.nan || res.falls?.length;
    if (fail) bad++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ch${ch}:${cp}`, JSON.stringify(res));
    for (const e of [...new Set(errs)].slice(0, 6)) console.log('     ', e.slice(0, 500));
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
