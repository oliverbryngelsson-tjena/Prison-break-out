// In-game HUD built from DOM elements over the canvas.
import * as THREE from 'three';
import type { SpeakerInfo } from '../game/dialogue';

const el = (tag: string, cls: string, parent?: HTMLElement, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

export interface Marker {
  id: string;
  pos: () => THREE.Vector3 | null;
  kind: 'partner' | 'objective' | 'guard' | 'item' | 'target';
  label?: string;
  /** 0..1 fill (guard awareness) */
  value?: () => number;
  visible?: () => boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private objective: HTMLElement;
  private objText: HTMLElement;
  private partner: HTMLElement;
  private prompt: HTMLElement;
  private promptLabel: HTMLElement;
  private promptRing: SVGCircleElement;
  private promptSub: HTMLElement;
  private subtitle: HTMLElement;
  private notice: HTMLElement;
  private title: HTMLElement;
  private vignette: HTMLElement;
  private letterTop: HTMLElement;
  private letterBot: HTMLElement;
  private fadeEl: HTMLElement;
  private banner: HTMLElement;
  private stats: HTMLElement;
  private markers = new Map<string, { m: Marker; el: HTMLElement }>();
  private markerLayer: HTMLElement;
  private noticeTimer = 0;
  private titleTimer = 0;
  private lastObjective = '';
  private skipHint: HTMLElement;
  private ctlHint: HTMLElement | null = null;
  private mg: { root: HTMLElement; t: HTMLElement; s: HTMLElement; l: HTMLElement; r: HTMLElement; mark: HTMLElement; sweet: HTMLElement } | null = null;
  showStats = false;
  fade = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.markerLayer = el('div', 'hud-markers', this.root);
    this.vignette = el('div', 'hud-vignette', this.root);
    this.letterTop = el('div', 'letterbox top', this.root);
    this.letterBot = el('div', 'letterbox bottom', this.root);
    this.objective = el('div', 'hud-objective', this.root, '<div class="label">OBJECTIVE</div>');
    this.objText = el('div', 'text', this.objective);
    this.partner = el('div', 'hud-partner', this.root);
    this.prompt = el('div', 'hud-prompt', this.root);
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 40 40');
    ring.classList.add('ring');
    ring.innerHTML = '<circle cx="20" cy="20" r="17" class="bg"/><circle cx="20" cy="20" r="17" class="fg"/>';
    this.prompt.appendChild(ring);
    this.promptRing = ring.querySelector('.fg') as SVGCircleElement;
    this.promptLabel = el('div', 'label', this.prompt);
    this.promptSub = el('div', 'sub', this.prompt);
    this.subtitle = el('div', 'hud-subtitle', this.root);
    this.notice = el('div', 'hud-notice', this.root);
    this.title = el('div', 'hud-title', this.root);
    this.banner = el('div', 'hud-banner', this.root);
    this.skipHint = el('div', 'hud-skip', this.root);
    this.fadeEl = el('div', 'hud-fade', this.root);
    this.stats = el('div', 'hud-stats', this.root);
    this.setAmmo(null);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  setGameplayVisible(v: boolean): void {
    this.root.classList.toggle('cinematic', !v);
  }

  setObjective(text: string): void {
    if (text === this.lastObjective) return;
    this.lastObjective = text;
    this.objText.textContent = text;
    this.objective.classList.toggle('empty', !text);
    this.objective.classList.remove('flash');
    void this.objective.offsetWidth;
    if (text) this.objective.classList.add('flash');
  }

  private partnerKey = '';
  setPartner(name: string, char: string, status: 'ok' | 'lag' | 'away', ping: number, hp: number): void {
    // Rebuilding this every frame was a measurable cost; only touch the DOM when something changed.
    const key = `${name}|${char}|${status}|${Math.round(ping / 10)}|${Math.round(hp)}`;
    if (key === this.partnerKey) return;
    this.partnerKey = key;
    this.partner.innerHTML = `<span class="dot ${status}"></span><span class="pname">${escapeHtml(name)}</span><span class="pchar">${char === 'elias' ? 'Elias' : 'Jax'}</span>` +
      `<span class="ping">${status === 'away' ? 'offline' : ping ? ping + ' ms' : ''}</span><span class="php"><i style="width:${Math.max(0, Math.min(100, hp))}%"></i></span>`;
  }

  setPrompt(label: string | null, progress = 0, sub = '', icon = 'hand'): void {
    if (!label) { this.prompt.classList.remove('show'); return; }
    this.prompt.classList.add('show');
    this.prompt.dataset.icon = icon;
    this.promptLabel.textContent = label;
    this.promptSub.textContent = sub;
    const c = 2 * Math.PI * 17;
    this.promptRing.style.strokeDasharray = `${c}`;
    this.promptRing.style.strokeDashoffset = `${c * (1 - Math.min(1, progress))}`;
  }

  setSubtitle(sp: SpeakerInfo | null, text: string, radio = false): void {
    if (!sp || !text) { this.subtitle.classList.remove('show'); return; }
    this.subtitle.innerHTML = `<span class="who" style="color:${sp.color}">${escapeHtml(sp.name)}${radio ? ' <em>(radio)</em>' : ''}</span><span class="line">${escapeHtml(text)}</span>`;
    this.subtitle.classList.add('show');
  }

  notify(text: string, secs = 2.6): void {
    this.notice.textContent = text;
    this.notice.classList.add('show');
    this.noticeTimer = secs;
  }

  showTitle(chapter: string, name: string, secs = 4.5): void {
    this.title.innerHTML = `<div class="ch">${escapeHtml(chapter)}</div><div class="nm">${escapeHtml(name)}</div>`;
    this.title.classList.add('show');
    this.titleTimer = secs;
  }

  setBanner(text: string | null, kind: 'warn' | 'info' | 'danger' = 'warn'): void {
    if (!text) { this.banner.classList.remove('show'); return; }
    this.banner.textContent = text;
    this.banner.className = `hud-banner show ${kind}`;
  }

  /** Mini-game panel: title, instruction and a bar (balance -1..1, or a 0..1 meter with a target zone). */
  setMiniGame(s: { title: string; sub: string; bar?: number; meter?: number | null; sweet?: [number, number]; left?: string; right?: string } | null): void {
    if (!s) { this.mg?.root.classList.remove('show'); return; }
    if (!this.mg) {
      const root = el('div', 'hud-mg', this.root);
      const t = el('div', 't', root), sub = el('div', 's', root);
      const row = el('div', 'row', root);
      const l = el('span', 'l', row), track = el('div', 'track', row), r = el('span', 'r', row);
      const sweet = el('b', 'sweet', track), mark = el('i', 'mark', track);
      this.mg = { root, t, s: sub, l, r, mark, sweet };
    }
    const m = this.mg;
    m.root.classList.add('show');
    if (m.t.textContent !== s.title) m.t.textContent = s.title;
    if (m.s.textContent !== s.sub) m.s.textContent = s.sub;
    if (m.l.textContent !== (s.left ?? '')) m.l.textContent = s.left ?? '';
    if (m.r.textContent !== (s.right ?? '')) m.r.textContent = s.right ?? '';
    const v = s.bar !== undefined ? 0.5 + 0.5 * s.bar : s.meter ?? null;
    m.mark.style.display = v === null ? 'none' : '';
    if (v !== null) m.mark.style.left = `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
    m.sweet.style.display = s.sweet ? '' : 'none';
    if (s.sweet) { m.sweet.style.left = `${s.sweet[0] * 100}%`; m.sweet.style.width = `${(s.sweet[1] - s.sweet[0]) * 100}%`; }
    m.root.classList.toggle('balance', s.bar !== undefined);
  }

  /** Small one-line help at the bottom (e.g. 'Click to control the camera'). */
  setControlHint(text: string | null): void {
    if (!this.ctlHint) this.ctlHint = el('div', 'hud-ctlhint', this.root);
    if (this.ctlHint.textContent !== (text ?? '')) this.ctlHint.textContent = text ?? '';
    this.ctlHint.classList.toggle('show', !!text);
  }

  setSkipHint(text: string | null): void {
    this.skipHint.textContent = text ?? '';
    this.skipHint.classList.toggle('show', !!text);
  }

  setLetterbox(on: boolean): void {
    this.letterTop.classList.toggle('on', on);
    this.letterBot.classList.toggle('on', on);
  }

  setFade(v: number): void {
    this.fade = v;
    this.fadeEl.style.opacity = String(v);
  }

  setHealth(hp: number): void {
    const k = Math.max(0, 1 - hp / 100);
    this.vignette.style.opacity = String(Math.min(0.9, k * 1.1));
  }

  addMarker(m: Marker): void {
    this.removeMarker(m.id);
    const e = el('div', `marker ${m.kind}`, this.markerLayer, m.kind === 'guard' ? '<i></i><b></b>' : m.kind === 'target' ? '<i></i>' : `<i></i><span>${escapeHtml(m.label ?? '')}</span>`);
    this.markers.set(m.id, { m, el: e });
  }

  removeMarker(id: string): void {
    const x = this.markers.get(id);
    if (x) { x.el.remove(); this.markers.delete(id); }
  }

  clearMarkers(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, statsText?: string): void {
    if (this.noticeTimer > 0) { this.noticeTimer -= dt; if (this.noticeTimer <= 0) this.notice.classList.remove('show'); }
    if (this.titleTimer > 0) { this.titleTimer -= dt; if (this.titleTimer <= 0) this.title.classList.remove('show'); }
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (const { m, el: e } of this.markers.values()) {
      const p = m.pos();
      const vis = p && (m.visible ? m.visible() : true);
      if (!p || !vis) { e.style.display = 'none'; continue; }
      v.copy(p).project(camera);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const val = m.value?.() ?? 0;
      if (m.kind === 'guard') {
        if (val < 0.05 || behind) { e.style.display = 'none'; continue; }
        e.style.display = '';
        e.classList.toggle('alert', val >= 1);
        (e.querySelector('b') as HTMLElement).style.height = `${Math.round(val * 100)}%`;
        (e.querySelector('i') as HTMLElement).textContent = val >= 1 ? '!' : '?';
        e.style.transform = `translate(${x}px, ${y}px)`;
        continue;
      }
      if (m.kind === 'target') {
        if (behind) { e.style.display = 'none'; continue; }
        e.style.display = '';
        e.style.transform = `translate(${x}px, ${y}px)`;
        continue;
      }
      // Clamp to screen edges for off-screen targets.
      const margin = 46;
      const off = behind || x < margin || x > w - margin || y < margin || y > h - margin;
      if (behind) { x = w - x; y = h - margin; }
      x = Math.min(w - margin, Math.max(margin, x));
      y = Math.min(h - margin, Math.max(margin, y));
      e.style.display = '';
      e.classList.toggle('edge', off);
      e.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (this.showStats && statsText) { this.stats.style.display = ''; this.stats.textContent = statsText; }
    else this.stats.style.display = 'none';
  }

  // ---- ammo counter (bottom right)
  private ammoEl: HTMLElement | null = null;
  private ammoText = '';
  setAmmo(text: string | null): void {
    if (!this.ammoEl) this.ammoEl = el('div', 'hud-ammo', this.root);
    const t = text ?? '';
    if (t === this.ammoText) return;
    this.ammoText = t;
    this.ammoEl.textContent = t;
    this.ammoEl.classList.toggle('show', !!text);
  }

  // ---- weapon shop (Dutch's van)
  private shop: HTMLElement | null = null;
  /** Shows a list of weapons with stat bars; `onPick` gets the chosen id. Returns false if already open. */
  showShop(title: string, items: Array<{ id: string; name: string; blurb: string; stats: Array<[string, number]>; taken?: string }>, onPick: (id: string) => void, onClose: () => void): boolean {
    if (this.shop) return false;
    const root = el('div', 'hud-shop', this.root);
    const head = el('div', 'shop-head', root, `<b>${escapeHtml(title)}</b>`);
    const close = el('button', 'btn small', head, 'Close') as HTMLButtonElement;
    close.addEventListener('click', () => { this.hideShop(); onClose(); });
    const list = el('div', 'shop-list', root);
    for (const it of items) {
      const card = el('button', 'shop-item' + (it.taken ? ' taken' : ''), list) as HTMLButtonElement;
      card.innerHTML = `<div class="nm">${escapeHtml(it.name)}${it.taken ? `<em>${escapeHtml(it.taken)}</em>` : ''}</div><div class="bl">${escapeHtml(it.blurb)}</div>` +
        it.stats.map(([k, v]) => `<div class="st"><span>${escapeHtml(k)}</span><i><b style="width:${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%"></b></i></div>`).join('');
      card.addEventListener('click', () => { this.hideShop(); onPick(it.id); });
    }
    this.shop = root;
    (list.querySelector('.shop-item') as HTMLElement | null)?.focus();
    return true;
  }

  hideShop(): void {
    this.shop?.remove();
    this.shop = null;
  }

  get shopOpen(): boolean { return !!this.shop; }

  dispose(): void {
    this.hideShop();
    this.root.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
