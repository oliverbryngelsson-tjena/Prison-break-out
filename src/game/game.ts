// The running game: owns the world, both player characters, NPCs, story events and the frame loop.
import { Extras } from './extras';
import { BARKS, BARK_DUR } from './voices';
import { VoiceBank } from './voicebank';
import { Capture } from './capture';
import { prefetchChapter, stopPrefetch } from './prefetch';
import { Guns, PLAYER_SHOT_DMG, SHOT_RANGE, type ShotEvent } from './guns';
import { DEFAULT_LOADOUT, hitChance, SHOP, WEAPONS, type WeaponId } from './weapons';
import { MiniGames } from './minigames';
import * as THREE from 'three';
import type { CharacterId, NpcSnap, PlayerSnap, Progress } from '../../shared/protocol';
import type { Renderer } from '../engine/renderer';
import type { Input } from '../engine/input';
import type { AudioManager } from '../engine/audio';
import { CameraRig } from '../engine/camera';
import { MaterialLib } from '../engine/materials';
import { CharacterLibrary } from '../engine/characters';
import { loadTexture } from '../engine/assets';
import type { NetClient } from '../net/client';
import type { Hud } from '../ui/hud';
import type { TouchControls } from '../ui/touch';
import { World } from './world';
import { Session, type SessionHandlers } from './session';
import { Body } from './body';
import { PlayerController, RemoteAvatar, type Combatant, type PlayerCtx } from './player';
import { InteractionSystem, type InteractDef } from './interact';
import { DialogueRunner, type Line, type SpeakerInfo } from './dialogue';
import { CutsceneRunner, type CutsceneHost } from './cutscene';
import { Npc, type NpcHooks, type Perceivable } from './npc';
import type { NavGraph } from './nav';
import type { Settings } from './settings';
import { writeSave } from './settings';
import { createChapter } from '../levels';
import type { Chapter } from '../levels/chapter';

export interface GameDeps {
  renderer: Renderer;
  input: Input;
  audio: AudioManager;
  hud: Hud;
  touch: TouchControls;
  settings: Settings;
  net: NetClient | null;
  onExit: (reason: 'quit' | 'partnerLeft' | 'error' | 'finished', detail?: string) => void;
  onChapterComplete: (next: number | null) => void;
}

const v3a = (p: THREE.Vector3): [number, number, number] => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];

export const SPEAKERS: Record<string, Omit<SpeakerInfo, 'body'>> = {
  elias: { name: 'Elias', color: '#e8c27a', voice: { pitch: 0.82, rate: 0.95, prefer: /daniel|george|male|david|arthur|guy/i } },
  jax: { name: 'Jax', color: '#7fc8ff', voice: { pitch: 1.05, rate: 1.08, prefer: /alex|fred|aaron|male|mark|tom/i } },
  crane: { name: 'Victor Crane', color: '#d46a5a', voice: { pitch: 0.7, rate: 0.9, prefer: /male|daniel|google uk english male/i } },
  marsh: { name: 'Det. Lena Marsh', color: '#c9a3e8', voice: { pitch: 1.0, rate: 1.0, prefer: /female|samantha|karen|victoria|zira/i } },
  mo: { name: 'Old Mo', color: '#b9d68a', voice: { pitch: 0.65, rate: 0.85, prefer: /male/i } },
  guard: { name: 'Guard', color: '#a8b0b8', voice: { pitch: 0.9, rate: 1.0, prefer: /male/i } },
  inmate: { name: 'Inmate', color: '#d8a070', voice: { pitch: 0.95, rate: 1.05, prefer: /male/i } },
  cop: { name: 'Officer', color: '#8fb0ff', voice: { pitch: 0.9, rate: 1.05, prefer: /male/i } },
  radio: { name: 'Radio', color: '#9fe0a0', voice: { pitch: 1.0, rate: 1.1, prefer: /male/i } },
  thug: { name: 'Crane\'s man', color: '#e09090', voice: { pitch: 0.85, rate: 1.0, prefer: /male/i } },
  ray: { name: 'Ray', color: '#f2b36b', voice: { pitch: 1.1, rate: 1.1, prefer: /male/i } },
  dutch: { name: 'Dutch', color: '#b8c48a', voice: { pitch: 0.8, rate: 0.92, prefer: /male/i } },
  julius: { name: 'Julius Crane', color: '#d9a35a', voice: { pitch: 1.0, rate: 1.1, prefer: /male/i } },
  mia: { name: 'Mia', color: '#f0a0c8', voice: { pitch: 1.2, rate: 1.0, prefer: /female|samantha|karen/i } },
  narrator: { name: '', color: '#ddd' },
};

type GameState = 'loading' | 'waiting' | 'playing' | 'failed' | 'paused' | 'ended';

const surfaceSound: Record<string, string> = {
  concrete: 'step_concrete', tile: 'step_concrete', asphalt: 'step_concrete', metal: 'step_metal', wood: 'step_wood',
  grass: 'step_grass', dirt: 'step_grass', leaves: 'step_grass', gravel: 'step_gravel', mud: 'step_mud', water: 'step_wet', carpet: 'step_carpet',
};

export class Game implements SessionHandlers, CutsceneHost {
  world!: World;
  readonly cam: CameraRig;
  session: Session;
  local!: PlayerController;
  remote!: RemoteAvatar;
  chapter!: Chapter;
  readonly npcs = new Map<string, Npc>();
  nav: NavGraph | null = null;
  readonly interact = new InteractionSystem();
  readonly dialogue = new DialogueRunner();
  readonly cutscenes: CutsceneRunner;
  readonly mats = new MaterialLib();
  readonly chars = new CharacterLibrary();
  objective = { text: '', marker: null as THREE.Vector3 | null };
  state: GameState = 'loading';
  flags = { jump: true, sprint: true, combat: false, crouch: true };
  localChar: CharacterId;
  remoteChar: CharacterId;
  peerLoaded = false;
  begun = false;
  playTime = 0;
  private checkpointFlags: Record<string, boolean | number | string> = {};
  private coopHolds = new Map<string, Set<string>>();
  private failTimer = -1;
  private pendingCutscene: { id: string; at: number } | null = null;
  /** Milliseconds from the start of load() to each step (for tuning load times). */
  readonly loadTimes: Record<string, number> = {};
  private prefetchTimer = 0;
  private pendingDialogue: { lines: Line[]; at: number } | null = null;
  private barkCooldown = new Map<string, number>();
  inCutscene = false;
  /** Partner presence (network). */
  partnerAway = false;
  private partnerAwaySince = 0;
  private unsubs: Array<() => void> = [];
  private reviveId = '__revive';
  /** Hook for chapter-specific per-frame logic that needs the game loop (bikes etc.). */
  readonly updaters = new Set<(dt: number) => void>();
  /** Co-op mini-games (arm wrestling, hoops) that chapters can place. */
  readonly minigames: MiniGames = new MiniGames(this);
  /** Optional memories to examine (story extras). */
  readonly extras: Extras = new Extras(this);
  /** Caught: tackle, handcuffs and the fail screen. */
  readonly capture: Capture = new Capture(this);
  readonly guns: Guns = new Guns(this);
  /** A short help line a chapter wants shown at the bottom (e.g. 'wait for your partner'). */
  chapterHint: string | null = null;
  /** Loading screen status callback. */
  onLoadStatus: ((s: string) => void) | null = null;
  /** Local bike state for snapshots [lean, pitch, steer, rpm, spin] (set by BikeSystem). */
  bikeSnap: number[] | null = null;
  /** Optional camera target override (bikes). */
  camTarget: (() => { pos: THREE.Vector3; yaw: number; speed: number; mode: 'follow' | 'bike' }) | null = null;
  debug: Record<string, unknown> = {};
  readonly deps: GameDeps;

  constructor(deps: GameDeps, localChar: CharacterId) {
    this.deps = deps;
    this.localChar = localChar;
    this.remoteChar = localChar === 'elias' ? 'jax' : 'elias';
    this.cam = new CameraRig(window.innerWidth / window.innerHeight);
    this.session = new Session(deps.net, this.localChar, this.remoteChar);
    this.session.handlers = this;
    this.cutscenes = new CutsceneRunner(this);
    this.cutscenes.clock = () => this.session.sharedNow();
    this.dialogue.speakers = (id) => this.speaker(id);
    this.dialogue.onSubtitle = (sp, text, radio) => {
      if (deps.settings.subtitles) deps.hud.setSubtitle(sp, text, radio);
      deps.audio.setDucking(!!text);
    };
    this.dialogue.tts = deps.settings.tts;
    this.dialogue.bank = new VoiceBank(deps.audio);
    if (deps.net) {
      this.unsubs.push(deps.net.on('peer', (ev) => this.onPeerEvent(ev)));
      this.unsubs.push(deps.net.on('status', (s) => {
        const net = deps.net!;
        // Peer-to-peer guest: the room lives in the partner's browser, so losing it means losing the partner.
        const p2pGuest = net.mode === 'p2p' && !net.hosting;
        if (s === 'reconnecting') {
          if (p2pGuest) { if (!this.partnerAway) this.onPeerEvent('disconnected'); }
          else deps.hud.setBanner('Connection lost — reconnecting…', 'warn');
        } else if (s === 'online') {
          deps.hud.setBanner(null);
        }
      }));
      this.unsubs.push(deps.net.on('room', (r) => {
        if (!this.partnerAway || deps.net!.mode !== 'p2p') return;
        const other = r.players.find((p) => p.id !== deps.net!.you);
        if (other?.connected && deps.net!.connected) this.onPeerEvent('reconnected');
      }));
    }
  }

  get audio(): AudioManager { return this.deps.audio; }
  get hud(): Hud { return this.deps.hud; }
  get input(): Input { return this.deps.input; }
  get authority(): boolean { return this.session.authority; }

  speaker(id: string): SpeakerInfo {
    const base = SPEAKERS[id] ?? SPEAKERS[id.replace(/\d+$/, '')] ?? { name: id, color: '#ddd' };
    let body: Body | null = null;
    if (id === this.localChar) body = this.local?.body ?? null;
    else if (id === this.remoteChar) body = this.remote?.body ?? null;
    else body = this.npcs.get(id)?.body ?? null;
    const npc = this.npcs.get(id);
    const name = npc?.def.name ?? base.name;
    return { ...base, name, body, role: npc?.def.role };
  }

  bodies(): Record<CharacterId, Body> {
    return { [this.localChar]: this.local.body, [this.remoteChar]: this.remote.body } as Record<CharacterId, Body>;
  }

  body(c: CharacterId): Body {
    return c === this.localChar ? this.local.body : this.remote.body;
  }

  isLocal(c: CharacterId): boolean {
    return c === this.localChar;
  }

  // ------------------------------------------------------------------ loading
  async load(chapterNum: number, checkpoint: string | null, savedFlags?: Record<string, boolean | number | string>): Promise<void> {
    this.state = 'loading';
    stopPrefetch();
    const t0 = performance.now();
    const mark = (k: string) => { this.loadTimes[k] = Math.round(performance.now() - t0); };
    this.audio.holdLongFiles(true);
    try { await this.loadInner(chapterNum, checkpoint, savedFlags, mark); } finally { this.audio.holdLongFiles(false); }
  }

  private async loadInner(chapterNum: number, checkpoint: string | null, savedFlags: Record<string, boolean | number | string> | undefined, mark: (k: string) => void): Promise<void> {
    const r = this.deps.renderer;
    this.world = new World(this.mats, this.chars, this.audio, r.q);
    await this.world.init();
    mark('world');
    this.world.particles.setViewport(window.innerHeight);
    this.chapter = createChapter(chapterNum);
    this.chapter.attach(this);
    this.flags = { ...this.chapter.flagsDefault };
    // Character models don't depend on the level: fetch and parse them while it builds.
    const outfit0 = (() => { const c = checkpoint && this.chapter.checkpoints[checkpoint] ? checkpoint : Object.keys(this.chapter.checkpoints)[0]; return this.chapter.checkpoints[c].outfit ?? this.chapter.outfit; })();
    const early = Promise.all([this.chars.create(this.localChar, outfit0), this.chars.create(this.remoteChar, outfit0), ...this.chapter.npcDefs.map((d) => this.chars.create(d.char, d.variant))]);
    early.catch(() => { /* awaited below */ });
    await this.chapter.build();
    mark('build');
    void this.guns.preload();
    const cp = checkpoint && this.chapter.checkpoints[checkpoint] ? checkpoint : Object.keys(this.chapter.checkpoints)[0];
    const outfit = this.chapter.checkpoints[cp].outfit ?? this.chapter.outfit;
    // Player characters
    const models = await early;
    const [lm, rm] = outfit === outfit0 ? [models[0], models[1]] : await Promise.all([this.chars.create(this.localChar, outfit), this.chars.create(this.remoteChar, outfit)]);
    const lb = new Body(this.localChar, 'player', 'prisoner', lm, this.world);
    const rb = new Body(this.remoteChar, 'player', 'prisoner', rm, this.world);
    lb.onStep = rb.onStep = (b, s, loud) => this.footstep(b, s, loud);
    this.local = new PlayerController(this.localChar, lb, this.playerCtx());
    this.local.variant = outfit;
    this.remote = new RemoteAvatar(this.remoteChar, rb);
    this.remote.variant = outfit;
    this.remote.onVariant = (v) => void this.applyOutfit(this.remoteChar, v);
    // NPCs
    await Promise.all(this.chapter.npcDefs.map((d, i) => this.spawnNpc(d, models[2 + i])));
    mark('characters');
    if (savedFlags) this.chapter.flags = { ...savedFlags };
    this.applyLoadout();
    this.chapter.checkpoint = cp;
    this.placeAtCheckpoint(cp);
    this.deps.renderer.setView(this.world.scene, this.cam.camera);
    this.state = 'waiting';
    // Compile every shader now (in the background where supported) and wait for it, so the GPU
    // isn't stalling on compiles in the first seconds of play.
    this.onLoadStatus?.('Preparing shaders');
    try {
      await Promise.race([
        this.deps.renderer.compile(this.world.scene, this.cam.camera),
        new Promise((r) => setTimeout(r, 12000)),
      ]);
    } catch { /* ignore */ }
    mark('shaders');
    // Upload textures and draw once so the first visible frame is cheap.
    try { this.deps.renderer.render(0.016); } catch { /* ignore */ }
    mark('firstFrame');
    void this.dialogue.bank?.prefetchChapter(0);
    void this.dialogue.bank?.prefetchChapter(chapterNum);
    // Once you're playing, quietly download the next chapter so its loading screen is short.
    this.prefetchTimer = window.setTimeout(() => { if (chapterNum < 6) prefetchChapter(chapterNum + 1, chapterNum); }, 25000);
    this.session.loaded(chapterNum, cp);
    if (!this.session.online) this.begin(cp);
  }

  async spawnNpc(d: import('./npc').NpcDef, preloaded?: import('../engine/characters').CharacterModel): Promise<Npc> {
    const model = preloaded ?? await this.chars.create(d.char, d.variant);
    const npc = new Npc(d, model, this.world, this.npcHooks());
    npc.body.onStep = (b, s, loud) => this.footstep(b, s, loud * 0.7);
    this.npcs.set(d.id, npc);
    return npc;
  }

  removeNpc(id: string): void {
    const n = this.npcs.get(id);
    if (n) { n.dispose(); this.npcs.delete(id); this.hud.removeMarker('npc:' + id); }
  }

  private placeAtCheckpoint(cp: string): void {
    const def = this.chapter.checkpoints[cp];
    const sl = def.spawn[this.localChar], sr = def.spawn[this.remoteChar];
    this.local.teleport(new THREE.Vector3(...sl.pos), sl.yaw);
    this.remote.teleport(new THREE.Vector3(...sr.pos), sr.yaw);
    this.cam.snapBehind(sl.yaw, new THREE.Vector3(...sl.pos));
  }

  /** Both clients loaded: start at checkpoint. */
  private begin(cp: string): void {
    if (this.begun) return;
    this.begun = true;
    this.state = 'playing';
    this.checkpointFlags = { ...this.chapter.flags };
    this.chapter.checkpoint = cp;
    this.chapter.setupCheckpoint(cp);
    const def = this.chapter.checkpoints[cp];
    this.placeAtCheckpoint(cp);
    if (def.objective) this.setObjectiveLocal(def.objective, null);
    this.audio.playMusic(this.chapter.music, 3);
    this.hud.showTitle(`Chapter ${this.chapter.num}`, this.chapter.title);
    this.hud.setFade(0);
    if (this.authority && def.intro && !this.cutscenes.played.has(def.intro)) this.chapter.cutscene(def.intro);
  }

  onPeerLoaded(chapter: number, checkpoint: string): void {
    if (this.state === 'loading' || chapter !== this.chapter?.num) return;
    this.peerLoaded = true;
    if (!this.authority) return;
    if (!this.begun) {
      this.session.emit('begin', { checkpoint: this.chapter.checkpoint || checkpoint });
    } else {
      // Peer re-joined mid-game: send everything.
      this.session.sendFull();
    }
  }

  private playerCtx(): PlayerCtx {
    return {
      world: this.world,
      session: this.session,
      audio: this.audio,
      input: this.input,
      cam: this.cam,
      interact: this.interact,
      combatants: () => this.combatants(),
      onAttack: (id, dmg, dir, kind) => this.localAttack(id, dmg, dir, kind),
      onInteract: (def, phase) => this.onLocalInteract(def, phase),
      onDowned: () => this.session.request('downed', { who: this.localChar }),
      armed: () => this.guns.playersArmed && this.flags.combat,
      onShoot: (t, dir) => this.localShoot(t, dir),
      pickTarget: (list) => this.guns.pickTarget(this.local.body, list, this.cam.forward),
      canShoot: () => this.guns.reloadT <= 0,
      weapon: () => this.guns.local,
      flags: this.flags,
    };
  }

  private hooksObj: NpcHooks | null = null;

  private npcHooks(): NpcHooks {
    if (this.hooksObj) return this.hooksObj;
    return (this.hooksObj = {
      nav: null,
      players: () => this.perceivables(),
      onCaught: (npc, who) => { if (this.state === 'playing') this.session.emit('caught', { who, by: npc.id }); },
      onSpotted: (npc, who) => { this.chapter.onEvent('spotted', { npc: npc.id, who }); },
      onAttackPlayer: (npc, who, dmg, kind) => {
        const dir: [number, number] = [Math.sin(npc.body.yaw), Math.cos(npc.body.yaw)];
        if (who === this.localChar) this.local.takeHit(dmg, npc.body.yaw, kind);
        else this.session.hit(who, dmg, dir, kind);
      },
      onKO: (npc) => { this.chapter.onEvent('ko', { npc: npc.id }); },
      onShoot: (npc, who, hit, dmg) => this.npcShoot(npc, who, hit, dmg),
      bark: (npc, kind) => this.npcBark(npc, kind),
      lightAt: (p) => this.chapter.lightAt(p),
      suspicion: (who, p, npc) => this.chapter.suspicion(who, p, npc.id),
    });
  }

  /** Called by chapters after building the nav graph. */
  setNav(nav: NavGraph): void {
    this.nav = nav;
    this.npcHooks().nav = nav;
  }

  private perceivables(): Perceivable[] {
    const ignore = this.inCutscene || this.state !== 'playing';
    return [
      { char: this.localChar, body: this.local.body, ignore: ignore || this.local.state === 'downed' || this.local.state === 'cutscene', light: this.chapter.lightAt(this.local.body.pos) },
      { char: this.remoteChar, body: this.remote.body, ignore: ignore || this.remote.downed || this.partnerAway, light: this.chapter.lightAt(this.remote.body.pos) },
    ];
  }

  private combatants(): Combatant[] {
    const out: Combatant[] = [...this.npcs.values()];
    if (this.chapter.flags.pvp) {
      const rb = this.remote.body;
      out.push({ id: this.remoteChar, body: rb, hostile: true, unaware: false, stunned: false, alive: !this.remote.downed });
    }
    return out;
  }

  private localAttack(id: string, dmg: number, dir: [number, number], kind: 'punch' | 'heavy' | 'takedown'): void {
    if (id === this.remoteChar) {
      this.session.hit(id, dmg, dir, kind);
      this.audio.play(kind === 'heavy' ? 'punch_heavy' : 'punch', { pos: this.remote.body.chest(), volume: 0.8, jitter: 0.1 });
      this.cam.addShake(0.12);
      return;
    }
    this.session.request('npcHit', { id, dmg, dir, kind, by: this.localChar });
    if (kind !== 'takedown') {
      const npc = this.npcs.get(id);
      if (npc) {
        this.audio.play(kind === 'heavy' ? 'punch_heavy' : 'punch', { pos: npc.body.chest(), volume: 0.85, jitter: 0.1 });
        this.cam.addShake(kind === 'heavy' ? 0.18 : 0.1);
      }
    }
  }

  /** Authority: an NPC fires at a player (hit already decided). Shared as a 'gunshot' event. */
  npcShoot(npc: Npc, who: CharacterId, hit: boolean, dmg: number): void {
    if (this.state !== 'playing') return;
    const tb = this.body(who);
    const from = this.guns.muzzle(npc.id);
    let to = tb.chest();
    if (!hit) {
      to.add(new THREE.Vector3((Math.random() - 0.5) * 1.8, (Math.random() - 0.35) * 0.9, (Math.random() - 0.5) * 1.8));
      to = from.clone().addScaledVector(to.sub(from).normalize(), from.distanceTo(tb.pos) + 8);
    }
    const tr = this.guns.trace(from, to);
    const ok = hit && !tr.wall;
    const ev: ShotEvent = { by: npc.id, from: v3a(from), to: v3a(tr.end), wall: tr.wall };
    if (ok) { ev.who = who; ev.dmg = dmg; }
    this.session.emit('gunshot', ev);
  }

  /** Local player pulls the trigger: roll each bullet against the weapon's spread, show it now, send it. */
  private localShoot(t: Combatant | null, dir: THREE.Vector3): void {
    const gn = this.guns;
    const w = gn.local;
    if (gn.reloadT > 0) return;
    gn.ammo--;
    if (gn.ammo <= 0) {
      gn.reloadT = w.reload;
      this.audio.play('lock_open', { pos: this.local.body.chest(), volume: 0.5, rate: 1.4, delay: 0.4 });
      this.audio.play('switch', { pos: this.local.body.chest(), volume: 0.4, delay: w.reload - 0.3 });
      this.hud.notify('Reloading…', w.reload);
    }
    const from = this.local.body.chest().addScaledVector(dir, 0.55).add(new THREE.Vector3(0, 0.1, 0));
    const npc = t ? this.npcs.get(t.id) : undefined;
    const spread = w.spread + gn.bloom;
    gn.shotFired();
    const aim = npc ? npc.body.chest() : from.clone().addScaledVector(dir, w.range);
    const d = npc ? npc.body.pos.distanceTo(this.local.body.pos) : w.range;
    let dmg = 0;
    const ends: THREE.Vector3[] = [];
    let wallAny = false;
    for (let i = 0; i < w.pellets; i++) {
      // Out of range: bullets fall short of doing anything useful.
      const hit = !!npc && d <= w.range * 1.15 && Math.random() < hitChance(spread, d) * (d > w.range ? 0.4 : 1);
      let to: THREE.Vector3;
      if (hit) to = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.25));
      else {
        // A miss: somewhere in the cone around the aim line, carried on past the target.
        const base = aim.clone().sub(from).normalize();
        const side = new THREE.Vector3(-base.z, 0, base.x).normalize();
        const a = spread * (0.6 + Math.random() * 0.8) + (npc ? 0.03 : 0);
        const ang = Math.random() * Math.PI * 2;
        const off = side.clone().multiplyScalar(Math.cos(ang) * Math.tan(a)).add(new THREE.Vector3(0, Math.sin(ang) * Math.tan(a), 0));
        to = from.clone().addScaledVector(base.add(off).normalize(), Math.max(d + 8, 12));
      }
      const tr = gn.trace(from, to);
      if (hit && !tr.wall) dmg += w.dmg;
      if (tr.wall) wallAny = true;
      ends.push(tr.end);
    }
    gn.fire(this.localChar, from, ends[0], wallAny, ends.slice(1));
    const ev: ShotEvent = { by: this.localChar, from: v3a(from), to: v3a(ends[0]), wall: wallAny, w: w.id };
    if (ends.length > 1) ev.more = ends.slice(1, 6).map(v3a);
    if (dmg > 0 && npc) { ev.id = npc.id; ev.dmg = dmg; }
    this.session.request('gunshot', ev);
  }

  /** Weapons carried over from earlier chapters (defaults if the chapter was started from the menu). */
  applyLoadout(): void {
    for (const c of ['elias', 'jax'] as CharacterId[]) {
      const w = this.chapter.flags[`carry_weapon_${c}`] as WeaponId | undefined;
      this.guns.setWeapon(c, w && WEAPONS[w] ? w : DEFAULT_LOADOUT[c]);
    }
  }

  /** Opens the weapon shop for the local player; the pick is sent as a shared 'weapon' event. */
  openWeaponShop(title: string, onDone?: (w: WeaponId) => void): void {
    if (this.hud.shopOpen) return;
    const partner = SPEAKERS[this.remoteChar].name;
    const items = SHOP.map((id) => {
      const d = WEAPONS[id];
      return {
        id, name: d.name, blurb: d.blurb,
        taken: this.guns.loadout[this.remoteChar] === id && this.chapter.flags[`picked_${this.remoteChar}`] ? `${partner} has one` : undefined,
        stats: [['Damage', Math.min(1, (d.dmg * d.pellets) / 110)], ['Fire rate', Math.min(1, 1 / d.rate / 14)], ['Accuracy', 1 - Math.min(0.95, d.spread / 0.1)], ['Range', d.range / 70], ['Magazine', d.mag / 30]] as Array<[string, number]>,
      };
    });
    const prev = this.local.state;
    this.local.state = 'busy';
    this.hud.showShop(title, items, (id) => {
      if (this.local.state === 'busy') this.local.state = prev === 'busy' ? 'free' : prev;
      this.session.request('weapon', { who: this.localChar, w: id });
      onDone?.(id as WeaponId);
    }, () => { if (this.local.state === 'busy') this.local.state = prev === 'busy' ? 'free' : prev; });
  }

  /** A player picked a weapon (shared event): both clients update what that player carries. */
  setWeapon(who: CharacterId, w: WeaponId): void {
    if (!WEAPONS[w]) return;
    this.guns.setWeapon(who, w);
    // Carried into the next chapters.
    this.chapter.flags[`carry_weapon_${who}`] = w;
  }

  private onLocalInteract(def: InteractDef, phase: 'press' | 'holdStart' | 'holdEnd' | 'complete'): void {
    if (def.coop) {
      if (phase === 'holdStart') this.session.hold(`${def.coop}:${def.role ?? this.localChar}`, true);
      if (phase === 'holdEnd') this.session.hold(`${def.coop}:${def.role ?? this.localChar}`, false);
    }
    if (def.id === this.reviveId && phase === 'complete') this.session.request('revive', { who: this.remoteChar, by: this.localChar });
  }

  private footstep(b: Body, s: string, loud: number): void {
    const name = surfaceSound[s] ?? 'step_concrete';
    const dist = b.pos.distanceTo(this.cam.camera.position);
    if (dist > 30) return;
    if (s === 'water') this.world.particles.emit('splash', b.pos.clone().setY(b.pos.y + 0.15), 6 + Math.round(loud * 6));
    else if ((s === 'dirt' || s === 'mud') && b.speed > 3) this.world.particles.emit(s === 'mud' ? 'mud' : 'dust', b.pos.clone().setY(b.pos.y + 0.05), 3);
    this.audio.play(name, { pos: b.pos.clone().setY(b.pos.y + 0.05), volume: (0.25 + 0.5 * loud) * (b.crouched ? 0.35 : 1), jitter: 0.08, ref: 1.5, maxDist: 30 });
  }

  private npcBark(npc: Npc, kind: 'suspicious' | 'alert' | 'lost' | 'hit' | 'search' | 'attack'): void {
    if (!this.authority) return;
    const now = this.world.time;
    const last = this.barkCooldown.get(npc.id) ?? -99;
    if (now - last < (kind === 'alert' ? 5 : 12)) return;
    // Not every hit or search gets a line.
    if ((kind === 'hit' || kind === 'attack' || kind === 'search') && Math.random() < 0.6) return;
    this.barkCooldown.set(npc.id, now);
    const alert = BARKS.alert[npc.def.role as 'guard' | 'police'] ?? BARKS.alert.other;
    const opts: string[] = kind === 'alert' ? alert : BARKS[kind];
    const text = opts[Math.floor(Math.random() * opts.length)];
    if (text) this.session.emit('bark', { id: npc.id, text, kind });
  }

  // ------------------------------------------------------------------ events
  applyEvent(type: string, args: unknown): void {
    // Still loading: drop it — a full-state sync follows once we announce we're loaded.
    if (this.state === 'loading' || !this.chapter) return;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'begin':
        this.begin(String(a.checkpoint));
        return;
      case 'flag':
        this.chapter.flags[String(a.k)] = a.v as boolean | number | string;
        this.chapter.onEvent('flag', a);
        return;
      case 'objective':
        this.setObjectiveLocal(String(a.text ?? ''), (a.marker as [number, number, number] | null) ?? null);
        return;
      case 'checkpoint': {
        this.chapter.checkpoint = String(a.id);
        this.checkpointFlags = { ...this.chapter.flags };
        this.hud.notify('Checkpoint reached');
        this.saveProgress();
        return;
      }
      case 'cutscene':
        this.startCutscene(String(a.id), Number(a.at));
        return;
      case 'csSkip':
        if (this.cutscenes.current?.id === a.id) this.cutscenes.finish();
        // Only drop a queued cutscene if this skip is for it: a late skip of the previous scene
        // used to cancel the next one before it started (its ending never ran: soft lock).
        if (this.pendingCutscene?.id === a.id) this.pendingCutscene = null;
        return;
      case 'dlg': {
        const lines = (a.lines as Line[] | undefined) ?? this.chapter.dialogues[String(a.id)];
        if (!lines) { console.warn('no dialogue', a.id); return; }
        const at = Number(a.at ?? 0);
        const offset = at ? (this.session.sharedNow() - at) / 1000 : 0;
        if (offset < 0) this.pendingDialogue = { lines, at };
        else if (this.inCutscene) this.dialogue.play(lines, undefined, offset);
        else this.dialogue.talk(lines, offset);
        return;
      }
      case 'bark': {
        if (this.dialogue.active || this.inCutscene) return;
        const npc = this.npcs.get(String(a.id));
        if (!npc || npc.body.pos.distanceTo(this.local.body.pos) > 22) return;
        // Alerts may cut in sooner; idle chatter needs a longer quiet spell.
        this.dialogue.bark({ who: String(a.id), text: String(a.text), dur: BARK_DUR }, a.kind === 'alert' ? 2.5 : 6);
        return;
      }
      case 'door': {
        const d = this.chapter.doors.get(String(a.id));
        if (d) d.target = a.open ? 1 : 0;
        return;
      }
      case 'trigger':
        this.chapter.onTrigger(String(a.id), a.who as CharacterId | 'both');
        return;
      case 'use':
        this.chapter.onUse(String(a.id), a.who as CharacterId);
        return;
      case 'coopDone': {
        const group = String(a.group);
        this.coopHolds.delete(group);
        this.coopSince.delete(group);
        this.interact.coopHeld.delete(group);
        if (this.interact.holding?.coop === group) this.local.endCoopHold();
        if (group.startsWith('mg_')) { this.minigames.onCoop(group); return; }
        this.chapter.onEvent('coop', { group });
        return;
      }
      case 'caught': {
        if (this.state !== 'playing') return;
        const extra = this.capture.start(a.who as CharacterId, String(a.by ?? ''));
        this.fail('', extra);
        return;
      }
      case 'fail':
        this.fail(String(a.reason ?? 'Mission failed.'));
        return;
      case 'restart':
        this.restartAt(String(a.checkpoint));
        return;
      case 'gunshot': {
        const sh = a as unknown as ShotEvent;
        const from = new THREE.Vector3(...sh.from), to = new THREE.Vector3(...sh.to);
        if (sh.by !== this.localChar) this.guns.fire(sh.by, from, to, !!sh.wall, (sh.more ?? []).map((p) => new THREE.Vector3(...p)));
        const dir = to.clone().sub(from).setY(0).normalize();
        if (sh.id) {
          const npc = this.npcs.get(sh.id);
          if (npc) {
            if (this.authority) npc.hit(sh.dmg ?? PLAYER_SHOT_DMG, [dir.x, dir.z], 'shot');
            this.audio.play('punch', { pos: npc.body.chest(), volume: 0.5, rate: 1.3, jitter: 0.1 });
          }
        }
        if (sh.who === this.localChar && this.state === 'playing') {
          this.local.takeHit(sh.dmg ?? 10, Math.atan2(dir.x, dir.z), 'shot');
          this.chapter.onEvent('playerHit', { who: this.localChar, dmg: sh.dmg, kind: 'shot' });
        }
        return;
      }
      case 'weapon': {
        const who = a.who as CharacterId, w = String(a.w) as WeaponId;
        this.setWeapon(who, w);
        this.chapter.onEvent('weaponPicked', { who, w });
        return;
      }
      case 'npcHit': {
        const npc = this.npcs.get(String(a.id));
        if (!npc) return;
        const kind = String(a.kind);
        if (this.authority) npc.hit(Number(a.dmg), a.dir as [number, number], kind);
        if (kind === 'takedown') {
          if (a.by === this.localChar) {
            const neck = npc.body.head().add(new THREE.Vector3(0, -0.15, 0));
            const behind = npc.body.pos.clone().addScaledVector(npc.body.forward(), -0.55);
            this.local.runScript([{ to: behind, dur: 0.25, yaw: npc.body.yaw }, { to: behind, dur: 2.3, yaw: npc.body.yaw, pose: 'choke', poseCtx: { points: { neck } } }]);
          }
          this.audio.play('grunt', { pos: npc.body.head(), volume: 0.6 });
          setTimeout(() => this.audio.play('body_fall', { pos: npc.body.pos, volume: 0.8 }), 2100);
        } else if (a.by !== this.localChar) {
          this.audio.play(kind === 'heavy' ? 'punch_heavy' : 'punch', { pos: npc.body.chest(), volume: 0.8, jitter: 0.1 });
        }
        return;
      }
      case 'downed':
        // Chapters may take over (the final fight).
        if (this.chapter.onEvent('downed', a)) return;
        if (a.who === this.remoteChar) this.hud.notify(`${SPEAKERS[this.remoteChar].name} is down! Help them up.`, 3);
        if (this.authority && this.local.state === 'downed' && this.remote.downed) this.session.emit('fail', { reason: 'You both went down.' });
        if (this.authority && a.who === this.localChar && this.partnerAway) this.session.emit('fail', { reason: 'You went down.' });
        if (this.authority && a.who === this.remoteChar && this.local.state === 'downed') this.session.emit('fail', { reason: 'You both went down.' });
        return;
      case 'revive':
        if (a.who === this.localChar) this.local.revive();
        return;
      case 'outfit':
        void this.applyOutfit(a.who as CharacterId, String(a.v));
        return;
      case 'chapterEnd':
        if (a.ending) writeSave(null, String(a.ending));
        this.endChapter((a.next as number | null) ?? null);
        return;
      default:
        if (type.startsWith('mg') && this.minigames.onEvent(type, args)) return;
        if (type === 'memory' && this.extras.onEvent(type, args)) return;
        if (!this.chapter.onEvent(type, args)) console.warn('unhandled event', type);
    }
  }

  validate(type: string, args: unknown, from: 'local' | 'peer'): boolean {
    const a = (args ?? {}) as Record<string, unknown>;
    if (type === 'gunshot') {
      if (from === 'peer' && a.by !== this.remoteChar) return false;
      if (a.id) {
        const npc = this.npcs.get(String(a.id));
        if (!npc || !npc.alive) return false;
        if (this.body(a.by as CharacterId).pos.distanceTo(npc.body.pos) > 80) return false;
        const wd = WEAPONS[this.guns.weaponOf(String(a.by)).id];
        if (Number(a.dmg) > wd.dmg * wd.pellets + 1) return false;
      }
      return true;
    }
    if (type === 'npcHit') {
      const npc = this.npcs.get(String(a.id));
      if (!npc || !npc.alive) return false;
      const attacker = this.body(a.by as CharacterId);
      if (attacker.pos.distanceTo(npc.body.pos) > 3) return false;
      if (a.kind === 'takedown' && !(npc.unaware || npc.stunned)) return false;
      if (a.kind === 'takedown' && npc.def.noTakedown) return false;
    }
    if (type === 'cutscene' || type === 'begin' || type === 'restart' || type === 'chapterEnd') return from === 'local';
    return this.chapter.validate(type, args, from);
  }

  fullState(): unknown {
    if (this.state === 'loading' || !this.local || !this.chapter) return null;
    return {
      chapter: this.chapter.num,
      ch: this.chapter.serialize(),
      checkpointFlags: this.checkpointFlags,
      objective: { text: this.objective.text, marker: this.objective.marker?.toArray() ?? null },
      npcs: [...this.npcs.values()].map((n) => n.snapshot()),
      played: [...this.cutscenes.played],
      begun: this.begun,
      playTime: this.playTime,
      authorityPos: this.local.body.pos.toArray(),
      cutscene: this.cutscenes.current ? { id: this.cutscenes.current.id, elapsed: this.cutscenes.elapsed } : null,
    };
  }

  applyFull(state: unknown): void {
    const s = state as ReturnType<Game['fullState']> & Record<string, unknown>;
    if (this.state === 'loading' || !s || s.chapter !== this.chapter.num) return;
    const wasBegun = this.begun;
    this.chapter.deserialize(s.ch as Record<string, unknown>);
    this.checkpointFlags = (s.checkpointFlags as Game['checkpointFlags']) ?? {};
    for (const id of (s.played as string[]) ?? []) this.cutscenes.played.add(id);
    const obj = s.objective as { text: string; marker: number[] | null };
    this.setObjectiveLocal(obj.text, obj.marker as [number, number, number] | null);
    if (!wasBegun && s.begun) {
      this.begun = true;
      this.state = 'playing';
      this.audio.playMusic(this.chapter.music, 3);
      this.chapter.setupCheckpoint(this.chapter.checkpoint);
      // We (re)joined late: appear next to our partner.
      const ap = new THREE.Vector3(...(s.authorityPos as [number, number, number]));
      this.local.teleport(ap.clone().add(new THREE.Vector3(1, 0, 0.5)), 0);
      this.chapter.deserialize(s.ch as Record<string, unknown>);
    }
    this.applyLoadout();
    for (const d of this.chapter.doors.values()) { d.t = d.target; this.chapter.applyDoor(d); }
    const tm = this.session.time;
    for (const ns of s.npcs as NpcSnap[]) this.npcs.get(ns.id)?.pushSnap(ns, tm, tm);
    // Rejoined during a cutscene: pick it up where the partner is.
    const cs = s.cutscene as { id: string; elapsed: number } | null;
    if (cs && !this.cutscenes.current && this.chapter.cutscenes[cs.id]) {
      this.cutscenes.play(this.chapter.cutscenes[cs.id], cs.elapsed, this.session.sharedNow() - cs.elapsed * 1000);
    }
    this.chapter.onEvent('synced', {});
  }

  onPeerSnap(s: PlayerSnap): void {
    if (this.state === 'loading' || !this.remote) return;
    this.remote.push(s, this.session.time);
  }

  onNpcSnaps(tm: number, n: NpcSnap[]): void {
    if (this.state === 'loading') return;
    const now = this.session.time;
    for (const s of n) this.npcs.get(s.id)?.pushSnap(s, tm, now);
  }

  onHold(id: string, on: boolean, _from: 'local' | 'peer'): void {
    const [group, role] = id.split(':');
    this.interact.setCoop(group, role, on);
    const need = this.coopNeed(group);
    if (this.interact.coopComplete(group)) {
      // Some co-op actions must be kept up together for a while (holdTime on the items).
      if (need > 0) { if (!this.coopSince.has(group)) this.coopSince.set(group, this.world.time); }
      else if (this.authority) this.session.emit('coopDone', { group });
    } else this.coopSince.delete(group);
  }

  private coopSince = new Map<string, number>();
  private coopNeed(group: string): number {
    let need = 0;
    for (const d of this.interact.items.values()) if (d.coop === group && d.holdTime) need = Math.max(need, d.holdTime);
    return need;
  }
  /** 0..1 progress of a timed co-op hold. */
  coopProgress(group: string): number {
    const t0 = this.coopSince.get(group);
    if (t0 === undefined) return 0;
    return Math.min(1, (this.world.time - t0) / Math.max(0.01, this.coopNeed(group)));
  }

  onHit(target: string, dmg: number, dir: [number, number], kind: string): void {
    if (target !== this.localChar) return;
    this.local.takeHit(dmg, Math.atan2(dir[0], dir[1]), kind);
    this.chapter.onEvent('playerHit', { who: this.localChar, dmg, kind });
  }

  onSkip(id: string, from: 'local' | 'peer'): void {
    this.cutscenes.skipVotes.add(from);
    if (this.authority && this.cutscenes.current?.id === id && (this.cutscenes.skipVotes.size >= 2 || this.partnerAway || !this.session.online)) {
      this.session.emit('csSkip', { id });
    }
  }

  private onPeerEvent(ev: 'disconnected' | 'reconnected' | 'left'): void {
    if (ev === 'disconnected') {
      this.partnerAway = true;
      this.partnerAwaySince = performance.now();
    } else if (ev === 'reconnected') {
      this.partnerAway = false;
      this.hud.setBanner(null);
      this.hud.notify('Partner reconnected');
    } else if (ev === 'left') {
      this.partnerAway = true;
      this.hud.setBanner('Your partner left the game.', 'danger');
      setTimeout(() => this.deps.onExit('partnerLeft'), 3500);
    }
  }

  // ------------------------------------------------------------------ cutscene host
  playShot(s: import('../engine/camera').Shot): void { this.cam.playShot(s); }
  endCamera(): void {
    this.cam.endCinematic(0.8);
    this.cam.snapBehind(this.local.body.yaw);
  }
  sayLines(lines: Line[]): void { this.dialogue.play(lines); }
  stopDialogue(): void { this.dialogue.stop(); }
  setLetterbox(on: boolean): void { this.hud.setLetterbox(on); }
  setFade(v: number): void { this.hud.setFade(v); }
  setCutsceneMode(on: boolean): void {
    this.inCutscene = on;
    this.hud.setGameplayVisible(!on);
    this.deps.touch.setMode(on ? 'hidden' : 'foot');
    if (on) {
      this.local.state = 'cutscene';
      this.local.body.speed = 0;
      this.remote.scripted = true;
      this.remote.cutsceneHold = true;
      this.hud.setSkipHint(this.cutscenes.current?.skippable === false ? null : this.input.device === 'touch' ? 'Tap and hold to skip' : `Press ${this.input.glyph('skip')} or hold ${this.input.glyph('interact')} to skip`);
    } else {
      if (this.local.state === 'cutscene') this.local.state = 'free';
      // Cutscene poses (lying, sitting, kneeling…) must not stick once you have control again.
      if (this.local.state === 'free' && this.local.body.poseName && this.local.body.poseName !== 'ride') this.local.body.clearPose(0.4);
      this.local.body.model.lookTarget = null;
      this.remote.release();
      this.hud.setSkipHint(null);
    }
  }
  music(name: string): void { this.audio.playMusic(name, 2); }

  private startCutscene(id: string, at: number): void {
    const def = this.chapter.cutscenes[id];
    if (!def) { console.warn('no cutscene', id); return; }
    const offset = (this.session.sharedNow() - at) / 1000;
    if (offset < 0) this.pendingCutscene = { id, at };
    else this.cutscenes.play(def, offset, at);
  }

  private setObjectiveLocal(text: string, marker: [number, number, number] | null): void {
    this.objective.text = text;
    this.objective.marker = marker ? new THREE.Vector3(...marker) : null;
    this.hud.setObjective(text);
    if (text) this.audio.play('ui_rise', { bus: 'ui', volume: 0.35 });
  }

  // ------------------------------------------------------------------ fail / restart / progress
  private failDelay = 0;
  /** Mission failed: banner, then fade and restart. `delay` gives a capture sequence time to play. */
  private fail(reason: string, delay = 0): void {
    if (this.state === 'failed') return;
    this.state = 'failed';
    if (reason) this.hud.setBanner(reason, 'danger');
    if (!delay) this.audio.play('sting', { bus: 'ui', volume: 0.6 });
    this.failTimer = 0;
    this.failDelay = delay;
    this.local.state = 'busy';
  }

  private restartAt(cp: string): void {
    this.capture.reset();
    this.guns.reset();
    this.chapter.flags = { ...this.checkpointFlags };
    this.chapter.checkpoint = cp;
    for (const t of this.chapter.triggers) t.fired = false;
    for (const n of this.npcs.values()) n.reset();
    this.local.body.hp = this.local.body.maxHp;
    this.local.body.clearPose(0);
    this.local.state = 'free';
    this.local.body.hidden = false;
    this.dialogue.stop();
    if (this.cutscenes.current) this.cutscenes.finish();
    this.chapter.setupCheckpoint(cp);
    for (const d of this.chapter.doors.values()) { d.t = d.target; this.chapter.applyDoor(d); }
    this.placeAtCheckpoint(cp);
    const def = this.chapter.checkpoints[cp];
    if (def.objective) this.setObjectiveLocal(def.objective, null);
    this.hud.setBanner(null);
    this.state = 'playing';
    this.failTimer = -1;
    this.chapter.onEvent('restarted', { checkpoint: cp });
  }

  saveProgress(): void {
    const p: Progress = { chapter: this.chapter.num, checkpoint: this.chapter.checkpoint, flags: this.chapter.flags, savedAt: Date.now(), playTime: Math.round(this.playTime) };
    writeSave(p);
    if (this.authority) this.deps.net?.save(p);
  }

  private endChapter(next: number | null): void {
    this.state = 'ended';
    if (next) {
      // Things that travel with you (the weapons you picked) go into the next chapter's flags.
      const carry = Object.fromEntries(Object.entries(this.chapter.flags).filter(([k]) => k.startsWith('carry_')));
      const p: Progress = { chapter: next, checkpoint: '', flags: carry, savedAt: Date.now(), playTime: Math.round(this.playTime) };
      writeSave(p);
      if (this.authority) this.deps.net?.save(p);
    }
    this.deps.onChapterComplete(next);
  }

  async applyOutfit(who: CharacterId, variant: string): Promise<void> {
    const body = this.body(who);
    const entry = this.chars.manifest[who];
    const v = entry?.variants?.[variant];
    if (!v) return;
    const mats = Array.isArray(body.model.mesh.material) ? body.model.mesh.material : [body.model.mesh.material];
    for (const m of mats as THREE.MeshStandardMaterial[]) {
      if (m.name !== v.material) continue;
      if (!m.userData.origMap) m.userData.origMap = m.map;
      const tex = v.map ? await loadTexture('characters/' + v.map, { flipY: false }) : (m.userData.origMap as THREE.Texture);
      const clone = m.clone();
      clone.map = tex;
      clone.userData.origMap = m.userData.origMap;
      clone.needsUpdate = true;
      const all = (Array.isArray(body.model.mesh.material) ? body.model.mesh.material : [body.model.mesh.material]).map((x) => (x === m ? clone : x));
      body.model.mesh.material = Array.isArray(body.model.mesh.material) ? all : all[0];
    }
    if (who === this.localChar) this.local.variant = variant;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number): void {
    if (this.state === 'loading') return;
    const inp = this.input;
    inp.update(dt);
    // Keep announcing that we're loaded until the authority starts the chapter
    // (the partner may still be loading and miss the first message).
    if (!this.begun && this.session.online) {
      this.loadedTimer -= dt;
      if (this.loadedTimer <= 0) {
        this.loadedTimer = 1.5;
        this.session.loaded(this.chapter.num, this.chapter.checkpoint);
      }
    }
    if (this.state === 'playing' || this.state === 'failed') this.playTime += dt;
    // Pending synced starts
    if (this.pendingCutscene && this.session.sharedNow() >= this.pendingCutscene.at) {
      const pc = this.pendingCutscene;
      this.pendingCutscene = null;
      this.startCutscene(pc.id, pc.at);
    }
    if (this.pendingDialogue && this.session.sharedNow() >= this.pendingDialogue.at) {
      if (this.inCutscene) this.dialogue.play(this.pendingDialogue.lines); else this.dialogue.talk(this.pendingDialogue.lines);
      this.pendingDialogue = null;
    }
    // Partner absence freezes the simulation (co-op cannot continue alone).
    const frozen = this.partnerAway && this.session.online;
    if (frozen) {
      const secs = Math.max(0, 120 - (performance.now() - this.partnerAwaySince) / 1000);
      this.hud.setBanner(`Partner disconnected — waiting for them to reconnect (${Math.ceil(secs)}s)`, 'warn');
    }
    // Skip cutscenes
    if (this.cutscenes.current && this.cutscenes.current.skippable !== false && (inp.buttons.skip.pressed || inp.heldFor('interact') > 0.8 || this.touchSkipHeld())) {
      if (!this.cutscenes.skipVotes.has('local')) {
        // Set the hint first: offline, the skip applies synchronously and clears it.
        this.hud.setSkipHint(this.session.online && !this.partnerAway ? 'Waiting for your partner to skip…' : 'Skipping…');
        this.session.skip(this.cutscenes.current.id);
      }
    }
    if (!frozen) {
      this.cutscenes.update(dt);
      this.dialogue.update(dt);
      if (this.state === 'playing' || this.state === 'failed') {
        this.chapter.checkTriggers();
        this.chapter.update(dt);
      }
      this.chapter.updateDoors(dt);
      for (const u of this.updaters) u(dt);
      this.capture.update(dt);
      this.guns.update(dt);
      if (this.authority) for (const [g, t0] of this.coopSince) {
        if (this.world.time - t0 >= this.coopNeed(g)) { this.coopSince.delete(g); this.session.emit('coopDone', { group: g }); }
      }
    }
    // Players
    this.updateReviveInteract();
    if (this.state !== 'waiting') this.local.update(frozen ? 0 : dt);
    else this.local.body.updateVisual(dt);
    this.remote.update(dt, this.session.time);
    // NPCs
    const camPos = this.cam.camera.position;
    const lod = this.deps.renderer.q.animLodDistance;
    for (const n of this.npcs.values()) {
      const far = n.body.pos.distanceTo(camPos) > lod;
      if (this.authority) { if (!frozen) n.updateAuthority(dt); }
      else n.updateProxy(dt, this.session.time);
      n.body.culled = n.body.pos.distanceTo(camPos) >= this.deps.renderer.q.characterDistance;
      void far;
    }
    this.world.update(frozen ? 0 : dt);
    // Fail timer
    if (this.failTimer >= 0) {
      this.failTimer += dt;
      this.hud.setFade(Math.min(1, Math.max(0, (this.failTimer - 1 - this.failDelay) / 1.2)));
      if (this.authority && this.failTimer > 2.8 + this.failDelay && this.state === 'failed') {
        this.failTimer = -2;
        this.session.emit('restart', { checkpoint: this.chapter.checkpoint });
      }
    } else if (this.failTimer === -1 && !this.cutscenes.current && this.hud.fade > 0 && this.state === 'playing') {
      this.hud.setFade(Math.max(0, this.hud.fade - dt * 1.5));
    }
    // Network snapshots
    this.session.update(dt, () => {
      if (!this.begun) return null;
      const s = this.local.snapshot(this.session.time);
      if (this.bikeSnap) s.b = this.bikeSnap;
      return s;
    }, () => [...this.npcs.values()].map((n) => n.snapshot()));
    // Camera
    const ct = this.camTarget?.();
    if (ct) {
      if (this.cam.mode !== 'cinematic') this.cam.mode = ct.mode;
      this.cam.update(dt, inp.look, ct.pos, ct.yaw, true, this.world.physics, ct.speed);
    } else {
      const lb = this.local.body;
      if (this.cam.mode === 'bike') this.cam.mode = 'follow';
      this.cam.height = this.local.crawlMode ? 0.7 : lb.crouched ? 1.15 : 1.55;
      this.cam.distance = (this.local.crawlMode ? 2.0 : this.local.inCombat ? 3.8 : 3.4) * (this.local.crawlMode ? 1 : this.input.zoom);
      this.cam.update(dt, inp.look, lb.pos, lb.yaw, lb.speed > 0.5, this.world.physics);
    }
    this.cam.autoFollow = this.deps.settings.autoCamera;
    this.world.updateShadowFocus(this.local.body.pos);
    this.audio.updateListener(this.cam.camera);
    this.updateHud(dt);
    inp.look.set(0, 0);
  }

  private touchSkipHeld(): boolean {
    return this.input.device === 'touch' && this.input.virtual.look.lengthSq() === 0 && this.skipTouch > 0.9;
  }
  skipTouch = 0;

  private updateReviveInteract(): void {
    if (this.chapter.flags.pvp) { if (this.interact.items.has(this.reviveId)) this.interact.remove(this.reviveId); return; }
    if (this.remote.downed && !this.interact.items.has(this.reviveId)) {
      this.interact.add({
        id: this.reviveId, pos: this.remote.body.pos.clone(), label: `Help ${SPEAKERS[this.remoteChar].name} up`, mode: 'hold', holdTime: 2.2,
        pose: 'revive', icon: 'coop', priority: 5, who: this.localChar, radius: 1.6,
      });
    } else if (!this.remote.downed && this.interact.items.has(this.reviveId)) this.interact.remove(this.reviveId);
    const rv = this.interact.items.get(this.reviveId);
    if (rv) rv.pos.copy(this.remote.body.pos);
  }

  private updateHud(dt: number): void {
    const hud = this.hud;
    const touch = this.deps.touch;
    // Prompt
    const h = this.interact.holding;
    const c = this.interact.current;
    if (this.inCutscene || this.state !== 'playing') hud.setPrompt(null);
    else if (h) {
      let sub = '';
      if (h.coop) {
        const held = this.interact.coopHeld.get(h.coop);
        const roles = this.interact.coopRoles(h.coop);
        const waiting = roles.filter((r) => !held?.has(r));
        sub = waiting.length ? `Waiting for ${SPEAKERS[this.remoteChar].name}…` : '';
      }
      const coopP = h.coop && h.holdTime ? this.coopProgress(h.coop) : -1;
      hud.setPrompt(this.interact.label(h), coopP >= 0 ? coopP : h.coop ? 0.5 + 0.5 * Math.sin(performance.now() / 300) * 0.3 : Number.isFinite(h.holdTime ?? 1.5) ? this.interact.holdT / (h.holdTime ?? 1.5) : 1, sub, h.icon ?? 'hand');
    } else if (this.local.takedownTarget) hud.setPrompt('Takedown', 0, this.input.device === 'touch' ? 'Tap Hit' : `[${this.input.glyph('attack')}] Attack`, 'fist');
    else if (c && this.local.state === 'free') {
      const key = this.input.glyph('interact');
      const partnerHolding = c.coop ? this.interact.coopHeld.get(c.coop)?.size ?? 0 : 0;
      hud.setPrompt(this.interact.label(c), 0, (key ? `[${key}] ` : '') + ((c.mode ?? 'press') === 'hold' ? 'Hold' : 'Press') + (partnerHolding ? ` — ${SPEAKERS[this.remoteChar].name} is ready` : ''), c.icon ?? 'hand');
    } else hud.setPrompt(null);
    // One-line control help: mouse capture on PC, bike controls while standing still on a bike.
    let ctl: string | null = null;
    if (!this.inCutscene && this.state === 'playing') {
      const inp = this.input;
      if (inp.device === 'keyboard' && !inp.pointerLocked) ctl = 'Click the game to look around with the mouse';
      else if (this.local.state === 'bike' && this.local.body.speed < 0.5 && Math.abs(this.bikeSnap?.[5] ?? 0) < 1) {
        ctl = inp.device === 'touch' ? 'Hold Gas to ride · stick to steer'
          : inp.device === 'gamepad' ? `${inp.glyph('throttle')} gas · ${inp.glyph('brake')} brake · left stick steer`
          : 'W gas · S brake · A / D steer';
      }
    }
    if (this.chapterHint && !this.inCutscene) ctl = this.chapterHint;
    hud.setControlHint(ctl);
    touch.setLabel('interact', c && !this.inCutscene ? shortLabel(this.interact.label(c)) : null, !!c);
    const armed = this.guns.playersArmed && this.flags.combat;
    hud.setAmmo(armed && !this.inCutscene && this.state === 'playing' ? `${this.guns.local.name}  ·  ${this.guns.reloadT > 0 ? 'reloading' : `${this.guns.ammo} / ${this.guns.local.mag}`}` : null);
    touch.setLabel('attack', this.local.takedownTarget ? 'Takedown' : armed ? (this.guns.reloadT > 0 ? 'Reload' : `Shoot ${this.guns.ammo}`) : null, !!this.local.takedownTarget || (armed && !!this.local.aimTarget));
    touch.setActive('crouch', this.local.body.crouched);
    touch.setFlags(this.flags);
    hud.setHealth(this.local.body.hp);
    const peer = this.deps.net?.peer;
    hud.setPartner(peer?.name ?? SPEAKERS[this.remoteChar].name, this.remoteChar, this.partnerAway ? 'away' : this.remote.stale ? 'lag' : 'ok', peer?.ping ?? Math.round(this.deps.net?.rtt ?? 0), this.remote.body.hp);
    // Markers (created once)
    if (!this.markersMade) {
      this.markersMade = true;
      hud.addMarker({ id: 'partner', kind: 'partner', label: SPEAKERS[this.remoteChar].name, pos: () => this.remote.body.head().add(new THREE.Vector3(0, 0.45, 0)), visible: () => !this.inCutscene && this.remote.body.pos.distanceTo(this.local.body.pos) > 2.5 });
      hud.addMarker({ id: 'objective', kind: 'objective', label: '', pos: () => this.objective.marker, visible: () => !this.inCutscene });
      hud.addMarker({ id: 'target', kind: 'target', pos: () => this.local.aimTarget?.body.chest() ?? null, visible: () => !this.inCutscene && this.guns.playersArmed && this.flags.combat && !!this.local.aimTarget?.alive });
    }
    for (const n of this.npcs.values()) {
      if ((n.def.role === 'guard' || n.def.role === 'police' || n.def.role === 'thug') && !this.npcMarkers.has(n.id)) {
        this.npcMarkers.add(n.id);
        hud.addMarker({ id: 'npc:' + n.id, kind: 'guard', pos: () => n.body.head().add(new THREE.Vector3(0, 0.35, 0)), value: () => (n.alive && !this.inCutscene ? n.awareness[this.localChar] : 0) });
      }
    }
    hud.showStats = this.deps.settings.showFps;
    const r = hud.showStats ? this.deps.renderer.stats() : null;
    hud.update(dt, this.cam.camera, !r ? '' : `${r.fps} fps · ${r.ms} ms · ${r.calls} calls · ${(r.tris / 1000).toFixed(0)}k tris · scale ${r.scale} · ${r.quality}${r.heapMB ? ` · ${r.heapMB} MB` : ''} · rtt ${Math.round(this.deps.net?.rtt ?? 0)} ms`);
  }
  private markersMade = false;
  private loadedTimer = 1.5;
  private npcMarkers = new Set<string>();

  dispose(): void {
    clearTimeout(this.prefetchTimer);
    for (const u of this.unsubs) u();
    this.session.dispose();
    this.dialogue.stop();
    this.hud.clearMarkers();
    this.hud.setLetterbox(false);
    this.hud.setBanner(null);
    this.hud.setPrompt(null);
    this.hud.setSubtitle(null, '');
    for (const n of this.npcs.values()) n.dispose();
    this.npcs.clear();
    this.minigames.dispose();
    this.capture.dispose();
    this.guns.dispose();
    this.dialogue.stop();
    this.dialogue.bank?.clear();
    try { this.chapter?.dispose(); } catch (e) { console.warn('chapter dispose', e); }
    try { this.world?.dispose(); } catch (e) { console.warn('world dispose', e); }
    this.audio.stopMusic(1.5);
  }
}

function shortLabel(s: string): string {
  const w = s.split(' ');
  return w.length > 2 ? w.slice(0, 2).join(' ') : s;
}
