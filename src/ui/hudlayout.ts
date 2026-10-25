// Player-placed HUD: drag the objective, partner panel, prompts and subtitles anywhere and resize them.
// Saved per screen orientation; anything not moved keeps the original position.
import type { Hud } from './hud';

export interface HudPos { x: number; y: number; s: number }

const ITEMS: Array<{ id: string; sel: string; sample: string }> = [
  { id: 'objective', sel: '.hud-objective', sample: 'Objective: where to go next' },
  { id: 'partner', sel: '.hud-partner', sample: 'Partner' },
  { id: 'prompt', sel: '.hud-prompt', sample: 'Use' },
  { id: 'subtitle', sel: '.hud-subtitle', sample: 'Subtitles appear here.' },
  { id: 'banner', sel: '.hud-banner', sample: 'Warnings appear here' },
  { id: 'notice', sel: '.hud-notice', sample: 'Notices' },
];

const KEY = 'pbo.hudLayout';
const key = () => KEY + (window.innerHeight > window.innerWidth ? ':portrait' : '');

export class HudLayout {
  layout: Record<string, HudPos> = {};
  private editing = false;
  private filled: Array<{ el: HTMLElement; text: HTMLElement; was: string }> = [];
  private bound = new Set<string>();
  selected: string | null = null;
  onSelect: ((id: string) => void) | null = null;
  private portrait = window.innerHeight > window.innerWidth;

  constructor(private hud: Hud) {
    this.layout = load();
    this.apply();
    window.addEventListener('resize', () => {
      const p = window.innerHeight > window.innerWidth;
      if (p !== this.portrait) { this.portrait = p; this.layout = load(); }
      this.apply();
    });
  }

  private el(id: string): HTMLElement | null {
    const it = ITEMS.find((i) => i.id === id);
    return it ? (this.hud.root.querySelector(it.sel) as HTMLElement | null) : null;
  }

  /** Puts every moved item where the player left it; others go back to the stylesheet's place. */
  apply(): void {
    for (const it of ITEMS) {
      const e = this.el(it.id);
      if (!e) continue;
      const p = this.layout[it.id];
      if (!p) { e.style.left = e.style.top = e.style.right = e.style.bottom = e.style.transform = ''; e.classList.remove('moved'); continue; }
      e.classList.add('moved');
      e.style.left = `${p.x}%`;
      e.style.top = `${p.y}%`;
      e.style.right = 'auto';
      e.style.bottom = 'auto';
      e.style.transform = `translate(-50%, -50%) scale(${p.s})`;
    }
  }

  setEditing(on: boolean): void {
    this.editing = on;
    this.hud.root.classList.toggle('hud-editing', on);
    if (on) {
      // Show every item with sample text so there's something to grab.
      for (const it of ITEMS) {
        const e = this.el(it.id);
        if (!e) continue;
        const text = (e.querySelector('.text') as HTMLElement | null) ?? (e.querySelector('.label') as HTMLElement | null) ?? e;
        if (!e.textContent?.trim() || e.classList.contains('empty') || !e.classList.contains('show')) {
          this.filled.push({ el: e, text, was: text.innerHTML });
          if (!text.textContent?.trim()) text.textContent = it.sample;
        }
        if (!this.bound.has(it.id)) { this.bound.add(it.id); this.bindDrag(it.id, e); }
      }
    } else {
      for (const f of this.filled) f.text.innerHTML = f.was;
      this.filled = [];
      save(this.layout);
    }
  }

  private bindDrag(id: string, e: HTMLElement): void {
    e.addEventListener('pointerdown', (ev) => {
      if (!this.editing) return;
      ev.preventDefault(); ev.stopPropagation();
      try { e.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
      this.selected = id;
      this.onSelect?.(id);
      const move = (m: PointerEvent) => {
        const cur = this.layout[id] ?? { x: 50, y: 50, s: 1 };
        this.layout[id] = { ...cur, x: clamp((m.clientX / window.innerWidth) * 100, 3, 97), y: clamp((m.clientY / window.innerHeight) * 100, 3, 97) };
        this.apply();
      };
      const up = () => { e.removeEventListener('pointermove', move); e.removeEventListener('pointerup', up); };
      e.addEventListener('pointermove', move);
      e.addEventListener('pointerup', up);
      move(ev);
    });
  }

  /** Scale of the selected item (0.5..1.8). */
  scaleOf(id: string): number { return this.layout[id]?.s ?? 1; }

  resizeSelected(s: number): void {
    if (!this.selected) return;
    const e = this.el(this.selected);
    let cur = this.layout[this.selected];
    if (!cur && e) {
      // First change to an item still in its original place: start from where it is now.
      const r = e.getBoundingClientRect();
      cur = { x: ((r.left + r.width / 2) / window.innerWidth) * 100, y: ((r.top + r.height / 2) / window.innerHeight) * 100, s: 1 };
    }
    this.layout[this.selected] = { ...(cur ?? { x: 50, y: 50, s: 1 }), s };
    this.apply();
  }

  reset(): void {
    this.layout = {};
    save(this.layout);
    this.apply();
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function load(): Record<string, HudPos> {
  try { const s = localStorage.getItem(key()); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return {};
}
function save(l: Record<string, HudPos>): void {
  try { localStorage.setItem(key(), JSON.stringify(l)); } catch { /* ignore */ }
}
