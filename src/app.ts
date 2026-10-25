// Application shell: boot, menus, lobby, loading, the running game and chapter transitions.
import { PadNav } from './ui/padnav';
import { initUiScale, setUserUiScale } from './ui/scale';
import type { CharacterId, GameMsg, Progress, RoomState } from '../shared/protocol';
import { Renderer } from './engine/renderer';
import { Input } from './engine/input';
import { AudioManager } from './engine/audio';
import { MaterialLib } from './engine/materials';
import { CharacterLibrary } from './engine/characters';
import { releaseAssetCaches, onLoadProgress } from './engine/assets';
import type { QualityLevel } from './engine/quality';
import { NetClient, defaultServerUrl } from './net/client';
import { Hud } from './ui/hud';
import { HudLayout } from './ui/hudlayout';
import { TouchControls } from './ui/touch';
import { Menus } from './ui/menus';
import { MenuScene } from './ui/menuScene';
import { Game } from './game/game';
import { clearSave, loadSave, loadSettings, saveSettings, type SaveData, type Settings } from './game/settings';
import { CHAPTER_TITLES } from './levels';
import { updateIfNewer } from './ui/version';

type AppState = 'boot' | 'menu' | 'lobby' | 'loading' | 'game' | 'end';

const CHAPTER_END_TEXT: Record<number, string> = {
  1: 'A screwdriver, a vent and a name: Victor Crane. Tonight, Redmoor loses two inmates.',
  2: 'Over the wall and into the dark. Every siren in the county is coming.',
  3: 'Old wounds, a long road and a secret that won\'t stay buried.',
  4: 'Crane\'s house burns behind them. The police are already on the road.',
  5: 'The chase is over. The truth is not.',
  6: 'Only one of them walks away.',
};

export class App {
  readonly container: HTMLElement;
  settings: Settings;
  save: SaveData;
  renderer!: Renderer;
  input!: Input;
  audio!: AudioManager;
  hud!: Hud;
  touch!: TouchControls;
  menus!: Menus;
  net!: NetClient;
  game: Game | null = null;
  menuScene: MenuScene | null = null;
  private menuMats = new MaterialLib();
  private menuChars = new CharacterLibrary();
  state: AppState = 'boot';
  private last = performance.now();
  private pauseBtn!: HTMLButtonElement;
  private editBar!: HTMLElement;
  private hudLayout!: HudLayout;
  private paused = false;
  private pendingNext: number | null = null;
  private startingGame = false;
  private soloDev = false;
  /** Test harness option (?render=N): draw only every Nth frame so logic runs at full speed under software GL. */
  private renderEvery = (() => { const v = new URLSearchParams(location.search).get('render'); return v === null ? 1 : Math.max(0, Number(v) || 0); })();
  private frameNo = 0;
  /** Test/debug hook. */
  readonly debug: Record<string, unknown> = {};

  constructor(container: HTMLElement) {
    this.container = container;
    this.settings = loadSettings();
    this.save = loadSave();
  }

  // ------------------------------------------------------------------ boot
  async boot(): Promise<void> {
    // Load a newer deploy if this copy of the page is old (only from the boot screen or main menu).
    const canUpdate = () => this.state === 'boot' || (this.state === 'menu' && this.menus?.current === 'main');
    void updateIfNewer(canUpdate);
    setInterval(() => void updateIfNewer(canUpdate), 10 * 60 * 1000);
    setUserUiScale(this.settings.uiScale);
    initUiScale();
    const bar = document.getElementById('boot-bar');
    const msg = document.getElementById('boot-msg');
    const step = (p: number, m: string) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; if (msg) msg.textContent = m; };
    step(0.05, 'Starting renderer');
    const q = this.settings.quality === 'auto' ? undefined : (this.settings.quality as QualityLevel);
    this.renderer = new Renderer(this.container, q);
    this.renderer.onContextLost = () => this.menus?.message('Graphics reset', 'The graphics driver was reset. Lower the quality preset in Settings if this keeps happening.', () => location.reload());
    this.input = new Input();
    this.input.attachCanvas(this.renderer.canvas);
    this.audio = new AudioManager();
    this.hud = new Hud(this.container);
    this.hud.setVisible(false);
    this.hudLayout = new HudLayout(this.hud);
    this.touch = new TouchControls(this.container, this.input);
    this.touch.setMode('hidden');
    this.buildPauseButton();
    this.buildEditBar();
    this.net = new NetClient(this.settings.serverUrl ? undefined : defaultServerUrl());
    if (this.settings.serverUrl) this.net.setServerUrl(this.settings.serverUrl);
    this.menus = new Menus(this.container, this.settings, {
      onContinue: () => this.create(0),
      onCreate: (ch) => this.create(ch),
      onJoin: (code) => this.join(code),
      onLeaveLobby: () => this.leaveRoom(),
      onSelectChar: (c) => { this.settings.preferredCharacter = c; saveSettings(this.settings); this.net.select(c); },
      onReady: (r) => this.net.ready(r),
      onStart: () => this.net.start(),
      onResume: () => this.setPaused(false),
      onQuitGame: () => this.quitGame(),
      onSettingsChanged: (s) => this.applySettings(s),
      onEditLayout: () => this.editLayout(true),
      onNextChapter: () => this.hostNextChapter(),
      onResetSave: () => { clearSave(); this.save = loadSave(); this.refreshSaveInfo(); },
    });
    this.applySettings(this.settings);
    this.bindNet();
    this.bindGlobal();
    step(0.15, 'Loading sounds');
    await this.audio.init();
    step(0.25, 'Building scene');
    const off = onLoadProgress((l, t) => step(0.25 + 0.7 * (l / Math.max(1, t)), 'Loading assets'));
    try {
      this.menuScene = new MenuScene(this.menuMats, this.menuChars, this.audio, this.renderer.q);
      await this.menuScene.build();
      this.renderer.setView(this.menuScene.world.scene, this.menuScene.camera);
      this.menuScene.resize(window.innerWidth, window.innerHeight);
    } catch (e) {
      console.error('menu scene failed', e);
      this.menuScene = null;
    }
    off();
    step(1, 'Ready');
    this.refreshSaveInfo();
    this.state = 'menu';
    document.getElementById('boot')?.classList.add('hide');
    this.menus.show('main');
    this.loop();
    // Deep link from an invite, or a session to resume after a reload.
    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (params.get('dev') === 'solo') {
      // Developer-only: load a chapter without a partner to debug levels and cutscenes.
      this.soloDev = true;
      void this.loadChapter(Number(params.get('ch') ?? 1), params.get('cp') ?? '', {}, (params.get('as') as CharacterId) ?? 'elias');
    } else if (this.net.resumable) {
      this.menus.message('Reconnecting', 'Rejoining your game…', () => { this.net.leave(); this.menus.show('main'); });
      this.net.resume().catch(() => this.menus.message('Server unreachable', 'Could not reconnect to the game server.'));
    } else if (join) {
      this.menus.prefillJoin(join);
      this.menus.show('join');
      this.net.connect().catch(() => { /* status shown */ });
    } else {
      this.net.connect().catch(() => { /* status shown */ });
    }
    (window as unknown as { __app: App }).__app = this;
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  private refreshSaveInfo(): void {
    const p = this.save.progress;
    this.menus.hasSave = !!p;
    this.menus.unlocked = this.save.unlocked;
    this.menus.saveLabel = p ? `Chapter ${p.chapter} — ${CHAPTER_TITLES[p.chapter] ?? ''}${p.checkpoint ? ' · checkpoint' : ''} · ${formatTime(p.playTime)}` : '';
    if (this.menus.current === 'main') this.menus.refreshMain();
  }

  private buildPauseButton(): void {
    const b = document.createElement('button');
    b.className = 'pause-btn';
    b.innerHTML = '&#10074;&#10074;';
    b.setAttribute('aria-label', 'Pause');
    b.addEventListener('click', (e) => { e.stopPropagation(); this.setPaused(true); });
    this.container.appendChild(b);
    this.pauseBtn = b;
  }

  private buildEditBar(): void {
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.innerHTML = `<span data-tip>Drag anything to move it · tap it, then Size</span>
      <button class="btn small" data-mode>Bike buttons</button>
      <label style="display:flex;gap:0.375rem;align-items:center">Size <input type="range" min="44" max="180" step="2" value="72" data-size></label>
      <button class="btn small" data-reset>Reset all</button><button class="btn small primary" data-done>Done</button>`;
    const size = bar.querySelector('[data-size]') as HTMLInputElement;
    // The slider means pixels for touch controls and a percentage for HUD items.
    let target: 'touch' | 'hud' = 'touch';
    size.addEventListener('input', () => {
      if (target === 'hud') this.hudLayout.resizeSelected(Number(size.value) / 100);
      else this.touch.resizeSelected(Number(size.value));
    });
    this.touch.onSelect = (n) => { target = 'touch'; this.hudLayout.selected = null; size.min = n === 'stick' ? '96' : '44'; size.max = n === 'stick' ? '200' : '140'; size.value = String(this.touch.layout[n]?.size ?? 72); };
    this.hudLayout.onSelect = (id) => { target = 'hud'; this.touch.selected = null; size.min = '50'; size.max = '180'; size.value = String(Math.round(this.hudLayout.scaleOf(id) * 100)); };
    bar.querySelector('[data-reset]')!.addEventListener('click', () => { this.touch.resetLayout(); this.hudLayout.reset(); });
    const modeBtn = bar.querySelector('[data-mode]') as HTMLButtonElement;
    modeBtn.addEventListener('click', () => {
      const bike = this.touch.mode !== 'bike';
      this.touch.setMode(bike ? 'bike' : 'foot');
      modeBtn.textContent = bike ? 'Walking buttons' : 'Bike buttons';
    });
    bar.querySelector('[data-done]')!.addEventListener('click', () => this.editLayout(false));
    this.container.appendChild(bar);
    this.editBar = bar;
  }

  private editLayout(on: boolean): void {
    const wasEnabled = this.touch.enabled;
    if (on) {
      this.touch.enabled = true;
      this.touch.setMode('foot');
      this.touch.setFlags({ jump: true, combat: true, crouch: true, sprint: true });
      this.touch.setEditing(true);
      (this.editBar.querySelector('[data-mode]') as HTMLElement).textContent = 'Bike buttons';
      this.editBar.dataset.hudWasVisible = this.hud.root.style.display === 'none' ? 'false' : 'true';
      this.hud.root.style.display = '';
      this.hudLayout.setEditing(true);
      this.editBar.classList.add('show');
      this.menus.show(null);
      this.editBar.dataset.wasEnabled = String(wasEnabled);
    } else {
      this.touch.setEditing(false);
      this.hudLayout.setEditing(false);
      if (this.editBar.dataset.hudWasVisible === 'false') this.hud.root.style.display = 'none';
      this.editBar.classList.remove('show');
      this.touch.enabled = this.editBar.dataset.wasEnabled === 'true';
      this.touch.setMode(this.state === 'game' && !this.paused ? 'foot' : 'hidden');
      this.menus.openSettings(this.state === 'game' ? 'pause' : 'main');
    }
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    setUserUiScale(s.uiScale);
    if (this.renderer) {
      this.renderer.autoLevel = s.quality === 'auto';
      const want = s.quality === 'auto' ? this.renderer.autoTier() : s.quality;
      if (want !== this.renderer.q.level) this.renderer.setQuality(want);
    }
    if (this.input) this.input.sens = { touch: s.sens.touch, mouse: s.sens.mouse, gamepad: s.sens.gamepad, invertY: s.invertY };
    if (this.audio) {
      this.audio.setVolume('master', s.volumes.master);
      this.audio.setVolume('music', s.volumes.music);
      this.audio.setVolume('sfx', s.volumes.sfx);
      this.audio.setVolume('dialogue', s.volumes.dialogue);
      this.audio.setVolume('ambience', s.volumes.ambience);
    }
    if (this.touch) {
      this.touch.scale = s.touchScale;
      this.touch.opacity = s.touchOpacity;
      this.touch.applyLayout();
    }
    document.body.classList.remove('sub-small', 'sub-medium', 'sub-large');
    document.body.classList.add('sub-' + s.subtitleSize);
    if (this.game) {
      this.game.dialogue.tts = s.tts;
      if (!s.subtitles) this.hud.setSubtitle(null, '');
    }
    if (this.net) {
      const url = s.serverUrl ? s.serverUrl : '';
      const cur = this.net.serverUrl;
      const target = url ? url : defaultServerUrl();
      if (!this.net.room && url !== (this.lastServerSetting ?? '') && cur !== target) {
        this.net.setServerUrl(url);
        this.net.connect().catch(() => { /* shown */ });
      }
      this.lastServerSetting = url;
    }
  }
  private lastServerSetting: string | null = null;

  private padNav = new PadNav();

  private bindGlobal(): void {
    // Menus own the gamepad/arrow keys whenever a screen is open or the game is paused.
    this.padNav.suspended = () => this.state === 'game' && !this.paused && !this.menus.current;
    // Losing the mouse capture during play (Esc, alt-tab) opens the pause menu, like most PC games.
    this.input.onPointerLock = (locked) => {
      if (!locked && this.state === 'game' && !this.paused && this.game && !this.game.inCutscene && this.input.device === 'keyboard') this.setPaused(true);
    };
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('resize', () => this.menuScene?.resize(window.innerWidth, window.innerHeight));
    document.getElementById('rotate-skip')?.addEventListener('click', () => document.body.classList.add('rotate-ok'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.touch.release(); this.input.reset(); }
    });
    // Keep the screen awake during play where supported.
    this.input.onDeviceChange = (d) => {
      this.touch.enabled = d === 'touch' || new URLSearchParams(location.search).has('touch');
      this.touch.applyLayout();
      this.pauseBtn.classList.toggle('show', this.state === 'game' && !this.paused);
    };
  }

  private wakeLock: { release: () => Promise<void> } | null = null;
  private async keepAwake(on: boolean): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    try {
      if (on && nav.wakeLock && !this.wakeLock) this.wakeLock = await nav.wakeLock.request('screen');
      if (!on && this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; }
    } catch { /* not allowed */ }
  }

  // ------------------------------------------------------------------ networking / lobby
  private bindNet(): void {
    const n = this.net;
    n.on('status', (s) => {
      this.menus.setNet(s);
      if (s === 'failed' && (this.menus.current === 'create' || this.menus.current === 'join')) {
        const m = 'Could not reach the game server. Check your connection or the server address in Settings → Network.';
        this.menus.setCreateError(m);
        this.menus.setJoinError(m);
      }
    });
    n.on('joined', (room, you) => {
      this.menus.setRoom(room, you);
      if (room.phase === 'playing' && this.state !== 'game' && this.state !== 'loading') {
        // Resumed into a running game (e.g. after a page reload).
        void this.startGame(room);
        return;
      }
      if (this.state === 'menu' || this.state === 'end') {
        this.state = 'lobby';
        this.menus.show('lobby');
        // Ask for the preferred character if it is free.
        const me = room.players.find((p) => p.id === you);
        const pref = this.settings.preferredCharacter;
        if (me && me.character !== pref && !room.players.some((p) => p.id !== you && p.character === pref)) n.select(pref);
      }
    });
    n.on('room', (room) => {
      this.menus.setRoom(room, n.you);
      // Host returned the room to the lobby while we were on the end screen.
      if (room.phase === 'lobby' && this.state === 'end') { this.state = 'lobby'; this.menus.show('lobby'); }
    });
    n.on('start', (room, at) => {
      const wait = Math.max(0, at - n.serverNow());
      setTimeout(() => void this.startGame(room), Math.min(wait, 2000));
    });
    n.on('error', (code, message) => {
      if (code === 'SESSION_EXPIRED') {
        if (this.state === 'game') return;
        this.menus.message('Session ended', 'That game is no longer available.', () => this.menus.show('main'));
        return;
      }
      if (this.menus.current === 'join') this.menus.setJoinError(message);
      else if (this.menus.current === 'create') this.menus.setCreateError(message);
      else if (this.state === 'lobby') this.hud.notify(message);
      else console.warn('server error', code, message);
    });
    n.on('relay', (_from, d: GameMsg) => {
      if (d.k !== 'app') return;
      if (d.cmd === 'next' && d.chapter) void this.loadChapter(d.chapter, '', {});
      if (d.cmd === 'menu') this.toLobby();
    });
    n.on('peer', (ev) => {
      if (ev === 'left' && (this.state === 'lobby' || this.state === 'end')) {
        this.hud.notify('Your partner left.');
        if (this.state === 'end') { this.state = 'lobby'; this.menus.show('lobby'); }
      }
    });
  }

  private async create(chapter: number): Promise<void> {
    const name = this.settings.name || 'Player';
    let progress: Progress | null = null;
    if (chapter === 0 && this.save.progress) progress = this.save.progress;
    else if (chapter > 0) progress = { chapter, checkpoint: '', flags: {}, savedAt: Date.now(), playTime: 0 };
    if (!this.settings.name) { this.menus.show('create'); return; }
    this.menus.setCreateError('');
    try {
      await this.net.createRoom(name, progress);
    } catch {
      this.menus.show('create');
      this.menus.setCreateError(this.net.mode === 'p2p'
        ? 'Could not open a room. Check your internet connection and try again.'
        : 'Could not reach the game server. Check your connection or the server address in Settings → Network.');
    }
  }

  private async join(code: string): Promise<void> {
    try {
      await this.net.joinRoom(code, this.settings.name || 'Player');
    } catch {
      this.menus.setJoinError(this.net.mode === 'p2p'
        ? 'Could not reach your friend\'s game. Check the code and your internet connection.'
        : 'Could not reach the game server. Check your connection or the server address in Settings → Network.');
    }
  }

  private leaveRoom(): void {
    this.net.leave();
    this.state = 'menu';
    this.menus.setRoom(null, null);
    this.menus.show('main');
  }

  // ------------------------------------------------------------------ game
  private async startGame(room: RoomState): Promise<void> {
    if (this.startingGame || this.state === 'game') return;
    const me = room.players.find((p) => p.id === this.net.you);
    if (!me?.character) return;
    const prog = room.progress;
    await this.loadChapter(prog?.chapter ?? 1, prog?.checkpoint ?? '', prog?.flags ?? {}, me.character);
  }

  private async loadChapter(chapter: number, checkpoint: string, flags: Record<string, boolean | number | string>, char?: CharacterId): Promise<void> {
    if (this.startingGame) return;
    this.startingGame = true;
    const character = char ?? this.game?.localChar ?? this.net.me?.character ?? 'elias';
    this.disposeGame();
    this.state = 'loading';
    this.menus.resetLoadingTip();
    const title = CHAPTER_TITLES[chapter] ?? '';
    this.menus.setLoading(chapter, title, 0, 'Loading');
    this.menus.show('loading');
    this.audio.stopMusic(1);
    // Free the menu scene while playing (memory on phones).
    if (this.menuScene) { this.menuScene.dispose(); this.menuScene = null; }
    const off = onLoadProgress((l, t) => this.menus.setLoading(chapter, title, Math.min(0.95, l / Math.max(1, t)), 'Loading assets'));
    const game = new Game({
      renderer: this.renderer, input: this.input, audio: this.audio, hud: this.hud, touch: this.touch,
      settings: this.settings, net: this.soloDev ? null : this.net,
      onExit: (reason, detail) => this.onGameExit(reason, detail),
      onChapterComplete: (next) => this.onChapterComplete(chapter, next),
    }, character);
    this.game = game;
    this.debug.game = game;
    game.onLoadStatus = (st) => this.menus.setLoading(chapter, title, 0.97, st);
    try {
      await game.load(chapter, checkpoint || null, Object.keys(flags).length ? flags : undefined);
    } catch (e) {
      console.error(e);
      off();
      this.startingGame = false;
      this.disposeGame();
      this.menus.message('Could not load the chapter', String((e as Error)?.message ?? e), () => this.toLobby());
      return;
    }
    off();
    this.startingGame = false;
    if (this.game !== game) return;
    this.menus.setLoading(chapter, title, 1, 'Waiting for your partner…');
    // Stay on the loading screen until both players are in.
    const waitBegin = () => {
      if (this.game !== game) return;
      if (game.begun) {
        this.state = 'game';
        this.menus.show(null);
        this.hud.setVisible(true);
        this.touch.setMode('foot');
        this.pauseBtn.classList.add('show');
        void this.keepAwake(true);
        return;
      }
      requestAnimationFrame(waitBegin);
    };
    waitBegin();
  }

  private disposeGame(): void {
    if (!this.game) return;
    try { this.game.dispose(); } catch (e) { console.error('dispose failed', e); }
    this.game = null;
    this.debug.game = null;
    // Drop cached models/textures of the finished chapter (the next one loads what it needs).
    void releaseAssetCaches();
    this.hud.setVisible(false);
    this.touch.setMode('hidden');
    this.pauseBtn.classList.remove('show');
    this.input.releasePointer();
    void this.keepAwake(false);
  }

  private onChapterComplete(chapter: number, next: number | null): void {
    this.save = loadSave();
    this.refreshSaveInfo();
    this.state = 'end';
    this.pendingNext = next;
    this.hud.setVisible(false);
    this.touch.setMode('hidden');
    this.pauseBtn.classList.remove('show');
    this.input.releasePointer();
    this.menus.showEnd(chapter, CHAPTER_TITLES[chapter] ?? '', CHAPTER_END_TEXT[chapter] ?? '', this.net.isHost, !!next);
  }

  private hostNextChapter(): void {
    const next = this.pendingNext;
    if (!next) return;
    this.net.relay({ k: 'app', cmd: 'next', chapter: next });
    void this.loadChapter(next, '', {});
  }

  private onGameExit(reason: 'quit' | 'partnerLeft' | 'error' | 'finished', detail?: string): void {
    if (reason === 'partnerLeft') {
      this.disposeGame();
      this.menus.message('Partner left', 'Your partner left the game. Progress is saved at the last checkpoint — invite them again from the lobby.', () => this.toLobby());
      return;
    }
    if (reason === 'error') {
      this.disposeGame();
      this.menus.message('Something went wrong', detail ?? 'The game hit an error.', () => this.toLobby());
      return;
    }
    this.quitGame();
  }

  /** Back to the lobby of the current room (or the main menu if not in a room). */
  private toLobby(): void {
    this.disposeGame();
    this.setPaused(false, true);
    this.ensureMenuScene();
    if (this.net.room) {
      if (this.net.isHost && this.net.room.phase === 'playing') this.net.backToLobby();
      this.state = 'lobby';
      this.menus.show('lobby');
    } else {
      this.state = 'menu';
      this.menus.show('main');
    }
  }

  private quitGame(): void {
    this.disposeGame();
    this.setPaused(false, true);
    this.net.leave();
    this.menus.setRoom(null, null);
    this.state = 'menu';
    this.save = loadSave();
    this.refreshSaveInfo();
    this.ensureMenuScene();
    this.menus.show('main');
  }

  private ensureMenuScene(): void {
    if (this.menuScene) return;
    const ms = new MenuScene(this.menuMats, this.menuChars, this.audio, this.renderer.q);
    ms.build().then(() => {
      if (this.game) { ms.dispose(); return; }
      this.menuScene = ms;
      this.renderer.setView(ms.world.scene, ms.camera);
      ms.resize(window.innerWidth, window.innerHeight);
    }).catch((e) => console.warn('menu scene', e));
  }

  private setPaused(on: boolean, silent = false): void {
    this.paused = on;
    this.input.enabled = !on;
    if (on) {
      this.touch.release();
      this.touch.setMode('hidden');
      this.input.releasePointer();
      this.pauseBtn.classList.remove('show');
      const peer = this.net.peer;
      this.menus.setPauseInfo(`Room ${this.net.room?.code ?? ''} · Partner: ${peer ? `${peer.name}${peer.connected ? '' : ' (disconnected)'}` : '—'}`);
      this.menus.show('pause');
    } else if (!silent) {
      this.menus.show(null);
      if (this.state === 'game') {
        this.touch.setMode(this.game?.local.state === 'bike' ? 'bike' : 'foot');
        this.pauseBtn.classList.add('show');
        if (this.input.device === 'keyboard') this.input.lockPointer();
      }
    }
  }

  // ------------------------------------------------------------------ loop
  /** Test option (?fps=N): run the game at a low frame rate to reproduce slow-device behaviour. */
  private simFps = Number(new URLSearchParams(location.search).get('fps')) || 0;

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.simFps > 0 && now - this.last < 1000 / this.simFps) return;
    const dt = Math.min(0.1, Math.max(0.0005, (now - this.last) / 1000));
    this.last = now;
    this.debug.frames = ((this.debug.frames as number) ?? 0) + 1;
    try {
      this.padNav.update();
      if (this.game && this.game.state !== 'loading') {
        if (this.state === 'game' && !this.paused && this.input.buttons.pause.pressed && !this.game.inCutscene) this.setPaused(true);
        else if (this.paused && this.input.buttons.pause.pressed) this.setPaused(false);
        this.game.update(dt);
        if (this.renderEvery > 0 && ++this.frameNo % this.renderEvery === 0) this.renderer.render(dt);
      } else if (this.menuScene) {
        this.menuScene.update(dt);
        this.renderer.render(dt);
      }
    } catch (e) {
      console.error(e);
      this.debug.lastError = String((e as Error)?.stack ?? e);
    }
  };
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
