// Getting caught: the nearest guard or officer runs over, tackles the caught player to the ground
// and handcuffs them, the camera cuts in, "You were caught" — then the usual fade and restart.
// Runs on both clients from the shared 'caught' event; the authority moves the NPC (synced as usual).
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from './game';
import { SPEAKERS } from './game';
import type { Npc } from './npc';
import { CAPTURE_LINES } from './voices';

const CATCHERS = ['guard', 'police', 'thug'];
/** Shouted when the searchlight or a patrol spots you (recorded with the tower guard's voice). */
const RAISE_ALARM = { who: 'towerguard', text: 'They\'re here!', dur: 1.6 };

interface Active {
  who: CharacterId;
  npc: Npc | null;
  helper: Npc | null;
  t: number;
  tackleAt: number;
  cuffed: boolean;
  onBike: boolean;
}

export class Capture {
  private a: Active | null = null;
  private cuffs: THREE.Group | null = null;

  constructor(private g: Game) {}

  get active(): boolean { return !!this.a; }

  /** Starts the sequence; returns how many extra seconds the fail screen should wait. */
  start(who: CharacterId, by: string): number {
    if (this.a) return 3;
    const g = this.g;
    const body = g.body(who);
    const onBike = who === g.localChar ? g.local.state === 'bike' : g.remote.onBike;
    const spotted = !g.npcs.has(by); // searchlight, patrol, police chase...
    const npc = this.pick(body.pos, by, null);
    const helper = spotted ? this.pick(body.pos, '', npc) : null;
    this.a = { who, npc, helper, t: 0, tackleAt: -1, cuffed: false, onBike };
    // The caught player stops; their partner keeps control until the fade.
    if (who === g.localChar) {
      g.local.cancelScript();
      g.local.state = 'busy';
      g.local.body.crouched = false;
    }
    if (spotted) g.dialogue.play([RAISE_ALARM]);
    // Authority sends the catchers in (NPC positions sync to the other client).
    if (g.authority) for (const n of [npc, helper]) {
      if (!n) continue;
      const d = n.body.pos.distanceTo(body.pos);
      if (d > 16) {
        // Too far to arrive in time: start them just out of reach on the same side.
        const dir = n.body.pos.clone().sub(body.pos).setY(0).normalize();
        n.body.pos.copy(body.pos).addScaledVector(dir, 8);
      }
      const side = n === helper ? 1 : 0;
      const dir = n.body.pos.clone().sub(body.pos).setY(0).normalize();
      const stand = body.pos.clone().addScaledVector(dir, 0.85).add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side * 1.0));
      n.walkTo(stand, 5.2, undefined, Math.atan2(body.pos.x - stand.x, body.pos.z - stand.z));
    }
    // Camera: low and close on the caught player, drifting in, from a side with a clear view
    // (fences and bars count here, unlike for the normal follow camera).
    const base = body.pos.clone();
    const to = base.clone().add(new THREE.Vector3(0, 0.5, 0));
    const toward = (npc ? npc.body.pos.clone().sub(base).setY(0) : body.forward()).normalize();
    const side = new THREE.Vector3(-toward.z, 0, toward.x);
    let view = side.clone().multiplyScalar(0.8).addScaledVector(toward, 0.6).normalize();
    for (let i = 0; i < 12; i++) {
      const a = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 6);
      const d = view.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const from = base.clone().addScaledVector(d, 3.0).add(new THREE.Vector3(0, 2.0, 0));
      const ray = from.clone().sub(to);
      const len = ray.length();
      if (!g.world.physics.raycast(to, ray.normalize(), len + 0.3, (b) => b.solid)) { view = d; break; }
    }
    g.cam.playShot({
      from: base.clone().addScaledVector(view, 3.0).add(new THREE.Vector3(0, 2.0, 0)),
      fromEnd: base.clone().addScaledVector(view, 2.3).add(new THREE.Vector3(0, 1.6, 0)),
      to,
      duration: 7, fov: 50, blend: 0.5, ease: 'inOut',
    });
    g.audio.play('sting', { bus: 'ui', volume: 0.55 });
    return onBike ? 1.5 : 3;
  }

  private pick(p: THREE.Vector3, prefer: string, not: Npc | null): Npc | null {
    const g = this.g;
    const ok = (n: Npc | undefined): n is Npc => !!n && n !== not && n.alive && CATCHERS.includes(n.def.role) && !n.def.passive;
    const first = g.npcs.get(prefer);
    if (ok(first)) return first;
    let best: Npc | null = null, bd = 45;
    for (const n of g.npcs.values()) {
      if (!ok(n)) continue;
      const d = n.body.pos.distanceTo(p);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  update(dt: number): void {
    const a = this.a;
    if (!a) return;
    const g = this.g;
    a.t += dt;
    const body = g.body(a.who);
    if (a.tackleAt < 0) {
      const near = a.npc ? a.npc.body.pos.distanceTo(body.pos) < 1.35 : a.t > 0.8;
      if (near || a.t > 2.4) this.tackle(a);
    } else if (!a.cuffed && a.t - a.tackleAt > 0.9) {
      a.cuffed = true;
      if (!a.onBike) {
        this.showCuffs(true);
        g.audio.play('chain', { pos: body.pos, volume: 0.6 });
        g.audio.play('lock_open', { pos: body.pos, volume: 0.5, delay: 0.25 });
      }
    }
    if (this.cuffs?.visible) {
      const m = body.model;
      const r = m.bone('Bip01_R_Hand')?.getWorldPosition(new THREE.Vector3());
      const l = m.bone('Bip01_L_Hand')?.getWorldPosition(new THREE.Vector3());
      if (r && l) {
        this.cuffs.position.copy(r).lerp(l, 0.5);
        this.cuffs.lookAt(r);
        const [cr, cl, chain] = this.cuffs.children;
        const half = Math.max(0.04, r.distanceTo(l) / 2);
        cr.position.set(0, 0, half); cl.position.set(0, 0, -half);
        chain.scale.set(1, 1, half * 2);
      }
    }
  }

  private tackle(a: Active): void {
    const g = this.g;
    a.tackleAt = a.t;
    const body = g.body(a.who);
    const npc = a.npc;
    if (!a.onBike) {
      if (a.who === g.localChar) g.local.body.setPose('cuffed', {}, { restart: true });
      g.audio.play('body_fall', { pos: body.pos, volume: 0.9 });
      g.audio.play('grunt', { pos: body.chest(), volume: 0.7, delay: 0.1 });
      g.cam.addShake(0.35);
    }
    if (npc) {
      npc.body.yaw = Math.atan2(body.pos.x - npc.body.pos.x, body.pos.z - npc.body.pos.z);
      if (!a.onBike) npc.body.setPose('kneel', {}, { restart: true });
      const line = CAPTURE_LINES[Math.floor(Math.random() * CAPTURE_LINES.length)];
      if (!g.dialogue.active) g.dialogue.play([{ who: npc.id, text: line, dur: 1.8 }]);
    }
    const name = SPEAKERS[a.who]?.name ?? 'Your partner';
    g.hud.setBanner(a.who === g.localChar ? 'You were caught!' : `${name} was caught — you were both caught!`, 'danger');
  }

  private showCuffs(on: boolean): void {
    if (!this.cuffs) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.9, roughness: 0.3 });
      const ring = new THREE.TorusGeometry(0.045, 0.009, 6, 16);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(ring, mat), new THREE.Mesh(ring, mat));
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 1), mat);
      g.add(chain);
      this.g.world.root.add(g);
      this.cuffs = g;
    }
    this.cuffs.visible = on;
  }

  /** Checkpoint restart: undo everything. */
  reset(): void {
    const g = this.g;
    if (this.a) {
      for (const n of [this.a.npc, this.a.helper]) n?.body.clearPose(0);
      g.cam.endCinematic(0);
    }
    this.a = null;
    if (this.cuffs) this.cuffs.visible = false;
  }

  dispose(): void {
    this.cuffs?.removeFromParent();
    this.cuffs = null;
    this.a = null;
  }
}
