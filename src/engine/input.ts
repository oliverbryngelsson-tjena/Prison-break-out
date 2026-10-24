// Unified input: keyboard/mouse, gamepad and on-screen touch controls feed one state.
import * as THREE from 'three';

export const BUTTONS = ['interact', 'jump', 'crouch', 'sprint', 'attack', 'block', 'dodge', 'pause', 'throttle', 'brake', 'skip', 'aux'] as const;
export type ButtonName = (typeof BUTTONS)[number];

export interface ButtonState { down: boolean; pressed: boolean; released: boolean; time: number }

export interface Sensitivity { touch: number; mouse: number; gamepad: number; invertY: boolean }

const KEYMAP: Record<string, ButtonName> = {
  KeyE: 'interact', KeyF: 'interact', Space: 'jump', KeyC: 'crouch', ControlLeft: 'crouch', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'dodge', KeyR: 'block', Escape: 'pause', KeyP: 'pause', Enter: 'skip', KeyX: 'aux', KeyJ: 'attack', KeyK: 'block',
};

export class Input {
  readonly move = new THREE.Vector2();
  /** Look delta this frame in normalised units (already scaled by sensitivity). */
  readonly look = new THREE.Vector2();
  readonly buttons = Object.fromEntries(BUTTONS.map((b) => [b, { down: false, pressed: false, released: false, time: 0 }])) as Record<ButtonName, ButtonState>;
  sens: Sensitivity = { touch: 1, mouse: 1, gamepad: 1, invertY: false };
  /** Written by the on-screen controls. */
  readonly virtual = {
    move: new THREE.Vector2(),
    look: new THREE.Vector2(),
    buttons: {} as Partial<Record<ButtonName, boolean>>,
    /** One-frame taps (button tapped and released between frames). */
    taps: new Set<ButtonName>(),
  };
  /** Last device used: drives prompt icons and control visibility. */
  device: 'touch' | 'keyboard' | 'gamepad' = 'ontouchstart' in window ? 'touch' : 'keyboard';
  onDeviceChange: ((d: Input['device']) => void) | null = null;
  enabled = true;
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private mouseDelta = new THREE.Vector2();
  private keyTaps = new Set<ButtonName>();
  pointerLocked = false;
  private canvas: HTMLElement | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' && t.offsetParent !== null) return;
      this.setDevice('keyboard');
      if (!e.repeat) {
        const b = KEYMAP[e.code];
        if (b) this.keyTaps.add(b);
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) this.mouseDelta.x += e.movementX, this.mouseDelta.y += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.setDevice('keyboard');
      this.mouseButtons.add(e.button);
      if (e.button === 0) this.keyTaps.add('attack');
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === this.canvas; });
    window.addEventListener('touchstart', () => this.setDevice('touch'), { passive: true, capture: true });
  }

  attachCanvas(canvas: HTMLElement): void {
    this.canvas = canvas;
    canvas.addEventListener('click', () => {
      if (this.device !== 'touch' && this.enabled && !this.pointerLocked && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch { /* not allowed */ }
      }
    });
  }

  releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private setDevice(d: Input['device']): void {
    if (this.device !== d) {
      this.device = d;
      this.onDeviceChange?.(d);
    }
  }

  update(dt: number): void {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    const kb = new THREE.Vector2(mx, my);
    if (kb.lengthSq() > 1) kb.normalize();
    // Walk instead of run with Alt held.
    if (k.has('AltLeft')) kb.multiplyScalar(0.5);

    const held: Partial<Record<ButtonName, boolean>> = {};
    for (const [code, b] of Object.entries(KEYMAP)) if (k.has(code)) held[b] = true;
    if (this.mouseButtons.has(0)) held.attack = true;
    if (this.mouseButtons.has(2)) held.block = true;
    if (k.has('KeyW') || k.has('ArrowUp')) held.throttle = true;
    if (k.has('KeyS') || k.has('ArrowDown')) held.brake = true;

    // Gamepad (standard mapping)
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    const gpMove = new THREE.Vector2();
    const gpLook = new THREE.Vector2();
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      gpMove.set(dz(gp.axes[0] ?? 0), -dz(gp.axes[1] ?? 0));
      gpLook.set(dz(gp.axes[2] ?? 0), dz(gp.axes[3] ?? 0));
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const map: Array<[number, ButtonName]> = [[0, 'jump'], [1, 'crouch'], [2, 'attack'], [3, 'interact'], [4, 'block'], [5, 'dodge'], [10, 'sprint'], [9, 'pause'], [7, 'throttle'], [6, 'brake'], [8, 'skip']];
      let any = gpMove.lengthSq() > 0 || gpLook.lengthSq() > 0;
      for (const [i, name] of map) if (b(i)) { held[name] = true; any = true; }
      if (any) this.setDevice('gamepad');
    }

    for (const [b, v] of Object.entries(this.virtual.buttons)) if (v) held[b as ButtonName] = true;

    // Combine movement (largest magnitude wins).
    const cands = [kb, gpMove, this.virtual.move];
    let best = cands[0];
    for (const c of cands) if (c.lengthSq() > best.lengthSq()) best = c;
    this.move.copy(best);
    if (!this.enabled) this.move.set(0, 0);

    // Look
    const inv = this.sens.invertY ? -1 : 1;
    this.look.set(0, 0);
    this.look.x += this.mouseDelta.x * 0.0022 * this.sens.mouse;
    this.look.y += this.mouseDelta.y * 0.0022 * this.sens.mouse * inv;
    this.look.x += gpLook.x * 2.6 * dt * this.sens.gamepad;
    this.look.y += gpLook.y * 1.8 * dt * this.sens.gamepad * inv;
    this.look.x += this.virtual.look.x * 0.0052 * this.sens.touch;
    this.look.y += this.virtual.look.y * 0.0042 * this.sens.touch * inv;
    this.mouseDelta.set(0, 0);
    this.virtual.look.set(0, 0);
    if (!this.enabled) this.look.set(0, 0);

    const now = performance.now();
    for (const name of BUTTONS) {
      const s = this.buttons[name];
      const tapped = this.keyTaps.has(name) || this.virtual.taps.has(name);
      const down = this.enabled && (!!held[name] || tapped);
      s.pressed = (down && !s.down) || (this.enabled && tapped && s.down === false);
      s.released = !down && s.down;
      if (s.pressed) s.time = now;
      s.down = !!held[name] && this.enabled;
      // A tap that was pressed and released between frames still registers once.
      if (tapped && !held[name]) { s.pressed = this.enabled; s.released = false; }
    }
    this.keyTaps.clear();
    this.virtual.taps.clear();
  }

  /** Clears transient state (e.g. when opening a menu). */
  reset(): void {
    this.keys.clear();
    this.mouseButtons.clear();
    this.virtual.move.set(0, 0);
    this.virtual.buttons = {};
    for (const name of BUTTONS) Object.assign(this.buttons[name], { down: false, pressed: false, released: false });
  }

  heldFor(name: ButtonName): number {
    const s = this.buttons[name];
    return s.down ? (performance.now() - s.time) / 1000 : 0;
  }
}
