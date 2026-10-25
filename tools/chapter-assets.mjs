// Records which asset files each chapter loads (headless), so the game can download the next
// chapter's files in the background while you play. Writes public/assets/chapter-assets.json.
// Usage: node tools/chapter-assets.mjs [url]   (a running build, e.g. http://localhost:8095/)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8095/';
const out = {};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const ch of [1, 2, 3, 4, 5, 6]) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ quality: 'medium', tts: true, volumes: { master: 0 } })));
  const files = new Set();
  let booted = false;
  page.on('request', (r) => {
    const u = new URL(r.url());
    const i = u.pathname.indexOf('/assets/');
    // Only what the chapter itself loads (not the menu), and not voice clips (prefetched separately).
    if (booted && i >= 0 && !u.pathname.includes('/audio/voice/')) files.add(u.pathname.slice(i + 1));
  });
  await page.goto(`${BASE}?dev=solo&ch=${ch}&render=0`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  booted = true;
  await page.waitForFunction(() => window.__app?.game?.begun, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  out[ch] = [...files].sort();
  console.log('chapter', ch, files.size, 'files');
  await ctx.close();
}
await browser.close();
fs.writeFileSync('public/assets/chapter-assets.json', JSON.stringify(out));
