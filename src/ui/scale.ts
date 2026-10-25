// Interface scaling: one factor (--u, applied to the root font size) sized from the real viewport so
// menus and HUD stay readable on a small phone and do not look tiny on a big monitor.
let userScale = 1;
let last = '';
const listeners = new Set<(u: number, portrait: boolean) => void>();

function viewport(): { w: number; h: number } {
  const vv = window.visualViewport;
  return { w: Math.round(vv?.width ?? window.innerWidth), h: Math.round(vv?.height ?? window.innerHeight) };
}

/** Auto factor for a viewport (1 at 1280x720; never below ~0.75 so text stays legible on phones). */
export function autoScale(w: number, h: number): number {
  // Upright phones are designed against a portrait reference so text is not shrunk by the narrow width.
  const base = h > w ? Math.min(w / 720, h / 1280) : Math.min(w / 1280, h / 720);
  const u = base < 1 ? 0.75 + 0.25 * Math.max(0, (base - 0.3) / 0.7) : 1 + (base - 1) * 0.7;
  return Math.min(2, Math.max(0.72, u));
}

export function applyUiScale(): void {
  const { w, h } = viewport();
  const portrait = h > w;
  const u = Math.min(2.4, Math.max(0.6, autoScale(w, h) * userScale));
  const key = `${u.toFixed(3)}:${portrait}`;
  if (key === last) return;
  last = key;
  document.documentElement.style.setProperty('--u', u.toFixed(3));
  document.body.classList.toggle('portrait', portrait);
  document.body.classList.toggle('touch-device', matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  document.body.classList.toggle('landscape', !portrait);
  for (const fn of listeners) fn(u, portrait);
}

export function setUserUiScale(s: number): void {
  userScale = Number.isFinite(s) && s > 0 ? s : 1;
  last = '';
  applyUiScale();
}

export function onUiScale(fn: (u: number, portrait: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentUiScale(): number {
  return Number(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
}

export function initUiScale(): void {
  const re = () => applyUiScale();
  window.addEventListener('resize', re);
  window.addEventListener('orientationchange', () => setTimeout(re, 120));
  window.visualViewport?.addEventListener('resize', re);
  applyUiScale();
}
