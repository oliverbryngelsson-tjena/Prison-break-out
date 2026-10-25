// Unified input: keyboard/mouse, gamepad and on-screen touch controls feed one state.
import * as THREE from 'three';

export const BUTTONS = ['interact', 'jump', 'crouch', 'sprint', 'attack', 'block', 'dodge', 'pause', 'throttle', 'brake', 'skip', 'aux'] as const;
export type ButtonName = (typeof BUTTONS)[number];

export interface ButtonState { down: boolean; pressed: boolean; released: boolean; time: number }

export interface Sensitivity { touch: number; mouse: number; gamepad: number; invertY: boolean }

/** Button names shown in prompts, per device. */
const KEY_GLYPHS: Record<ButtonName, string> = {
  interact: 'E', jump: 'Space', crouch: 'C', sprint: 'Shift', attack: 'LMB', block: 'RMB', dodge: 'Q', pause: 'Esc',
  throttle: 'W', brake: 'S', skip: 'Enter', aux: 'X',
};
const XBOX_GLYPHS: Record<ButtonName, string> = {
  interact: 'Y', jump: 'A', crouch: 'B', sprint: 'L3', attack: 'X', block: 'LB', dodge: 'RB', pause: 'Menu',
  throttle: 'RT', brake: 'LT', skip: 'View', aux: 'X',
};
const PS_GLYPHS: Record<ButtonName, string> = {
  interact: '△', jump: '✕', crouch: '○', sprint: 'L3', attack: '□', block: 'L1', dodge: 'R1', pause: 'Options',
  throttle: 'R2', brake: 'L2', skip: 'Share', aux: '□',
};

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
  /** Called when pointer lock is gained or lost (lost during play = pause). */
  onPointerLock: ((locked: boolean) => void) | null = null;
  /** Analog trigger values (gamepad), 0..1. */
  readonly analog = { throttle: 0, brake: 0 };
  /** Camera zoom from the mouse wheel (multiplier on the follow distance). */
  zoom = 1;
  private dragging = false;
  private padKind: 'xbox' | 'ps' = 'xbox';
  /** Gamepad rumble on hits, if the pad supports it. */
  rumble(strength = 0.5, ms = 120): void {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | undefined;
    try { void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch { /* unsupported */ }
  }
  /** Label for a button on the current device ('' on touch, which shows on-screen buttons instead). */
  glyph(b: ButtonName): string {
    if (this.device === 'touch') return '';
    if (this.device === 'gamepad') return (this.padKind === 'ps' ? PS_GLYPHS : XBOX_GLYPHS)[b];
    return KEY_GLYPHS[b];
  }
  /** Recent key events (debugging). */
  readonly keyLog: string[] = [];
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
      this.keyLog.push(`${Math.round(performance.now())}:${e.code}:${e.repeat ? 'r' : 'd'}`);
      if (this.keyLog.length > 20) this.keyLog.shift();
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.keyLog.push(`${Math.round(performance.now())}:${e.code}:u`); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); this.keyLog.push(`${Math.round(performance.now())}:blur`); });
    window.addEventListener('mousemove', (e) => {
      // Locked: free look. Not locked (pointer lock refused, e.g. inside an iframe): drag with a button held.
      if (this.pointerLocked || this.dragging) { this.mouseDelta.x += e.movementX; this.mouseDelta.y += e.movementY; }
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
        if (e.target === this.canvas && this.enabled) { this.dragging = true; this.setDevice('keyboard'); }
        return;
      }
      this.setDevice('keyboard');
      this.mouseButtons.add(e.button);
      if (e.button === 0) this.keyTaps.add('attack');
    });
    window.addEventListener('mouseup', (e) => { this.mouseButtons.delete(e.button); this.dragging = false; });
    window.addEventListener('wheel', (e) => {
      if (!this.pointerLocked && e.target !== this.canvas) return;
      this.zoom = Math.min(1.5, Math.max(0.65, this.zoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (this.pointerLocked || e.target === this.canvas) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.pointerLocked;
      this.pointerLocked = !!this.canvas && document.pointerLockElement === this.canvas;
      if (was !== this.pointerLocked) { this.mouseButtons.clear(); this.onPointerLock?.(this.pointerLocked); }
    });
    window.addEventListener('touchstart', () => this.setDevice('touch'), { passive: true, capture: true });
  }

  attachCanvas(canvas: HTMLElement): void {
    this.canvas = canvas;
    canvas.addEventListener('click', () => {
      if (this.device !== 'touch' && this.enabled && !this.pointerLocked) this.lockPointer();
    });
  }

  /** Captures the mouse for camera look (needs a user gesture: a click or key press). */
  lockPointer(): void {
    const c = this.canvas as (HTMLElement & { requestPointerLock?: (o?: object) => Promise<void> | void }) | null;
    if (!c?.requestPointerLock || this.device === 'touch') return;
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { try { c.requestPointerLock!(); } catch { /* refused */ } });
    } catch { try { c.requestPointerLock(); } catch { /* refused */ } }
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
    this.analog.throttle = 0;
    this.analog.brake = 0;
    if (gp) {
      this.padKind = /054c|playstation|dualshock|dualsense|wireless controller/i.test(gp.id) ? 'ps' : 'xbox';
      // Radial dead zone with a smooth ramp (no drift, fine control near the centre).
      const stick = (x: number, y: number, out: THREE.Vector2) => {
        const m = Math.hypot(x, y);
        if (m < 0.16) return out.set(0, 0);
        const k = Math.min(1, (m - 0.16) / 0.8) / m;
        return out.set(x * k, y * k);
      };
      stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0, gpMove);
      gpMove.y = -gpMove.y;
      stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0, gpLook);
      // Response curve on the look stick: precise aim, fast turns at full tilt.
      gpLook.multiplyScalar(0.35 + 0.65 * gpLook.length());
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const map: Array<[number, ButtonName]> = [[0, 'jump'], [1, 'crouch'], [2, 'attack'], [2, 'aux'], [3, 'interact'], [4, 'block'], [5, 'dodge'], [10, 'sprint'], [9, 'pause'], [7, 'throttle'], [6, 'brake'], [8, 'skip']];
      let any = gpMove.lengthSq() > 0 || gpLook.lengthSq() > 0;
      for (const [i, name] of map) if (b(i)) { held[name] = true; any = true; }
      this.analog.throttle = gp.buttons[7]?.value ?? 0;
      this.analog.brake = gp.buttons[6]?.value ?? 0;
      if (this.analog.throttle > 0.05 || this.analog.brake > 0.05) any = true;
      // D-pad drives movement too (handy on pads without a comfortable stick).
      const dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dy = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      if (dx || dy) { gpMove.set(dx, dy).normalize(); any = true; }
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
      // Pause keeps working while input is disabled (it is how you leave the pause menu).
      const en = this.enabled || name === 'pause';
      const tapped = this.keyTaps.has(name) || this.virtual.taps.has(name);
      const down = en && (!!held[name] || tapped);
      s.pressed = (down && !s.down) || (en && tapped && s.down === false);
      s.released = !down && s.down;
      if (s.pressed) s.time = now;
      s.down = !!held[name] && en;
      // A tap that was pressed and released between frames still registers once.
      if (tapped && !held[name]) { s.pressed = en; s.released = false; }
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
