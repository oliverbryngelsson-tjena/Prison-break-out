// Game server: serves the built client (dist/) and hosts WebSocket rooms on /ws.
// Run: npm run server   (PORT env, default 8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, isClientMsg, type ClientMsg } from '../shared/protocol';
import { RoomManager, type Conn } from './rooms';

const PORT = Number(process.env.PORT || 8080);
const DIST = path.resolve(process.env.DIST_DIR || 'dist');
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const rooms = new RoomManager(process.env.QUIET ? () => {} : log);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.glb', '.txt', '.webmanifest', '.wasm', '.hdr']);

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, v: PROTOCOL_VERSION, stats: rooms.stats }));
    return;
  }
  let file = path.join(DIST, decodeURIComponent(u.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (!path.extname(file)) file = path.join(DIST, 'index.html');
    else { res.writeHead(404); res.end('not found'); return; }
  }
  const ext = path.extname(file).toLowerCase();
  const headers: Record<string, string> = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=86400',
    'access-control-allow-origin': '*',
  };
  const accept = String(req.headers['accept-encoding'] || '');
  if (COMPRESSIBLE.has(ext) && accept.includes('gzip')) {
    headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    headers['content-length'] = String(fs.statSync(file).size);
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const conn: Conn = { ws, playerId: null, roomCode: null, name: 'Player', helloed: false, budget: 200, lastRefill: Date.now() };
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const hb = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }, 15000);
  ws.send(JSON.stringify({ t: 'welcome', v: PROTOCOL_VERSION, serverTime: Date.now() }));
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      const parsed = JSON.parse(String(data));
      if (!isClientMsg(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }
    if (msg.t === 'hello' && msg.v !== PROTOCOL_VERSION) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_VERSION', message: 'Game version mismatch. Please refresh to update.' }));
      return;
    }
    if (msg.t === 'ping' && typeof msg.rtt === 'number') rooms.setPing(conn, msg.rtt);
    rooms.handle(conn, msg);
  });
  ws.on('close', () => {
    clearInterval(hb);
    rooms.detach(conn, false);
  });
  ws.on('error', () => { /* close follows */ });
  void req;
});

server.listen(PORT, () => log(`server on :${PORT} (static from ${DIST})`));
