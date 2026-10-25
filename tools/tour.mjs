// Visual tour: screenshots of every checkpoint (player view + reverse view) for visual review.
// Usage: node tools/tour.mjs [baseUrl] [outDir] [spec...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const OUT = process.argv[3] || 'test-results/tour';
const specs = process.argv.slice(4).length ? process.argv.slice(4) : ['1:arrival,morning,yard,workshop,laundry,count', '2:cells,chase,tunnel,yard,outside', '3:bank,ravine,farm,road,cabin', '4:yard,rim,pit,compound,office', '5:start,cp_farm,cp_river,cp_highway,cp_climb', '6:dawn,run,hall'];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const spec of specs) {
  const [ch, cps] = spec.split(':');
  for (const cp of cps.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
    await ctx.addInitScript((q) => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: q, tts: false, volumes: { master: 0 } })), process.env.Q || 'medium');
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(`${BASE}?dev=solo&ch=${ch}&cp=${cp}`, { timeout: 120000 });
      await page.waitForFunction(() => window.__app?.state === 'game' && window.__app.game?.begun, null, { timeout: 400000, polling: 500 });
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(1200); }
      await page.waitForFunction(() => !window.__app.game.cutscenes.current, null, { timeout: 60000 }).catch(() => {});
      await page.evaluate(() => { const h = document.querySelector('.hud-title'); if (h) h.style.display = 'none'; });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${OUT}/${ch}_${cp}_a.png`, timeout: 120000 });
      await page.evaluate(() => { const g = window.__app.game; g.cam.yaw += Math.PI; g.cam.autoFollow = false; });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${OUT}/${ch}_${cp}_b.png`, timeout: 120000 });
      console.log('ok', ch, cp, errs.slice(0, 2).join(' | '));
    } catch (e) { console.log('FAIL', ch, cp, String(e.message).slice(0, 150)); }
    await ctx.close();
  }
}
await browser.close();
