import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export const ASSET_BASE = (import.meta.env?.BASE_URL ?? './') + 'assets/';

/** Shared loading manager so the loading screen can show real progress. */
export const loadingManager = new THREE.LoadingManager();
type ProgressFn = (loaded: number, total: number, url: string) => void;
const progressListeners = new Set<ProgressFn>();
loadingManager.onProgress = (url, loaded, total) => progressListeners.forEach((f) => f(loaded, total, url));
export function onLoadProgress(fn: ProgressFn): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader(loadingManager);
let ktx2: KTX2Loader | null = null;

/** Enables KTX2 (Basis Universal) textures; needs the renderer to pick a GPU format. */
export function initKTX2(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader(loadingManager);
    ktx2.setTranscoderPath((import.meta.env?.BASE_URL ?? './') + 'libs/basis/');
    ktx2.detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2);
  }
  return ktx2;
}

export function loadKTX2(path: string, opts: TexOpts = {}): Promise<THREE.Texture> {
  if (!ktx2) throw new Error('initKTX2 not called');
  const key = 'ktx2:' + path + JSON.stringify(opts);
  let p = texCache.get(key);
  if (!p) {
    p = ktx2.loadAsync(url(path)).then((t) => {
      t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (opts.repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(opts.repeat[0], opts.repeat[1]);
      }
      t.anisotropy = opts.anisotropy ?? maxAnisotropy;
      return t;
    });
    texCache.set(key, p);
  }
  return p;
}
const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, Promise<THREE.Texture>>();
const jsonCache = new Map<string, Promise<unknown>>();

export function url(path: string): string {
  return path.startsWith('http') || path.startsWith('/') || path.startsWith('data:') ? path : ASSET_BASE + path;
}

export function loadGLTF(path: string): Promise<GLTF> {
  let p = gltfCache.get(path);
  if (!p) {
    p = gltfLoader.loadAsync(url(path));
    gltfCache.set(path, p);
    p.catch(() => gltfCache.delete(path));
  }
  return p;
}

export interface TexOpts {
  srgb?: boolean;
  repeat?: [number, number];
  anisotropy?: number;
  flipY?: boolean;
}

let maxAnisotropy = 4;
export function setMaxAnisotropy(v: number): void {
  maxAnisotropy = v;
}

export function loadTexture(path: string, opts: TexOpts = {}): Promise<THREE.Texture> {
  const key = path + JSON.stringify(opts);
  let p = texCache.get(key);
  if (!p) {
    p = texLoader.loadAsync(url(path)).then((t) => {
      t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (opts.repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(opts.repeat[0], opts.repeat[1]);
      }
      if (opts.flipY !== undefined) t.flipY = opts.flipY;
      t.anisotropy = opts.anisotropy ?? maxAnisotropy;
      return t;
    });
    texCache.set(key, p);
    p.catch(() => texCache.delete(key));
  }
  return p;
}

export function loadJSON<T>(path: string): Promise<T> {
  let p = jsonCache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url(path)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
      return r.json() as Promise<T>;
    });
    jsonCache.set(path, p);
  }
  return p;
}

export function loadEnvironment(path: string): Promise<THREE.DataTexture> {
  const loader = path.endsWith('.exr') ? new EXRLoader(loadingManager) : new HDRLoader(loadingManager);
  return loader.loadAsync(url(path)).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
}

// ---------------------------------------------------------------- freeing memory between chapters
const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'clearcoatNormalMap', 'transmissionMap', 'sheenColorMap'] as const;

function disposeMaterial(m: THREE.Material, seen: Set<object>): void {
  if (seen.has(m)) return;
  seen.add(m);
  const r = m as unknown as Record<string, unknown>;
  for (const k of TEX_KEYS) { const t = r[k] as THREE.Texture | undefined; if (t?.isTexture && !seen.has(t)) { seen.add(t); t.dispose(); } }
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const v of Object.values(u)) { const t = v?.value as THREE.Texture | undefined; if (t?.isTexture && !seen.has(t)) { seen.add(t); t.dispose(); } }
  (r.userData as { renderTarget?: THREE.WebGLRenderTarget } | undefined)?.renderTarget?.dispose();
  m.dispose();
}

/** Frees the GPU resources (geometry, materials, textures, skeletons) of everything under `root`. */
export function disposeTree(root: THREE.Object3D, seen = new Set<object>()): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; skeleton?: THREE.Skeleton; dispose?: () => void };
    if (mesh.geometry && !seen.has(mesh.geometry)) { seen.add(mesh.geometry); mesh.geometry.dispose(); }
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) disposeMaterial(m, seen);
    if (mesh.isInstancedMesh) mesh.dispose?.();
    if (mesh.isSkinnedMesh && mesh.skeleton && !seen.has(mesh.skeleton)) { seen.add(mesh.skeleton); mesh.skeleton.dispose(); }
    // Lights own their shadow-map render targets.
    if ((o as THREE.Light).isLight) (o as THREE.Light).dispose?.();
  });
  const sc = root as THREE.Scene;
  if (sc.isScene) {
    for (const t of [sc.environment, sc.background]) if ((t as THREE.Texture | null)?.isTexture && !seen.has(t as object)) { seen.add(t as object); (t as THREE.Texture).dispose(); }
  }
}

/**
 * Drops every cached model and texture (and frees their GPU copies). Called between chapters so a
 * long session does not keep each level's assets alive — on phones that runs out of memory.
 */
export async function releaseAssetCaches(): Promise<void> {
  const seen = new Set<object>();
  const gl = [...gltfCache.values()], tx = [...texCache.values()];
  gltfCache.clear();
  texCache.clear();
  for (const p of gl) { try { disposeTree((await p).scene, seen); } catch { /* failed load */ } }
  for (const p of tx) { try { const t = await p; if (!seen.has(t)) { seen.add(t); t.dispose(); } } catch { /* failed load */ } }
}
