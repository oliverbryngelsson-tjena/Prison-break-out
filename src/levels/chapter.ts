// Base class for chapters: checkpoints, triggers, doors, cutscenes, dialogue and shared state.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { Game } from '../game/game';
import type { NpcDef } from '../game/npc';
import type { CutsceneDef } from '../game/cutscene';
import type { Line } from '../game/dialogue';
import type { Box } from '../engine/physics';

export interface SpawnPoint { pos: [number, number, number]; yaw: number }

export interface CheckpointDef {
  spawn: Record<CharacterId, SpawnPoint>;
  objective?: string;
  /** Outfit for both leads. */
  outfit?: 'prison' | 'civil';
  /** Cutscene played when starting here (if not already seen). */
  intro?: string;
}

export interface TriggerDef {
  id: string;
  /** Axis-aligned volume. */
  min: [number, number, number];
  max: [number, number, number];
  /** Who must be inside: anyone, both players, or a specific character. */
  who: 'any' | 'both' | CharacterId;
  once?: boolean;
  enabled?: () => boolean;
  fired?: boolean;
}

export interface DoorDef {
  id: string;
  /** Moving part (child pivot animated). */
  obj: THREE.Object3D;
  collider: Box | null;
  kind: 'slide' | 'swing';
  /** slide: offset when open; swing: angle when open. */
  open: THREE.Vector3 | number;
  closedPos: THREE.Vector3;
  closedRot: number;
  speed: number;
  /** 0 closed .. 1 open (current) */
  t: number;
  target: number;
  sound?: 'cell' | 'metal' | 'wood' | 'gate';
}

export abstract class Chapter {
  abstract readonly num: number;
  abstract readonly title: string;
  abstract readonly subtitle: string;
  abstract readonly checkpoints: Record<string, CheckpointDef>;
  g!: Game;
  /** Shared, serialisable chapter state (flags). */
  flags: Record<string, boolean | number | string> = {};
  readonly npcDefs: NpcDef[] = [];
  readonly triggers: TriggerDef[] = [];
  readonly doors = new Map<string, DoorDef>();
  readonly cutscenes: Record<string, CutsceneDef> = {};
  readonly dialogues: Record<string, Line[]> = {};
  checkpoint = '';
  /** Ambient music track used during free play. */
  music = 'music_explore';
  /** Outfit used in this chapter. */
  outfit: 'prison' | 'civil' = 'prison';
  flagsDefault: { jump: boolean; sprint: boolean; combat: boolean; crouch: boolean } = { jump: false, sprint: true, combat: false, crouch: true };

  attach(g: Game): void {
    this.g = g;
  }

  /** Build static geometry, props, lights, NPC definitions (deterministic). */
  abstract build(): Promise<void>;

  /** Reset dynamic state for a checkpoint. Runs on both clients. */
  abstract setupCheckpoint(id: string): void;

  /** Chapter-specific events. Return true if handled. */
  onEvent(_type: string, _args: unknown): boolean { return false; }

  /** A trigger fired (both clients). */
  onTrigger(_id: string, _who: CharacterId | 'both'): void {}

  /** An interaction completed (both clients, via event). */
  onUse(_id: string, _who: CharacterId): void {}

  /** Authority-only validation of peer requests. */
  validate(_type: string, _args: unknown, _from: 'local' | 'peer'): boolean { return true; }

  /** Per-frame logic (both clients). Use `this.g.authority` to gate simulation. */
  update(_dt: number): void {}

  /** Light level 0..1 at a point (used by stealth). */
  lightAt(_p: THREE.Vector3): number { return 1; }

  /** How suspicious it is for a player to be seen at p by an NPC (0 = allowed here). */
  suspicion(_who: CharacterId, _p: THREE.Vector3, _npc: string): number { return 1; }

  serialize(): Record<string, unknown> {
    return { flags: this.flags, checkpoint: this.checkpoint, doors: Object.fromEntries([...this.doors].map(([k, d]) => [k, d.target])), triggers: this.triggers.filter((t) => t.fired).map((t) => t.id) };
  }

  deserialize(s: Record<string, unknown>): void {
    if (s.flags) this.flags = s.flags as Chapter['flags'];
    if (s.doors) for (const [k, v] of Object.entries(s.doors as Record<string, number>)) { const d = this.doors.get(k); if (d) d.target = v; }
    if (s.triggers) for (const t of this.triggers) t.fired = (s.triggers as string[]).includes(t.id);
  }

  // ------------------------------------------------------------ helpers
  get authority(): boolean { return this.g.session.authority; }

  /** Ask the authority to set a flag (applies on both). */
  setFlag(k: string, v: boolean | number | string = true): void {
    this.g.session.request('flag', { k, v });
  }

  objective(text: string, marker?: [number, number, number] | null): void {
    if (this.authority) this.g.session.emit('objective', { text, marker: marker ?? null });
  }

  cutscene(id: string): void {
    if (this.authority) this.g.session.emit('cutscene', { id, at: this.g.session.sharedNow() + 400 });
  }

  say(id: string): void {
    if (this.authority) this.g.session.emit('dlg', { id, at: this.g.session.sharedNow() + 150 });
  }

  saveCheckpoint(id: string): void {
    if (this.authority) this.g.session.emit('checkpoint', { id });
  }

  door(id: string, open: boolean): void {
    if (this.authority) this.g.session.emit('door', { id, open });
  }

  addTrigger(t: TriggerDef): TriggerDef {
    this.triggers.push(t);
    return t;
  }

  addDoor(d: Omit<DoorDef, 't' | 'target' | 'closedPos' | 'closedRot'> & { startOpen?: boolean }): DoorDef {
    const door: DoorDef = { ...d, t: d.startOpen ? 1 : 0, target: d.startOpen ? 1 : 0, closedPos: d.obj.position.clone(), closedRot: d.obj.rotation.y };
    this.doors.set(d.id, door);
    this.applyDoor(door);
    return door;
  }

  applyDoor(d: DoorDef): void {
    if (d.kind === 'slide') d.obj.position.copy(d.closedPos).addScaledVector(d.open as THREE.Vector3, d.t);
    else d.obj.rotation.y = d.closedRot + (d.open as number) * d.t;
    if (d.collider) d.collider.enabled = d.t < 0.75;
  }

  updateDoors(dt: number): void {
    for (const d of this.doors.values()) {
      if (Math.abs(d.t - d.target) < 1e-4) continue;
      const prev = d.t;
      d.t += Math.sign(d.target - d.t) * Math.min(Math.abs(d.target - d.t), dt * d.speed);
      this.applyDoor(d);
      if (prev === 0 || prev === 1) {
        const p = d.obj.getWorldPosition(new THREE.Vector3());
        const snd = d.sound === 'cell' ? 'creak' : d.sound === 'wood' ? 'door_wood' : d.sound === 'gate' ? 'creak' : d.target > prev ? 'door_open' : 'door_close';
        this.g.audio.play(snd, { pos: p, volume: 0.8 });
      }
      if ((d.t === 0 || d.t === 1) && (d.sound === 'cell' || d.sound === 'metal' || d.sound === 'gate')) {
        this.g.audio.play(d.t === 0 ? 'door_slam' : 'metal_slam', { pos: d.obj.getWorldPosition(new THREE.Vector3()), volume: d.t === 0 ? 0.7 : 0.4 });
      }
    }
  }

  /** Authority checks triggers each frame. */
  checkTriggers(): void {
    if (!this.authority) return;
    const bodies = this.g.bodies();
    for (const t of this.triggers) {
      if (t.fired && t.once !== false) continue;
      if (t.enabled && !t.enabled()) continue;
      const inside = (c: CharacterId) => {
        const p = bodies[c].pos;
        return p.x >= t.min[0] && p.x <= t.max[0] && p.y >= t.min[1] && p.y <= t.max[1] && p.z >= t.min[2] && p.z <= t.max[2];
      };
      let who: CharacterId | 'both' | null = null;
      if (t.who === 'both') { if (inside('elias') && inside('jax')) who = 'both'; }
      else if (t.who === 'any') { if (inside('elias')) who = 'elias'; else if (inside('jax')) who = 'jax'; }
      else if (inside(t.who)) who = t.who;
      if (who) {
        t.fired = true;
        this.g.session.emit('trigger', { id: t.id, who });
      }
    }
  }

  dispose(): void {}
}
