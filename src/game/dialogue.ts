// Dialogue playback: subtitles, speaker animation, jaw movement and recorded voices.
// Never uses the device's speech synthesis: a line without a recording is shown as a subtitle only.
import type { Body } from './body';
import type { VoiceBank, VoicePlayback } from './voicebank';
import { lineDuration } from './voices';

export { lineDuration };

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
  /** NPC role, for picking a recorded voice. */
  role?: string;
  body?: Body | null;
  voice?: { pitch: number; rate: number; prefer: RegExp };
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
  /** Recorded voices (played when voice acting is on). */
  bank: VoiceBank | null = null;
  private clip: ReturnType<VoiceBank['find']> = null;
  private playback: VoicePlayback | null = null;
  active = false;
  /** What is playing: a cutscene/scripted scene, in-game talk, or a short NPC shout. */
  kind: 'scene' | 'talk' | 'bark' | null = null;
  /** Seconds since the last line ended (shouts wait for some quiet). */
  private quietT = 99;

  /** Scene dialogue (cutscenes, scripted moments): replaces whatever is playing. */
  play(lines: Line[], onDone?: () => void, startOffset = 0): void {
    this.start(lines, 'scene', onDone, startOffset);
  }

  /** In-game conversation: waits for the current one to finish instead of talking over it. */
  talk(lines: Line[], startOffset = 0): void {
    if (this.active && this.kind !== 'bark') {
      // Already talking: queue it (but never pile up a backlog of chatter).
      if (this.queue.length < 4) this.queue.push(...lines);
      return;
    }
    this.start(lines, 'talk', undefined, startOffset);
  }

  /** A short shout from an NPC: only into silence, and not right after someone else spoke. */
  bark(line: Line, minQuiet = 4): boolean {
    if (this.active || this.quietT < minQuiet) return false;
    this.start([line], 'bark');
    return true;
  }

  private start(lines: Line[], kind: 'scene' | 'talk' | 'bark', onDone?: () => void, startOffset = 0): void {
    this.stop();
    this.kind = kind;
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
    // Decode this conversation's recordings now so each line starts on time.
    if (this.bank && this.tts) for (const l of [this.current, ...this.queue]) {
      if (!l) continue;
      const c = this.bank.find(l.who, this.speakers(l.who).role, l.text);
      if (c) void this.bank.prepare(c);
    }
  }

  private next(): void {
    this.endSpeaking();
    const l = this.queue.shift() ?? null;
    this.current = l;
    this.t = 0;
    if (!l) {
      this.active = false;
      this.kind = null;
      this.quietT = 0;
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
    this.clip = this.tts ? this.bank?.find(l.who, sp.role, l.text) ?? null : null;
    if (body) {
      body.model.speaking = this.clip ? 0 : 1;
      if (l.anim) body.model.play(l.anim, { layer: 'upper', fade: 0.35 });
      if (l.look) {
        const t = this.speakers(l.look).body;
        if (t) body.model.lookTarget = t.head();
      }
    }
  }

  private endSpeaking(): void {
    const l = this.current;
    if (!l) return;
    const body = this.speakers(l.who).body;
    this.playback?.stop();
    this.playback = null;
    this.clip = null;
    if (body) {
      body.model.speaking = 0;
      body.model.mouth = null;
      if (l.anim) body.model.stop('upper', 0.4);
      if (l.look) body.model.lookTarget = null;
    }
  }

  stop(): void {
    this.endSpeaking();
    this.queue = [];
    this.current = null;
    if (this.active) this.quietT = 0;
    this.active = false;
    this.kind = null;
    this.onSubtitle?.(null, '', false);
  }

  update(dt: number): void {
    if (!this.current) { this.quietT += dt; return; }
    this.t += dt;
    const l = this.current;
    const body = this.speakers(l.who).body;
    // Speak during the line, pause at the end.
    if (this.clip && this.bank) {
      this.playback ??= this.bank.play(this.clip, this.t, !!l.radio);
      if (body) body.model.mouth = this.playback.mouth(this.t);
    } else if (body) body.model.speaking = this.t < lineDuration(l) - 0.2 ? 1 : 0;
    if (this.t >= this.lineDur) this.next();
  }
}
