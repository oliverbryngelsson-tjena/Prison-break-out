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
  kind: 'partner' | 'objective' | 'guard' | 'item';
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

  setPartner(name: string, char: string, status: 'ok' | 'lag' | 'away', ping: number, hp: number): void {
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
    const e = el('div', `marker ${m.kind}`, this.markerLayer, m.kind === 'guard' ? '<i></i><b></b>' : `<i></i><span>${escapeHtml(m.label ?? '')}</span>`);
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

  dispose(): void {
    this.root.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
