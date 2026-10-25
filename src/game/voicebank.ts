// Recorded dialogue (public/assets/audio/voice): finds a line's clip, plays it on the dialogue bus and
// reports how open the speaker's mouth should be. Compressed clips are cached; decoded audio is
// kept only for the few lines around the current one (decoded speech is large on phones).
import type { AudioManager } from '../engine/audio';
import { url as assetUrl } from '../engine/assets';
import { voiceFor, voiceKey } from './voices';

interface Clip { f: string; d: number; e: string; c: number }
interface Manifest { rate: number; clips: Record<string, Clip> }

export interface VoicePlayback {
  /** Seconds of speech. */
  duration: number;
  /** Mouth opening 0..1 at time t (seconds into the line). */
  mouth(t: number): number;
  stop(): void;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
let manifest: Promise<Manifest | null> | null = null;
let loaded: Manifest | null = null;

export class VoiceBank {
  private bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private decoded = new Map<string, AudioBuffer>();

  constructor(private audio: AudioManager) {
    manifest ??= fetch(assetUrl('audio/voice/manifest.json'))
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
    void manifest.then((m) => { loaded = m; });
  }

  get ready(): boolean { return !!loaded; }

  /** Clip for a line, if one was recorded. */
  find(who: string, role: string | undefined, text: string): (Clip & { key: string }) | null {
    const key = voiceKey(voiceFor(who, role).v, text);
    const c = loaded?.clips[key];
    return c ? { ...c, key } : null;
  }

  /** Download (not decode) every clip of a chapter and the shared ones, in the background. */
  async prefetchChapter(ch: number): Promise<void> {
    const m = await manifest;
    if (!m) return;
    for (const [key, c] of Object.entries(m.clips)) if (c.c === ch) void this.fetchBytes(key, c.f);
  }

  private fetchBytes(key: string, file: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(key);
    if (!p) {
      p = fetch(assetUrl('audio/voice/' + file)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      this.bytes.set(key, p);
    }
    return p;
  }

  /** Decode ahead of time (call for the lines of a conversation when it starts). */
  async prepare(clip: Clip & { key: string }): Promise<AudioBuffer | null> {
    const have = this.decoded.get(clip.key);
    if (have) return have;
    const ctx = this.audio.ctx;
    const ab = await this.fetchBytes(clip.key, clip.f);
    if (!ab || !ctx) return null;
    try {
      const buf = await ctx.decodeAudioData(ab.slice(0));
      this.decoded.set(clip.key, buf);
      // Keep only the most recent few decoded lines.
      while (this.decoded.size > 10) this.decoded.delete(this.decoded.keys().next().value as string);
      return buf;
    } catch { return null; }
  }

  /** Start a line `offset` seconds in. Starts late (in sync) if it's still loading. */
  play(clip: Clip & { key: string }, offset: number, radio: boolean): VoicePlayback {
    const audio = this.audio;
    const rate = loaded?.rate ?? 30;
    let stopped = false;
    let src: AudioBufferSourceNode | null = null;
    const t0 = performance.now() - offset * 1000;
    const start = (buf: AudioBuffer) => {
      const ctx = audio.ctx;
      if (stopped || !ctx) return;
      const at = (performance.now() - t0) / 1000;
      if (at >= buf.duration) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      let node: AudioNode = src;
      if (radio) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
        src.connect(bp);
        node = bp;
      }
      const { out } = audio.route(node, { bus: 'dialogue' });
      out.gain.value = radio ? 0.85 : 1;
      src.onended = () => out.disconnect();
      src.start(0, at);
    };
    const have = this.decoded.get(clip.key);
    if (have) start(have);
    else void this.prepare(clip).then((b) => b && start(b));
    return {
      duration: clip.d,
      mouth: (t) => {
        const i = Math.floor(t * rate);
        return i >= 0 && i < clip.e.length ? DIGITS.indexOf(clip.e[i]) / 35 : 0;
      },
      stop: () => { stopped = true; try { src?.stop(); } catch { /* already stopped */ } },
    };
  }

  /** Forget the previous chapter's clips. */
  clear(): void {
    this.bytes.clear();
    this.decoded.clear();
  }
}
