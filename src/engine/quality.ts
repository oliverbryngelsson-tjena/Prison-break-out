// Graphics quality presets and device detection.
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  /** Max device pixel ratio used for the canvas. */
  maxPixelRatio: number;
  /** Initial render scale (dynamic resolution adjusts within [minScale, 1]). */
  renderScale: number;
  minScale: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowSoft: boolean;
  /** Radius around the camera covered by the sun shadow map (m). */
  shadowRange: number;
  /** Shadow-casting point/spot lights allowed at once. */
  maxShadowLights: number;
  bloom: boolean;
  ao: boolean;
  smaa: boolean;
  grain: boolean;
  /** Extra local lights a level may enable. */
  maxLights: number;
  anisotropy: number;
  drawDistance: number;
  /** Multiplier for particle counts. */
  particles: number;
  /** Multiplier for grass/foliage instance counts. */
  foliage: number;
  /** Distance beyond which NPC animation updates at a reduced rate. */
  animLodDistance: number;
  /** Characters beyond this distance are not drawn. */
  characterDistance: number;
  dynamicResolution: boolean;
  /** Use HRTF panning for positional audio. */
  hrtf: boolean;
}

export const PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low', maxPixelRatio: 1, renderScale: 0.75, minScale: 0.5, shadows: false, shadowMapSize: 512, shadowSoft: false,
    shadowRange: 18, maxShadowLights: 0, bloom: false, ao: false, smaa: false, grain: false, maxLights: 3, anisotropy: 1,
    drawDistance: 90, particles: 0.35, foliage: 0.3, animLodDistance: 12, characterDistance: 45, dynamicResolution: true, hrtf: false,
  },
  medium: {
    level: 'medium', maxPixelRatio: 1.5, renderScale: 0.85, minScale: 0.6, shadows: true, shadowMapSize: 1024, shadowSoft: false,
    shadowRange: 22, maxShadowLights: 0, bloom: false, ao: false, smaa: true, grain: false, maxLights: 5, anisotropy: 2,
    drawDistance: 140, particles: 0.6, foliage: 0.55, animLodDistance: 18, characterDistance: 70, dynamicResolution: true, hrtf: false,
  },
  high: {
    level: 'high', maxPixelRatio: 2, renderScale: 1, minScale: 0.7, shadows: true, shadowMapSize: 2048, shadowSoft: true,
    shadowRange: 30, maxShadowLights: 1, bloom: true, ao: false, smaa: true, grain: true, maxLights: 8, anisotropy: 4,
    drawDistance: 220, particles: 1, foliage: 0.85, animLodDistance: 28, characterDistance: 110, dynamicResolution: true, hrtf: true,
  },
  ultra: {
    level: 'ultra', maxPixelRatio: 2.5, renderScale: 1, minScale: 0.8, shadows: true, shadowMapSize: 4096, shadowSoft: true,
    shadowRange: 40, maxShadowLights: 2, bloom: true, ao: true, smaa: true, grain: true, maxLights: 12, anisotropy: 8,
    drawDistance: 320, particles: 1.4, foliage: 1, animLodDistance: 40, characterDistance: 160, dynamicResolution: false, hrtf: true,
  },
};

export interface DeviceInfo {
  mobile: boolean;
  gpu: string;
  cores: number;
  memory: number;
  tier: QualityLevel;
}

export function detectDevice(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceInfo {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  let gpu = 'unknown';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  let tier: QualityLevel = mobile ? 'medium' : 'high';
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(g)) tier = 'low';
  else if (mobile) {
    const adreno = /adreno[^\d]*(\d{3})/.exec(g);
    const mali = /mali-g(\d+)/.exec(g);
    if (adreno && +adreno[1] >= 730) tier = 'high';
    else if (adreno && +adreno[1] < 610) tier = 'low';
    if (mali && +mali[1] >= 710) tier = 'high';
    else if (/mali-t|mali-4/.test(g)) tier = 'low';
    if (/apple/.test(g) && memory >= 4) tier = 'high';
    if (memory <= 2 || cores <= 4) tier = 'low';
  } else if (/rtx|radeon rx|apple m\d|arc a/.test(g)) tier = 'ultra';
  else if (/intel/.test(g)) tier = 'medium';
  return { mobile, gpu, cores, memory, tier };
}
