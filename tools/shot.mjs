// Takes a screenshot of a page in headless Chromium (software WebGL).
// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , url, out, w = '1280', h = '720', wait = '1500'] = process.argv;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => (window).__ready === true, null, { timeout: 240000 });
} catch {
  logs.push('timeout waiting for __ready');
}
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const uniq = [...new Set(logs)];
console.log(uniq.slice(0, 40).join('\n'));
await browser.close();
