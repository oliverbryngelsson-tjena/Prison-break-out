// PBR material library built from imported texture sets plus procedural canvas textures.
import * as THREE from 'three';
import { loadJSON, loadKTX2, loadTexture } from './assets';

export interface MatOpts {
  /** Texture repeats per metre (default 0.5 => one tile per 2 m). */
  scale?: number;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envIntensity?: number;
  side?: THREE.Side;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** Use the colour map's luminance only (for re-tinting). */
  name?: string;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  vertexColors?: boolean;
  polygonOffset?: boolean;
}

type TexSet = { c?: string; n?: string; r?: string };

export class MaterialLib {
  private sets: Record<string, TexSet> = {};
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private ready: Promise<void> | null = null;
  /** Default world texel density used by geometry builders (repeats per metre). */
  envMap: THREE.Texture | null = null;

  init(): Promise<void> {
    if (!this.ready) this.ready = loadJSON<Record<string, TexSet>>('tex/textures.json').then((s) => { this.sets = s; });
    return this.ready;
  }

  private async tex(file: string, srgb: boolean): Promise<THREE.Texture> {
    const t = file.endsWith('.ktx2') ? await loadKTX2(file, { srgb }) : await loadTexture(file, { srgb });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /**
   * PBR material from an imported set. Geometry produced by the builders uses metre-based UVs,
   * so `scale` = texture repeats per metre.
   */
  async pbr(set: string, o: MatOpts = {}): Promise<THREE.MeshStandardMaterial> {
    await this.init();
    const key = set + JSON.stringify(o);
    const have = this.cache.get(key);
    if (have) return have;
    const s = this.sets[set];
    if (!s) console.warn('unknown texture set', set);
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? 0xffffff,
      roughness: o.roughness ?? (s?.r ? 1 : 0.85),
      metalness: o.metalness ?? 0,
      side: o.side ?? THREE.FrontSide,
      vertexColors: o.vertexColors ?? false,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      alphaTest: o.alphaTest ?? 0,
    });
    m.name = o.name ?? set;
    m.envMapIntensity = o.envIntensity ?? 0.6;
    if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    if (o.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    const rep = o.scale ?? 0.5;
    const jobs: Promise<void>[] = [];
    if (s?.c) jobs.push(this.tex(s.c, true).then((t) => { m.map = t; }));
    if (s?.n) jobs.push(this.tex(s.n, false).then((t) => { m.normalMap = t; const ns = o.normalScale ?? 1; m.normalScale.set(ns, ns); }));
    if (s?.r) jobs.push(this.tex(s.r, false).then((t) => { m.roughnessMap = t; }));
    await Promise.all(jobs);
    // Shared textures: use a per-material UV transform instead of texture.repeat.
    for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) { t.repeat.set(1, 1); }
    if (rep !== 1) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uvScale = { value: rep };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uvScale;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * uvScale;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = vNormalMapUv * uvScale;\n#endif\n#ifdef USE_ROUGHNESSMAP\nvRoughnessMapUv = vRoughnessMapUv * uvScale;\n#endif');
      };
      m.customProgramCacheKey = () => 'uvs' + rep;
    }
    this.cache.set(key, m);
    return m;
  }

  /** Plain (untextured) PBR material. */
  plain(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = `plain:${new THREE.Color(color).getHexString()}:${roughness}:${metalness}:${JSON.stringify(extra)}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
      m.envMapIntensity = 0.7;
      this.cache.set(key, m);
    }
    return m;
  }

  emissive(color: THREE.ColorRepresentation, intensity = 2): THREE.MeshStandardMaterial {
    return this.plain(0x111111, 0.4, 0, { emissive: new THREE.Color(color), emissiveIntensity: intensity });
  }

  async canvasMat(key: string, draw: CanvasDraw, size = 512, o: MatOpts = {}): Promise<THREE.MeshStandardMaterial> {
    const ck = 'canvas:' + key + JSON.stringify(o);
    const have = this.cache.get(ck);
    if (have) return have;
    const tex = canvasTexture(key, draw, size);
    const m = new THREE.MeshStandardMaterial({
      map: tex, roughness: o.roughness ?? 0.8, metalness: o.metalness ?? 0, transparent: o.transparent ?? false,
      alphaTest: o.alphaTest ?? 0, side: o.side ?? THREE.FrontSide, color: o.color ?? 0xffffff,
    });
    if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveMap = tex; m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    if (o.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    m.envMapIntensity = o.envIntensity ?? 0.5;
    this.cache.set(ck, m);
    return m;
  }
}

export type CanvasDraw = (ctx: CanvasRenderingContext2D, size: number) => void;
const canvasCache = new Map<string, THREE.CanvasTexture>();

export function canvasTexture(key: string, draw: CanvasDraw, size = 512, srgb = true): THREE.CanvasTexture {
  const have = canvasCache.get(key);
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  canvasCache.set(key, t);
  return t;
}

/** Deterministic pseudo random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- procedural canvas drawings used by the levels ----

export const DRAW = {
  chainLink: (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(170,175,178,1)';
    ctx.lineWidth = s / 64;
    const n = 8;
    const step = s / n;
    for (let i = -n; i <= n * 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * step + s, 0); ctx.lineTo(i * step, s); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(90,92,95,0.6)';
    ctx.lineWidth = s / 160;
    for (let i = -n; i <= n * 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * step + 2, 0); ctx.lineTo(i * step + s + 2, s); ctx.stroke();
    }
  },
  tiles: (ctx: CanvasRenderingContext2D, s: number) => {
    const r = rng(7);
    ctx.fillStyle = '#8f9590';
    ctx.fillRect(0, 0, s, s);
    const n = 8, t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 200 + r() * 30;
      const dirt = r() * 25;
      ctx.fillStyle = `rgb(${v - dirt},${v - dirt * 0.8},${v - 5 - dirt * 1.2})`;
      ctx.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
      if (r() < 0.12) { ctx.fillStyle = 'rgba(90,80,60,0.25)'; ctx.fillRect(x * t + 2, y * t + t * 0.5, t - 4, t * 0.5 - 2); }
      if (r() < 0.05) { ctx.strokeStyle = 'rgba(40,40,40,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x * t + r() * t, y * t); ctx.lineTo(x * t + r() * t, y * t + t); ctx.stroke(); }
    }
  },
  mattress: (ctx: CanvasRenderingContext2D, s: number) => {
    const r = rng(3);
    ctx.fillStyle = '#6f7a6c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(${40 + r() * 40},${50 + r() * 40},${40 + r() * 30},0.12)`;
      ctx.fillRect(r() * s, r() * s, 2 + r() * 3, 1);
    }
    ctx.strokeStyle = 'rgba(30,35,30,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < s; i += s / 6) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke(); }
    for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(110,90,50,0.15)'; ctx.beginPath(); ctx.arc(r() * s, r() * s, 10 + r() * 50, 0, 7); ctx.fill(); }
  },
  blanket: (ctx: CanvasRenderingContext2D, s: number) => {
    const r = rng(11);
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) {
      const v = (Math.sin(x * 0.5) + Math.cos(y * 0.5)) * 6 + r() * 10;
      ctx.fillStyle = `rgba(${70 + v},${76 + v},${86 + v},0.5)`;
      ctx.fillRect(x, y, 4, 4);
    }
    ctx.fillStyle = 'rgba(160,150,120,0.5)';
    ctx.fillRect(0, s * 0.1, s, s * 0.04);
    ctx.fillRect(0, s * 0.86, s, s * 0.04);
  },
  grime: (ctx: CanvasRenderingContext2D, s: number) => {
    const r = rng(19);
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(40,32,20,0)');
    g.addColorStop(0.55, 'rgba(40,32,20,0.15)');
    g.addColorStop(1, 'rgba(30,24,14,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const x = r() * s;
      const w = 2 + r() * 8;
      const grad = ctx.createLinearGradient(0, s * 0.2, 0, s);
      grad.addColorStop(0, 'rgba(50,38,20,0)');
      grad.addColorStop(1, `rgba(50,38,20,${0.1 + r() * 0.25})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, s * (0.2 + r() * 0.5), w, s);
    }
  },
  cracks: (ctx: CanvasRenderingContext2D, s: number) => {
    const r = rng(23);
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(20,18,15,0.7)';
    for (let k = 0; k < 6; k++) {
      let x = r() * s, y = r() * s;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 14; i++) { x += (r() - 0.5) * 40; y += (r() - 0.2) * 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const rad = ctx.createRadialGradient(r() * s, r() * s, 1, r() * s, r() * s, 30 + r() * 80);
      rad.addColorStop(0, 'rgba(60,45,25,0.35)');
      rad.addColorStop(1, 'rgba(60,45,25,0)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, s, s);
    }
  },
  softShadow: (ctx: CanvasRenderingContext2D, s: number) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  },
  lightCone: (ctx: CanvasRenderingContext2D, s: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const h = ctx.createLinearGradient(0, 0, s, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)');
    h.addColorStop(0.5, 'rgba(0,0,0,0)');
    h.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
  },
  razorWire: (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(190,195,200,1)';
    ctx.lineWidth = s / 80;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let x = 0; x <= s; x += 2) {
        const y = s / 2 + Math.sin((x / s) * Math.PI * 6 + i * 2) * s * 0.35;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,205,210,1)';
    for (let x = 0; x < s; x += s / 12) { ctx.beginPath(); ctx.moveTo(x, s * 0.45); ctx.lineTo(x + s / 40, s * 0.5); ctx.lineTo(x, s * 0.55); ctx.fill(); }
  },
};

export function signDraw(lines: string[], bg = '#1d3b2a', fg = '#e8e6d8', border = true): CanvasDraw {
  return (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s / 2);
    if (border) { ctx.strokeStyle = fg; ctx.lineWidth = s / 64; ctx.strokeRect(s / 32, s / 32, s - s / 16, s / 2 - s / 16); }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((l, i) => {
      ctx.font = `bold ${Math.floor(s / (5 + n * 2.2))}px Arial, sans-serif`;
      ctx.fillText(l, s / 2, (s / 2) * ((i + 1) / (n + 1)));
    });
    // weathering
    const r = rng(lines.join('').length * 7);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.15})`; ctx.fillRect(r() * s, r() * s / 2, 2 + r() * 6, 1 + r() * 3); }
  };
}
