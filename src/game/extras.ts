// Optional "memories": objects either player can examine for a short exchange between Elias and Jax.
// Found memories are chapter flags (saved with checkpoints) and counted per chapter.
import * as THREE from 'three';
import type { Game } from './game';
import type { Line } from './dialogue';

export interface MemoryDef {
  id: string;
  pos: THREE.Vector3;
  label: string;
  lines: Line[];
  radius?: number;
  enabled?: () => boolean;
}

export class Extras {
  private memories = new Map<string, MemoryDef>();

  constructor(private g: Game) {}

  addMemory(m: MemoryDef): void {
    this.memories.set(m.id, m);
    const g = this.g;
    g.interact.add({
      id: `mem_${m.id}`, pos: m.pos, radius: m.radius ?? 1.4, label: m.label, icon: 'talk', priority: 0,
      enabled: () => !g.dialogue.active && !g.chapter.flags[`mem_${m.id}`] && (m.enabled?.() ?? true),
      onUse: () => g.session.request('memory', { id: m.id }),
    });
  }

  get total(): number { return this.memories.size; }
  get found(): number { let n = 0; for (const id of this.memories.keys()) if (this.g.chapter.flags[`mem_${id}`]) n++; return n; }

  onEvent(type: string, args: unknown): boolean {
    if (type !== 'memory') return false;
    const g = this.g;
    const id = String((args as { id?: string })?.id ?? '');
    const m = this.memories.get(id);
    if (!m || g.chapter.flags[`mem_${id}`]) return true;
    g.chapter.flags[`mem_${id}`] = true;
    g.dialogue.play(m.lines);
    g.hud.notify(`Memory ${this.found}/${this.total}`, 2.5);
    g.audio.play('ui_tick', { volume: 0.5 });
    return true;
  }
}
