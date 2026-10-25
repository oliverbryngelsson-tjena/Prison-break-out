// Memory test: plays through chapter loads in one tab (as a real session does) and reports GPU
// resources and JS heap after each load, to catch leaks that crash phones after a few chapters.
// Usage: node tools/memory.mjs [baseUrl] [chapters e.g. 1,2,3,4,5,6,1]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const chapters = (process.argv[3] || '1,2,3,4,5,6,1,2').split(',').map(Number);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}?dev=solo&ch=${chapters[0]}&cp=&render=1`, { timeout: 120000 });
for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i];
  if (i > 0) await page.evaluate((c) => { window.__app.startingGame = false; return window.__app.loadChapter(c, '', {}, 'elias'); }, ch);
  await page.waitForFunction((c) => window.__app?.state === 'game' && window.__app.game?.begun && window.__app.game.chapter.num === c, ch, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => {
    window.gc?.();
    const info = window.__app.renderer.gl.info;
    const mem = performance.memory;
    return { tex: info.memory.textures, geo: info.memory.geometries, progs: info.programs?.length ?? 0, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null };
  });
  console.log(`after ch${ch}`, JSON.stringify(m));
}
console.log('errors', errs.slice(0, 5));
await browser.close();
