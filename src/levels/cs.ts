// Cutscene / scripting helpers shared by chapters.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from '../game/game';
import type { Shot } from '../engine/camera';
import type { ScriptStep } from '../game/player';
import type { PoseCtx } from '../game/poses';

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function placeChar(g: Game, c: CharacterId, p: THREE.Vector3, yaw: number): void {
  if (g.isLocal(c)) { g.local.cancelScript(); g.local.teleport(p, yaw); }
  else g.remote.teleport(p, yaw);
}

/** Walk a character along points at a speed (both clients run this identically). */
export function walkChar(g: Game, c: CharacterId, pts: THREE.Vector3[], speed = 1.4, done?: () => void, endYaw?: number): void {
  const b = g.body(c);
  const steps: ScriptStep[] = [];
  let prev = b.pos.clone();
  pts.forEach((p, i) => {
    const d = prev.distanceTo(p);
    steps.push({ to: p.clone(), dur: Math.max(0.05, d / speed), anim: speed, ease: 'linear', yaw: i === pts.length - 1 && endYaw !== undefined ? undefined : undefined });
    prev = p;
  });
  if (endYaw !== undefined) steps.push({ to: pts[pts.length - 1].clone(), dur: 0.35, yaw: endYaw });
  run(g, c, steps, done);
}

export function run(g: Game, c: CharacterId, steps: ScriptStep[], done?: () => void): void {
  if (g.isLocal(c)) {
    const prevState = g.local.state;
    g.local.runScript(steps, () => {
      if (g.inCutscene) g.local.state = 'cutscene';
      else if (prevState === 'cutscene') g.local.state = 'free';
      done?.();
    });
  } else g.remote.runScript(steps, done);
}

export function poseChar(g: Game, c: CharacterId, pose: string | null, ctx: PoseCtx = {}): void {
  const b = g.body(c);
  if (pose) b.setPose(pose, ctx, { restart: true });
  else b.clearPose(0.3);
}

export function clipChar(g: Game, c: CharacterId, clip: string | null, layer: 'full' | 'upper' = 'full', loop = true): void {
  const m = g.body(c).model;
  if (clip) m.play(clip, { layer, loop, fade: 0.35 });
  else m.stop(layer, 0.35);
}

export function lookChar(g: Game, c: CharacterId, at: THREE.Vector3 | null): void {
  g.body(c).model.lookTarget = at ? at.clone() : null;
}

export function shot(from: THREE.Vector3, to: THREE.Vector3, duration: number, o: Partial<Shot> = {}): Shot {
  return { from, to, duration, fov: 42, blend: 0, ease: 'inOut', ...o };
}

/** Over-the-shoulder shot of `a` looking at `b`. */
export function ots(g: Game, a: CharacterId | string, b: CharacterId | string, duration: number, side = 1, o: Partial<Shot> = {}): Shot {
  const pa = bodyOf(g, a).head(), pb = bodyOf(g, b).head();
  const dir = pb.clone().sub(pa).setY(0).normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side);
  const from = pa.clone().addScaledVector(dir, -0.75).addScaledVector(right, 0.42).add(new THREE.Vector3(0, 0.12, 0));
  return { from, to: pb.clone().add(new THREE.Vector3(0, -0.05, 0)), duration, fov: 38, ease: 'inOut', ...o };
}

/** Close-up on a character's face from in front. */
export function closeUp(g: Game, a: CharacterId | string, duration: number, dist = 0.9, side = 0.25, o: Partial<Shot> = {}): Shot {
  const b = bodyOf(g, a);
  const h = b.head();
  const f = b.forward();
  const right = new THREE.Vector3(-f.z, 0, f.x);
  const from = h.clone().addScaledVector(f, dist).addScaledVector(right, side).add(new THREE.Vector3(0, 0.02, 0));
  return { from, to: h.clone().add(new THREE.Vector3(0, -0.03, 0)), duration, fov: 35, ease: 'inOut', ...o };
}

/** Two-shot framing both characters from the side. */
export function twoShot(g: Game, a: CharacterId | string, b: CharacterId | string, duration: number, dist = 2.6, height = 1.55, side = 1, o: Partial<Shot> = {}): Shot {
  const pa = bodyOf(g, a).pos, pb = bodyOf(g, b).pos;
  const mid = pa.clone().add(pb).multiplyScalar(0.5);
  const dir = pb.clone().sub(pa).setY(0).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side);
  const from = mid.clone().addScaledVector(perp, dist).setY(mid.y + height);
  return { from, to: mid.clone().setY(mid.y + 1.35), duration, fov: 45, ease: 'inOut', ...o };
}

export function bodyOf(g: Game, id: string) {
  if (id === 'elias' || id === 'jax') return g.body(id as CharacterId);
  const n = g.npcs.get(id);
  if (!n) throw new Error('no actor ' + id);
  return n.body;
}

/** Authority-side NPC helpers (proxies follow via snapshots). */
export function npcWalk(g: Game, id: string, p: THREE.Vector3, speed = 1.3, yaw?: number, onArrive?: () => void): void {
  const n = g.npcs.get(id);
  if (!n) return;
  if (g.authority) n.walkTo(p, speed, onArrive, yaw);
}

export function npcPlace(g: Game, id: string, p: THREE.Vector3, yaw: number): void {
  const n = g.npcs.get(id);
  if (!n) return;
  n.body.pos.copy(p);
  n.body.yaw = yaw;
}

export function npcClip(g: Game, id: string, clip: string | null): void {
  const n = g.npcs.get(id);
  if (!n) return;
  if (clip) n.body.model.play(clip, { fade: 0.4 });
  else n.body.model.stop('full', 0.4);
}
