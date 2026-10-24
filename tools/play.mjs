// Scripted headless play session for debugging levels.
// Usage: node tools/play.mjs <url> <outDir> '<steps json>'
// Steps: {"until":"js expr","timeout":ms} {"wait":ms} {"shot":"name"} {"eval":"js expr"} {"key":"KeyW","hold":ms} {"press":"Enter"}
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , url, out = 'test-results/play', stepsArg = '[]'] = process.argv;
const steps = JSON.parse(stepsArg.startsWith('@') ? fs.readFileSync(stepsArg.slice(1), 'utf8') : stepsArg);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) } });
await ctx.addInitScript((q) => {
  localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: q, tts: false, volumes: { master: 0 }, showFps: true }));
}, process.env.Q || 'low');
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}\n${e.stack}`));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
console.log(stamp(), 'ready');
for (const s of steps) {
  try {
    if (s.until) {
      await page.waitForFunction(s.until, null, { timeout: s.timeout ?? 120000, polling: 250 });
      console.log(stamp(), 'until ok:', s.until.slice(0, 80));
    } else if (s.wait) await page.waitForTimeout(s.wait);
    else if (s.shot) { await page.screenshot({ path: `${out}/${s.shot}.png`, timeout: 120000 }); console.log(stamp(), 'shot', s.shot); }
    else if (s.eval) console.log(stamp(), 'eval', s.eval.slice(0, 60), '=>', JSON.stringify(await page.evaluate(s.eval)));
    else if (s.key) { await page.keyboard.down(s.key); await page.waitForTimeout(s.hold ?? 500); await page.keyboard.up(s.key); }
    else if (s.press) await page.keyboard.press(s.press);
  } catch (e) {
    console.log(stamp(), 'STEP FAILED', JSON.stringify(s).slice(0, 100), String(e.message).slice(0, 300));
    break;
  }
}
const uniq = [...new Set(logs)].filter((l) => !/GPU stall|swiftshader|Automatic fallback/i.test(l));
console.log(uniq.slice(0, 30).join('\n').slice(0, 6000));
await browser.close();
