// The World holds the scene, collision, lighting environment and registries for one chapter.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CollisionWorld, type Surface } from '../engine/physics';
import { MaterialLib, canvasTexture, DRAW } from '../engine/materials';
import { CharacterLibrary } from '../engine/characters';
import type { AudioManager, Sound } from '../engine/audio';
import { loadEnvironment, loadGLTF, loadJSON } from '../engine/assets';
import type { QualitySettings } from '../engine/quality';
import type { Grade } from '../engine/renderer';
import { Particles } from './particles';

export type Team = 'prisoner' | 'guard' | 'police' | 'thug' | 'neutral';

export interface Actor {
  id: string;
  kind: 'player' | 'npc';
  team: Team;
  pos: THREE.Vector3;
  yaw: number;
  radius: number;
  height: number;
  alive: boolean;
  /** Not drawn/collidable (hidden in locker, in vent...). */
  hidden?: boolean;
  crouched?: boolean;
  /** Pushes others away (characters). */
  solid?: boolean;
}

export interface Noise {
  pos: THREE.Vector3;
  radius: number;
  time: number;
  source: string;
  kind: 'step' | 'fight' | 'impact' | 'distraction' | 'alarm' | 'voice';
}

export interface EnvSettings {
  hdr?: string;
  background?: THREE.ColorRepresentation | 'hdr';
  envIntensity?: number;
  fog?: { color: THREE.ColorRepresentation; near?: number; far?: number; density?: number };
  hemi?: { sky: THREE.ColorRepresentation; ground: THREE.ColorRepresentation; intensity: number };
  sun?: { color: THREE.ColorRepresentation; intensity: number; dir: [number, number, number]; shadows?: boolean };
  grade?: Grade;
  reverb?: number;
}

interface ModelMeta { file: string; size: [number, number, number]; tris: number }

export class World {
  readonly scene = new THREE.Scene();
  readonly physics = new CollisionWorld();
  readonly root = new THREE.Group();
  readonly actors = new Map<string, Actor>();
  noises: Noise[] = [];
  readonly particles: Particles;
  sun: THREE.DirectionalLight | null = null;
  hemi: THREE.HemisphereLight | null = null;
  time = 0;
  private envTex: THREE.Texture | null = null;
  private loops: Sound[] = [];
  private modelMeta: Record<string, ModelMeta> = {};
  /** Objects updated every frame (animated props). */
  readonly tickers = new Set<(dt: number, t: number) => void>();
  private shadowTarget = new THREE.Vector3();

  constructor(readonly mats: MaterialLib, readonly chars: CharacterLibrary, readonly audio: AudioManager, public q: QualitySettings) {
    this.scene.add(this.root);
    this.particles = new Particles(this.scene, q);
  }

  async init(): Promise<void> {
    await Promise.all([this.mats.init(), this.chars.init(), loadJSON<Record<string, ModelMeta>>('models/models.json').then((m) => { this.modelMeta = m; })]);
  }

  async setEnvironment(e: EnvSettings): Promise<void> {
    if (e.hdr) {
      try {
        const tex = await loadEnvironment(e.hdr);
        this.envTex = tex;
        this.scene.environment = tex;
        if (e.background === 'hdr') {
          this.scene.background = tex;
          this.scene.backgroundIntensity = e.envIntensity ?? 1;
        }
        this.scene.environmentIntensity = e.envIntensity ?? 1;
      } catch (err) { console.warn('env failed', err); }
    }
    if (e.background !== undefined && e.background !== 'hdr') this.scene.background = new THREE.Color(e.background);
    if (e.fog) {
      this.scene.fog = e.fog.density !== undefined
        ? new THREE.FogExp2(e.fog.color, e.fog.density)
        : new THREE.Fog(e.fog.color, e.fog.near ?? 10, e.fog.far ?? Math.min(this.q.drawDistance, 120));
    }
    if (e.hemi) {
      this.hemi = new THREE.HemisphereLight(e.hemi.sky, e.hemi.ground, e.hemi.intensity);
      this.scene.add(this.hemi);
    }
    if (e.sun) {
      const s = new THREE.DirectionalLight(e.sun.color, e.sun.intensity);
      const d = new THREE.Vector3(...e.sun.dir).normalize();
      s.position.copy(d).multiplyScalar(40);
      s.userData.dir = d;
      s.castShadow = !!e.sun.shadows && this.q.shadows;
      const r = this.q.shadowRange;
      s.shadow.camera.left = -r; s.shadow.camera.right = r; s.shadow.camera.top = r; s.shadow.camera.bottom = -r;
      s.shadow.camera.near = 1; s.shadow.camera.far = 120;
      s.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.03;
      this.scene.add(s, s.target);
      this.sun = s;
    }
    this.audio.setReverb(e.reverb ?? 0.3);
  }

  /** Keeps the sun shadow frustum centred around the focus point. */
  updateShadowFocus(p: THREE.Vector3): void {
    if (!this.sun) return;
    const d = this.sun.userData.dir as THREE.Vector3;
    // Snap to texel grid to avoid shimmering.
    const r = this.q.shadowRange;
    const texel = (2 * r) / this.q.shadowMapSize;
    this.shadowTarget.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, Math.round(p.z / texel) * texel);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(d, 50);
    this.sun.target.updateMatrixWorld();
  }

  /** Clones an imported model (static or skinned). */
  async model(id: string, opts: { shadows?: boolean; receive?: boolean } = {}): Promise<THREE.Object3D> {
    const meta = this.modelMeta[id];
    const g = await loadGLTF(meta ? meta.file : `models/${id}.glb`);
    let skinned = false;
    g.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
    const obj = skinned ? cloneSkinned(g.scene) : g.scene.clone(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = opts.shadows ?? true;
        m.receiveShadow = opts.receive ?? true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.isMeshStandardMaterial && sm.envMapIntensity === 1) sm.envMapIntensity = 0.7;
        }
      }
    });
    return obj;
  }

  modelSize(id: string): THREE.Vector3 {
    const m = this.modelMeta[id];
    return m ? new THREE.Vector3(...m.size) : new THREE.Vector3(1, 1, 1);
  }

  addNoise(pos: THREE.Vector3, radius: number, source: string, kind: Noise['kind'] = 'step'): void {
    this.noises.push({ pos: pos.clone(), radius, time: this.time, source, kind });
  }

  /** A cheap blob shadow under a character or prop (used when real shadows are off). */
  blobShadow(size = 0.9): THREE.Mesh {
    const tex = canvasTexture('softShadow', DRAW.softShadow, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6 }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    return m;
  }

  ambientLoop(name: string, volume = 0.5, pos?: THREE.Vector3): Sound {
    const s = this.audio.play(name, { bus: 'ambience', loop: true, volume, fadeIn: 1.5, pos, ref: pos ? 4 : undefined });
    this.loops.push(s);
    return s;
  }

  surfaceAt(x: number, z: number, y: number): Surface {
    if (this.physics.water.length && this.physics.inWater(x, z, y + 0.08)) return 'water';
    return this.physics.groundAt(x, z, y + 0.3)?.surface ?? 'concrete';
  }

  update(dt: number): void {
    this.time += dt;
    this.noises = this.noises.filter((n) => this.time - n.time < 0.6);
    for (const t of this.tickers) t(dt, this.time);
    this.particles.update(dt);
  }

  dispose(): void {
    for (const s of this.loops) s.stop(1);
    this.loops = [];
    this.tickers.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.SkinnedMesh).isSkinnedMesh && m.geometry && !m.userData.shared) m.geometry.dispose();
    });
    this.envTex?.dispose();
    this.physics.clear();
    this.particles.dispose();
  }
}
