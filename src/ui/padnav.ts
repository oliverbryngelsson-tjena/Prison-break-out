// Menu navigation with a gamepad (D-pad / left stick, A = select, B = back) and the keyboard arrows.
// Moves focus spatially between the visible screen's controls.

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

function visibleRoot(): HTMLElement | null {
  const shown = [...document.querySelectorAll<HTMLElement>('.screen.show')];
  return shown[shown.length - 1] ?? null;
}

function candidates(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => {
    if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function center(e: HTMLElement): { x: number; y: number } {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export class PadNav {
  /** True while gameplay owns the controls (menus closed). */
  suspended = () => false;
  private prev: Record<string, boolean> = {};
  private repeatAt = 0;
  private current: HTMLElement | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.suspended()) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.code];
      if (dir) {
        // Sliders keep their own left/right behaviour.
        if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range' && dir[0] !== 0) return;
        if (this.move(dir[0], dir[1])) e.preventDefault();
      } else if (e.code === 'Escape' || e.code === 'Backspace') {
        if (this.back()) e.preventDefault();
      }
    });
  }

  /** Call every frame. */
  update(): void {
    if (this.suspended()) { this.prev = {}; return; }
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!gp) return;
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const state: Record<string, boolean> = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      a: b(0), b: b(1), start: b(9),
    };
    const now = performance.now();
    const edge = (k: string) => state[k] && !this.prev[k];
    const dirs: Array<[string, number, number]> = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    for (const [k, dx, dy] of dirs) {
      if (edge(k) || (state[k] && now > this.repeatAt)) {
        this.repeatAt = now + (edge(k) ? 380 : 140);
        const f = document.activeElement as HTMLInputElement | null;
        if (f?.tagName === 'INPUT' && f.type === 'range' && dx !== 0) {
          f.value = String(Number(f.value) + dx * Number(f.step || 1));
          f.dispatchEvent(new Event('input', { bubbles: true }));
        } else this.move(dx, dy);
      }
    }
    if (edge('a')) {
      const f = this.focused();
      if (f) f.click();
    }
    if (edge('b')) this.back();
    this.prev = state;
  }

  private focused(): HTMLElement | null {
    const root = visibleRoot();
    const a = document.activeElement as HTMLElement | null;
    if (root && a && root.contains(a) && a !== document.body) return a;
    return null;
  }

  private setFocus(e: HTMLElement): void {
    this.current?.classList.remove('padfocus');
    this.current = e;
    e.classList.add('padfocus');
    e.focus({ preventScroll: false });
    e.scrollIntoView?.({ block: 'nearest' });
  }

  /** Moves focus to the nearest control in a direction. Returns true if something was focused. */
  move(dx: number, dy: number): boolean {
    const root = visibleRoot();
    if (!root) return false;
    const list = candidates(root);
    if (!list.length) return false;
    const cur = this.focused();
    if (!cur || !list.includes(cur)) {
      const first = root.querySelector<HTMLElement>('.mbtn:not([disabled]), .btn.primary:not([disabled])') ?? list[0];
      this.setFocus(first);
      return true;
    }
    const c = center(cur);
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const p = center(e);
      const vx = p.x - c.x, vy = p.y - c.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) { this.setFocus(best); return true; }
    return false;
  }

  /** Activates the screen's back / close / leave button. */
  back(): boolean {
    const root = visibleRoot();
    if (!root) return false;
    const btn = root.querySelector<HTMLElement>('[data-a=back], [data-a=resume], [data-a=done], [data-a=close]');
    if (btn) { btn.click(); return true; }
    return false;
  }
}
