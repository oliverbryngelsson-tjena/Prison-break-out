// Dialogue playback: subtitles, speaker animation, jaw movement and optional speech synthesis.
import type { Body } from './body';

export interface Line {
  who: string;
  text: string;
  dur?: number;
  /** Upper-body gesture clip while speaking. */
  anim?: string;
  /** Target the speaker looks at (speaker id). */
  look?: string;
  /** Delay before this line (s). */
  pause?: number;
  /** Radio/phone filter. */
  radio?: boolean;
}

export interface SpeakerInfo {
  name: string;
  color: string;
  body?: Body | null;
  voice?: { pitch: number; rate: number; prefer: RegExp };
}

export function lineDuration(l: Line): number {
  if (l.dur) return l.dur;
  const words = l.text.split(/\s+/).length;
  return Math.max(1.6, words * 0.34 + 0.7);
}

export class DialogueRunner {
  queue: Line[] = [];
  current: Line | null = null;
  private t = 0;
  private lineDur = 0;
  private onDone: (() => void) | null = null;
  speakers: (id: string) => SpeakerInfo = (id) => ({ name: id, color: '#fff' });
  onSubtitle: ((speaker: SpeakerInfo | null, text: string, radio: boolean) => void) | null = null;
  tts = false;
  private voices: SpeechSynthesisVoice[] = [];
  /** Ambient barks that do not block. */
  private barkTimer = 0;
  active = false;

  constructor() {
    try {
      const load = () => { this.voices = window.speechSynthesis?.getVoices() ?? []; };
      load();
      window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    } catch { /* no TTS */ }
  }

  play(lines: Line[], onDone?: () => void, startOffset = 0): void {
    this.stop();
    this.queue = lines.slice();
    this.onDone = onDone ?? null;
    this.active = true;
    this.next();
    // Catch up if we joined late (network delay).
    let off = startOffset;
    while (off > 0 && this.current) {
      const left = this.lineDur - this.t;
      if (off < left) { this.t += off; break; }
      off -= left;
      this.next();
    }
  }

  private next(): void {
    this.endSpeaking();
    const l = this.queue.shift() ?? null;
    this.current = l;
    this.t = 0;
    if (!l) {
      this.active = false;
      this.onSubtitle?.(null, '', false);
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
      return;
    }
    this.lineDur = lineDuration(l) + (l.pause ?? 0);
    const sp = this.speakers(l.who);
    this.onSubtitle?.(sp, l.text, !!l.radio);
    const body = sp.body;
    if (body) {
      body.model.speaking = 1;
      if (l.anim) body.model.play(l.anim, { layer: 'upper', fade: 0.35 });
      if (l.look) {
        const t = this.speakers(l.look).body;
        if (t) body.model.lookTarget = t.head();
      }
    }
    if (this.tts) this.speak(l, sp);
  }

  private speak(l: Line, sp: SpeakerInfo): void {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(l.text.replace(/[*_]/g, ''));
      const v = sp.voice;
      if (v) {
        u.pitch = v.pitch;
        u.rate = v.rate;
        const en = this.voices.filter((x) => /^en/i.test(x.lang));
        u.voice = en.find((x) => v.prefer.test(x.name)) ?? en[0] ?? null;
      }
      u.volume = l.radio ? 0.7 : 1;
      synth.speak(u);
    } catch { /* ignore */ }
  }

  private endSpeaking(): void {
    const l = this.current;
    if (!l) return;
    const body = this.speakers(l.who).body;
    if (body) {
      body.model.speaking = 0;
      if (l.anim) body.model.stop('upper', 0.4);
      if (l.look) body.model.lookTarget = null;
    }
  }

  stop(): void {
    this.endSpeaking();
    this.queue = [];
    this.current = null;
    this.active = false;
    this.onSubtitle?.(null, '', false);
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }

  update(dt: number): void {
    if (!this.current) return;
    this.t += dt;
    const l = this.current;
    const body = this.speakers(l.who).body;
    // Speak during the line, pause at the end.
    if (body) body.model.speaking = this.t < lineDuration(l) - 0.2 ? 1 : 0;
    if (this.t >= this.lineDur) this.next();
    this.barkTimer -= dt;
  }
}
