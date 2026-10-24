// Web Audio manager: buses, positional sound, loops, music and synthesised engines/sirens.
import * as THREE from 'three';
import { url as assetUrl } from './assets';

export type Bus = 'music' | 'sfx' | 'dialogue' | 'ambience' | 'ui';

export interface PlayOpts {
  bus?: Bus;
  volume?: number;
  rate?: number;
  /** Random +- variation applied to rate. */
  jitter?: number;
  loop?: boolean;
  pos?: THREE.Vector3;
  /** Distance where the sound starts to attenuate. */
  ref?: number;
  maxDist?: number;
  delay?: number;
  fadeIn?: number;
  offset?: number;
}

export interface Sound {
  stop(fade?: number): void;
  setVolume(v: number, ramp?: number): void;
  setRate(r: number): void;
  setPos(p: THREE.Vector3): void;
  readonly playing: boolean;
  readonly duration: number;
  readonly source: AudioBufferSourceNode | null;
}

const NULL_SOUND: Sound = { stop() {}, setVolume() {}, setRate() {}, setPos() {}, playing: false, duration: 0, source: null };

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buses = {} as Record<Bus, GainNode>;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  /** name -> list of files (variants picked at random). */
  bank: Record<string, string[]> = {};
  volumes: Record<Bus | 'master', number> = { master: 0.9, music: 0.55, sfx: 0.9, dialogue: 1, ambience: 0.7, ui: 0.6 };
  hrtf = true;
  private music: { name: string; sound: Sound } | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  readonly listenerPos = new THREE.Vector3();
  unlocked = false;
  /** Ducks music + ambience while dialogue is playing. */
  private duck = 1;

  async init(bankUrl = 'audio/bank.json'): Promise<void> {
    try {
      const r = await fetch(assetUrl(bankUrl));
      if (r.ok) this.bank = await r.json();
    } catch { /* bank optional */ }
  }

  /** Must run from a user gesture on mobile. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const b of ['music', 'sfx', 'dialogue', 'ambience', 'ui'] as Bus[]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses[b] = g;
      }
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.impulse(1.8, 2.6);
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.18;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.buses.sfx);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.unlocked = true;
  }

  setVolume(bus: Bus | 'master', v: number): void {
    this.volumes[bus] = v;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    for (const b of Object.keys(this.buses) as Bus[]) {
      const duck = b === 'music' ? 0.55 + 0.45 * this.duck : b === 'ambience' ? 0.7 + 0.3 * this.duck : 1;
      this.buses[b].gain.setTargetAtTime(this.volumes[b] * duck, t, 0.15);
    }
  }

  setDucking(talking: boolean): void {
    const d = talking ? 0 : 1;
    if (d !== this.duck) {
      this.duck = d;
      this.applyVolumes();
    }
  }

  /** Set reverb amount for the current space (0 dry .. 1 big hall). */
  setReverb(amount: number): void {
    if (this.reverbSend && this.ctx) this.reverbSend.gain.setTargetAtTime(amount * 0.45, this.ctx.currentTime, 0.3);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  updateListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.getWorldPosition(this.listenerPos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      (l as unknown as { setPosition: (...a: number[]) => void }).setPosition(p.x, p.y, p.z);
      (l as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  private resolve(name: string): string | null {
    const list = this.bank[name];
    if (list && list.length) return list[Math.floor(Math.random() * list.length)];
    if (/\.(mp3|ogg|wav)$/.test(name)) return name;
    return null;
  }

  load(file: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(file);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(file);
    if (!p) {
      p = fetch(assetUrl('audio/' + file))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404 ' + file))))
        .then((ab) => {
          if (!this.ctx) this.unlockSilently();
          return this.ctx!.decodeAudioData(ab);
        })
        .then((b) => { this.buffers.set(file, b); return b; })
        .catch((e) => { console.warn('audio load failed', file, e); return null; });
      this.loading.set(file, p);
    }
    return p;
  }

  /** Create the context without resuming it, so decoding can start before the first tap. */
  private unlockSilently(): void {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx && AC) {
      this.unlock();
      this.unlocked = false;
    }
  }

  preload(names: string[]): Promise<unknown> {
    const files = new Set<string>();
    for (const n of names) for (const f of this.bank[n] ?? (/\.(mp3|ogg|wav)$/.test(n) ? [n] : [])) files.add(f);
    return Promise.all([...files].map((f) => this.load(f)));
  }

  /** Plays a sound; returns a handle immediately (buffer may still be loading). */
  play(name: string, opts: PlayOpts = {}): Sound {
    const file = this.resolve(name);
    if (!file) return NULL_SOUND;
    if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) void this.ctx.resume();
    const buf = this.buffers.get(file);
    const handle = new BufferSound(this, opts);
    if (buf) handle.start(buf);
    else void this.load(file).then((b) => b && !handle.cancelled && handle.start(b));
    return handle;
  }

  /** @internal */
  route(node: AudioNode, opts: PlayOpts): { out: GainNode; panner: PannerNode | null } {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    let panner: PannerNode | null = null;
    if (opts.pos) {
      panner = ctx.createPanner();
      panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.ref ?? 2;
      panner.maxDistance = opts.maxDist ?? 60;
      panner.rolloffFactor = 1.1;
      setPannerPos(panner, opts.pos, ctx);
      node.connect(panner);
      panner.connect(out);
    } else node.connect(out);
    out.connect(this.buses[opts.bus ?? 'sfx']);
    if ((opts.bus ?? 'sfx') === 'sfx' && opts.pos && this.reverbSend) out.connect(this.reverbSend);
    return { out, panner };
  }

  playMusic(name: string, fade = 2.5, volume = 1): void {
    if (this.music?.name === name) return;
    this.music?.sound.stop(fade);
    if (!name) { this.music = null; return; }
    const s = this.play(name, { bus: 'music', loop: true, fadeIn: fade, volume });
    this.music = { name, sound: s };
  }

  stopMusic(fade = 2): void {
    this.music?.sound.stop(fade);
    this.music = null;
  }

  get musicName(): string | null { return this.music?.name ?? null; }

  /** A synthetic engine voice driven by RPM (dirt bike / car). */
  engine(kind: 'bike' | 'car' = 'bike'): EngineSound | null {
    if (!this.ctx) return null;
    return new EngineSound(this, kind);
  }

  siren(): SirenSound | null {
    if (!this.ctx) return null;
    return new SirenSound(this);
  }

  /** Short synthesised UI blip (works without any audio files). */
  blip(freq = 880, dur = 0.06, vol = 0.15): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = 'triangle';
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.buses.ui);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }
}

function setPannerPos(p: PannerNode, v: THREE.Vector3, ctx: AudioContext): void {
  if (p.positionX) {
    const t = ctx.currentTime;
    p.positionX.setTargetAtTime(v.x, t, 0.03);
    p.positionY.setTargetAtTime(v.y, t, 0.03);
    p.positionZ.setTargetAtTime(v.z, t, 0.03);
  } else (p as unknown as { setPosition: (...a: number[]) => void }).setPosition(v.x, v.y, v.z);
}

class BufferSound implements Sound {
  source: AudioBufferSourceNode | null = null;
  private out: GainNode | null = null;
  private panner: PannerNode | null = null;
  cancelled = false;
  private ended = false;
  private vol: number;
  duration = 0;
  constructor(private am: AudioManager, private opts: PlayOpts) {
    this.vol = opts.volume ?? 1;
  }
  start(buf: AudioBuffer): void {
    const ctx = this.am.ctx;
    if (!ctx || this.cancelled) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!this.opts.loop;
    const j = this.opts.jitter ?? 0;
    src.playbackRate.value = (this.opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j);
    const { out, panner } = this.am.route(src, this.opts);
    this.out = out;
    this.panner = panner;
    const t = ctx.currentTime + (this.opts.delay ?? 0);
    if (this.opts.fadeIn) {
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(this.vol, t + this.opts.fadeIn);
    } else out.gain.value = this.vol;
    src.onended = () => { this.ended = true; out.disconnect(); };
    src.start(t, this.opts.offset ?? (this.opts.loop ? Math.random() * buf.duration * 0.5 : 0));
    this.source = src;
    this.duration = buf.duration / src.playbackRate.value;
  }
  get playing(): boolean { return !!this.source && !this.ended; }
  stop(fade = 0): void {
    this.cancelled = true;
    const ctx = this.am.ctx;
    if (!this.source || !ctx || this.ended) return;
    const s = this.source;
    if (fade > 0 && this.out) {
      const t = ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0, t + fade);
      try { s.stop(t + fade + 0.05); } catch { /* already stopped */ }
    } else {
      try { s.stop(); } catch { /* already stopped */ }
    }
  }
  setVolume(v: number, ramp = 0.1): void {
    this.vol = v;
    const ctx = this.am.ctx;
    if (this.out && ctx) this.out.gain.setTargetAtTime(v, ctx.currentTime, ramp);
  }
  setRate(r: number): void {
    const ctx = this.am.ctx;
    if (this.source && ctx) this.source.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.05);
  }
  setPos(p: THREE.Vector3): void {
    const ctx = this.am.ctx;
    if (this.panner && ctx) setPannerPos(this.panner, p, ctx);
  }
}

/** Single-cylinder four-stroke (bike) or V8-ish (car) engine built from a looped combustion cycle. */
export class EngineSound {
  private src: AudioBufferSourceNode;
  private src2: OscillatorNode;
  private filter: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private gain: GainNode;
  private oscGain: GainNode;
  private noise: AudioBufferSourceNode;
  private noiseGain: GainNode;
  private panner: PannerNode;
  private baseRpm: number;
  private cylinders: number;
  stopped = false;

  constructor(private am: AudioManager, kind: 'bike' | 'car') {
    const ctx = am.ctx!;
    this.baseRpm = 3000;
    this.cylinders = kind === 'bike' ? 1 : 8;
    // One full engine cycle (two revolutions) at base rpm.
    const cycle = 120 / this.baseRpm;
    const sr = ctx.sampleRate;
    const len = Math.floor(cycle * sr);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let c = 0; c < this.cylinders; c++) {
      const start = Math.floor((c / this.cylinders) * len);
      const pulse = Math.floor(len * (kind === 'bike' ? 0.55 : 0.12));
      for (let i = 0; i < pulse; i++) {
        const t = i / sr;
        const env = Math.exp(-t * (kind === 'bike' ? 70 : 140));
        const thump = Math.sin(2 * Math.PI * (kind === 'bike' ? 55 : 90) * t) * env;
        const crackle = (Math.random() * 2 - 1) * env * 0.55;
        d[(start + i) % len] += (thump * 0.9 + crackle) * (0.8 + 0.2 * Math.random());
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
    this.src = ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src2 = ctx.createOscillator();
    this.src2.type = 'sawtooth';
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0.12;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4); }
    this.shaper.curve = curve;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    // Intake/air noise layer.
    const nb = ctx.createBuffer(1, sr, sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = nb;
    this.noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1800;
    nf.Q.value = 0.6;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(nf).connect(this.noiseGain).connect(this.filter);
    this.src.connect(this.shaper);
    this.src2.connect(this.oscGain).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.gain);
    this.panner = ctx.createPanner();
    this.panner.panningModel = am.hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 4;
    this.panner.maxDistance = 120;
    this.gain.connect(this.panner).connect(am.buses.sfx);
    this.src.start();
    this.src2.start();
    this.noise.start();
  }

  /** rpm ~1300..11000, load 0..1 (throttle), volume 0..1 */
  set(rpm: number, load: number, volume: number, pos?: THREE.Vector3): void {
    const ctx = this.am.ctx!;
    const t = ctx.currentTime;
    const r = rpm / this.baseRpm;
    this.src.playbackRate.setTargetAtTime(r, t, 0.03);
    this.src2.frequency.setTargetAtTime((rpm / 60) * (this.cylinders === 1 ? 0.5 : 4), t, 0.03);
    this.filter.frequency.setTargetAtTime(300 + rpm * 0.32 + load * 1800, t, 0.05);
    this.gain.gain.setTargetAtTime(volume * (0.45 + load * 0.55), t, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.05 + load * 0.25, t, 0.05);
    if (pos) setPannerPos(this.panner, pos, ctx);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const ctx = this.am.ctx!;
    this.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    const end = ctx.currentTime + 1;
    this.src.stop(end);
    this.src2.stop(end);
    this.noise.stop(end);
  }
}

/** Police siren (wail / yelp) with doppler-like pitch offset. */
export class SirenSound {
  private osc: OscillatorNode;
  private osc2: OscillatorNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private gain: GainNode;
  private panner: PannerNode;
  private mode: 'wail' | 'yelp' = 'wail';
  stopped = false;
  constructor(private am: AudioManager) {
    const ctx = am.ctx!;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = 0.22;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 380;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc.frequency);
    this.lfoGain.connect(this.osc2.frequency);
    this.osc.frequency.value = 950;
    this.osc2.frequency.value = 952;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.7;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(mix);
    this.osc2.connect(mix);
    mix.connect(bp).connect(this.gain);
    this.panner = ctx.createPanner();
    this.panner.panningModel = am.hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 8;
    this.panner.maxDistance = 300;
    this.panner.rolloffFactor = 0.9;
    this.gain.connect(this.panner).connect(am.buses.sfx);
    this.osc.start();
    this.osc2.start();
    this.lfo.start();
  }
  setMode(mode: 'wail' | 'yelp'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const t = this.am.ctx!.currentTime;
    this.lfo.frequency.setTargetAtTime(mode === 'wail' ? 0.22 : 3.2, t, 0.1);
    this.lfoGain.gain.setTargetAtTime(mode === 'wail' ? 380 : 300, t, 0.1);
  }
  /** doppler: -1 (receding fast) .. 1 (approaching fast) */
  set(pos: THREE.Vector3, volume: number, doppler = 0): void {
    const ctx = this.am.ctx!;
    const t = ctx.currentTime;
    setPannerPos(this.panner, pos, ctx);
    this.gain.gain.setTargetAtTime(volume * 0.22, t, 0.1);
    const base = 950 * (1 + doppler * 0.06);
    this.osc.frequency.setTargetAtTime(base, t, 0.1);
    this.osc2.frequency.setTargetAtTime(base * 1.003, t, 0.1);
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const ctx = this.am.ctx!;
    this.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const end = ctx.currentTime + 1.5;
    this.osc.stop(end);
    this.osc2.stop(end);
    this.lfo.stop(end);
  }
}
