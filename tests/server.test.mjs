// Protocol-level tests for the room server using two raw WebSocket clients.
// Usage: node tests/server.test.mjs [ws://localhost:8090/ws]
import assert from 'node:assert/strict';
const URL = process.argv[2] || 'ws://localhost:8090/ws';
const V = 3;

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  };
  const c = {
    ws, inbox, name,
    open: () => new Promise((r, j) => { ws.onopen = () => { c.send({ t: 'hello', v: V, name }); r(); }; ws.onerror = j; }),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 3000) => {
      const found = inbox.find(pred);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((res, rej) => {
        const w = { pred: (m) => { if (pred(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, res };
        waiters.push(w);
        setTimeout(() => rej(new Error(`${name}: timeout waiting`)), ms);
      });
    },
    close: () => ws.close(),
  };
  return c;
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}

await test('create room returns code + token', async () => {
  const a = client('Alice'); await a.open();
  a.send({ t: 'create', name: 'Alice' });
  const j = await a.wait((m) => m.t === 'joined');
  assert.match(j.room.code, /^[A-Z2-9]{5}$/);
  assert.ok(j.token.length > 10);
  assert.equal(j.room.players.length, 1);
  assert.equal(j.room.players[0].isHost, true);
  a.close();
});

await test('join with bad code gives ROOM_NOT_FOUND', async () => {
  const b = client('Bob'); await b.open();
  b.send({ t: 'join', code: 'ZZZZZ', name: 'Bob' });
  const e = await b.wait((m) => m.t === 'error');
  assert.equal(e.code, 'ROOM_NOT_FOUND');
  b.close();
});

let shared = {};
await test('second player joins, characters assigned, swap works', async () => {
  const a = client('Alice'); await a.open();
  a.send({ t: 'create', name: 'Alice' });
  const ja = await a.wait((m) => m.t === 'joined');
  const b = client('Bob'); await b.open();
  b.send({ t: 'join', code: ja.room.code.toLowerCase(), name: 'Bob' });
  const jb = await b.wait((m) => m.t === 'joined');
  assert.equal(jb.room.players.length, 2);
  const chars = jb.room.players.map((p) => p.character).sort();
  assert.deepEqual(chars, ['elias', 'jax']);
  const r = await a.wait((m) => m.t === 'room' && m.room.players.length === 2);
  assert.ok(r);
  // Bob picks Elias -> Alice gets Jax.
  b.send({ t: 'select', character: 'elias' });
  const r2 = await a.wait((m) => m.t === 'room' && m.room.players.find((p) => p.name === 'Bob').character === 'elias');
  assert.equal(r2.room.players.find((p) => p.name === 'Alice').character, 'jax');
  shared = { a, b, code: ja.room.code, tokenB: jb.token };
});

await test('third player is rejected (ROOM_FULL)', async () => {
  const c = client('Carl'); await c.open();
  c.send({ t: 'join', code: shared.code, name: 'Carl' });
  const e = await c.wait((m) => m.t === 'error');
  assert.equal(e.code, 'ROOM_FULL');
  c.close();
});

await test('start requires both ready, only host', async () => {
  const { a, b } = shared;
  b.send({ t: 'start' });
  assert.equal((await b.wait((m) => m.t === 'error')).code, 'NOT_HOST');
  a.send({ t: 'start' });
  assert.equal((await a.wait((m) => m.t === 'error')).code, 'NOT_READY');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait((m) => m.t === 'room' && m.room.players.every((p) => p.ready));
  a.send({ t: 'start' });
  const sa = await a.wait((m) => m.t === 'start');
  const sb = await b.wait((m) => m.t === 'start');
  assert.equal(sa.room.phase, 'playing');
  assert.equal(sa.at, sb.at);
});

await test('relay delivers game messages to the peer only', async () => {
  const { a, b } = shared;
  a.send({ t: 'relay', d: { k: 'ps', s: { tm: 1, p: [1, 2, 3], y: 0, s: 0, f: 0 } } });
  const m = await b.wait((x) => x.t === 'relay');
  assert.deepEqual(m.d.s.p, [1, 2, 3]);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(a.inbox.filter((x) => x.t === 'relay').length, 0);
});

await test('disconnect + resume keeps the seat and notifies the peer', async () => {
  const { a, b, code, tokenB } = shared;
  b.close();
  const pe = await a.wait((m) => m.t === 'peer' && m.event === 'disconnected');
  assert.ok(pe.graceMs > 0);
  const b2 = client('Bob2'); await b2.open();
  b2.send({ t: 'resume', code, token: tokenB });
  const j = await b2.wait((m) => m.t === 'joined');
  assert.equal(j.room.phase, 'playing');
  await a.wait((m) => m.t === 'peer' && m.event === 'reconnected');
  a.send({ t: 'relay', d: { k: 'chat', text: 'welcome back' } });
  const m = await b2.wait((x) => x.t === 'relay');
  assert.equal(m.d.text, 'welcome back');
  shared.b = b2;
});

await test('bad resume token gives SESSION_EXPIRED', async () => {
  const c = client('Mallory'); await c.open();
  c.send({ t: 'resume', code: shared.code, token: 'nope' });
  assert.equal((await c.wait((m) => m.t === 'error')).code, 'SESSION_EXPIRED');
  c.close();
});

await test('save stores progress in the room', async () => {
  const { a, b } = shared;
  a.send({ t: 'save', progress: { chapter: 2, checkpoint: 'vents', flags: { tool: true }, savedAt: Date.now(), playTime: 100 } });
  const r = await b.wait((m) => m.t === 'room' && m.room.progress && m.room.progress.chapter === 2);
  assert.equal(r.room.progress.checkpoint, 'vents');
});

await test('leave frees the seat and returns the room to lobby', async () => {
  const { a, b } = shared;
  b.send({ t: 'leave' });
  const pe = await a.wait((m) => m.t === 'peer' && m.event === 'left');
  assert.ok(pe);
  const r = await a.wait((m) => m.t === 'room' && m.room.players.length === 1);
  assert.equal(r.room.phase, 'lobby');
  a.close(); b.close();
});

await test('version mismatch is reported', async () => {
  const ws = new WebSocket(URL);
  const err = await new Promise((res) => { ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 999, name: 'x' })); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'error') res(m); }; });
  assert.equal(err.code, 'BAD_VERSION');
  ws.close();
});

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
