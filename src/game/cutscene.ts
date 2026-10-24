// Time-based cutscenes, started at the same shared-clock moment on both clients.
import type { Shot } from '../engine/camera';
import { lineDuration, type Line } from './dialogue';

export interface Beat {
  /** Duration (s). Defaults to the total length of `lines`. */
  dur?: number;
  shot?: () => Shot;
  lines?: Line[];
  run?: () => void;
  /** Fade to/from black over the beat. */
  fade?: 'in' | 'out';
}

export interface CutsceneDef {
  id: string;
  beats: Beat[];
  /** Runs on start (both clients): place actors. */
  start?: () => void;
  /** Final state; runs at the end and on skip. */
  end: () => void;
  music?: string;
  skippable?: boolean;
  /** Keep the letterbox bars (default true). */
  letterbox?: boolean;
}

export interface CutsceneHost {
  playShot(s: Shot): void;
  endCamera(): void;
  sayLines(lines: Line[]): void;
  stopDialogue(): void;
  setLetterbox(on: boolean): void;
  setFade(v: number): void;
  setCutsceneMode(on: boolean): void;
  music(name: string): void;
}

export class CutsceneRunner {
  current: CutsceneDef | null = null;
  private t = 0;
  private beat = -1;
  private beatStart = 0;
  private durations: number[] = [];
  skipVotes = new Set<string>();
  /** Cutscenes already played (so reconnects don't replay them). */
  readonly played = new Set<string>();
  /** Shared clock (ms). When set, cutscene time follows it so both clients stay in step even at low frame rates. */
  clock: (() => number) | null = null;
  private startAt: number | null = null;

  constructor(private host: CutsceneHost) {}

  get active(): boolean {
    return !!this.current;
  }

  get elapsed(): number { return this.t; }

  play(def: CutsceneDef, startOffset = 0, startAt: number | null = null): void {
    if (this.current) this.finish();
    this.startAt = startAt;
    this.current = def;
    this.played.add(def.id);
    this.t = 0;
    this.beat = -1;
    this.skipVotes.clear();
    this.durations = def.beats.map((b) => b.dur ?? (b.lines ? b.lines.reduce((s, l) => s + lineDuration(l) + (l.pause ?? 0), 0) + 0.3 : 1));
    this.host.setCutsceneMode(true);
    if (def.letterbox !== false) this.host.setLetterbox(true);
    if (def.music) this.host.music(def.music);
    def.start?.();
    this.update(Math.max(0, startOffset));
  }

  update(dt: number): void {
    const def = this.current;
    if (!def) return;
    this.t += dt;
    if (this.clock && this.startAt !== null) this.t = Math.max(this.t - dt, (this.clock() - this.startAt) / 1000);
    // Advance beats
    let acc = 0;
    let idx = -1;
    for (let i = 0; i < this.durations.length; i++) {
      if (this.t >= acc) idx = i;
      acc += this.durations[i];
    }
    if (this.t >= acc) { this.finish(); return; }
    while (this.beat < idx) {
      this.beat++;
      this.beatStart = this.durations.slice(0, this.beat).reduce((a, b) => a + b, 0);
      const b = def.beats[this.beat];
      b.run?.();
      if (b.shot) this.host.playShot(b.shot());
      if (b.lines) this.host.sayLines(b.lines);
    }
    const b = def.beats[this.beat];
    if (b?.fade) {
      const k = (this.t - this.beatStart) / this.durations[this.beat];
      this.host.setFade(b.fade === 'out' ? Math.min(1, k) : Math.max(0, 1 - k));
    }
  }

  /** Ends the cutscene immediately (skip) or naturally. */
  finish(): void {
    const def = this.current;
    if (!def) return;
    this.current = null;
    this.host.stopDialogue();
    def.end();
    this.host.setLetterbox(false);
    this.host.setFade(0);
    this.host.endCamera();
    this.host.setCutsceneMode(false);
  }
}
