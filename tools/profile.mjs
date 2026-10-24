// CPU profile of a running page for N seconds; prints the top self-time functions.
// Usage: node tools/profile.mjs <url> [seconds]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , url, secs = '4'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript((q) => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: q, tts: false, volumes: { master: 0 } })), process.env.Q || 'low');
const page = await ctx.newPage();
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 400000, polling: 500 });
await page.waitForTimeout(2000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.waitForTimeout(+secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log('total ms', total.toFixed(0));
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(0).padStart(7), 'ms ', k);
await browser.close();
