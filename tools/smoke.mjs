// Smoke test: loads chapters/checkpoints in solo debug mode and reports load errors, runtime errors and state.
// Usage: node tools/smoke.mjs [baseUrl] [spec...]   spec = "3:bank,ravine" ; default = all chapters' first checkpoint
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const specs = process.argv.slice(3);
const RENDER = process.env.RENDER ?? '0';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (const spec of specs) {
  const [ch, cps] = spec.split(':');
  for (const cp of (cps || '').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message} ${String(e.stack).split('\n').slice(1, 3).join(' ')}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
    const t0 = Date.now();
    let res;
    try {
      await page.goto(`${BASE}?dev=solo&ch=${ch}&cp=${cp}&render=${RENDER}`, { timeout: 120000 });
      await page.waitForFunction(() => window.__app?.state === 'game' || (window.__app?.menus?.current === 'message'), null, { timeout: 300000, polling: 500 });
      const loadS = ((Date.now() - t0) / 1000).toFixed(0);
      await page.waitForTimeout(3000);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
      res = await page.evaluate(() => {
        const a = window.__app, g = a.game;
        if (!g) return { app: a.state, msg: document.querySelector('[data-screen=message] [data-m]')?.textContent };
        return { st: g.state, cp: g.chapter.checkpoint, phase: g.chapter.flags.phase, cs: g.cutscenes.current?.id ?? null, played: [...g.cutscenes.played], obj: g.objective.text.slice(0, 60), pos: g.local.body.pos.toArray().map((x) => +x.toFixed(1)), ls: g.local.state, err: a.debug.lastError?.slice(0, 400), frames: a.debug.frames };
      });
      res.load = loadS + 's';
    } catch (e) { res = { error: String(e.message).slice(0, 200) }; }
    const fail = errs.length || res.err || res.error || res.msg;
    if (fail) bad++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ch${ch}:${cp}`, JSON.stringify(res));
    for (const e of [...new Set(errs)].slice(0, 5)) console.log('     ', e.slice(0, 400));
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
