// Two-instance co-op script runner: hosts a room at a chapter/checkpoint, joins it from a second
// browser, starts, then runs scripted steps on either or both players.
// Usage: node tools/coop.mjs <chapter> <checkpoint> '<steps json>' [baseUrl]
// Step: { on: 'A'|'B'|'AB', until|wait|eval|hold|press|tp|shot|check|sync ... }
//   sync: { name, a, b, tol }  (numeric arrays from A's and B's expressions must match)
//   hold: { key, ms }  (held on all targets at once)    tp: [x,y,z,yaw]
//   check: { name, expr }  (expr evaluated on each target; must be truthy)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , CH = '1', CP = '', stepsArg = '[]', BASE = 'http://localhost:5173/'] = process.argv;
const steps = JSON.parse(stepsArg.startsWith('@') ? fs.readFileSync(stepsArg.slice(1), 'utf8') : stepsArg);
const OUT = process.env.OUT || 'test-results/coop';
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + 's';
let fails = 0, passes = 0;

async function launch(label, name) {
  const browser = await chromium.launch({ args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 560, height: 315 } });
  await ctx.addInitScript((n) => localStorage.setItem('pbo.settings', JSON.stringify({ name: n, quality: 'low', tts: false, volumes: { master: 0 } })), name);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error'].includes(m.type())) logs.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${label}] pageerror: ${e.message}\n${e.stack}`));
  return { browser, page, logs, label };
}

/** [x, y, z, yaw]; y = null puts the player on the terrain (levels with a height function). */
function teleport(t) {
  const g = window.__app.game, ch = g.chapter;
  const y = t[1] ?? (ch.y ? ch.y(t[0], t[2]) : ch.terrain ? ch.terrain.height(t[0], t[2]) : 0) + 0.05;
  g.local.cancelScript?.();
  g.local.state = 'free';
  g.local.teleport({ x: t[0], y, z: t[2] }, t[3] ?? 0);
  g.cam.snapBehind(t[3] ?? 0, g.local.body.pos);
}

const A = await launch('A', 'Ana');
const B = await launch('B', 'Ben');
const P = { A, B };
try {
  const R = [process.env.RENDER ? `render=${process.env.RENDER}` : '', process.env.Q || ''].filter(Boolean).join('&');
  await A.page.goto(BASE + (R ? `?${R}` : ''), { timeout: 120000 });
  await A.page.waitForFunction(() => window.__ready && window.__app.net.status === 'online', null, { timeout: 240000 });
  await A.page.evaluate(([ch, cp]) => window.__app.net.createRoom('Ana', { chapter: +ch, checkpoint: cp, flags: {}, savedAt: Date.now(), playTime: 0 }), [CH, CP]);
  await A.page.waitForFunction(() => window.__app.net.room?.code, null, { timeout: 20000 });
  const code = await A.page.evaluate(() => window.__app.net.room.code);
  await B.page.goto(`${BASE}?join=${code}${R ? '&' + R : ''}`, { timeout: 120000 });
  await B.page.waitForFunction(() => window.__ready && window.__app.net.status === 'online', null, { timeout: 240000 });
  await B.page.evaluate((c) => window.__app['join'](c), code);
  await A.page.waitForFunction(() => window.__app.net.room?.players.length === 2, null, { timeout: 20000 });
  await A.page.evaluate(() => window.__app.net.ready(true));
  await B.page.evaluate(() => window.__app.net.ready(true));
  await A.page.waitForFunction(() => window.__app.net.room.players.every((p) => p.ready), null, { timeout: 20000 });
  await A.page.evaluate(() => window.__app.net.start());
  await Promise.all([A, B].map((c) => c.page.waitForFunction(() => window.__app.state === 'game', null, { timeout: 600000, polling: 500 })));
  console.log(stamp(), `both in game: chapter ${CH} @ ${CP || 'start'} (room ${code})`);
  for (const [i, s] of steps.entries()) {
    const targets = (s.on || 'AB').split('').map((k) => P[k]);
    try {
      // The checkpoint's intro cutscene is scheduled ~400 ms after the chapter begins, so the first
      // "begun and no cutscene" wait must also see that intro played, or it can return too early.
      if (s.until && i === 0 && s.until.includes('cutscenes.current')) s.until = `(${s.until}) && (() => { const g = window.__app.game, d = g.chapter.checkpoints[g.chapter.checkpoint]; return !d || !d.intro || g.cutscenes.played.has(d.intro); })()`;
      if (s.until) { await Promise.all(targets.map((c) => c.page.waitForFunction(s.until, null, { timeout: s.timeout ?? 120000, polling: 300 }))); console.log(stamp(), s.on || 'AB', 'until ok:', s.until.slice(0, 70)); }
      else if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      else if (s.reload) for (const c of targets) await c.page.reload({ timeout: 120000 });
      else if (s.eval) for (const c of targets) console.log(stamp(), c.label, 'eval =>', JSON.stringify(await c.page.evaluate(s.eval)).slice(0, 400));
      else if (s.hold) { await Promise.all(targets.map((c) => c.page.keyboard.down(s.hold))); await new Promise((r) => setTimeout(r, s.ms ?? 1000)); await Promise.all(targets.map((c) => c.page.keyboard.up(s.hold))); }
      else if (s.press) await Promise.all(targets.map((c) => c.page.keyboard.press(s.press)));
      else if (s.down) await Promise.all(targets.map((c) => c.page.keyboard.down(s.down)));
      else if (s.up) await Promise.all(targets.map((c) => c.page.keyboard.up(s.up)));
      else if (s.down) await Promise.all(targets.map((c) => c.page.keyboard.down(s.down)));
      else if (s.up) await Promise.all(targets.map((c) => c.page.keyboard.up(s.up)));
      else if (s.tp) for (const c of targets) await c.page.evaluate(teleport, s.tp);
      else if (s.tpA || s.tpB) {
        if (s.tpA) await A.page.evaluate(teleport, s.tpA);
        if (s.tpB) await B.page.evaluate(teleport, s.tpB);
      }
      else if (s.shot) for (const c of targets) await Promise.race([c.page.screenshot({ path: `${OUT}/${c.label}_${s.shot}.png` }), new Promise((r) => setTimeout(r, 45000))]);
      else if (s.sync) {
        // Cross-instance comparison: numeric arrays from A and B must match within tol.
        const [va, vb] = await Promise.all([A.page.evaluate(s.sync.a), B.page.evaluate(s.sync.b)]);
        const d = Math.max(...va.map((x, i) => Math.abs(x - vb[i])));
        const pass = Number.isFinite(d) && d <= (s.sync.tol ?? 0.5);
        if (pass) passes++; else fails++;
        console.log(stamp(), pass ? 'PASS' : 'FAIL', 'AB', s.sync.name, pass ? '' : JSON.stringify({ A: va, B: vb }));
      }
      else if (s.check) {
        for (const c of targets) {
          const ok = await c.page.evaluate(s.check.expr).catch((e) => `error: ${e.message}`);
          const pass = ok === true || (ok && ok !== false && typeof ok !== 'string');
          if (pass) passes++; else fails++;
          console.log(stamp(), pass ? 'PASS' : 'FAIL', c.label, s.check.name, pass ? '' : JSON.stringify(ok));
        }
      }
    } catch (e) {
      fails++;
      console.log(stamp(), 'STEP FAILED', JSON.stringify(s).slice(0, 120), String(e.message).slice(0, 200));
      for (const c of targets) console.log('  ', c.label, JSON.stringify(await c.page.evaluate(() => { const g = window.__app.game; return g ? { st: g.state, pos: g.local.body.pos.toArray().map((x) => +x.toFixed(2)), ls: g.local.state, flags: g.chapter.flags, cs: g.cutscenes.current?.id, frames: window.__app.debug.frames, keys: window.__app.input.keyLog.slice(-6), cur: g.interact.current?.id, auth: g.authority, err: window.__app.debug.lastError?.slice(0, 200) } : window.__app.state; }).catch(() => 'n/a')).slice(0, 500));
      if (s.critical !== false) break;
    }
  }
} catch (e) {
  fails++;
  console.log('ERROR', e.message);
} finally {
  const logs = [...new Set([...A.logs, ...B.logs])];
  if (logs.length) console.log('errors:\n' + logs.slice(0, 15).join('\n').slice(0, 4000));
  console.log(`\n${passes} passed, ${fails} failed`);
  await A.browser.close();
  await B.browser.close();
  process.exit(fails ? 1 : 0);
}
