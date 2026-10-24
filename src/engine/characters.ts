import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLTF, loadJSON, loadTexture } from './assets';

export type Sex = 'm' | 'f';
export interface ClipMeta { duration: number; speed: number; loop: boolean; src: string }
interface ClipsFile { [sex: string]: { hipY: number; clips: Record<string, ClipMeta> } }
export interface CharacterEntry {
  file: string;
  sex: Sex;
  role: string;
  hipY: number;
  height: number;
  defaultVariant?: string;
  variants?: Record<string, { material: string; map: string | null }>;
}

const UPPER = /Spine1|Spine2|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger/;

/** Loads the character manifest, avatars and shared animation clips. */
export class CharacterLibrary {
  manifest: Record<string, CharacterEntry> = {};
  clipMeta: ClipsFile = {};
  private clips = new Map<Sex, Map<string, THREE.AnimationClip>>();
  private upperClips = new Map<Sex, Map<string, THREE.AnimationClip>>();
  private lowerClips = new Map<Sex, Map<string, THREE.AnimationClip>>();
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        loadJSON<Record<string, CharacterEntry>>('characters/manifest.json'),
        loadJSON<ClipsFile>('anims/clips.json'),
      ]).then(([m, c]) => {
        this.manifest = m;
        this.clipMeta = c;
      });
    }
    return this.ready;
  }

  async ensureClips(sex: Sex): Promise<Map<string, THREE.AnimationClip>> {
    const have = this.clips.get(sex);
    if (have) return have;
    const gltf = await loadGLTF(`anims/anims_${sex}.glb`);
    const map = new Map<string, THREE.AnimationClip>();
    const up = new Map<string, THREE.AnimationClip>();
    const low = new Map<string, THREE.AnimationClip>();
    for (const clip of gltf.animations) {
      map.set(clip.name, clip);
      up.set(clip.name, new THREE.AnimationClip(clip.name + '#upper', clip.duration, clip.tracks.filter((t) => UPPER.test(t.name))));
      low.set(clip.name, new THREE.AnimationClip(clip.name + '#lower', clip.duration, clip.tracks.filter((t) => !UPPER.test(t.name))));
    }
    this.clips.set(sex, map);
    this.upperClips.set(sex, up);
    this.lowerClips.set(sex, low);
    return map;
  }

  clip(sex: Sex, name: string, part: 'full' | 'upper' | 'lower' = 'full'): THREE.AnimationClip | undefined {
    const src = part === 'full' ? this.clips : part === 'upper' ? this.upperClips : this.lowerClips;
    return src.get(sex)?.get(name) ?? (sex === 'f' ? src.get('m')?.get(name) : undefined);
  }

  meta(sex: Sex, name: string): ClipMeta | undefined {
    return this.clipMeta[sex]?.clips[name] ?? this.clipMeta.m?.clips[name];
  }

  async create(id: string, variant?: string): Promise<CharacterModel> {
    await this.init();
    const entry = this.manifest[id];
    if (!entry) throw new Error('unknown character ' + id);
    const [gltf] = await Promise.all([loadGLTF('characters/' + entry.file), this.ensureClips(entry.sex), entry.sex === 'f' ? this.ensureClips('m') : null]);
    const scene = cloneSkinned(gltf.scene);
    let variantMap: THREE.Texture | null = null;
    const v = variant && entry.variants?.[variant];
    if (v && v.map) variantMap = await loadTexture('characters/' + v.map, { flipY: false });
    return new CharacterModel(this, id, entry, scene, variantMap, v ? v.material : null);
  }
}

export type Layer = 'full' | 'upper';
export interface PlayOpts {
  layer?: Layer;
  loop?: boolean;
  fade?: number;
  timeScale?: number;
  /** Hold the last frame when a non-looping clip ends. */
  hold?: boolean;
  startAt?: number;
  onEnd?: () => void;
}

interface Override {
  name: string;
  action: THREE.AnimationAction;
  lowerAction?: THREE.AnimationAction;
  weight: number;
  target: number;
  fade: number;
  opts: PlayOpts;
  ended: boolean;
}

export interface LocoSet { idle: string; walk: string; run: string; sprint: string }
export const LOCO_NORMAL: LocoSet = { idle: 'idle', walk: 'walk', run: 'run', sprint: 'run_fast' };
export const LOCO_INJURED: LocoSet = { idle: 'idle_breathe', walk: 'walk_injured', run: 'run_injured', sprint: 'run_injured' };
export const LOCO_GUARD: LocoSet = { idle: 'idle_look', walk: 'walk_slow', run: 'run', sprint: 'run_fast' };

/**
 * A skinned Rocketbox avatar with phase-synchronised locomotion blending, gesture layers
 * and a procedural layer (look-at, speech jaw, blinking, IK hooks).
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones = new Map<string, THREE.Object3D>();
  readonly mixer: THREE.AnimationMixer;
  readonly sex: Sex;
  readonly height: number;
  private hipScale: number;
  private hip: THREE.Object3D;
  private actionCache = new Map<string, THREE.AnimationAction>();
  private locoSet: LocoSet = LOCO_NORMAL;
  phase = 0;
  private speed = 0;
  private crouch = 0;
  private crouchTarget = 0;
  private idleName = 'idle';
  private overrides: { full: Override | null; upper: Override | null } = { full: null, upper: null };
  private fading: Override[] = [];
  /** Extra procedural pose hooks run after animation sampling (IK etc.). */
  readonly postHooks: Array<(m: CharacterModel, dt: number) => void> = [];
  lookTarget: THREE.Vector3 | null = null;
  private lookWeight = 0;
  speaking = 0;
  private speakPhase = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blinkAmt = 0;
  /** Lean (radians) applied to spine when turning/riding. */
  lean = 0;
  /** Forward bend of the spine (radians), used for crouch-walk and riding. */
  bend = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(
    readonly lib: CharacterLibrary,
    readonly id: string,
    readonly entry: CharacterEntry,
    scene: THREE.Object3D,
    variantMap: THREE.Texture | null,
    variantMaterial: string | null,
  ) {
    this.sex = entry.sex;
    this.height = entry.height;
    this.root.name = 'char:' + id;
    this.root.add(scene);
    let mesh: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if (o.name && !this.bones.has(o.name)) this.bones.set(o.name, o);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        mesh = o as THREE.SkinnedMesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const out = mats.map((m) => {
          const sm = m as THREE.MeshStandardMaterial;
          if (variantMap && sm.name === variantMaterial) {
            const c = sm.clone();
            variantMap.colorSpace = THREE.SRGBColorSpace;
            c.map = variantMap;
            return c;
          }
          return sm;
        });
        mesh.material = Array.isArray(mesh.material) ? out : out[0];
      }
    });
    if (!mesh) throw new Error('no skinned mesh in ' + id);
    this.mesh = mesh;
    this.hip = this.bones.get('Bip01')!;
    const animHip = lib.clipMeta[this.sex]?.hipY ?? 0.9;
    this.hipScale = entry.hipY / animHip;
    this.mixer = new THREE.AnimationMixer(scene);
    this.setIdle('idle');
  }

  bone(name: string): THREE.Object3D | undefined {
    return this.bones.get(name) ?? this.bones.get(name.replace(/ /g, '_'));
  }

  private action(name: string, part: 'full' | 'upper' | 'lower' = 'full'): THREE.AnimationAction | null {
    const key = name + '#' + part;
    let a = this.actionCache.get(key);
    if (a) return a;
    const clip = this.lib.clip(this.sex, name, part);
    if (!clip) return null;
    a = this.mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    this.actionCache.set(key, a);
    return a;
  }

  get locoSpeed(): number { return this.speed; }

  setLocoSet(set: LocoSet): void {
    this.locoSet = set;
    this.idleName = set.idle;
  }

  setIdle(name: string): void {
    this.idleName = name;
  }

  /** Speed in m/s along the ground, crouch 0..1. */
  setLocomotion(speed: number, crouch = false): void {
    this.speed = speed;
    this.crouchTarget = crouch ? 1 : 0;
  }

  play(name: string, opts: PlayOpts = {}): void {
    const layer = opts.layer ?? 'full';
    const meta = this.lib.meta(this.sex, name);
    const action = this.action(name, layer === 'upper' ? 'upper' : 'full');
    if (!action) {
      console.warn('missing clip', name);
      opts.onEnd?.();
      return;
    }
    const prev = this.overrides[layer];
    if (prev && prev.name === name && !prev.ended) {
      prev.target = 1;
      return;
    }
    if (prev) {
      prev.target = 0;
      this.fading.push(prev);
    }
    const loop = opts.loop ?? meta?.loop ?? true;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = opts.timeScale ?? 1;
    action.time = opts.startAt ?? 0;
    action.setEffectiveWeight(0);
    action.play();
    const ov: Override = { name, action, weight: 0, target: 1, fade: opts.fade ?? 0.25, opts: { ...opts, loop }, ended: false };
    if (layer === 'upper') ov.lowerAction = undefined;
    this.overrides[layer] = ov;
  }

  stop(layer: Layer = 'full', fade = 0.3): void {
    const ov = this.overrides[layer];
    if (!ov) return;
    ov.target = 0;
    ov.fade = fade;
    this.fading.push(ov);
    this.overrides[layer] = null;
  }

  isPlaying(name: string): boolean {
    return this.overrides.full?.name === name || this.overrides.upper?.name === name;
  }

  current(layer: Layer = 'full'): string | null {
    return this.overrides[layer]?.name ?? null;
  }

  update(dt: number): void {
    // --- override weights
    const step = (ov: Override) => {
      const rate = dt / Math.max(ov.fade, 0.001);
      ov.weight += Math.sign(ov.target - ov.weight) * Math.min(rate, Math.abs(ov.target - ov.weight));
      if (!ov.opts.loop && !ov.ended && ov.action.time >= ov.action.getClip().duration - 1e-3) {
        ov.ended = true;
        ov.opts.onEnd?.();
        if (!ov.opts.hold) {
          ov.target = 0;
        }
      }
    };
    for (const layer of ['full', 'upper'] as const) {
      const ov = this.overrides[layer];
      if (ov) {
        step(ov);
        if (ov.ended && !ov.opts.hold && ov.weight <= 0) this.overrides[layer] = null;
      }
    }
    for (const ov of this.fading) step(ov);
    this.fading = this.fading.filter((ov) => {
      if (ov.weight <= 0) {
        ov.action.setEffectiveWeight(0);
        return false;
      }
      return true;
    });

    const fullW = this.overrides.full?.weight ?? 0;
    const fadingFull = this.fading.filter((o) => o.action.getClip().name.indexOf('#') < 0).reduce((s, o) => s + o.weight, 0);
    const upperW = (this.overrides.upper?.weight ?? 0) + this.fading.filter((o) => o.action.getClip().name.endsWith('#upper')).reduce((s, o) => s + o.weight, 0);
    const baseW = Math.max(0, 1 - Math.min(1, fullW + fadingFull));

    // --- locomotion weights with phase sync
    this.crouch += (this.crouchTarget - this.crouch) * Math.min(1, dt * 6);
    const L = this.locoSet;
    const pts: Array<[string, number]> = [
      [this.crouch > 0.5 ? 'crouch_idle' : this.idleName, 0],
      [L.walk, this.lib.meta(this.sex, L.walk)?.speed || 1],
      [L.run, this.lib.meta(this.sex, L.run)?.speed || 2.9],
      [L.sprint, this.lib.meta(this.sex, L.sprint)?.speed || 5.8],
    ];
    const v = this.speed;
    const w = [0, 0, 0, 0];
    if (v <= 0.05) w[0] = 1;
    else if (v < pts[1][1]) { const t = v / pts[1][1]; w[0] = 1 - t; w[1] = t; }
    else if (v < pts[2][1]) { const t = (v - pts[1][1]) / (pts[2][1] - pts[1][1]); w[1] = 1 - t; w[2] = t; }
    else if (v < pts[3][1]) { const t = (v - pts[2][1]) / (pts[3][1] - pts[2][1]); w[2] = 1 - t; w[3] = t; }
    else w[3] = 1;
    // stride length per cycle for each moving clip
    let stride = 0, sw = 0;
    for (let i = 1; i < 4; i++) {
      const m = this.lib.meta(this.sex, pts[i][0]);
      if (!m || w[i] === 0) continue;
      stride += m.speed * m.duration * w[i];
      sw += w[i];
    }
    if (sw > 0 && stride > 0) this.phase = (this.phase + (v * dt) / (stride / sw)) % 1;
    const upperShare = Math.min(1, upperW);
    for (let i = 0; i < 4; i++) {
      const name = pts[i][0];
      const full = this.action(name, 'full');
      const lower = upperShare > 0 ? this.action(name, 'lower') : null;
      const wt = w[i] * baseW;
      if (full) {
        full.setEffectiveWeight(wt * (1 - upperShare));
        if (i > 0) { full.time = this.phase * full.getClip().duration; full.timeScale = 0; }
      }
      if (lower) {
        lower.setEffectiveWeight(wt * upperShare);
        if (i > 0) { lower.time = this.phase * lower.getClip().duration; lower.timeScale = 0; }
        else lower.time = full ? full.time : lower.time;
      }
    }
    // Disable locomotion actions that are not part of the current set.
    const active = new Set(pts.map((p) => p[0]));
    for (const [key, a] of this.actionCache) {
      const base = key.split('#')[0];
      const part = key.split('#')[1];
      const isOverride = this.overrides.full?.action === a || this.overrides.upper?.action === a || this.fading.some((o) => o.action === a);
      if (isOverride) continue;
      if (!active.has(base) && a.getEffectiveWeight() > 0) a.setEffectiveWeight(0);
      if (part === 'upper' && !isOverride) a.setEffectiveWeight(0);
    }
    for (const layer of ['full', 'upper'] as const) {
      const ov = this.overrides[layer];
      if (ov) ov.action.setEffectiveWeight(ov.weight);
    }
    for (const ov of this.fading) ov.action.setEffectiveWeight(ov.weight);

    this.mixer.update(dt);
    this.hip.position.y *= this.hipScale;
    if (this.crouch > 0.01 && v > 0.05) this.applyCrouchWalk(this.crouch);
    this.applyProcedural(dt);
    for (const h of this.postHooks) h(this, dt);
  }

  /** Lowers the pelvis and bends the knees for a sneaking gait. */
  private applyCrouchWalk(k: number): void {
    this.hip.position.y -= 0.32 * k;
    this.bend = Math.max(this.bend, 0.35 * k);
    this.root.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const thigh = this.bone(`Bip01_${side}_Thigh`);
      const calf = this.bone(`Bip01_${side}_Calf`);
      const foot = this.bone(`Bip01_${side}_Foot`);
      if (!thigh || !calf || !foot) continue;
      // Foot target = where the foot was before lowering the hip.
      const target = foot.getWorldPosition(new THREE.Vector3());
      target.y += 0.32 * k * this.root.scale.y;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(this.tmpQ));
      solveTwoBone(thigh, calf, foot, target, fwd);
    }
  }

  private applyProcedural(dt: number): void {
    const spine = this.bone('Bip01_Spine1');
    const spine2 = this.bone('Bip01_Spine2');
    if (spine && (Math.abs(this.bend) > 1e-3 || Math.abs(this.lean) > 1e-3)) {
      this.root.updateMatrixWorld(true);
      const rq = this.root.getWorldQuaternion(this.tmpQ);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rq);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rq);
      rotateBoneWorld(spine, right, this.bend * 0.6);
      if (spine2) rotateBoneWorld(spine2, right, this.bend * 0.4);
      rotateBoneWorld(spine, fwd, -this.lean * 0.5);
    }
    this.bend *= Math.max(0, 1 - dt * 8);
    // Head look-at
    const head = this.bone('Bip01_Head');
    const neck = this.bone('Bip01_Neck');
    this.lookWeight += ((this.lookTarget ? 1 : 0) - this.lookWeight) * Math.min(1, dt * 4);
    if (head && neck && this.lookTarget && this.lookWeight > 0.01) {
      this.root.updateMatrixWorld(true);
      const hp = head.getWorldPosition(this.tmpV);
      const toT = this.tmpV2.copy(this.lookTarget).sub(hp).normalize();
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(this.tmpQ));
      // Clamp the look direction to a cone in front of the character.
      const ang = fwd.angleTo(toT);
      const maxA = 1.1;
      if (ang > maxA) toT.lerpVectors(fwd, toT, maxA / ang).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(fwd, toT);
      const id = new THREE.Quaternion();
      const qn = id.clone().slerp(q, 0.4 * this.lookWeight);
      const qh = id.clone().slerp(q, 0.6 * this.lookWeight);
      applyWorldRotation(neck, qn);
      applyWorldRotation(head, qh);
    }
    // Speech jaw movement
    const jaw = this.bone('Bip01_MJaw');
    if (jaw) {
      if (this.speaking > 0) {
        this.speakPhase += dt * (9 + Math.sin(this.speakPhase * 0.37) * 3);
        const open = Math.max(0, Math.sin(this.speakPhase) * 0.5 + Math.sin(this.speakPhase * 2.3) * 0.3) * 0.16 * this.speaking;
        jaw.rotateZ(-open);
      }
    }
    // Blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer < 0) {
      this.blinkAmt = 1;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    if (this.blinkAmt > 0) {
      this.blinkAmt = Math.max(0, this.blinkAmt - dt * 7);
      const b = Math.sin(this.blinkAmt * Math.PI);
      for (const side of ['L', 'R']) {
        const top = this.bone(`Bip01_${side}EyeBlinkTop`);
        if (top) top.position.y -= 0.006 * b;
      }
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

// ---------- bone helpers ----------
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Rotates a bone around a world-space axis by angle (keeps children attached). */
export function rotateBoneWorld(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void {
  _q.setFromAxisAngle(axisWorld, angle);
  applyWorldRotation(bone, _q);
}

/** Pre-multiplies a world-space rotation onto a bone's world orientation. */
export function applyWorldRotation(bone: THREE.Object3D, qWorld: THREE.Quaternion): void {
  const parent = bone.parent!;
  parent.updateMatrixWorld(true);
  const pq = parent.getWorldQuaternion(_q2);
  const wq = pq.clone().multiply(bone.quaternion); // bone world rotation
  wq.premultiply(qWorld);
  bone.quaternion.copy(pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
}

/** Rotates `bone` so that the direction to `childWorld` points toward `targetWorld`. */
export function aimBone(bone: THREE.Object3D, childWorld: THREE.Vector3, targetWorld: THREE.Vector3, weight = 1): void {
  const bp = bone.getWorldPosition(_v.clone());
  const a = childWorld.clone().sub(bp).normalize();
  const b = targetWorld.clone().sub(bp).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(a, b);
  if (weight < 1) q.slerp(new THREE.Quaternion(), 1 - weight);
  applyWorldRotation(bone, q);
}

/**
 * Analytic two-bone IK (thigh/calf/foot or upperarm/forearm/hand).
 * `pole` is a world direction the middle joint should bend toward.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  mid: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
): void {
  upper.updateMatrixWorld(true);
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = mid.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const la = a.distanceTo(b);
  const lb = b.distanceTo(c);
  const t = target.clone();
  if (weight < 1) t.lerpVectors(c, target, weight);
  const toT = t.clone().sub(a);
  let d = toT.length();
  d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-4), la + lb - 1e-4);
  const dir = toT.normalize();
  // Angle at the upper joint from law of cosines.
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
  const angA = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
  // Bend plane defined by dir and pole.
  const poleDir = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  if (poleDir.lengthSq() < 1e-6) poleDir.set(0, 0, 1);
  const knee = a.clone().add(dir.clone().multiplyScalar(Math.cos(angA) * la)).add(poleDir.multiplyScalar(Math.sin(angA) * la));
  aimBone(upper, b, knee);
  mid.updateMatrixWorld(true);
  const c2 = end.getWorldPosition(new THREE.Vector3());
  const finalT = a.clone().add(dir.multiplyScalar(d));
  aimBone(mid, c2, finalT);
}
