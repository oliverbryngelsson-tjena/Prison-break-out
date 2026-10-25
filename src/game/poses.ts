// Procedural pose overlays applied after animation sampling (IK + bone offsets).
// Each pose is a pure function of elapsed time so local and remote players render identically.
import * as THREE from 'three';
import { applyWorldRotation, rotateBoneWorld, solveTwoBone, type CharacterModel } from '../engine/characters';

export interface PoseCtx {
  /** world-space parameters (ledge points, target head, handlebar grips...) */
  points?: Record<string, THREE.Vector3>;
  /** scalar parameters */
  k?: Record<string, number>;
}

export interface PoseDef {
  /** Duration for one-shot poses (seconds). Infinity = loop until stopped. */
  dur: number;
  /** Base clip played on the full-body layer while the pose runs (optional). */
  clip?: string;
  /** Upper-body clip instead. */
  upperClip?: string;
  /** Movement allowed while active. */
  canMove?: boolean;
  /** Lock rotation */
  lockTurn?: boolean;
  /** Fade-in time. */
  fade?: number;
  apply: (m: CharacterModel, t: number, w: number, c: PoseCtx) => void;
}

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function frame(m: CharacterModel) {
  m.root.updateMatrixWorld(true);
  const q = m.root.getWorldQuaternion(new THREE.Quaternion());
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  const chest = m.bone('Bip01_Spine2')!.getWorldPosition(V());
  const head = m.bone('Bip01_Head')!.getWorldPosition(V());
  const base = m.root.getWorldPosition(V());
  return { q, fwd, right, chest, head, base };
}

const smooth = (a: number, b: number, t: number) => THREE.MathUtils.smoothstep(t, a, b);
const lerp = THREE.MathUtils.lerp;

export function fist(m: CharacterModel, side: 'L' | 'R', amt: number): void {
  if (amt <= 0) return;
  for (const f of ['1', '2', '3', '4']) for (const seg of ['', '1', '2']) {
    const b = m.bone(`Bip01_${side}_Finger${f}${seg}`);
    if (b) b.rotateZ(1.25 * amt * (seg === '' ? 0.8 : 1));
  }
  const th = m.bone(`Bip01_${side}_Finger01`);
  if (th) th.rotateZ(0.6 * amt);
}

function arm(m: CharacterModel, side: 'L' | 'R', target: THREE.Vector3, w: number, pole: THREE.Vector3): void {
  if (w <= 0.001) return;
  const u = m.bone(`Bip01_${side}_UpperArm`), f = m.bone(`Bip01_${side}_Forearm`), h = m.bone(`Bip01_${side}_Hand`);
  if (u && f && h) solveTwoBone(u, f, h, target, pole, Math.min(1, w));
}

function leg(m: CharacterModel, side: 'L' | 'R', target: THREE.Vector3, w: number, pole: THREE.Vector3): void {
  if (w <= 0.001) return;
  const u = m.bone(`Bip01_${side}_Thigh`), c = m.bone(`Bip01_${side}_Calf`), f = m.bone(`Bip01_${side}_Foot`);
  if (u && c && f) solveTwoBone(u, c, f, target, pole, Math.min(1, w));
}

function spine(m: CharacterModel, fr: ReturnType<typeof frame>, pitch: number, twist: number, roll = 0): void {
  const s1 = m.bone('Bip01_Spine1'), s2 = m.bone('Bip01_Spine2');
  for (const [b, k] of [[s1, 0.55], [s2, 0.45]] as const) {
    if (!b) continue;
    // positive pitch bends forward (rotation about the true right axis leans back)
    if (pitch) rotateBoneWorld(b, fr.right, -pitch * k);
    if (twist) rotateBoneWorld(b, UP, twist * k);
    if (roll) rotateBoneWorld(b, fr.fwd, roll * k);
  }
}

function headTurn(m: CharacterModel, fr: ReturnType<typeof frame>, pitch: number, yaw: number): void {
  const h = m.bone('Bip01_Head');
  if (!h) return;
  if (pitch) rotateBoneWorld(h, fr.right, -pitch);
  if (yaw) rotateBoneWorld(h, UP, yaw);
}

/** Moves the pelvis/root in character space (dx right, dy up, dz forward). */
function hip(m: CharacterModel, dx: number, dy: number, dz: number): void {
  const b = m.bone('Bip01');
  if (!b) return;
  // Bip01 lives in the model's local frame where +Z is forward and -X is right.
  b.position.x -= dx;
  b.position.y += dy;
  b.position.z += dz;
}

/** Rotates the whole body around the pelvis about the character's right axis (positive = fall back). */
function bodyPitch(m: CharacterModel, fr: ReturnType<typeof frame>, ang: number): void {
  const b = m.bone('Bip01');
  if (!b || !ang) return;
  applyWorldRotation(b, new THREE.Quaternion().setFromAxisAngle(fr.right, ang));
}

function bodyRoll(m: CharacterModel, fr: ReturnType<typeof frame>, ang: number): void {
  const b = m.bone('Bip01');
  if (!b || !ang) return;
  applyWorldRotation(b, new THREE.Quaternion().setFromAxisAngle(fr.fwd, ang));
}

/** Punch envelope: 0 = guard, 1 = full extension. */
function strike(t: number, hitAt: number, dur: number): number {
  if (t < hitAt) return smooth(0, hitAt, t) ** 1.5;
  return 1 - smooth(hitAt + 0.04, dur, t);
}

function guardHands(m: CharacterModel, fr: ReturnType<typeof frame>, w: number, extR = 0, extL = 0, lift = 0): void {
  const R = fr.chest.clone().addScaledVector(fr.fwd, 0.28 + 0.38 * extR).addScaledVector(fr.right, 0.15 - 0.13 * extR).add(new THREE.Vector3(0, 0.27 + lift - 0.04 * extR, 0));
  const L = fr.chest.clone().addScaledVector(fr.fwd, 0.3 + 0.38 * extL).addScaledVector(fr.right, -0.13 + 0.12 * extL).add(new THREE.Vector3(0, 0.3 + lift - 0.04 * extL, 0));
  const poleR = fr.right.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, -1, 0));
  const poleL = fr.right.clone().multiplyScalar(-0.9).add(new THREE.Vector3(0, -1, 0));
  arm(m, 'R', R, w, poleR);
  arm(m, 'L', L, w, poleL);
  fist(m, 'R', w);
  fist(m, 'L', w);
}

export const POSES: Record<string, PoseDef> = {
  guard: {
    dur: Infinity, canMove: true, fade: 0.15,
    apply(m, t, w) {
      const fr = frame(m);
      spine(m, fr, 0.15 * w, -0.12 * w);
      hip(m, 0, -0.04 * w, 0);
      guardHands(m, fr, w);
      void t;
    },
  },
  punch_r: {
    dur: 0.42, canMove: false, lockTurn: true, fade: 0.05,
    apply(m, t, w) {
      const fr = frame(m);
      const e = strike(t, 0.14, 0.42);
      spine(m, fr, 0.18 * w, (-0.12 + 0.5 * e) * w);
      hip(m, 0, -0.04 * w, 0.06 * e * w);
      guardHands(m, frame(m), w, e, 0);
    },
  },
  punch_l: {
    dur: 0.4, canMove: false, lockTurn: true, fade: 0.05,
    apply(m, t, w) {
      const fr = frame(m);
      const e = strike(t, 0.13, 0.4);
      spine(m, fr, 0.18 * w, (-0.1 - 0.45 * e) * w);
      hip(m, 0, -0.04 * w, 0.05 * e * w);
      guardHands(m, frame(m), w, 0, e);
    },
  },
  hook: {
    dur: 0.6, canMove: false, lockTurn: true, fade: 0.05,
    apply(m, t, w) {
      const fr = frame(m);
      const e = strike(t, 0.22, 0.6);
      const swing = smooth(0.05, 0.25, t) - smooth(0.3, 0.6, t);
      spine(m, fr, 0.2 * w, (0.55 * (1 - swing) - 0.6 * swing) * w * (e > 0.05 ? 1 : 0.5));
      const fr2 = frame(m);
      const R = fr2.chest.clone().addScaledVector(fr2.fwd, 0.25 + 0.35 * e).addScaledVector(fr2.right, 0.35 - 0.45 * swing).add(new THREE.Vector3(0, 0.25, 0));
      arm(m, 'R', R, w, fr2.right.clone().add(new THREE.Vector3(0, 0.3, 0)));
      const L = fr2.chest.clone().addScaledVector(fr2.fwd, 0.3).addScaledVector(fr2.right, -0.12).add(new THREE.Vector3(0, 0.3, 0));
      arm(m, 'L', L, w, fr2.right.clone().multiplyScalar(-0.9).add(new THREE.Vector3(0, -1, 0)));
      fist(m, 'R', w); fist(m, 'L', w);
    },
  },
  block: {
    dur: Infinity, canMove: true, fade: 0.08,
    apply(m, _t, w) {
      const fr = frame(m);
      spine(m, fr, 0.25 * w, 0);
      hip(m, 0, -0.07 * w, -0.03 * w);
      const fr2 = frame(m);
      const R = fr2.head.clone().addScaledVector(fr2.fwd, 0.22).addScaledVector(fr2.right, 0.06).add(new THREE.Vector3(0, 0.02, 0));
      const L = fr2.head.clone().addScaledVector(fr2.fwd, 0.24).addScaledVector(fr2.right, -0.06).add(new THREE.Vector3(0, -0.02, 0));
      arm(m, 'R', R, w, fr2.right.clone().add(new THREE.Vector3(0, -0.6, 0)));
      arm(m, 'L', L, w, fr2.right.clone().multiplyScalar(-1).add(new THREE.Vector3(0, -0.6, 0)));
      fist(m, 'R', w); fist(m, 'L', w);
    },
  },
  hit_react: {
    dur: 0.55, canMove: false, fade: 0.03,
    apply(m, t, w, c) {
      const fr = frame(m);
      const e = Math.sin(smooth(0, 0.55, t) * Math.PI) * w;
      const side = c.k?.side ?? 0;
      spine(m, fr, -0.35 * e, 0.3 * side * e, 0.15 * side * e);
      headTurn(m, frame(m), -0.3 * e, 0.4 * side * e);
      hip(m, 0, -0.03 * e, -0.08 * e);
    },
  },
  stagger: {
    dur: 1.0, canMove: false, fade: 0.05,
    apply(m, t, w) {
      const fr = frame(m);
      const e = Math.sin(smooth(0, 1, t) * Math.PI) * w;
      spine(m, fr, 0.5 * e, 0.2 * Math.sin(t * 9) * e);
      hip(m, 0, -0.15 * e, -0.12 * e);
      const fr2 = frame(m);
      arm(m, 'R', fr2.chest.clone().addScaledVector(fr2.fwd, 0.25).add(new THREE.Vector3(0, -0.15, 0)), e * 0.8, new THREE.Vector3(0, -1, 0));
    },
  },
  dodge: {
    dur: 0.45, canMove: false, lockTurn: true, fade: 0.04,
    apply(m, t, w, c) {
      const fr = frame(m);
      const e = Math.sin(smooth(0, 0.45, t) * Math.PI) * w;
      const side = c.k?.side ?? -1;
      spine(m, fr, 0.25 * e, 0, -0.35 * side * e);
      hip(m, 0, -0.22 * e, 0);
      guardHands(m, frame(m), w * 0.8);
    },
  },
  knockdown: {
    dur: 1.1, canMove: false, lockTurn: true, fade: 0.05,
    apply(m, t, w) {
      const fr = frame(m);
      const e = smooth(0.05, 0.75, t) * w;
      bodyPitch(m, fr, (Math.PI / 2) * e);
      hip(m, 0, -0.78 * e, -0.35 * e);
      if (e > 0.6 && t > 0.75) { const b = Math.sin((t - 0.75) * 14) * 0.03 * (1.1 - t); hip(m, 0, b, 0); }
    },
  },
  lying: {
    dur: Infinity, canMove: false, lockTurn: true, fade: 0,
    apply(m, t, w) {
      const fr = frame(m);
      bodyPitch(m, fr, (Math.PI / 2) * w);
      hip(m, 0, -0.78 * w, -0.35 * w);
      const fr2 = frame(m);
      arm(m, 'R', fr2.chest.clone().addScaledVector(fr2.right, 0.45).add(new THREE.Vector3(0, -0.05, 0)), w * 0.8, new THREE.Vector3(0, 1, 0));
      arm(m, 'L', fr2.chest.clone().addScaledVector(fr2.right, -0.4).add(new THREE.Vector3(0, -0.05, 0.1)), w * 0.8, new THREE.Vector3(0, 1, 0));
      void t;
    },
  },
  downed: {
    // Wounded on the ground, propped on one elbow, reaching out.
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.3, clip: 'idle_breathe',
    apply(m, t, w) {
      const fr = frame(m);
      bodyPitch(m, fr, 1.2 * w);
      bodyRoll(m, fr, 0.25 * w);
      hip(m, 0, -0.72 * w, -0.3 * w);
      const fr2 = frame(m);
      const reach = 0.5 + Math.sin(t * 1.3) * 0.05;
      arm(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, reach).addScaledVector(fr2.right, 0.2).add(new THREE.Vector3(0, 0.25, 0)), w, new THREE.Vector3(0, 1, 0));
      arm(m, 'L', fr2.chest.clone().addScaledVector(fr2.right, -0.3).add(new THREE.Vector3(0, -0.35, 0)), w, new THREE.Vector3(0, 1, 0));
      headTurn(m, frame(m), -0.5 * w, 0);
    },
  },
  revive: {
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.25, clip: 'crouch_idle',
    apply(m, t, w) {
      const fr = frame(m);
      spine(m, fr, 0.3 * w, 0);
      const fr2 = frame(m);
      const pump = Math.sin(t * 6) * 0.04;
      arm(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.55).addScaledVector(fr2.right, 0.1).add(new THREE.Vector3(0, 0.45 + pump, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 0.5));
      arm(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.55).addScaledVector(fr2.right, -0.1).add(new THREE.Vector3(0, 0.45 + pump, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -0.5));
    },
  },
  boost_give: {
    // Crouched with hands cupped for a partner's foot.
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.3, clip: 'crouch_idle',
    apply(m, t, w, c) {
      const fr = frame(m);
      const lift = c.k?.lift ?? 0;
      hip(m, 0, 0.35 * lift * w, 0);
      spine(m, fr, (0.25 - 0.2 * lift) * w, 0);
      const fr2 = frame(m);
      const y = 0.55 + lift * 0.75;
      arm(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.42).addScaledVector(fr2.right, 0.05).setY(fr2.base.y + y), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 1));
      arm(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.42).addScaledVector(fr2.right, -0.05).setY(fr2.base.y + y), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -1));
      void t;
    },
  },
  climb: {
    // Hands reach a ledge (points.ledge), body pitched forward; driven by a scripted move.
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.15, clip: 'idle',
    apply(m, t, w, c) {
      const fr = frame(m);
      const ledge = c.points?.ledge;
      const phase = c.k?.phase ?? 0;
      spine(m, fr, (0.35 + 0.2 * Math.sin(phase * Math.PI)) * w, 0);
      const fr2 = frame(m);
      if (ledge) {
        const l = ledge.clone();
        arm(m, 'R', l.clone().addScaledVector(fr2.right, 0.22), w, fr2.right.clone().add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(fr2.fwd, -0.5));
        arm(m, 'L', l.clone().addScaledVector(fr2.right, -0.22), w, fr2.right.clone().negate().add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(fr2.fwd, -0.5));
        // Knees come up while pulling over.
        const kneeUp = Math.sin(Math.min(1, phase) * Math.PI) * 0.45;
        leg(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.1 + kneeUp * 0.3).addScaledVector(fr2.right, 0.12).add(new THREE.Vector3(0, 0.1 + kneeUp, 0)), w * 0.8, fr2.fwd);
      }
      fist(m, 'R', 0.5 * w); fist(m, 'L', 0.5 * w);
      void t;
    },
  },
  vault: {
    dur: 0.9, canMove: false, lockTurn: true, fade: 0.08,
    apply(m, t, w, c) {
      const fr = frame(m);
      const top = c.points?.top;
      const e = Math.sin(smooth(0, 0.9, t) * Math.PI) * w;
      spine(m, fr, 0.4 * e, 0, 0.25 * e);
      if (top) arm(m, 'L', top, e, fr.right.clone().negate().add(new THREE.Vector3(0, -1, 0)));
      const fr2 = frame(m);
      leg(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.25).addScaledVector(fr2.right, 0.25).add(new THREE.Vector3(0, 0.55 * e, 0)), e, fr2.fwd);
      leg(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.15).addScaledVector(fr2.right, 0.05).add(new THREE.Vector3(0, 0.5 * e, 0)), e, fr2.fwd);
    },
  },
  push: {
    dur: Infinity, canMove: true, fade: 0.25,
    apply(m, t, w) {
      const fr = frame(m);
      spine(m, fr, 0.45 * w, 0);
      hip(m, 0, -0.1 * w, -0.08 * w);
      const fr2 = frame(m);
      const s = Math.sin(t * 5) * 0.015;
      arm(m, 'R', fr2.chest.clone().addScaledVector(fr2.fwd, 0.55 + s).addScaledVector(fr2.right, 0.22).add(new THREE.Vector3(0, 0.05, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 0.6));
      arm(m, 'L', fr2.chest.clone().addScaledVector(fr2.fwd, 0.55 - s).addScaledVector(fr2.right, -0.22).add(new THREE.Vector3(0, 0.05, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -0.6));
    },
  },
  pick_low: {
    dur: 1.1, canMove: false, lockTurn: true, fade: 0.15,
    apply(m, t, w) {
      const fr = frame(m);
      const e = Math.sin(smooth(0, 1.1, t) * Math.PI) * w;
      hip(m, 0, -0.45 * e, -0.1 * e);
      spine(m, fr, 0.6 * e, 0);
      const fr2 = frame(m);
      arm(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.45).addScaledVector(fr2.right, 0.15).add(new THREE.Vector3(0, 0.15, 0)), e, new THREE.Vector3(0, 0, -1).applyQuaternion(fr2.q).add(new THREE.Vector3(0, -0.3, 0)));
      leg(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.25).addScaledVector(fr2.right, 0.15), e, fr2.fwd);
      leg(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, -0.2).addScaledVector(fr2.right, -0.15), e, fr2.fwd);
    },
  },
  use: {
    // Working on something at chest height in front (locks, panels, screws).
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.25, clip: 'idle',
    apply(m, t, w, c) {
      const fr = frame(m);
      const h = c.k?.height ?? 1.15;
      const lean = c.k?.lean ?? 0.12;
      spine(m, fr, lean * w, 0);
      if (h < 0.8) hip(m, 0, -(0.8 - h) * 0.9 * w, -0.1 * w);
      const fr2 = frame(m);
      const wob = Math.sin(t * 7) * 0.025;
      const tgt = fr2.base.clone().addScaledVector(fr2.fwd, 0.42).setY(fr2.base.y + h);
      arm(m, 'R', tgt.clone().addScaledVector(fr2.right, 0.08 + wob).add(new THREE.Vector3(0, wob, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 1));
      arm(m, 'L', tgt.clone().addScaledVector(fr2.right, -0.1).add(new THREE.Vector3(0, 0.05, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -1));
      headTurn(m, frame(m), 0.25 * w, 0);
    },
  },
  crawl: {
    // Hands-and-knees crawl through vents. k.speed = forward speed.
    dur: Infinity, canMove: true, fade: 0.25, clip: 'idle',
    apply(m, t, w, c) {
      const fr = frame(m);
      const sp = c.k?.speed ?? 0;
      const ph = (c.k?.phase ?? t) * Math.PI * 2;
      bodyPitch(m, fr, -1.35 * w);
      hip(m, 0, -0.38 * w, -0.05 * w);
      const fr2 = frame(m);
      const amp = Math.min(1, sp / 0.8) * 0.16;
      for (const [side, s, off] of [['R', 1, 0], ['L', -1, Math.PI]] as const) {
        const st = Math.sin(ph + off) * amp;
        const lift = Math.max(0, Math.cos(ph + off)) * amp * 0.6;
        arm(m, side, fr2.chest.clone().addScaledVector(fr2.fwd, 0.25 + st).addScaledVector(fr2.right, 0.2 * s).setY(fr2.base.y + 0.04 + lift), w, fr2.fwd.clone().negate().add(new THREE.Vector3(0, 0.3, 0)));
        const knee = Math.sin(ph + off + Math.PI) * amp;
        leg(m, side, fr2.base.clone().addScaledVector(fr2.fwd, -0.55 + knee).addScaledVector(fr2.right, 0.13 * s).setY(fr2.base.y + 0.12 + Math.max(0, Math.cos(ph + off + Math.PI)) * amp * 0.4), w, fr2.fwd.clone().negate().add(new THREE.Vector3(0, -1, 0)));
      }
      headTurn(m, frame(m), -0.9 * w, 0);
    },
  },
  hands_up: {
    dur: Infinity, canMove: false, fade: 0.4,
    apply(m, _t, w) {
      const fr = frame(m);
      arm(m, 'R', fr.head.clone().addScaledVector(fr.right, 0.35).add(new THREE.Vector3(0, 0.25, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr.right, 1));
      arm(m, 'L', fr.head.clone().addScaledVector(fr.right, -0.35).add(new THREE.Vector3(0, 0.25, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr.right, -1));
    },
  },
  aim: {
    // Pointing a pistol forward with both hands.
    dur: Infinity, canMove: true, fade: 0.25,
    apply(m, _t, w, c) {
      const fr = frame(m);
      const pitch = c.k?.pitch ?? 0;
      spine(m, fr, 0.05 * w, 0.1 * w);
      const fr2 = frame(m);
      const tgt = fr2.chest.clone().addScaledVector(fr2.fwd, 0.62).add(new THREE.Vector3(0, 0.2 + pitch, 0));
      arm(m, 'R', tgt.clone().addScaledVector(fr2.right, 0.02), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 0.6));
      arm(m, 'L', tgt.clone().addScaledVector(fr2.fwd, -0.06).addScaledVector(fr2.right, -0.04).add(new THREE.Vector3(0, -0.04, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -0.6));
      fist(m, 'R', 0.7 * w); fist(m, 'L', 0.6 * w);
    },
  },
  kneel: {
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.6, clip: 'crouch_idle',
    apply(m, _t, w) {
      const fr = frame(m);
      spine(m, fr, 0.35 * w, 0);
      headTurn(m, frame(m), 0.45 * w, 0);
    },
  },
  sit_ground: {
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.5, clip: 'idle_breathe',
    apply(m, _t, w) {
      const fr = frame(m);
      hip(m, 0, -0.68 * w, -0.1 * w);
      spine(m, fr, 0.2 * w, 0);
      const fr2 = frame(m);
      leg(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.55).addScaledVector(fr2.right, 0.2).setY(fr2.base.y + 0.06), w, new THREE.Vector3(0, 1, 0).addScaledVector(fr2.fwd, 0.5));
      leg(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.45).addScaledVector(fr2.right, -0.2).setY(fr2.base.y + 0.06), w, new THREE.Vector3(0, 1, 0).addScaledVector(fr2.fwd, 0.5));
      arm(m, 'R', fr2.base.clone().addScaledVector(fr2.fwd, 0.45).addScaledVector(fr2.right, 0.22).setY(fr2.base.y + 0.45), w, new THREE.Vector3(0, -1, 0));
      arm(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.4).addScaledVector(fr2.right, -0.22).setY(fr2.base.y + 0.45), w, new THREE.Vector3(0, -1, 0));
    },
  },
  ride: {
    // Seated on a dirt bike. points: grips L/R, pegs L/R, seat. k: lean, stand (0..1), steer.
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.2, clip: 'idle_breathe',
    apply(m, _t, w, c) {
      const p = c.points;
      if (!p) return;
      const fr = frame(m);
      const stand = c.k?.stand ?? 0;
      const lean = c.k?.lean ?? 0;
      // Root is placed at the seat by the bike; drop the pelvis onto the seat.
      const hipB = m.bone('Bip01')!;
      const want = p.seat;
      const cur = hipB.getWorldPosition(V());
      const local = m.root.worldToLocal(want.clone());
      const curL = m.root.worldToLocal(cur.clone());
      hipB.position.x += (local.x - curL.x) * w;
      hipB.position.y += (local.y - curL.y + stand * 0.32) * w;
      hipB.position.z += (local.z - curL.z - stand * 0.05) * w;
      spine(m, frame(m), (0.55 - 0.2 * stand) * w, (c.k?.steer ?? 0) * 0.3 * w, -lean * 0.2 * w);
      const fr2 = frame(m);
      arm(m, 'R', p.gripR, w, fr2.right.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fr2.fwd, -0.4));
      arm(m, 'L', p.gripL, w, fr2.right.clone().multiplyScalar(-0.7).add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fr2.fwd, -0.4));
      leg(m, 'R', p.pegR, w, fr2.fwd.clone().add(new THREE.Vector3(0, 0.3, 0)));
      leg(m, 'L', p.pegL, w, fr2.fwd.clone().add(new THREE.Vector3(0, 0.3, 0)));
      fist(m, 'R', 0.8 * w); fist(m, 'L', 0.8 * w);
      void fr;
    },
  },
  choke: {
    // Rear takedown: arms around the victim's neck (points.neck).
    dur: 2.4, canMove: false, lockTurn: true, fade: 0.1,
    apply(m, t, w, c) {
      const fr = frame(m);
      const neck = c.points?.neck ?? fr.chest.clone().addScaledVector(fr.fwd, 0.4).add(new THREE.Vector3(0, 0.25, 0));
      const e = smooth(0, 0.25, t) * (1 - smooth(2.1, 2.4, t)) * w;
      spine(m, fr, 0.2 * e, Math.sin(t * 10) * 0.05 * e);
      hip(m, 0, -0.12 * e, 0);
      const fr2 = frame(m);
      arm(m, 'R', neck.clone().addScaledVector(fr2.right, -0.08).addScaledVector(fr2.fwd, 0.05), e, fr2.right.clone().add(new THREE.Vector3(0, -0.3, 0)));
      arm(m, 'L', neck.clone().addScaledVector(fr2.right, 0.12).addScaledVector(fr2.fwd, -0.05).add(new THREE.Vector3(0, 0.08, 0)), e, fr2.right.clone().negate().add(new THREE.Vector3(0, -0.3, 0)));
    },
  },
  choked: {
    // Victim of a rear takedown: struggles, then goes limp and drops.
    dur: 2.4, canMove: false, lockTurn: true, fade: 0.1,
    apply(m, t, w) {
      const fr = frame(m);
      const s = smooth(0, 0.3, t) * w;
      const limp = smooth(1.5, 2.3, t);
      spine(m, fr, (-0.3 * s) * (1 - limp) + 0.4 * limp * w, Math.sin(t * 12) * 0.1 * s * (1 - limp));
      headTurn(m, frame(m), (-0.4 * s) * (1 - limp) + 0.6 * limp * w, 0);
      const fr2 = frame(m);
      const flail = Math.sin(t * 15) * 0.06 * (1 - limp);
      arm(m, 'R', fr2.head.clone().addScaledVector(fr2.fwd, -0.05).addScaledVector(fr2.right, 0.1).add(new THREE.Vector3(0, -0.15 + flail, 0)), s * (1 - limp), new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 1));
      arm(m, 'L', fr2.head.clone().addScaledVector(fr2.fwd, -0.05).addScaledVector(fr2.right, -0.1).add(new THREE.Vector3(0, -0.15 - flail, 0)), s * (1 - limp), new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -1));
      hip(m, 0, -0.6 * limp * w, 0);
    },
  },
  talk_phone: {
    dur: Infinity, canMove: true, fade: 0.3, upperClip: 'phone_talk',
    apply() { /* clip only */ },
  },
  arm_wrestle: {
    // Bent over a table, right elbow down, hand locked with the opponent's at points.grip (shared point),
    // left hand flat on the table. k.strain 0..1 adds effort shake.
    dur: Infinity, canMove: false, lockTurn: true, fade: 0.3, clip: 'idle',
    apply(m, t, w, c) {
      const fr = frame(m);
      const strain = c.k?.strain ?? 0.5;
      spine(m, fr, 0.78 * w, 0.18 * w);
      hip(m, 0, -0.34 * w, 0.04 * w);
      const fr2 = frame(m);
      const shake = Math.sin(t * 23) * 0.008 * strain;
      const grip = c.points?.grip ?? fr2.chest.clone().addScaledVector(fr2.fwd, 0.5);
      const table = c.k?.table ?? grip.y - 0.25;
      arm(m, 'R', grip.clone().add(new THREE.Vector3(shake, shake * 0.5, 0)), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.fwd, 0.4).addScaledVector(fr2.right, 0.3));
      fist(m, 'R', w);
      arm(m, 'L', fr2.base.clone().addScaledVector(fr2.fwd, 0.42).addScaledVector(fr2.right, -0.32).setY(table + 0.04), w, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -1));
      headTurn(m, frame(m), -0.25 * w, 0);
    },
  },
  shoot: {
    // Basketball shot: dip, raise the ball overhead, release toward the hoop (release at ~0.55 s).
    dur: 1.05, canMove: false, lockTurn: true, fade: 0.1,
    apply(m, t, w) {
      const fr = frame(m);
      const dip = Math.sin(smooth(0, 0.45, t) * Math.PI) * w;
      hip(m, 0, -0.14 * dip, 0);
      spine(m, fr, -0.08 * w * smooth(0.3, 0.6, t), 0);
      const fr2 = frame(m);
      const raise = smooth(0.05, 0.5, t), rel = smooth(0.5, 0.7, t), back = smooth(0.8, 1.05, t);
      const ball = fr2.chest.clone().addScaledVector(fr2.fwd, 0.32).add(new THREE.Vector3(0, -0.1, 0))
        .lerp(fr2.head.clone().addScaledVector(fr2.fwd, 0.18).add(new THREE.Vector3(0, 0.28, 0)), raise)
        .lerp(fr2.head.clone().addScaledVector(fr2.fwd, 0.45).add(new THREE.Vector3(0, 0.42, 0)), rel)
        .lerp(fr2.chest.clone().addScaledVector(fr2.fwd, 0.3), back);
      const e = w * (1 - back * 0.9);
      arm(m, 'R', ball.clone().addScaledVector(fr2.right, 0.06).addScaledVector(fr2.fwd, -0.06), e, new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, 1));
      arm(m, 'L', ball.clone().addScaledVector(fr2.right, -0.13).add(new THREE.Vector3(0, -0.04, 0)), e * (1 - rel), new THREE.Vector3(0, -1, 0).addScaledVector(fr2.right, -1));
    },
  },
};

/** Applies a pose (by name) with blend weight to a model; used by both local and remote characters. */
export function applyPose(m: CharacterModel, name: string, t: number, w: number, c: PoseCtx = {}): void {
  const p = POSES[name];
  if (!p || w <= 0) return;
  p.apply(m, t, Math.min(1, w), c);
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
}

void lerp;
