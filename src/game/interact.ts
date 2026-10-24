// Context-sensitive interactions: press, hold and two-player co-op holds.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import type { PoseCtx } from './poses';

export interface InteractDef {
  id: string;
  pos: THREE.Vector3;
  radius?: number;
  label: string | (() => string);
  /** Which character may use it. */
  who?: CharacterId | 'any';
  enabled?: () => boolean;
  /** Yaw the player turns to while using. */
  facing?: number;
  mode?: 'press' | 'hold';
  holdTime?: number;
  /** Co-op group: all roles in the group must be held at the same time. */
  coop?: string;
  /** Role within the co-op group (defaults to the character id). */
  role?: string;
  pose?: string;
  poseCtx?: PoseCtx;
  /** Snap the player to this position while using. */
  stand?: THREE.Vector3;
  /** Small icon key shown in the prompt. */
  icon?: 'hand' | 'eye' | 'talk' | 'climb' | 'fist' | 'coop' | 'door' | 'tool' | 'hide' | 'bike';
  /** Called when the interaction completes (local side). */
  onUse?: (who: CharacterId) => void;
  /** Called when a hold starts/stops (local). */
  onHold?: (on: boolean) => void;
  /** Higher wins when several are in range. */
  priority?: number;
  /** Require the button to be released before reuse. */
  cooldown?: number;
}

export interface Prompt {
  def: InteractDef;
  label: string;
  progress: number;
  waiting: boolean;
}

export class InteractionSystem {
  readonly items = new Map<string, InteractDef>();
  current: InteractDef | null = null;
  holding: InteractDef | null = null;
  holdT = 0;
  /** co-op roles currently held, by group: Set of roles */
  readonly coopHeld = new Map<string, Set<string>>();
  private lastUse = new Map<string, number>();
  time = 0;

  add(d: InteractDef): InteractDef {
    this.items.set(d.id, d);
    return d;
  }

  remove(id: string): void {
    this.items.delete(id);
    if (this.current?.id === id) this.current = null;
    if (this.holding?.id === id) this.holding = null;
  }

  clear(): void {
    this.items.clear();
    this.current = null;
    this.holding = null;
    this.coopHeld.clear();
  }

  /** Finds the best interaction for a character at pos/yaw. */
  find(who: CharacterId, pos: THREE.Vector3, yaw: number): InteractDef | null {
    let best: InteractDef | null = null;
    let bestScore = -Infinity;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (const d of this.items.values()) {
      if (d.who && d.who !== 'any' && d.who !== who) continue;
      if (d.enabled && !d.enabled()) continue;
      const r = d.radius ?? 1.3;
      const dx = d.pos.x - pos.x, dz = d.pos.z - pos.z, dy = d.pos.y - pos.y;
      if (Math.abs(dy) > 2.2) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > r) continue;
      const facing = dist > 0.05 ? (fwd.x * dx + fwd.z * dz) / dist : 1;
      const cd = this.lastUse.get(d.id);
      if (cd !== undefined && this.time - cd < (d.cooldown ?? 0.6)) continue;
      const score = (d.priority ?? 0) * 10 - dist + facing * 0.6;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  label(d: InteractDef): string {
    return typeof d.label === 'function' ? d.label() : d.label;
  }

  markUsed(id: string): void {
    this.lastUse.set(id, this.time);
  }

  setCoop(group: string, role: string, on: boolean): void {
    let s = this.coopHeld.get(group);
    if (!s) { s = new Set(); this.coopHeld.set(group, s); }
    if (on) s.add(role); else s.delete(role);
  }

  coopRoles(group: string): string[] {
    const roles = new Set<string>();
    for (const d of this.items.values()) if (d.coop === group) roles.add(d.role ?? (d.who as string) ?? d.id);
    return [...roles];
  }

  coopComplete(group: string): boolean {
    const held = this.coopHeld.get(group);
    if (!held) return false;
    const roles = this.coopRoles(group);
    return roles.length > 0 && roles.every((r) => held.has(r));
  }
}
