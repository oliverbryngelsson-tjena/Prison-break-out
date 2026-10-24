// Renderer wrapper: quality presets, post-processing, dynamic resolution and stats.
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { PRESETS, detectDevice, type DeviceInfo, type QualityLevel, type QualitySettings } from './quality';
import { initKTX2, setMaxAnisotropy } from './assets';

/** Lift/gamma/gain colour grade with saturation and a split-tone tint. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform vec3 lift; uniform vec3 gamma; uniform vec3 gain; uniform float saturation; uniform float contrast;
      uniform vec3 shadowTint; uniform vec3 highlightTint; uniform float fade;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        c = pow(max(c * gain + lift * (1.0 - c), 0.0), 1.0 / gamma);
        float l2 = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        c *= mix(shadowTint, highlightTint, smoothstep(0.0, 0.7, l2));
        c = mix(c, vec3(0.0), fade);
        outputColor = vec4(c, inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['gamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['fade', new THREE.Uniform(0)],
      ]),
    });
  }
}

export interface Grade {
  lift?: [number, number, number];
  gamma?: [number, number, number];
  gain?: [number, number, number];
  saturation?: number;
  contrast?: number;
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
  exposure?: number;
  bloom?: number;
  vignette?: number;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  device: DeviceInfo;
  q: QualitySettings;
  scale = 1;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: BloomEffect | null = null;
  private vignette: VignetteEffect | null = null;
  private grade = new GradeEffect();
  private toneMap: ToneMappingEffect | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private frameTimes: number[] = [];
  private lastScaleChange = 0;
  private gradeState: Grade = {};
  fps = 60;
  frameMs = 16;
  /** 0..1 fade to black applied in post (or via overlay when post is off). */
  fade = 0;
  onContextLost: (() => void) | null = null;

  constructor(container: HTMLElement, level?: QualityLevel) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
    this.canvas = this.gl.domElement;
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);
    this.device = detectDevice(this.gl.getContext());
    this.q = { ...PRESETS[level ?? this.device.tier] };
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.enabled = true;
    initKTX2(this.gl);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  setQuality(level: QualityLevel): void {
    this.q = { ...PRESETS[level] };
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.q;
    this.scale = q.renderScale;
    this.gl.shadowMap.enabled = q.shadows;
    this.gl.shadowMap.type = q.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.gl.shadowMap.needsUpdate = true;
    setMaxAnisotropy(Math.min(q.anisotropy, this.gl.capabilities.getMaxAnisotropy()));
    this.buildComposer();
    this.resize();
  }

  private usePost(): boolean {
    return this.q.level !== 'low';
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    if (!this.usePost()) {
      this.gl.toneMapping = THREE.ACESFilmicToneMapping;
      this.gl.toneMappingExposure = this.gradeState.exposure ?? 1;
      return;
    }
    this.gl.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene ?? new THREE.Scene(), this.camera ?? new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    const effects: Effect[] = [];
    if (this.q.bloom) {
      this.bloom = new BloomEffect({ intensity: this.gradeState.bloom ?? 0.8, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
      effects.push(this.bloom);
    } else this.bloom = null;
    this.toneMap = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    effects.push(this.toneMap);
    effects.push(this.grade);
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: this.gradeState.vignette ?? 0.5 });
    effects.push(this.vignette);
    if (this.q.grain) {
      const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      noise.blendMode.opacity.value = 0.12;
      effects.push(noise);
    }
    composer.addPass(new EffectPass(this.camera ?? new THREE.PerspectiveCamera(), ...effects));
    if (this.q.smaa) composer.addPass(new EffectPass(this.camera ?? new THREE.PerspectiveCamera(), new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    this.composer = composer;
    this.applyGrade();
  }

  setGrade(g: Grade): void {
    this.gradeState = g;
    this.applyGrade();
  }

  private applyGrade(): void {
    const g = this.gradeState;
    const u = this.grade.uniforms;
    (u.get('lift')!.value as THREE.Vector3).fromArray(g.lift ?? [0, 0, 0]);
    (u.get('gamma')!.value as THREE.Vector3).fromArray(g.gamma ?? [1, 1, 1]);
    (u.get('gain')!.value as THREE.Vector3).fromArray(g.gain ?? [1, 1, 1]);
    u.get('saturation')!.value = g.saturation ?? 1;
    u.get('contrast')!.value = g.contrast ?? 1;
    (u.get('shadowTint')!.value as THREE.Vector3).fromArray(g.shadowTint ?? [1, 1, 1]);
    (u.get('highlightTint')!.value as THREE.Vector3).fromArray(g.highlightTint ?? [1, 1, 1]);
    if (this.bloom) this.bloom.intensity = g.bloom ?? 0.8;
    if (this.vignette) this.vignette.darkness = g.vignette ?? 0.5;
    this.gl.toneMappingExposure = g.exposure ?? 1;
    if (this.toneMap) (this.toneMap as unknown as { exposure?: number }).exposure = g.exposure ?? 1;
  }

  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.mainScene = scene;
      this.renderPass.mainCamera = camera;
    }
    if (this.composer) {
      for (const pass of this.composer.passes) (pass as unknown as { mainCamera: THREE.Camera }).mainCamera = camera;
    }
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio);
    this.gl.setPixelRatio(dpr * this.scale);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer?.setSize(w, h, false);
    if (this.camera && (this.camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const c = this.camera as THREE.PerspectiveCamera;
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
  }

  render(dt: number): void {
    if (!this.scene || !this.camera) return;
    this.grade.uniforms.get('fade')!.value = this.fade;
    if (this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
    this.trackPerformance(dt);
  }

  private trackPerformance(dt: number): void {
    const ms = dt * 1000;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameMs = avg;
    this.fps = 1000 / Math.max(avg, 1);
    if (!this.q.dynamicResolution || this.frameTimes.length < 90) return;
    const now = performance.now();
    if (now - this.lastScaleChange < 2500) return;
    if (avg > 21 && this.scale > this.q.minScale) {
      this.scale = Math.max(this.q.minScale, this.scale - 0.08);
      this.lastScaleChange = now;
      this.resize();
    } else if (avg < 13.5 && this.scale < this.q.renderScale) {
      this.scale = Math.min(this.q.renderScale, this.scale + 0.05);
      this.lastScaleChange = now;
      this.resize();
    }
  }

  stats() {
    const i = this.gl.info;
    return {
      fps: Math.round(this.fps),
      ms: +this.frameMs.toFixed(1),
      calls: i.render.calls,
      tris: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      scale: +this.scale.toFixed(2),
      quality: this.q.level,
      gpu: this.device.gpu,
      heapMB: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576)
        : undefined,
    };
  }
}
