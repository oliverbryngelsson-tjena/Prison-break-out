// server/index.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { WebSocketServer } from "ws";

// shared/protocol.ts
var PROTOCOL_VERSION = 3;
var MAX_PLAYERS = 2;
var RECONNECT_GRACE_MS = 12e4;
var AUTHORITY_HANDOFF_MS = 8e3;
function isClientMsg(x) {
  return !!x && typeof x === "object" && typeof x.t === "string";
}
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 5;
function normalizeCode(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

// server/rooms.ts
import { randomBytes, randomInt } from "node:crypto";
var send = (conn, msg) => {
  if (conn && conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg));
};
var RoomManager = class {
  constructor(log2 = () => {
  }) {
    this.log = log2;
    setInterval(() => this.sweep(), 1e3).unref?.();
  }
  log;
  rooms = /* @__PURE__ */ new Map();
  stats = { created: 0, joined: 0, resumed: 0, relayed: 0 };
  newCode() {
    for (let tries = 0; tries < 1e3; tries++) {
      let c = "";
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error("no free room codes");
  }
  state(room) {
    return {
      code: room.code,
      phase: room.phase,
      progress: room.progress,
      startedAt: room.startedAt,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        ready: p.ready,
        connected: !!p.conn,
        isHost: p.id === room.hostId,
        isAuthority: p.id === room.authorityId,
        ping: p.ping
      }))
    };
  }
  broadcast(room, msg, except) {
    for (const p of room.players) if (p.id !== except) send(p.conn, msg);
  }
  pushRoom(room) {
    this.broadcast(room, { t: "room", room: this.state(room) });
  }
  error(conn, code, message) {
    send(conn, { t: "error", code, message });
  }
  rateOk(conn) {
    const now = Date.now();
    conn.budget = Math.min(200, conn.budget + (now - conn.lastRefill) / 1e3 * 120);
    conn.lastRefill = now;
    if (conn.budget < 1) return false;
    conn.budget -= 1;
    return true;
  }
  handle(conn, msg) {
    if (!this.rateOk(conn)) {
      if (msg.t !== "relay") this.error(conn, "RATE_LIMIT", "Too many messages");
      return;
    }
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : void 0;
    const me = room?.players.find((p) => p.id === conn.playerId);
    if (room) room.lastActivity = Date.now();
    switch (msg.t) {
      case "hello":
        conn.helloed = true;
        conn.name = sanitizeName(msg.name);
        return;
      case "ping":
        send(conn, { t: "pong", c: Number(msg.c) || 0, s: Date.now() });
        return;
      case "create": {
        this.detach(conn, true);
        const code = this.newCode();
        const p = { id: id(), token: token(), name: sanitizeName(msg.name), character: "elias", ready: false, conn, disconnectedAt: null, ping: 0 };
        const r = {
          code,
          phase: "lobby",
          players: [p],
          hostId: p.id,
          authorityId: p.id,
          progress: validProgress(msg.progress) ? msg.progress : null,
          startedAt: null,
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        this.rooms.set(code, r);
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.created++;
        this.log("room created", code, p.name);
        send(conn, { t: "joined", you: p.id, token: p.token, room: this.state(r) });
        return;
      }
      case "join": {
        const code = normalizeCode(String(msg.code || ""));
        const r = this.rooms.get(code);
        if (!r) return this.error(conn, "ROOM_NOT_FOUND", `No game with code ${code}. Check the code with your friend.`);
        if (r.players.length >= MAX_PLAYERS) return this.error(conn, "ROOM_FULL", "That game already has two players.");
        if (r.phase === "playing") return this.error(conn, "ROOM_IN_GAME", "That game has already started.");
        this.detach(conn, true);
        const taken = new Set(r.players.map((p2) => p2.character));
        const character = taken.has("elias") ? "jax" : "elias";
        const p = { id: id(), token: token(), name: sanitizeName(msg.name), character, ready: false, conn, disconnectedAt: null, ping: 0 };
        r.players.push(p);
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.joined++;
        this.log("room joined", code, p.name);
        send(conn, { t: "joined", you: p.id, token: p.token, room: this.state(r) });
        this.pushRoom(r);
        return;
      }
      case "resume": {
        const code = normalizeCode(String(msg.code || ""));
        const r = this.rooms.get(code);
        const p = r?.players.find((x) => x.token === msg.token);
        if (!r || !p) return this.error(conn, "SESSION_EXPIRED", "That session has ended.");
        if (p.conn && p.conn !== conn) {
          const old = p.conn;
          old.playerId = null;
          old.roomCode = null;
          try {
            old.ws.close(4e3, "replaced");
          } catch {
          }
        }
        this.detach(conn, true);
        p.conn = conn;
        p.disconnectedAt = null;
        conn.roomCode = code;
        conn.playerId = p.id;
        this.stats.resumed++;
        this.log("resumed", code, p.name);
        send(conn, { t: "joined", you: p.id, token: p.token, room: this.state(r) });
        this.broadcast(r, { t: "peer", event: "reconnected", id: p.id }, p.id);
        this.pushRoom(r);
        return;
      }
      case "select": {
        if (!room || !me) return this.error(conn, "BAD_REQUEST", "Not in a room");
        if (room.phase !== "lobby") return;
        if (msg.character !== "elias" && msg.character !== "jax") return this.error(conn, "BAD_REQUEST", "Unknown character");
        const other = room.players.find((p) => p.id !== me.id);
        if (other && other.character === msg.character) {
          other.character = me.character;
          other.ready = false;
        }
        me.character = msg.character;
        me.ready = false;
        this.pushRoom(room);
        return;
      }
      case "ready": {
        if (!room || !me || room.phase !== "lobby") return;
        me.ready = !!msg.ready;
        this.pushRoom(room);
        return;
      }
      case "start": {
        if (!room || !me) return;
        if (room.hostId !== me.id) return this.error(conn, "NOT_HOST", "Only the host can start the game.");
        if (room.players.length < MAX_PLAYERS) return this.error(conn, "NOT_READY", "Waiting for your friend to join.");
        if (!room.players.every((p) => p.ready && p.conn && p.character)) return this.error(conn, "NOT_READY", "Both players must be ready.");
        room.phase = "playing";
        room.startedAt = Date.now();
        room.authorityId = room.hostId;
        this.log("game started", room.code);
        this.broadcast(room, { t: "start", room: this.state(room), at: Date.now() + 1500 });
        return;
      }
      case "backToLobby": {
        if (!room || !me || room.hostId !== me.id) return;
        room.phase = "lobby";
        for (const p of room.players) p.ready = false;
        this.pushRoom(room);
        return;
      }
      case "save": {
        if (!room || !me) return;
        if (validProgress(msg.progress)) {
          room.progress = msg.progress;
          this.pushRoom(room);
        }
        return;
      }
      case "relay": {
        if (!room || !me) return;
        const raw = msg.d;
        if (!raw || typeof raw !== "object") return;
        this.stats.relayed++;
        for (const p of room.players) if (p.id !== me.id) send(p.conn, { t: "relay", from: me.id, d: raw });
        return;
      }
      case "leave": {
        this.detach(conn, true);
        return;
      }
      default:
        this.error(conn, "BAD_REQUEST", "Unknown message");
    }
  }
  /** Removes a connection from its room. `leave` = intentional (frees the seat). */
  detach(conn, leave) {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : void 0;
    const pid = conn.playerId;
    conn.roomCode = null;
    conn.playerId = null;
    if (!room || !pid) return;
    const p = room.players.find((x) => x.id === pid);
    if (!p || p.conn !== conn) return;
    if (leave) {
      room.players = room.players.filter((x) => x.id !== pid);
      this.log("left", room.code, p.name);
      if (room.players.length === 0) {
        this.rooms.delete(room.code);
        return;
      }
      if (room.hostId === pid) room.hostId = room.players[0].id;
      if (room.authorityId === pid) room.authorityId = room.players[0].id;
      if (room.phase === "playing") room.phase = "lobby";
      for (const x of room.players) x.ready = false;
      this.broadcast(room, { t: "peer", event: "left", id: pid });
      this.pushRoom(room);
    } else {
      p.conn = null;
      p.disconnectedAt = Date.now();
      this.log("disconnected", room.code, p.name);
      this.broadcast(room, { t: "peer", event: "disconnected", id: pid, graceMs: RECONNECT_GRACE_MS });
      this.pushRoom(room);
    }
  }
  setPing(conn, ms) {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : void 0;
    const p = room?.players.find((x) => x.id === conn.playerId);
    if (p) p.ping = Math.round(ms);
  }
  sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const auth = room.players.find((p) => p.id === room.authorityId);
      if (room.phase === "playing" && auth && !auth.conn && auth.disconnectedAt && now - auth.disconnectedAt > AUTHORITY_HANDOFF_MS) {
        const other = room.players.find((p) => p.conn);
        if (other) {
          room.authorityId = other.id;
          this.log("authority ->", room.code, other.name);
          this.broadcast(room, { t: "authority", id: other.id });
          this.pushRoom(room);
        }
      }
      for (const p of [...room.players]) {
        if (!p.conn && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
          room.players = room.players.filter((x) => x !== p);
          this.log("seat expired", room.code, p.name);
          if (room.hostId === p.id && room.players[0]) room.hostId = room.players[0].id;
          if (room.authorityId === p.id && room.players[0]) room.authorityId = room.players[0].id;
          this.broadcast(room, { t: "peer", event: "left", id: p.id });
          if (room.players.length) {
            room.phase = "lobby";
            for (const x of room.players) x.ready = false;
            this.pushRoom(room);
          }
        }
      }
      if (room.players.length === 0 || room.players.every((p) => !p.conn) && now - room.lastActivity > RECONNECT_GRACE_MS) {
        this.rooms.delete(room.code);
        this.log("room closed", room.code);
      }
    }
  }
};
function id() {
  return randomBytes(6).toString("hex");
}
function token() {
  return randomBytes(18).toString("base64url");
}
function sanitizeName(n) {
  const s = String(n ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16);
  return s || "Player";
}
function validProgress(p) {
  if (!p || typeof p !== "object") return false;
  const x = p;
  return Number.isInteger(x.chapter) && x.chapter >= 1 && x.chapter <= 6 && typeof x.checkpoint === "string" && x.checkpoint.length < 64 && typeof x.flags === "object" && JSON.stringify(x.flags).length < 8e3;
}

// server/index.ts
var PORT = Number(process.env.PORT || 8080);
var DIST = path.resolve(process.env.DIST_DIR || "dist");
var log = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString(), ...a);
var rooms = new RoomManager(process.env.QUIET ? () => {
} : log);
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".hdr": "application/octet-stream",
  ".exr": "application/octet-stream",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};
var COMPRESSIBLE = /* @__PURE__ */ new Set([".html", ".js", ".css", ".json", ".svg", ".glb", ".txt", ".webmanifest", ".wasm", ".hdr"]);
var server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://x");
  if (u.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, v: PROTOCOL_VERSION, stats: rooms.stats }));
    return;
  }
  let file = path.join(DIST, decodeURIComponent(u.pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    if (!path.extname(file)) file = path.join(DIST, "index.html");
    else {
      res.writeHead(404);
      res.end("not found");
      return;
    }
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" || file.endsWith("sw.js") ? "no-cache" : "public, max-age=86400",
    "access-control-allow-origin": "*"
  };
  const accept = String(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.has(ext) && accept.includes("gzip")) {
    headers["content-encoding"] = "gzip";
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    headers["content-length"] = String(fs.statSync(file).size);
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }
});
var wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
wss.on("connection", (ws, req) => {
  const conn = { ws, playerId: null, roomCode: null, name: "Player", helloed: false, budget: 200, lastRefill: Date.now() };
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const hb = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
    }
  }, 15e3);
  ws.send(JSON.stringify({ t: "welcome", v: PROTOCOL_VERSION, serverTime: Date.now() }));
  ws.on("message", (data) => {
    let msg;
    try {
      const parsed = JSON.parse(String(data));
      if (!isClientMsg(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }
    if (msg.t === "hello" && msg.v !== PROTOCOL_VERSION) {
      ws.send(JSON.stringify({ t: "error", code: "BAD_VERSION", message: "Game version mismatch. Please refresh to update." }));
      return;
    }
    if (msg.t === "ping" && typeof msg.rtt === "number") rooms.setPing(conn, msg.rtt);
    rooms.handle(conn, msg);
  });
  ws.on("close", () => {
    clearInterval(hb);
    rooms.detach(conn, false);
  });
  ws.on("error", () => {
  });
  void req;
});
server.listen(PORT, () => log(`server on :${PORT} (static from ${DIST})`));
