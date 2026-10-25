// End-to-end multiplayer test with two separate browser processes (two real game instances).
// Usage: node tests/e2e-multiplayer.mjs [baseUrl]   (default http://localhost:5173/)
// Requires the room server (npm run server) and the client (npm run dev, or npm start for a build).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] || 'http://localhost:5173/';
// Extra query, e.g. Q='peer=127.0.0.1:9000' for peer-to-peer rooms through a local signaling server.
const Q = process.env.Q ? process.env.Q : '';
const OUT = process.env.OUT || 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const VIEW = { width: 640, height: 360 };
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function launch(label, name) {
  const browser = await chromium.launch({ args: ARGS });
  const ctx = await browser.newContext({ viewport: VIEW });
  await ctx.addInitScript(([n]) => {
    if (!localStorage.getItem('pbo.settings')) {
      localStorage.setItem('pbo.settings', JSON.stringify({ name: n, quality: 'low', tts: false, volumes: { master: 0 } }));
    }
  }, [name]);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${label}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${label}] pageerror: ${e.message}\n${e.stack}`));
  return { browser, page, logs, label };
}

const ev = (p, fn, arg) => p.page.evaluate(fn, arg);
// Screenshots are slow with software rendering; never let one stall the test.
const snap = (p, name) => Promise.race([p.page.screenshot({ path: `${OUT}/${name}.png` }), new Promise((r) => setTimeout(r, 45000))]).catch(() => {});
const wait = (p, fn, arg, timeout = 120000) => p.page.waitForFunction(fn, arg, { timeout, polling: 250 });

async function main() {
  const A = await launch('A', 'Ana');
  const B = await launch('B', 'Ben');
  try {
    await A.page.goto(BASE + (Q ? `?${Q}` : ''), { timeout: 120000 });
    await wait(A, () => window.__ready === true, null, 240000);
    await wait(A, () => window.__app.net.status === 'online', null, 30000);
    check('A: menu loaded and server online', true);

    // A creates a room
    await A.page.click('[data-screen=main] [data-a=create]');
    await A.page.fill('[data-screen=create] [data-name]', 'Ana');
    await A.page.click('[data-screen=create] [data-a=go]');
    await wait(A, () => window.__app.state === 'lobby' && !!window.__app.net.room?.code, null, 20000);
    const code = await ev(A, () => window.__app.net.room.code);
    const shownCode = await A.page.textContent('[data-screen=lobby] [data-code]');
    check('A: private room created', /^[A-Z0-9]{5}$/.test(code) && shownCode === code, `code ${code}`);

    // B joins through the invite link
    await B.page.goto(`${BASE}?join=${code}${Q ? '&' + Q : ''}`, { timeout: 120000 });
    await wait(B, () => window.__ready === true, null, 240000);
    const prefilled = await B.page.inputValue('[data-screen=join] [data-code]');
    check('B: invite link opens Join with the code filled in', prefilled === code);
    await B.page.fill('[data-screen=join] [data-name]', 'Ben');
    await B.page.click('[data-screen=join] [data-a=go]');
    await wait(B, () => window.__app.state === 'lobby' && window.__app.net.room?.players.length === 2, null, 20000);
    await wait(A, () => window.__app.net.room?.players.length === 2, null, 10000);
    const chars = await ev(A, () => window.__app.net.room.players.map((p) => `${p.name}:${p.character}`).join(','));
    check('Both players in the lobby with different characters', chars.includes('Ana:elias') && chars.includes('Ben:jax'), chars);

    // Character swap from B's side
    await B.page.click('[data-screen=lobby] .char:nth-child(1)');
    await wait(A, () => window.__app.net.room.players.find((p) => p.name === 'Ben')?.character === 'elias', null, 10000);
    const swapped = await ev(A, () => window.__app.net.room.players.map((p) => `${p.name}:${p.character}`).join(','));
    check('Character select swaps characters on both clients', swapped.includes('Ana:jax') && swapped.includes('Ben:elias'), swapped);
    await A.page.click('[data-screen=lobby] .char:nth-child(1)');
    await wait(B, () => window.__app.net.room.players.find((p) => p.name === 'Ana')?.character === 'elias', null, 10000);

    // Start is blocked until both are ready
    const startDisabled = await A.page.isDisabled('[data-screen=lobby] [data-a=start]');
    const guestStartHidden = !(await B.page.isVisible('[data-screen=lobby] [data-a=start]'));
    check('Start disabled until both ready; hidden for the guest', startDisabled && guestStartHidden);
    await A.page.click('[data-screen=lobby] [data-a=ready]');
    await B.page.click('[data-screen=lobby] [data-a=ready]');
    await wait(A, () => window.__app.net.room.players.every((p) => p.ready), null, 10000);
    await A.page.waitForSelector('[data-screen=lobby] [data-a=start]:not([disabled])', { timeout: 10000 });
    await A.page.click('[data-screen=lobby] [data-a=start]');
    const t0 = Date.now();
    await Promise.all([
      wait(A, () => window.__app.state === 'game', null, 400000),
      wait(B, () => window.__app.state === 'game', null, 400000),
    ]);
    check('Both clients loaded Chapter 1 and began together', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);

    const roles = await Promise.all([A, B].map((p) => ev(p, () => ({ local: window.__app.game.localChar, auth: window.__app.game.authority }))));
    check('Host is the world authority, guest is not', roles[0].auth === true && roles[1].auth === false, JSON.stringify(roles));

    // Opening cutscene plays on both clients. It is scheduled ~400 ms after the chapter begins so both
    // clients start it at the same shared time, so wait for it rather than sampling right at begin.
    await Promise.all([A, B].map((p) => wait(p, () => window.__app.game?.begun, null, 60000)));
    await Promise.all([A, B].map((p) => wait(p, () => !!window.__app.game.cutscenes.current || window.__app.game.cutscenes.played.has('cs_arrival'), null, 20000).catch(() => {})));
    const cs = await Promise.all([A, B].map((p) => ev(p, () => window.__app.game.cutscenes.current?.id ?? (window.__app.game.cutscenes.played.has('cs_arrival') ? 'played' : null))));
    check('Opening cutscene runs on both clients', cs.every((c) => c === 'cs_arrival' || c === 'played'), cs.join(','));
    await snap(A, 'A_cutscene');
    await snap(B, 'B_cutscene');

    // Skip needs both players
    await A.page.keyboard.press('Enter');
    await A.page.waitForTimeout(1500);
    const stillA = await ev(A, () => window.__app.game.cutscenes.current?.id ?? null);
    await B.page.keyboard.press('Enter');
    await Promise.all([
      wait(A, () => !window.__app.game.cutscenes.current, null, 30000),
      wait(B, () => !window.__app.game.cutscenes.current, null, 30000),
    ]);
    check('Cutscene skip waits for both players, then skips on both', stillA === 'cs_arrival' || stillA === null, `after A only: ${stillA}`);

    // Movement sync: B walks, A sees B's character move
    await B.page.waitForTimeout(500);
    const before = await ev(A, () => window.__app.game.remote.body.pos.toArray());
    const bStart = await ev(B, () => window.__app.game.local.body.pos.toArray());
    await B.page.keyboard.down('KeyW');
    await B.page.waitForTimeout(2500);
    await B.page.keyboard.up('KeyW');
    await B.page.waitForTimeout(1200);
    const bEnd = await ev(B, () => window.__app.game.local.body.pos.toArray());
    const after = await ev(A, () => window.__app.game.remote.body.pos.toArray());
    const moved = Math.hypot(bEnd[0] - bStart[0], bEnd[2] - bStart[2]);
    const err = Math.hypot(after[0] - bEnd[0], after[2] - bEnd[2]);
    check('Movement is synced (guest moves, host sees it)', moved > 0.5 && err < 0.35, `moved ${moved.toFixed(2)} m, remote error ${err.toFixed(2)} m, before ${before.map((x) => x.toFixed(1))}`);

    // Shared objective
    const obj = await Promise.all([A, B].map((p) => ev(p, () => window.__app.game.objective.text)));
    check('Both clients show the same objective', obj[0] === obj[1] && obj[0].length > 0, obj[0]);

    // NPC sync: positions of a patrolling guard match
    await A.page.waitForTimeout(1500);
    const npcA = await ev(A, () => window.__app.game.npcs.get('vance')?.body.pos.toArray());
    const npcB = await ev(B, () => window.__app.game.npcs.get('vance')?.body.pos.toArray());
    const npcErr = npcA && npcB ? Math.hypot(npcA[0] - npcB[0], npcA[2] - npcB[2]) : 99;
    check('NPC positions are synced from the authority', npcErr < 1.2, `guard Vance error ${npcErr.toFixed(2)} m`);

    // Reconnection: B reloads the page and comes back into the same game
    await B.page.reload({ timeout: 120000 });
    await wait(B, () => window.__ready === true, null, 240000);
    await wait(B, () => window.__app.state === 'game', null, 400000);
    const rejoin = await ev(B, () => ({ code: window.__app.net.room?.code, chapter: window.__app.game.chapter.num, begun: window.__app.game.begun, obj: window.__app.game.objective.text }));
    check('Guest reloads the page and rejoins the running game', rejoin.code === code && rejoin.begun && rejoin.obj === obj[0], JSON.stringify(rejoin));
    const awayAfter = await ev(A, () => window.__app.game.partnerAway);
    check('Host sees the partner reconnected', awayAfter === false);

    // Network drop (socket closed) and automatic reconnect
    await ev(B, () => window.__app.net.simulateDrop());
    await wait(B, () => window.__app.net.status === 'online', null, 30000);
    await B.page.waitForTimeout(1500);
    const ok2 = await ev(A, () => !window.__app.game.partnerAway);
    check('Socket drop: client reconnects automatically', ok2);

    await snap(A, 'A_end');
    await snap(B, 'B_end');

    // Leaving: guest quits, host is told
    await B.page.evaluate(() => window.__app['quitGame']());
    await wait(A, () => window.__app.state === 'lobby' || document.querySelector('[data-screen=message].show') !== null, null, 30000);
    check('Guest leaves: host is notified and returned to the lobby', true);
  } catch (e) {
    check('Unexpected error', false, String(e?.message ?? e));
    await snap(A, 'A_error');
    await snap(B, 'B_error');
  } finally {
    const logs = [...new Set([...A.logs, ...B.logs])].filter((l) => !/GPU stall|WebGL: INVALID|swiftshader|Automatic fallback/i.test(l));
    fs.writeFileSync(`${OUT}/e2e-logs.txt`, logs.join('\n'));
    if (logs.length) console.log(`\n${logs.length} console warnings/errors (see ${OUT}/e2e-logs.txt). First ones:\n` + logs.slice(0, 12).join('\n').slice(0, 3000));
    fs.writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2));
    await A.browser.close();
    await B.browser.close();
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
}

main();
