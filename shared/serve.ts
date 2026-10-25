// Glue between one client transport and the RoomManager: welcome, parsing, version check, pings.
// Shared by the Node server (WebSocket) and the P2P host in the browser (data channels, loopback).
import { PROTOCOL_VERSION, isClientMsg, type ClientMsg } from './protocol';
import type { Conn, RoomManager, Transport } from './rooms';

export interface ServedConnection {
  message(data: string): void;
  closed(): void;
}

export function serveConnection(rooms: RoomManager, t: Transport): ServedConnection {
  const conn: Conn = { ws: t, playerId: null, roomCode: null, name: 'Player', helloed: false, budget: 200, lastRefill: Date.now() };
  t.send(JSON.stringify({ t: 'welcome', v: PROTOCOL_VERSION, serverTime: Date.now() }));
  let open = true;
  return {
    message(data: string) {
      if (!open) return;
      let msg: ClientMsg;
      try {
        const parsed = JSON.parse(data);
        if (!isClientMsg(parsed)) return;
        msg = parsed;
      } catch {
        return;
      }
      if (msg.t === 'hello' && msg.v !== PROTOCOL_VERSION) {
        t.send(JSON.stringify({ t: 'error', code: 'BAD_VERSION', message: 'Game version mismatch. Please refresh to update.' }));
        return;
      }
      if (msg.t === 'ping' && typeof msg.rtt === 'number') rooms.setPing(conn, msg.rtt);
      rooms.handle(conn, msg);
    },
    closed() {
      if (!open) return;
      open = false;
      rooms.detach(conn, false);
    },
  };
}
