// DOM menus: main menu, create/join, lobby, settings, credits, loading, pause, chapter end.
import type { CharacterId, RoomState } from '../../shared/protocol';
import type { Settings } from '../game/settings';
import { escapeHtml } from './hud';
import { CHAPTER_TITLES } from '../levels';
import { loadJSON } from '../engine/assets';
import { BUILD, BUILD_DATE } from './version';

type Handler = () => void;

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export const CHAR_INFO: Record<CharacterId, { name: string; desc: string; img: string }> = {
  elias: { name: 'Elias Varga', desc: 'Former accountant. Patient, observant, trusts no one. Six years into a sentence for a murder he swears he didn\'t commit.', img: 'assets/ui/portrait_elias.jpg' },
  jax: { name: 'Jax Rourke', desc: 'Getaway driver. Quick fists, quicker mouth. Just transferred to Redmoor — and nobody knows why.', img: 'assets/ui/portrait_jax.jpg' },
};

const TIPS = [
  'Crouch to move quietly. Guards notice you faster when you run in their sight.',
  'The marker over a guard fills as they notice you. Break line of sight before it turns red.',
  'Some doors and obstacles need both of you at the same time — look for the co-op icon.',
  'If your partner goes down, hold Use next to them to help them up.',
  'Hold Block just before a punch lands to take almost no damage.',
  'You can customise the size and position of the touch buttons in Settings → Controls.',
  'Lower the graphics quality in Settings if your phone gets warm.',
];

export interface MenuCallbacks {
  onContinue: Handler;
  onCreate: (chapter: number) => void;
  onJoin: (code: string) => void;
  onLeaveLobby: Handler;
  onSelectChar: (c: CharacterId) => void;
  onReady: (r: boolean) => void;
  onStart: Handler;
  onResume: Handler;
  onQuitGame: Handler;
  onSettingsChanged: (s: Settings) => void;
  onEditLayout: Handler;
  onNextChapter: Handler;
  onResetSave: Handler;
}

export class Menus {
  readonly root: HTMLElement;
  private screens = new Map<string, HTMLElement>();
  current = '';
  private cb: MenuCallbacks;
  settings: Settings;
  private room: RoomState | null = null;
  private you: string | null = null;
  private settingsReturn = 'main';
  netStatus = 'offline';
  hasSave = false;
  saveLabel = '';
  unlocked = 1;
  private joinError: HTMLElement | null = null;
  private createError: HTMLElement | null = null;

  constructor(parent: HTMLElement, settings: Settings, cb: MenuCallbacks) {
    this.root = parent;
    this.settings = settings;
    this.cb = cb;
    this.buildMain();
    this.buildCreate();
    this.buildJoin();
    this.buildLobby();
    this.buildSettings();
    this.buildCredits();
    this.buildLoading();
    this.buildPause();
    this.buildEnd();
    this.buildMessage();
  }

  private add(name: string, el: HTMLElement): HTMLElement {
    el.classList.add('screen');
    el.dataset.screen = name;
    this.root.appendChild(el);
    this.screens.set(name, el);
    return el;
  }

  show(name: string | null): void {
    // Drop focus from text fields on the previous screen, or the game would ignore keys typed "into" a hidden input.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    for (const [n, el] of this.screens) el.classList.toggle('show', n === name);
    this.current = name ?? '';
    if (name === 'main') this.refreshMain();
    if (name === 'lobby') this.renderLobby();
    if (name === 'settings') this.renderSettings();
  }

  private click(sel: string, root: HTMLElement, fn: Handler): void {
    root.querySelector(sel)?.addEventListener('click', (e) => { e.preventDefault(); fn(); });
  }

  // ---------------------------------------------------------------- main
  private buildMain(): void {
    const el = this.add('main', h(`<div class="dim">
      <div class="menu-col">
        <div class="title-block"><div class="t1">REDMOOR<span>.</span></div><div class="t2">Break Out · Two-Player Co-op</div></div>
        <div class="menu-list">
          <button class="mbtn" data-a="continue">Continue<span class="sub" data-sub="continue"></span></button>
          <button class="mbtn" data-a="create">Create Game<span class="sub">Host a private online game for you and a friend</span></button>
          <button class="mbtn" data-a="join">Join Game<span class="sub">Enter your friend's room code</span></button>
          <button class="mbtn" data-a="settings">Settings</button>
          <button class="mbtn" data-a="credits">Credits</button>
        </div>
      </div>
      <div class="net-pill"><span class="dot" data-net></span><span data-net-text>Offline</span></div>
      <div class="foot">Online co-op only — two players, two devices.<span class="ver">Version ${BUILD} · ${BUILD_DATE}</span></div>
    </div>`));
    this.click('[data-a=continue]', el, () => this.cb.onContinue());
    this.click('[data-a=create]', el, () => this.show('create'));
    this.click('[data-a=join]', el, () => this.show('join'));
    this.click('[data-a=settings]', el, () => { this.settingsReturn = 'main'; this.show('settings'); });
    this.click('[data-a=credits]', el, () => this.show('credits'));
  }

  refreshMain(): void {
    const el = this.screens.get('main')!;
    const c = el.querySelector('[data-a=continue]') as HTMLButtonElement;
    c.style.display = this.hasSave ? '' : 'none';
    (el.querySelector('[data-sub=continue]') as HTMLElement).textContent = this.saveLabel;
    this.setNet(this.netStatus);
  }

  setNet(status: string): void {
    this.netStatus = status;
    for (const el of this.root.querySelectorAll('[data-net]')) el.className = `dot ${status}`;
    const label: Record<string, string> = { offline: 'Server: not connected', connecting: 'Connecting…', online: 'Server online', reconnecting: 'Reconnecting…', failed: 'Server unreachable' };
    for (const el of this.root.querySelectorAll('[data-net-text]')) el.textContent = label[status] ?? status;
  }

  // ---------------------------------------------------------------- create
  private buildCreate(): void {
    const el = this.add('create', h(`<div class="center"><div class="panel">
      <h2>Create Game <button class="btn small back" data-a="back">Back</button></h2>
      <div class="field"><label>Your name</label><input type="text" maxlength="16" data-name placeholder="Name" autocomplete="nickname"></div>
      <div class="field"><label>Start from</label><div class="row" data-chapters></div></div>
      <p class="hint">You'll get a room code to share. Your friend joins from their own device.</p>
      <div class="error" data-err></div>
      <div class="row"><button class="btn primary" data-a="go">Create private room</button></div>
    </div></div>`));
    this.createError = el.querySelector('[data-err]');
    this.click('[data-a=back]', el, () => this.show('main'));
    this.click('[data-a=go]', el, () => {
      const name = (el.querySelector('[data-name]') as HTMLInputElement).value.trim();
      if (!name) { this.createError!.textContent = 'Enter a name so your friend knows it\'s you.'; return; }
      this.settings.name = name;
      this.cb.onSettingsChanged(this.settings);
      const sel = el.querySelector('[data-chapters] .on') as HTMLElement | null;
      this.createError!.textContent = '';
      this.cb.onCreate(Number(sel?.dataset.ch ?? 1));
    });
    const obs = new MutationObserver(() => {
      if (el.classList.contains('show')) {
        (el.querySelector('[data-name]') as HTMLInputElement).value = this.settings.name;
        const wrap = el.querySelector('[data-chapters]')!;
        wrap.innerHTML = '';
        const seg = document.createElement('div');
        seg.className = 'seg';
        const opts: Array<[number, string]> = [];
        if (this.hasSave) opts.push([0, 'Continue']);
        for (let i = 1; i <= Math.max(1, this.unlocked); i++) opts.push([i, `Ch. ${i}`]);
        opts.forEach(([n, label], k) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.dataset.ch = String(n);
          b.title = n ? CHAPTER_TITLES[n] : 'From your last checkpoint';
          if (k === 0) b.classList.add('on');
          b.addEventListener('click', () => { for (const x of seg.children) x.classList.remove('on'); b.classList.add('on'); });
          seg.appendChild(b);
        });
        wrap.appendChild(seg);
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  setCreateError(msg: string): void { if (this.createError) this.createError.textContent = msg; }

  // ---------------------------------------------------------------- join
  private buildJoin(): void {
    const el = this.add('join', h(`<div class="center"><div class="panel">
      <h2>Join Game <button class="btn small back" data-a="back">Back</button></h2>
      <div class="field"><label>Your name</label><input type="text" maxlength="16" data-name placeholder="Name" autocomplete="nickname"></div>
      <div class="field"><label>Room code</label><input type="text" maxlength="5" class="code-input" data-code placeholder="•••••" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
      <div class="error" data-err></div>
      <div class="row"><button class="btn primary" data-a="go">Join</button></div>
    </div></div>`));
    this.joinError = el.querySelector('[data-err]');
    const code = el.querySelector('[data-code]') as HTMLInputElement;
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    this.click('[data-a=back]', el, () => this.show('main'));
    const go = () => {
      const name = (el.querySelector('[data-name]') as HTMLInputElement).value.trim();
      if (!name) { this.joinError!.textContent = 'Enter your name.'; return; }
      if (code.value.length !== 5) { this.joinError!.textContent = 'Room codes have 5 characters.'; return; }
      this.settings.name = name;
      this.cb.onSettingsChanged(this.settings);
      this.joinError!.textContent = '';
      this.cb.onJoin(code.value);
    };
    this.click('[data-a=go]', el, go);
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const obs = new MutationObserver(() => {
      if (el.classList.contains('show')) (el.querySelector('[data-name]') as HTMLInputElement).value = this.settings.name;
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  prefillJoin(code: string): void {
    const el = this.screens.get('join')!;
    (el.querySelector('[data-code]') as HTMLInputElement).value = code.toUpperCase();
  }

  setJoinError(msg: string): void { if (this.joinError) this.joinError.textContent = msg; }

  // ---------------------------------------------------------------- lobby
  private buildLobby(): void {
    const el = this.add('lobby', h(`<div class="center"><div class="panel" style="width:min(62.5rem,96vw)">
      <h2>Private Lobby <button class="btn small back danger" data-a="leave">Leave</button></h2>
      <div class="lobby">
        <div>
          <div class="code-box"><div class="lbl">Room code</div><div class="code" data-code>-----</div>
            <div class="row" style="justify-content:center"><button class="btn small" data-a="invite">Invite friend</button><button class="btn small" data-a="copy">Copy code</button></div>
            <div class="hint" data-copied style="margin-top:0.375rem"></div>
          </div>
          <div class="players" data-players></div>
          <div class="hint" data-chapter style="margin-top:0.625rem"></div>
        </div>
        <div>
          <div class="chars" data-chars></div>
          <div class="row" style="margin-top:0.875rem;justify-content:flex-end">
            <span class="hint" data-status></span>
            <button class="btn" data-a="ready">Ready</button>
            <button class="btn primary" data-a="start">Start</button>
          </div>
        </div>
      </div>
    </div></div>`));
    this.click('[data-a=leave]', el, () => this.cb.onLeaveLobby());
    this.click('[data-a=ready]', el, () => {
      const me = this.room?.players.find((p) => p.id === this.you);
      this.cb.onReady(!me?.ready);
    });
    this.click('[data-a=start]', el, () => this.cb.onStart());
    this.click('[data-a=copy]', el, () => this.copy(this.room?.code ?? ''));
    this.click('[data-a=invite]', el, () => this.invite());
  }

  private inviteUrl(): string {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('join', this.room?.code ?? '');
    const srv = new URLSearchParams(location.search).get('server');
    if (srv) u.searchParams.set('server', srv);
    return u.toString();
  }

  private async invite(): Promise<void> {
    const url = this.inviteUrl();
    const text = `Join me in Redmoor: Break Out — room code ${this.room?.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Redmoor: Break Out', text, url }); return; }
    } catch { /* cancelled */ }
    this.copy(url, 'Invite link copied — send it to your friend.');
  }

  private async copy(text: string, msg = 'Code copied.'): Promise<void> {
    const out = this.screens.get('lobby')!.querySelector('[data-copied]') as HTMLElement;
    try { await navigator.clipboard.writeText(text); out.textContent = msg; }
    catch { out.textContent = text; }
  }

  setRoom(room: RoomState | null, you: string | null): void {
    this.room = room;
    this.you = you;
    if (this.current === 'lobby') this.renderLobby();
  }

  private renderLobby(): void {
    const el = this.screens.get('lobby')!;
    const r = this.room;
    (el.querySelector('[data-code]') as HTMLElement).textContent = r?.code ?? '-----';
    const pl = el.querySelector('[data-players]') as HTMLElement;
    pl.innerHTML = '';
    const players = r?.players ?? [];
    for (const p of players) {
      pl.appendChild(h(`<div class="pl"><span class="dot ${p.connected ? 'ok' : 'away'}"></span><span class="name">${escapeHtml(p.name)}</span>
        <span class="tag">${p.isHost ? 'Host' : 'Guest'}${p.id === this.you ? ' · You' : ''}${p.ping ? ' · ' + p.ping + ' ms' : ''}</span>
        <span class="ready ${p.ready ? 'yes' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span></div>`));
    }
    if (players.length < 2) pl.appendChild(h(`<div class="pl empty"><span class="dot"></span>Waiting for your friend to join with the code…</div>`));
    const prog = r?.progress;
    (el.querySelector('[data-chapter]') as HTMLElement).textContent = prog ? `Starting: Chapter ${prog.chapter} — ${CHAPTER_TITLES[prog.chapter]}${prog.checkpoint ? ' (checkpoint)' : ''}` : 'Starting: Chapter 1 — Prison Life';
    const chars = el.querySelector('[data-chars]') as HTMLElement;
    chars.innerHTML = '';
    const me = players.find((p) => p.id === this.you);
    const other = players.find((p) => p.id !== this.you);
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      const info = CHAR_INFO[c];
      const mine = me?.character === c;
      const theirs = other?.character === c;
      const card = h(`<button class="char ${mine ? 'mine' : ''} ${theirs ? 'theirs' : ''}">
        <img src="${info.img}" alt="" onerror="this.style.visibility='hidden'">
        <div class="info"><div class="nm">${info.name.split(' ')[0]}</div><div class="desc">${info.desc}</div></div>
        ${mine ? '<span class="who">You</span>' : theirs ? `<span class="who">${escapeHtml(other!.name)}</span>` : ''}
      </button>`);
      card.addEventListener('click', () => this.cb.onSelectChar(c));
      chars.appendChild(card);
    }
    const readyBtn = el.querySelector('[data-a=ready]') as HTMLButtonElement;
    readyBtn.textContent = me?.ready ? 'Not ready' : 'Ready';
    readyBtn.classList.toggle('primary', !me?.ready);
    const start = el.querySelector('[data-a=start]') as HTMLButtonElement;
    start.style.display = me?.isHost ? '' : 'none';
    const all = players.length === 2 && players.every((p) => p.ready && p.connected);
    start.disabled = !all;
    (el.querySelector('[data-status]') as HTMLElement).textContent = players.length < 2 ? 'Share the code with your friend' : !all ? 'Both players must be ready' : me?.isHost ? 'Everyone is ready' : 'Waiting for the host to start';
  }

  // ---------------------------------------------------------------- settings
  private settingsTab = 'graphics';
  private buildSettings(): void {
    const el = this.add('settings', h(`<div class="center"><div class="panel">
      <h2>Settings <button class="btn small back" data-a="back">Done</button></h2>
      <div class="tabs">${['graphics', 'controls', 'audio', 'gameplay', 'network'].map((t) => `<button class="tab" data-tab="${t}">${t}</button>`).join('')}</div>
      <div data-body></div>
    </div></div>`));
    this.click('[data-a=back]', el, () => this.show(this.settingsReturn));
    for (const t of el.querySelectorAll('[data-tab]')) t.addEventListener('click', () => { this.settingsTab = (t as HTMLElement).dataset.tab!; this.renderSettings(); });
  }

  openSettings(from: string): void {
    this.settingsReturn = from;
    this.show('settings');
  }

  private renderSettings(): void {
    const el = this.screens.get('settings')!;
    for (const t of el.querySelectorAll('[data-tab]')) t.classList.toggle('on', (t as HTMLElement).dataset.tab === this.settingsTab);
    const body = el.querySelector('[data-body]') as HTMLElement;
    body.innerHTML = '';
    const s = this.settings;
    const changed = () => this.cb.onSettingsChanged(s);
    const row = (label: string, ctl: HTMLElement) => { const r = h(`<div class="set-row"><span>${label}</span><span class="ctl"></span></div>`); r.querySelector('.ctl')!.appendChild(ctl); body.appendChild(r); };
    const seg = <T extends string>(opts: Array<[T, string]>, cur: T, set: (v: T) => void) => {
      const e = h('<div class="seg"></div>');
      for (const [v, l] of opts) {
        const b = document.createElement('button');
        b.textContent = l;
        if (v === cur) b.classList.add('on');
        b.addEventListener('click', () => { set(v); changed(); this.renderSettings(); });
        e.appendChild(b);
      }
      return e;
    };
    const slider = (min: number, max: number, step: number, cur: number, set: (v: number) => void) => {
      const i = document.createElement('input');
      i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(cur);
      i.addEventListener('input', () => { set(Number(i.value)); changed(); });
      return i;
    };
    const toggle = (cur: boolean, set: (v: boolean) => void) => {
      const b = document.createElement('button');
      b.className = 'toggle' + (cur ? ' on' : '');
      b.addEventListener('click', () => { set(!b.classList.contains('on')); b.classList.toggle('on'); changed(); });
      return b;
    };
    if (this.settingsTab === 'graphics') {
      row('Quality preset', seg([['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], s.quality, (v) => { s.quality = v; }));
      row('Interface size', slider(0.75, 1.5, 0.05, s.uiScale ?? 1, (v) => { s.uiScale = v; }));
      row('Show performance stats', toggle(s.showFps, (v) => { s.showFps = v; }));
      body.appendChild(h('<p class="hint">Low: no shadows, reduced resolution. Medium: shadows, anti-aliasing. High: soft shadows, bloom, film grain. Ultra: high-resolution shadows and effects. Dynamic resolution keeps the frame rate steady on Low–High.</p>'));
    } else if (this.settingsTab === 'controls') {
      row('Touch look sensitivity', slider(0.3, 2.5, 0.05, s.sens.touch, (v) => { s.sens.touch = v; }));
      row('Mouse sensitivity', slider(0.3, 2.5, 0.05, s.sens.mouse, (v) => { s.sens.mouse = v; }));
      row('Gamepad sensitivity', slider(0.3, 2.5, 0.05, s.sens.gamepad, (v) => { s.sens.gamepad = v; }));
      row('Invert vertical look', toggle(s.invertY, (v) => { s.invertY = v; }));
      row('Camera follows movement', toggle(s.autoCamera, (v) => { s.autoCamera = v; }));
      row('Touch button size', slider(0.7, 1.5, 0.05, s.touchScale, (v) => { s.touchScale = v; }));
      row('Touch button opacity', slider(0.25, 1, 0.05, s.touchOpacity, (v) => { s.touchOpacity = v; }));
      const b = h('<button class="btn small">Edit HUD & controls</button>');
      b.addEventListener('click', () => this.cb.onEditLayout());
      row('Move and resize the joystick, buttons and HUD', b);
      body.appendChild(h(`<div class="hint" style="line-height:1.6;margin-top:0.75rem">
        <b>Keyboard + mouse</b> — click the game to capture the mouse · WASD move · Mouse look · Wheel zoom · Shift run · C crouch · E use (hold for co-op actions) · Space jump · Left click hit · Right click block · Q dodge · Enter skip · Esc pause.<br>
        <b>Bike</b> — W gas · S brake · A/D steer · X boost.<br>
        <b>Gamepad</b> (Xbox / PlayStation / most USB and Bluetooth pads) — left stick move · right stick look · Y/△ use · A/✕ jump · B/○ crouch · X/□ hit · LB/L1 block · RB/R1 dodge · L3 run · RT/LT gas and brake on the bike · Menu/Options pause · View/Share skip. Menus: D-pad or stick to move, A/✕ select, B/○ back.
      </div>`));
    } else if (this.settingsTab === 'audio') {
      row('Master volume', slider(0, 1, 0.05, s.volumes.master, (v) => { s.volumes.master = v; }));
      row('Music', slider(0, 1, 0.05, s.volumes.music, (v) => { s.volumes.music = v; }));
      row('Sound effects', slider(0, 1, 0.05, s.volumes.sfx, (v) => { s.volumes.sfx = v; }));
      row('Dialogue', slider(0, 1, 0.05, s.volumes.dialogue, (v) => { s.volumes.dialogue = v; }));
      row('Ambience', slider(0, 1, 0.05, s.volumes.ambience, (v) => { s.volumes.ambience = v; }));
      row('Voice acting', toggle(s.tts, (v) => { s.tts = v; }));
      body.appendChild(h('<p class="hint">Spoken dialogue uses your device\'s built-in speech voices; subtitles are always available.</p>'));
    } else if (this.settingsTab === 'gameplay') {
      row('Subtitles', toggle(s.subtitles, (v) => { s.subtitles = v; }));
      row('Subtitle size', seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], s.subtitleSize, (v) => { s.subtitleSize = v; }));
      row('Vibration', toggle(s.vibration, (v) => { s.vibration = v; }));
      const r = h('<button class="btn small danger">Delete saved progress</button>');
      r.addEventListener('click', () => { if (confirm('Delete your saved campaign progress on this device?')) this.cb.onResetSave(); });
      row('Saved progress', r);
    } else {
      const i = document.createElement('input');
      i.type = 'text';
      i.placeholder = 'Empty = join by room code (no server)';
      i.value = s.serverUrl;
      i.style.cssText = 'width:min(20rem,52vw);background:rgba(0,0,0,.4);border:1px solid var(--line);color:var(--text);padding:0.5625rem 0.625rem;border-radius:0.375rem;font-size:0.875rem';
      i.addEventListener('change', () => { s.serverUrl = i.value.trim(); changed(); });
      row('Game server address', i);
      body.appendChild(h('<p class="hint">Leave empty to play by room code: the player who creates the room hosts it and the partner connects directly — no server needed. Only enter an address if you run your own room server (for example wss://your-game.example.com); both players must then use the same one.</p>'));
    }
  }

  // ---------------------------------------------------------------- credits
  private buildCredits(): void {
    const el = this.add('credits', h(`<div class="center"><div class="panel">
      <h2>Credits <button class="btn small back" data-a="back">Back</button></h2>
      <div class="credits-list" data-list>Loading…</div>
    </div></div>`));
    this.click('[data-a=back]', el, () => this.show('main'));
    const obs = new MutationObserver(async () => {
      if (!el.classList.contains('show')) return;
      const list = el.querySelector('[data-list]') as HTMLElement;
      let credits: Array<{ kind: string; title: string; author: string; link: string; license: string; licenseUrl: string; via: string }> = [];
      try { credits = await loadJSON('credits.json'); } catch { /* ignore */ }
      const sec = (title: string, items: string) => `<h3>${title}</h3>${items}`;
      const fmt = (c: typeof credits[number]) => `<div class="c"><b>${escapeHtml(c.title)}</b> — ${escapeHtml(c.author)} · <a href="${encodeURI(c.link)}" target="_blank" rel="noopener">source</a> · <a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a></div>`;
      list.innerHTML =
        `<p>Redmoor: Break Out — an original two-player co-op story. All characters and events are fictional.</p>` +
        sec('Characters & animation', `<div class="c"><b>Microsoft Rocketbox Avatar Library</b> — 115 rigged avatars and 417 animations by Microsoft / Rocketbox · <a href="https://github.com/microsoft/Microsoft-Rocketbox" target="_blank" rel="noopener">source</a> · MIT</div>`) +
        sec('3D models', credits.filter((c) => c.kind === 'model').map(fmt).join('')) +
        sec('Textures & environments', credits.filter((c) => c.kind === 'texture' || c.kind === 'hdri').map(fmt).join('')) +
        sec('Sound & music', credits.filter((c) => c.kind === 'audio').map(fmt).join('')) +
        sec('Software', `<div class="c">three.js (MIT) · postprocessing (Zlib) · ws (MIT) · glTF-Transform (MIT) · meshoptimizer (MIT) · EZ-Tree (MIT) · Vite (MIT)</div>`);
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------------------------------------------------------------- loading
  private buildLoading(): void {
    this.add('loading', h(`<div class="loading">
      <div class="ch" data-ch>Chapter 1</div><div class="nm" data-nm>Prison Life</div>
      <div class="tip" data-tip></div>
      <div class="bar"><i data-bar></i></div>
      <div class="st" data-st>Loading</div>
    </div>`));
  }

  setLoading(ch: number, name: string, progress: number, status: string): void {
    const el = this.screens.get('loading')!;
    (el.querySelector('[data-ch]') as HTMLElement).textContent = `Chapter ${ch}`;
    (el.querySelector('[data-nm]') as HTMLElement).textContent = name;
    (el.querySelector('[data-bar]') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    (el.querySelector('[data-st]') as HTMLElement).textContent = status;
    const tip = el.querySelector('[data-tip]') as HTMLElement;
    if (!tip.textContent) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  resetLoadingTip(): void {
    const tip = this.screens.get('loading')!.querySelector('[data-tip]') as HTMLElement;
    tip.textContent = '';
  }

  // ---------------------------------------------------------------- pause
  private buildPause(): void {
    const el = this.add('pause', h(`<div class="center"><div class="panel" style="width:min(28.75rem,92vw)">
      <h2>Paused</h2>
      <p class="hint" data-info></p>
      <div class="menu-list" style="margin-top:0.375rem">
        <button class="mbtn" data-a="resume">Resume</button>
        <button class="mbtn" data-a="settings">Settings</button>
        <button class="mbtn" data-a="quit">Leave game</button>
      </div>
      <p class="hint">The world keeps moving while you are paused — this is an online game.</p>
    </div></div>`));
    this.click('[data-a=resume]', el, () => this.cb.onResume());
    this.click('[data-a=settings]', el, () => this.openSettings('pause'));
    this.click('[data-a=quit]', el, () => { if (confirm('Leave the game? Your partner will be returned to the lobby. Progress is saved at the last checkpoint.')) this.cb.onQuitGame(); });
  }

  setPauseInfo(text: string): void {
    (this.screens.get('pause')!.querySelector('[data-info]') as HTMLElement).textContent = text;
  }

  // ---------------------------------------------------------------- chapter end
  private buildEnd(): void {
    const el = this.add('end', h(`<div class="center"><div class="panel" style="width:min(35rem,92vw);text-align:center">
      <div class="ch" style="font-family:var(--font);letter-spacing:.4em;color:var(--accent);font-size:0.8125rem" data-ch>CHAPTER 1 COMPLETE</div>
      <h2 style="justify-content:center;font-size:2.125rem;margin:0.625rem 0" data-nm>Prison Life</h2>
      <p data-txt></p>
      <div class="row" style="justify-content:center;margin-top:0.625rem">
        <button class="btn primary" data-a="next">Continue</button>
        <button class="btn" data-a="menu">Main menu</button>
      </div>
      <p class="hint" data-wait></p>
    </div></div>`));
    this.click('[data-a=next]', el, () => this.cb.onNextChapter());
    this.click('[data-a=menu]', el, () => this.cb.onQuitGame());
  }

  showEnd(ch: number, name: string, text: string, isHost: boolean, hasNext: boolean): void {
    const el = this.screens.get('end')!;
    (el.querySelector('[data-ch]') as HTMLElement).textContent = `CHAPTER ${ch} COMPLETE`;
    (el.querySelector('[data-nm]') as HTMLElement).textContent = name;
    (el.querySelector('[data-txt]') as HTMLElement).textContent = text;
    const next = el.querySelector('[data-a=next]') as HTMLButtonElement;
    next.style.display = hasNext && isHost ? '' : 'none';
    (el.querySelector('[data-wait]') as HTMLElement).textContent = hasNext ? (isHost ? '' : 'Waiting for the host to continue…') : 'Thank you for playing.';
    this.show('end');
  }

  // ---------------------------------------------------------------- message box
  private buildMessage(): void {
    const el = this.add('message', h(`<div class="center"><div class="panel" style="width:min(30rem,92vw)">
      <h2 data-t>Notice</h2><p data-m></p>
      <div class="row"><button class="btn primary" data-a="ok">OK</button></div>
    </div></div>`));
    this.click('[data-a=ok]', el, () => { const fn = this.msgDone; this.msgDone = null; fn?.(); });
  }

  private msgDone: Handler | null = null;
  message(title: string, msg: string, done?: Handler): void {
    const el = this.screens.get('message')!;
    (el.querySelector('[data-t]') as HTMLElement).textContent = title;
    (el.querySelector('[data-m]') as HTMLElement).textContent = msg;
    this.msgDone = done ?? (() => this.show('main'));
    this.show('message');
  }
}
