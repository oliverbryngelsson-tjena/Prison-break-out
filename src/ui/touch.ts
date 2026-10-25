// On-screen touch controls: floating joystick, camera drag area and customisable buttons.
import type { ButtonName, Input } from '../engine/input';

export interface ButtonLayout {
  /** distance from right edge (% of width) */
  x: number;
  /** distance from bottom (% of height) */
  y: number;
  /** size in px at 1x */
  size: number;
}

export type ControlMode = 'foot' | 'bike' | 'hidden';

interface BtnDef { name: ButtonName; label: string; icon: string; modes: ControlMode[]; toggle?: boolean }

const BTN_DEFS: BtnDef[] = [
  { name: 'interact', label: 'Use', icon: '✋', modes: ['foot'] },
  { name: 'attack', label: 'Hit', icon: '👊', modes: ['foot'] },
  { name: 'block', label: 'Block', icon: '🛡', modes: ['foot'] },
  { name: 'dodge', label: 'Dodge', icon: '↯', modes: ['foot'] },
  { name: 'jump', label: 'Jump', icon: '⤒', modes: ['foot'] },
  { name: 'crouch', label: 'Crouch', icon: '⤓', modes: ['foot'] },
  { name: 'sprint', label: 'Run', icon: '»', modes: ['foot'] },
  { name: 'throttle', label: 'Gas', icon: '▲', modes: ['bike'] },
  { name: 'brake', label: 'Brake', icon: '▼', modes: ['bike'] },
  { name: 'aux', label: 'Boost', icon: '⚡', modes: ['bike'] },
];

export const DEFAULT_LAYOUT: Record<string, ButtonLayout> = {
  interact: { x: 17, y: 34, size: 86 },
  attack: { x: 6, y: 14, size: 82 },
  block: { x: 17, y: 8, size: 64 },
  dodge: { x: 4, y: 33, size: 60 },
  jump: { x: 5, y: 52, size: 58 },
  crouch: { x: 15, y: 54, size: 56 },
  sprint: { x: 26, y: 18, size: 58 },
  throttle: { x: 6, y: 16, size: 104 },
  brake: { x: 22, y: 9, size: 78 },
  aux: { x: 8, y: 46, size: 64 },
};

/** Phones held upright: buttons in the bottom-right quarter, above the thumb reach line. */
export const DEFAULT_LAYOUT_PORTRAIT: Record<string, ButtonLayout> = {
  interact: { x: 24, y: 20, size: 86 },
  attack: { x: 5, y: 9, size: 82 },
  block: { x: 30, y: 5, size: 62 },
  dodge: { x: 4, y: 21, size: 58 },
  jump: { x: 7, y: 31, size: 58 },
  crouch: { x: 27, y: 32, size: 56 },
  sprint: { x: 45, y: 8, size: 58 },
  throttle: { x: 6, y: 9, size: 104 },
  brake: { x: 38, y: 5, size: 78 },
  aux: { x: 9, y: 24, size: 64 },
};

const LAYOUT_KEY = 'pbo.touchLayout';
const isPortrait = () => window.innerHeight > window.innerWidth;
const defaults = () => (isPortrait() ? DEFAULT_LAYOUT_PORTRAIT : DEFAULT_LAYOUT);
const layoutKey = () => (isPortrait() ? LAYOUT_KEY + ':portrait' : LAYOUT_KEY);

export class TouchControls {
  readonly root: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private buttons = new Map<ButtonName, HTMLElement>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  layout: Record<string, ButtonLayout>;
  scale = 1;
  opacity = 0.75;
  mode: ControlMode = 'foot';
  private editing = false;
  private flags = { jump: true, combat: false, crouch: true, sprint: true };
  private labels = new Map<ButtonName, string>();
  /** Visible only on touch devices (or when forced). */
  enabled: boolean;

  constructor(parent: HTMLElement, private input: Input) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    parent.appendChild(this.root);
    this.layout = loadLayout();
    const lookZone = document.createElement('div');
    lookZone.className = 'touch-look';
    this.root.appendChild(lookZone);
    const moveZone = document.createElement('div');
    moveZone.className = 'touch-move';
    this.root.appendChild(moveZone);
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.appendChild(this.stickKnob);
    this.root.appendChild(this.stickBase);
    for (const d of BTN_DEFS) {
      const b = document.createElement('button');
      b.className = 'tbtn';
      b.dataset.name = d.name;
      b.innerHTML = `<span class="ic">${d.icon}</span><span class="lb">${d.label}</span>`;
      this.root.appendChild(b);
      this.buttons.set(d.name, b);
      this.bindButton(b, d);
    }
    // Joystick (left side)
    moveZone.addEventListener('pointerdown', (e) => {
      if (this.editing || this.stickId !== null) return;
      this.stickId = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    moveZone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.virtual.move.set(0, 0);
      this.stickBase.classList.remove('active');
      this.stickKnob.style.transform = 'translate(-50%,-50%)';
      this.input.virtual.buttons.sprint = false;
    };
    moveZone.addEventListener('pointerup', endStick);
    moveZone.addEventListener('pointercancel', endStick);
    // Camera look (right side, anywhere not on a button)
    lookZone.addEventListener('pointerdown', (e) => {
      if (this.editing) return;
      lookZone.setPointerCapture(e.pointerId);
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
    });
    lookZone.addEventListener('pointermove', (e) => {
      const p = this.lookIds.get(e.pointerId);
      if (!p) return;
      this.input.virtual.look.x += e.clientX - p.x;
      this.input.virtual.look.y += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => this.lookIds.delete(e.pointerId);
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);
    this.enabled = input.device === 'touch' || new URLSearchParams(location.search).has('touch');
    this.applyLayout();
    window.addEventListener('resize', () => {
      // Each orientation keeps its own (customisable) layout.
      if (this.layoutPortrait !== isPortrait()) { this.layout = loadLayout(); this.layoutPortrait = isPortrait(); }
      this.applyLayout();
    });
  }
  private layoutPortrait = isPortrait();

  private updateStick(x: number, y: number): void {
    const R = 58 * this.scale;
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    // Drag the base along when the thumb goes far past the edge.
    if (d > R * 1.6) {
      const k = (d - R * 1.6) / d;
      this.stickOrigin.x += dx * k;
      this.stickOrigin.y += dy * k;
      this.stickBase.style.left = `${this.stickOrigin.x}px`;
      this.stickBase.style.top = `${this.stickOrigin.y}px`;
      dx = x - this.stickOrigin.x; dy = y - this.stickOrigin.y;
    }
    const dd = Math.hypot(dx, dy);
    const cl = Math.min(1, dd / R);
    const nx = dd > 0 ? dx / dd : 0, ny = dd > 0 ? dy / dd : 0;
    this.stickKnob.style.transform = `translate(calc(-50% + ${nx * cl * R}px), calc(-50% + ${ny * cl * R}px))`;
    // Small dead zone, then a smooth response curve.
    const mag = cl < 0.12 ? 0 : (cl - 0.12) / 0.88;
    this.input.virtual.move.set(nx * mag, -ny * mag);
    // Pushing far beyond the ring sprints.
    this.input.virtual.buttons.sprint = this.flags.sprint && dd > R * 1.35 && this.mode === 'foot';
  }

  private bindButton(b: HTMLElement, d: BtnDef): void {
    let id: number | null = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.editing) { this.startDrag(b, d.name, e); return; }
      id = e.pointerId;
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      this.input.virtual.buttons[d.name] = true;
      this.input.virtual.taps.add(d.name);
      if (navigator.vibrate && (d.name === 'attack' || d.name === 'interact')) { try { navigator.vibrate(8); } catch { /* ignore */ } }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      b.classList.remove('down');
      this.input.virtual.buttons[d.name] = false;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMode(m: ControlMode): void {
    if (this.mode === m) return;
    this.mode = m;
    this.input.virtual.buttons = {};
    this.applyVisibility();
  }

  setFlags(f: { jump: boolean; combat: boolean; crouch: boolean; sprint: boolean }): void {
    if (f.jump === this.flags.jump && f.combat === this.flags.combat && f.crouch === this.flags.crouch && f.sprint === this.flags.sprint) return;
    this.flags = { ...f };
    this.applyVisibility();
  }

  /** Context label on the Use button ("Climb", "Talk"...). */
  setLabel(name: ButtonName, label: string | null, highlight = false): void {
    const b = this.buttons.get(name);
    if (!b) return;
    const def = BTN_DEFS.find((d) => d.name === name)!;
    const text = label ?? def.label;
    if (this.labels.get(name) !== text) {
      this.labels.set(name, text);
      (b.querySelector('.lb') as HTMLElement).textContent = text;
    }
    b.classList.toggle('hot', highlight);
  }

  setActive(name: ButtonName, on: boolean): void {
    this.buttons.get(name)?.classList.toggle('on', on);
  }

  private applyVisibility(): void {
    this.root.style.display = this.enabled && this.mode !== 'hidden' ? '' : 'none';
    for (const d of BTN_DEFS) {
      const b = this.buttons.get(d.name)!;
      let vis = d.modes.includes(this.mode);
      if (d.name === 'jump' && !this.flags.jump) vis = false;
      if ((d.name === 'attack' || d.name === 'block' || d.name === 'dodge') && !this.flags.combat) vis = false;
      if (d.name === 'crouch' && !this.flags.crouch) vis = false;
      if (d.name === 'sprint' && !this.flags.sprint) vis = false;
      b.style.display = vis || this.editing ? '' : 'none';
    }
  }

  applyLayout(): void {
    const sMin = Math.min(window.innerWidth, window.innerHeight);
    const auto = Math.max(0.7, Math.min(1.25, sMin / 420));
    for (const [name, b] of this.buttons) {
      const l = this.layout[name] ?? defaults()[name];
      const size = l.size * this.scale * auto;
      b.style.width = b.style.height = `${size}px`;
      b.style.right = `calc(${l.x}% + env(safe-area-inset-right, 0px))`;
      b.style.bottom = `calc(${l.y}% + env(safe-area-inset-bottom, 0px))`;
      b.style.fontSize = `${Math.round(size * 0.3)}px`;
    }
    this.root.style.setProperty('--touch-opacity', String(this.opacity));
    this.stickBase.style.setProperty('--stick-size', `${132 * this.scale * auto}px`);
    this.applyVisibility();
  }

  // ---- layout editor
  setEditing(on: boolean): void {
    this.editing = on;
    this.root.classList.toggle('editing', on);
    if (on) { this.root.style.display = ''; for (const b of this.buttons.values()) b.style.display = ''; }
    else { saveLayout(this.layout); this.applyVisibility(); }
  }

  private startDrag(b: HTMLElement, name: ButtonName, e: PointerEvent): void {
    b.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = ((window.innerWidth - ev.clientX) / window.innerWidth) * 100 - (b.offsetWidth / 2 / window.innerWidth) * 100;
      const y = ((window.innerHeight - ev.clientY) / window.innerHeight) * 100 - (b.offsetHeight / 2 / window.innerHeight) * 100;
      const cur = this.layout[name] ?? { ...defaults()[name] };
      this.layout[name] = { ...cur, x: Math.max(0, Math.min(90, x)), y: Math.max(0, Math.min(85, y)) };
      this.applyLayout();
    };
    const upEv = () => { b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', upEv); this.selected = name; this.onSelect?.(name); };
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', upEv);
  }

  selected: ButtonName | null = null;
  onSelect: ((n: ButtonName) => void) | null = null;

  resizeSelected(size: number): void {
    if (!this.selected) return;
    const cur = this.layout[this.selected] ?? { ...defaults()[this.selected] };
    this.layout[this.selected] = { ...cur, size };
    this.applyLayout();
  }

  resetLayout(): void {
    this.layout = JSON.parse(JSON.stringify(defaults()));
    saveLayout(this.layout);
    this.applyLayout();
  }

  release(): void {
    this.stickId = null;
    this.lookIds.clear();
    this.input.virtual.move.set(0, 0);
    this.input.virtual.buttons = {};
    this.stickBase.classList.remove('active');
    for (const b of this.buttons.values()) b.classList.remove('down');
  }
}

function loadLayout(): Record<string, ButtonLayout> {
  try {
    const s = localStorage.getItem(layoutKey());
    if (s) return { ...JSON.parse(JSON.stringify(defaults())), ...JSON.parse(s) };
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(defaults()));
}

function saveLayout(l: Record<string, ButtonLayout>): void {
  try { localStorage.setItem(layoutKey(), JSON.stringify(l)); } catch { /* ignore */ }
}
