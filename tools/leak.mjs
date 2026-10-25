// Leak check: loads chapters one after another and counts live Game / World / Scene objects
// through the DevTools protocol (should stay at 1 game). Usage: node tools/leak.mjs [baseUrl] [chapters]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const chapters = (process.argv[3] || '1,2,1').split(',').map(Number);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`${BASE}?dev=solo&ch=${chapters[0]}&cp=&render=0`, { timeout: 120000 });
const count = async (expr) => {
  // Use a dedicated object group and release it: DevTools handles would otherwise keep objects alive.
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr, objectGroup: 'leak' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup: 'leak' });
  const { result: n } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true, objectGroup: 'leak' });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'leak' });
  return n.value;
};
for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i];
  if (i > 0) await page.evaluate((c) => { window.__app.startingGame = false; return window.__app.loadChapter(c, '', {}, 'elias'); }, ch);
  await page.waitForFunction((c) => window.__app?.state === 'game' && window.__app.game?.begun && window.__app.game.chapter.num === c, ch, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(2500);
  await cdp.send('HeapProfiler.collectGarbage');
  const games = await count('Object.getPrototypeOf(window.__app.game)');
  const worlds = await count('Object.getPrototypeOf(window.__app.game.world)');
  const scenes = await count('Object.getPrototypeOf(window.__app.game.world.scene)');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  const gpu = await page.evaluate(() => { const i = window.__app.renderer.gl.info; return `tex=${i.memory.textures} geo=${i.memory.geometries} progs=${i.programs?.length}`; });
  console.log(`after ch${ch}: games=${games} worlds=${worlds} scenes=${scenes} heap=${heap}MB ${gpu}`);
}
await browser.close();
