// Co-op mini-games between the two players (arm wrestling, shooting hoops).
// Started by a co-op hold at the spot (both players), run by the world authority and synced as events:
//   mgStart {kind,id,at}  mgTap {who,n}  mgBal {b}  mgShot {who,p}  mgShotR {who,made,n,p}  mgEnd {id,winner}
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from './game';
import { SPEAKERS } from './game';
import { QUIPS, QUIP_DUR } from './voices';

export interface ArmSpot { id: string; center: THREE.Vector3; /** table top height */ table: number; /** players face along this axis */ axis: 'x' | 'z'; enabled?: () => boolean }
export interface HoopSpot { id: string; rim: THREE.Vector3; spots: [THREE.Vector3, THREE.Vector3]; enabled?: () => boolean }

type Active =
  | { kind: 'arm'; id: string; spot: ArmSpot; at: number; b: number; taps: Record<CharacterId, number>; sent: number; pendingTaps: number; ended: boolean }
  | { kind: 'hoops'; id: string; spot: HoopSpot; at: number; shots: Record<CharacterId, number>; made: Record<CharacterId, number>; pendingShot: boolean; ended: boolean };

const SHOTS = 5;
/** Sweet spot of the shot meter (0..1) and its tolerance. */
const SWEET = 0.78, TOL = 0.085;

export class MiniGames {
  private arms = new Map<string, ArmSpot>();
  private hoops = new Map<string, HoopSpot>();
  active: Active | null = null;
  private balls: Array<{ mesh: THREE.Mesh; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; peak: number; made: boolean; rim: THREE.Vector3 }> = [];
  private ballMat: THREE.MeshStandardMaterial | null = null;
  private resultT = 0;
  readonly wins: Record<string, Record<CharacterId, number>> = {};

  constructor(private g: Game) {
    g.updaters.add((dt) => this.update(dt));
  }

  // ---------------------------------------------------------------- setup (chapters call these in build)
  addArmWrestling(s: ArmSpot): void {
    this.arms.set(s.id, s);
    const I = this.g.interact;
    const dir = s.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const seat = (k: number) => s.center.clone().addScaledVector(dir, -0.7 * k).setY(s.center.y);
    const yaw = (k: number) => Math.atan2(dir.x * k, dir.z * k);
    for (const [role, k] of [['a', 1], ['b', -1]] as const) {
      I.add({
        id: `mg_${s.id}_${role}`, coop: `mg_${s.id}`, role, pos: seat(k), radius: 1.1, label: 'Arm wrestle', icon: 'coop', mode: 'hold', holdTime: 0.8,
        facing: yaw(k), stand: seat(k), enabled: () => this.ready() && (s.enabled?.() ?? true),
      });
    }
  }

  addHoops(s: HoopSpot): void {
    this.hoops.set(s.id, s);
    const I = this.g.interact;
    s.spots.forEach((p, i) => {
      const yaw = Math.atan2(s.rim.x - p.x, s.rim.z - p.z);
      I.add({
        id: `mg_${s.id}_${i}`, coop: `mg_${s.id}`, role: i ? 'b' : 'a', pos: p.clone(), radius: 1.0, label: 'Shoot hoops', icon: 'coop', mode: 'hold', holdTime: 0.8,
        facing: yaw, stand: p.clone(), enabled: () => this.ready() && (s.enabled?.() ?? true),
      });
    });
  }

  /** Mashing past the end must not start the next round by accident: short cooldown after each game. */
  private endedAt = -1e9;
  private ready(): boolean { return !this.active && !this.g.inCutscene && performance.now() - this.endedAt > 2500; }

  // ---------------------------------------------------------------- events
  /** A co-op hold completed: start the matching game (authority). */
  onCoop(group: string): void {
    const id = group.slice(3);
    if (!this.g.authority || this.active) return;
    const kind = this.arms.has(id) ? 'arm' : this.hoops.has(id) ? 'hoops' : null;
    if (kind) this.g.session.emit('mgStart', { kind, id, at: this.g.session.sharedNow() + 3200 });
  }

  onEvent(type: string, args: unknown): boolean {
    const a = (args ?? {}) as Record<string, unknown>;
    const g = this.g;
    switch (type) {
      case 'mgStart': this.start(String(a.kind) as 'arm' | 'hoops', String(a.id), Number(a.at)); return true;
      case 'mgTap': {
        const m = this.active;
        if (m?.kind === 'arm' && g.authority && !m.ended && g.session.sharedNow() >= m.at) m.taps[a.who as CharacterId] += Math.min(12, Number(a.n) || 0);
        return true;
      }
      case 'mgBal': { const m = this.active; if (m?.kind === 'arm') m.b = Number(a.b) || 0; return true; }
      case 'mgShot': {
        const m = this.active;
        if (m?.kind !== 'hoops' || !g.authority || m.ended) return true;
        const who = a.who as CharacterId;
        if (m.shots[who] >= SHOTS) return true;
        const p = Math.max(0, Math.min(1, Number(a.p) || 0));
        g.session.emit('mgShotR', { who, p, made: Math.abs(p - SWEET) <= TOL, n: m.shots[who] + 1 });
        return true;
      }
      case 'mgShotR': this.shotResult(a.who as CharacterId, Number(a.p), !!a.made, Number(a.n)); return true;
      case 'mgEnd': this.end(String(a.id), (a.winner as CharacterId | 'tie' | null) ?? null); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- flow
  private start(kind: 'arm' | 'hoops', id: string, at: number): void {
    const g = this.g;
    if (kind === 'arm') {
      const spot = this.arms.get(id)!;
      this.active = { kind, id, spot, at, b: 0, taps: { elias: 0, jax: 0 }, sent: 0, pendingTaps: 0, ended: false };
      const dir = spot.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      // Elias takes seat a, Jax seat b (facing each other across the table).
      const place = (c: CharacterId, k: number) => {
        const p = spot.center.clone().addScaledVector(dir, -0.7 * k).setY(spot.center.y);
        const yaw = Math.atan2(dir.x * k, dir.z * k);
        if (g.isLocal(c)) { g.local.cancelScript(); g.local.teleport(p, yaw); g.local.state = 'minigame'; g.local.body.setPose('arm_wrestle', { points: { grip: this.grip() }, k: { table: spot.table, strain: 0.3 } }, { restart: true }); }
      };
      place('elias', 1); place('jax', -1);
      const mid = spot.center.clone().setY(spot.table + 0.6);
      g.cam.playShot({ from: mid.clone().addScaledVector(side, 2.3).add(new THREE.Vector3(0, 0.55, 0)), to: mid.clone().add(new THREE.Vector3(0, -0.15, 0)), duration: 999, fov: 46, blend: 0.6, ease: 'inOut' });
    } else {
      const spot = this.hoops.get(id)!;
      this.active = { kind, id, spot, at, shots: { elias: 0, jax: 0 }, made: { elias: 0, jax: 0 }, pendingShot: false, ended: false };
      const p = spot.spots[g.localChar === 'elias' ? 0 : 1];
      g.local.cancelScript();
      g.local.teleport(p, Math.atan2(spot.rim.x - p.x, spot.rim.z - p.z));
      g.local.state = 'minigame';
      const mid = spot.spots[0].clone().lerp(spot.spots[1], 0.5);
      const back = mid.clone().sub(spot.rim).setY(0).normalize();
      g.cam.playShot({ from: mid.clone().addScaledVector(back, 3.2).add(new THREE.Vector3(0, 2.1, 0)), to: spot.rim.clone().add(new THREE.Vector3(0, -0.6, 0)), duration: 999, fov: 50, blend: 0.6, ease: 'inOut' });
    }
    g.audio.play('ui_rise', { volume: 0.6 });
  }

  /** Shared grip point of the locked hands, from the balance (+1 = Elias wins). */
  private grip(): THREE.Vector3 {
    const m = this.active;
    const spot = m?.kind === 'arm' ? m.spot : null;
    if (!spot) return new THREE.Vector3();
    const dir = spot.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ang = (m as { b: number }).b * 1.2;
    return spot.center.clone().setY(spot.table + 0.24).addScaledVector(side, Math.sin(ang) * 0.3).add(new THREE.Vector3(0, (Math.cos(ang) - 1) * 0.3, 0));
  }

  private shotResult(who: CharacterId, p: number, made: boolean, n: number): void {
    const m = this.active;
    if (m?.kind !== 'hoops') return;
    const g = this.g;
    m.shots[who] = n;
    if (made) m.made[who]++;
    if (who === g.localChar) m.pendingShot = false;
    // Ball flight from the shooter's hands to the rim (or off it).
    const body = g.body(who);
    const from = body.pos.clone().add(new THREE.Vector3(0, 2.25, 0)).addScaledVector(body.forward(), 0.4);
    const rim = m.spot.rim.clone();
    const miss = (p - SWEET) / TOL; // <0 short, >0 long
    const to = made ? rim.clone().add(new THREE.Vector3(0, -0.05, 0)) : rim.clone().addScaledVector(rim.clone().sub(from).setY(0).normalize(), THREE.MathUtils.clamp(miss * 0.18, -0.6, 0.5)).add(new THREE.Vector3(0, 0.05, 0));
    if (!this.ballMat) this.ballMat = new THREE.MeshStandardMaterial({ color: 0xc8622a, roughness: 0.7 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), this.ballMat);
    mesh.castShadow = true;
    g.world.root.add(mesh);
    if (g.isLocal(who)) g.local.body.setPose('shoot', {}, { restart: true });
    this.balls.push({ mesh, t: -0.55, dur: 0.95, from, to, peak: Math.max(from.y, to.y) + 1.4, made, rim });
    g.audio.play('whoosh', { pos: from, volume: 0.3, delay: 0.55 });
    if (g.authority && m.shots.elias >= SHOTS && m.shots.jax >= SHOTS && !m.ended) {
      m.ended = true;
      const w: CharacterId | 'tie' = m.made.elias === m.made.jax ? 'tie' : m.made.elias > m.made.jax ? 'elias' : 'jax';
      setTimeout(() => { if (this.active === m) g.session.emit('mgEnd', { id: m.id, winner: w }); }, 2200);
    }
  }

  private end(id: string, winner: CharacterId | 'tie' | null): void {
    const g = this.g;
    const m = this.active;
    if (!m || m.id !== id) return;
    this.active = null;
    this.endedAt = performance.now();
    g.hud.setMiniGame(null);
    // Only undo what the mini-game set up (a cutscene or restart may already have taken over).
    if (g.local.state === 'minigame') {
      g.local.state = 'free';
      g.local.body.clearPose(0.4);
      if (!g.inCutscene) g.cam.endCinematic(0.8);
    }
    if (winner && winner !== 'tie') {
      (this.wins[id] ??= { elias: 0, jax: 0 })[winner]++;
      const name = SPEAKERS[winner].name;
      g.hud.notify(winner === g.localChar ? `You win! (${this.wins[id][g.localChar]}–${this.wins[id][g.remoteChar]})` : `${name} wins (${this.wins[id][g.remoteChar]}–${this.wins[id][g.localChar]})`, 3);
      g.audio.play(winner === g.localChar ? 'ui_rise' : 'ui_hit', { volume: 0.6 });
      const q = QUIPS[winner][Math.floor(Math.random() * QUIPS[winner].length)];
      if (g.authority) g.session.emit('dlg', { lines: [{ who: winner, text: q, dur: QUIP_DUR }], at: g.session.sharedNow() + 300 });
    } else if (winner === 'tie') g.hud.notify('A tie!', 2.5);
    else g.hud.notify('Game cancelled', 2);
    this.resultT = 0;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number): void {
    const g = this.g;
    for (const b of [...this.balls]) {
      b.t += dt;
      if (b.t < 0) { b.mesh.position.copy(g.body('elias').pos).setY(-50); continue; }
      const k = Math.min(1, b.t / b.dur);
      const p = b.from.clone().lerp(b.to, k);
      p.y = THREE.MathUtils.lerp(b.from.y, b.to.y, k) + Math.sin(k * Math.PI) * (b.peak - Math.max(b.from.y, b.to.y));
      if (k >= 1) {
        // After the rim: drop through the net, or bounce away.
        const after = b.t - b.dur;
        if (after < 0.02 && b.made) g.audio.play('wood_hit', { pos: b.rim, volume: 0.25 });
        if (after < 0.02 && !b.made) g.audio.play('metal_hit', { pos: b.rim, volume: 0.45 });
        p.copy(b.to);
        if (b.made) p.y -= after * 3.5;
        else { p.addScaledVector(b.to.clone().sub(b.from).setY(0).normalize(), after * 2); p.y += Math.sin(Math.min(Math.PI, after * 4)) * 0.6 - after * after * 4; }
        if (after > 1.2) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); this.balls.splice(this.balls.indexOf(b), 1); continue; }
      }
      b.mesh.position.copy(p);
    }
    const m = this.active;
    if (!m) return;
    const now = g.session.sharedNow();
    const count = Math.ceil((m.at - now) / 1000);
    const inp = g.input;
    // Partner left: cancel.
    if (g.authority && g.partnerAway && !m.ended) { m.ended = true; g.session.emit('mgEnd', { id: m.id, winner: null }); }
    // Safety net: something else took the player out of the game (cutscene, checkpoint restart,
    // reconnect), or it ran far too long. End it here so its panel can never stay on screen.
    const lost = now > m.at + 1500 && g.local.state !== 'minigame';
    const stale = now - m.at > (m.kind === 'arm' ? 40000 : 150000);
    if (lost || stale) {
      if (g.authority && !m.ended) { m.ended = true; g.session.emit('mgEnd', { id: m.id, winner: null }); }
      if (this.active === m) this.end(m.id, null);
      return;
    }
    if (m.kind === 'arm') {
      const go = now >= m.at;
      const pressed = inp.buttons.interact.pressed || inp.buttons.attack.pressed || inp.buttons.jump.pressed;
      if (go && pressed) { m.pendingTaps++; g.cam.addShake(0.05); }
      m.sent += dt;
      if (m.sent >= 0.1) {
        m.sent = 0;
        if (m.pendingTaps) { g.session.request('mgTap', { who: g.localChar, n: m.pendingTaps }); m.pendingTaps = 0; }
        if (g.authority && go && !m.ended) {
          m.b = THREE.MathUtils.clamp(m.b + (m.taps.elias - m.taps.jax) * 0.04, -1, 1);
          m.taps.elias = m.taps.jax = 0;
          g.session.emit('mgBal', { b: +m.b.toFixed(3) });
          if (Math.abs(m.b) >= 1 || now - m.at > 30000) { m.ended = true; g.session.emit('mgEnd', { id: m.id, winner: m.b === 0 ? 'tie' : m.b > 0 ? 'elias' : 'jax' }); }
        }
      }
      g.local.body.updatePoseCtx({ points: { grip: this.grip() }, k: { table: m.spot.table, strain: go ? 1 : 0.3 } });
      const mine = g.localChar === 'elias' ? m.b : -m.b;
      const key = inp.device === 'touch' ? 'Tap USE' : `Mash ${inp.glyph('interact')}`;
      g.hud.setMiniGame({ title: 'Arm wrestling', sub: go ? `${key} as fast as you can!` : `${key} when it starts… ${Math.max(1, count)}`, bar: mine, left: SPEAKERS[g.localChar].name, right: SPEAKERS[g.remoteChar].name });
    } else {
      const go = now >= m.at;
      const myShots = m.shots[g.localChar];
      // Shot meter: swings 0..1; release near the sweet spot to score.
      const meter = 0.5 + 0.5 * Math.sin((now / 1000) * 3.4);
      if (go && !m.pendingShot && myShots < SHOTS && inp.buttons.interact.pressed) {
        m.pendingShot = true;
        g.session.request('mgShot', { who: g.localChar, p: +meter.toFixed(3) });
      }
      const key = inp.device === 'touch' ? 'Tap USE' : `Press ${inp.glyph('interact')}`;
      g.hud.setMiniGame({
        title: 'Shooting hoops', sub: !go ? `Get ready… ${Math.max(1, count)}` : myShots >= SHOTS ? 'Waiting for your partner…' : `${key} in the green zone — shot ${myShots + 1} of ${SHOTS}`,
        meter: go && myShots < SHOTS ? meter : null, sweet: [SWEET - TOL, SWEET + TOL],
        left: `${SPEAKERS[g.localChar].name} ${m.made[g.localChar]}`, right: `${m.made[g.remoteChar]} ${SPEAKERS[g.remoteChar].name}`,
      });
    }
  }

  dispose(): void {
    // The HUD outlives the game (it is shared across chapters), so clear the panel here.
    this.g.hud.setMiniGame(null);
    for (const b of this.balls) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); }
    this.balls = [];
    this.ballMat?.dispose();
    this.active = null;
  }
}
