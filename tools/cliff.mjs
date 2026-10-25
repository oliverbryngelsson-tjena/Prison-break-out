// Cliff test: finds the steepest terrain near each checkpoint and sprints into it at a low frame rate,
// measuring how far the player ends up below the terrain surface (falling through the ground).
// Usage: node tools/cliff.mjs [baseUrl] [fps] [spec...]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8080/';
const FPS = process.argv[3] || '8';
const specs = process.argv.slice(4).length ? process.argv.slice(4) : ['2:outside', '3:bank,ravine,road', '4:rim,pit', '6:run'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const spec of specs) {
  const [ch, cps] = spec.split(':');
  for (const cp of cps.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
    await ctx.addInitScript(() => localStorage.setItem('pbo.settings', JSON.stringify({ name: 'Dev', quality: 'low', tts: false, volumes: { master: 0 } })));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    let res;
    try {
      await page.goto(`${BASE}?dev=solo&ch=${ch}&cp=${cp}&render=0&fps=${FPS}`, { timeout: 120000 });
      await page.waitForFunction(() => window.__app?.state === 'game' && window.__app.game?.begun, null, { timeout: 300000, polling: 500 });
      res = await page.evaluate(() => new Promise((resolve) => {
        const app = window.__app, g = app.game, ph = g.world.physics;
        const T = (x, z) => ph.terrainHeight ? ph.terrainHeight(x, z) : (() => { let b = null; for (const hf of ph.heightfields) if (hf.contains(x, z)) { const h = hf.height(x, z); if (b === null || h > b) b = h; } return b; })();
        const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code }));
        // Skip any cutscene first.
        const p0 = g.local.body.pos.clone();
        const spots = [];
        for (let i = 0; i < 6000; i++) {
          const x = p0.x + (Math.random() - 0.5) * 140, z = p0.z + (Math.random() - 0.5) * 140;
          const h = T(x, z); if (h === null) continue;
          const e = 0.6;
          const gx = (T(x + e, z) - T(x - e, z)) / (2 * e), gz = (T(x, z + e) - T(x, z - e)) / (2 * e);
          const sl = Math.hypot(gx, gz);
          if (sl > 1.3) spots.push({ x, z, sl, gx, gz });
        }
        spots.sort((a, b) => b.sl - a.sl);
        const pick = [];
        for (const s of spots) { if (pick.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 12)) pick.push(s); if (pick.length >= 6) break; }
        const out = { tested: pick.length, worst: 0, below: 0, falls: 0, maxSlope: +(spots[0]?.sl ?? 0).toFixed(2) };
        let k = 0;
        const run = () => {
          if (k >= pick.length) { resolve(out); return; }
          const s = pick[k++];
          const ux = s.gx / s.sl, uz = s.gz / s.sl;
          const sx = s.x - ux * 3, sz = s.z - uz * 3;
          const yaw = Math.atan2(ux, uz);
          if (g.cutscenes.current) { ev('keydown', 'Enter'); ev('keyup', 'Enter'); }
          g.local.state = 'free';
          g.local.teleport({ x: sx, y: T(sx, sz) + 0.05, z: sz }, yaw);
          g.local.body.grounded = true;
          g.cam.snapBehind(yaw, g.local.body.pos);
          g.cam.autoFollow = false;
          ev('keydown', 'KeyW'); ev('keydown', 'ShiftLeft');
          let n = 0, under = false;
          const iv = setInterval(() => {
            g.cam.yaw = yaw;
            const b = g.local.body;
            const h = T(b.pos.x, b.pos.z);
            if (h !== null) {
              const d = h - b.pos.y;
              if (d > out.worst) out.worst = +d.toFixed(2);
              if (d > 0.6 && !under) { under = true; out.below++; }
            }
            if (b.pos.y < -38) out.falls++;
            if (++n > 32) { clearInterval(iv); ev('keyup', 'KeyW'); ev('keyup', 'ShiftLeft'); setTimeout(run, 200); }
          }, 125);
        };
        run();
      }));
    } catch (e) { res = { error: String(e.message).slice(0, 200) }; }
    const fail = errs.length || res.error || res.below || res.falls;
    if (fail) bad++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ch${ch}:${cp}`, JSON.stringify(res), errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
