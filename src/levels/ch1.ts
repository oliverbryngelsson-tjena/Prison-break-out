// Chapter 1 — Prison Life. Jax arrives at Redmoor, meets Elias, and they steal the tool they need.
import * as THREE from 'three';
import type { CharacterId } from '../../shared/protocol';
import { Chapter, type CheckpointDef } from './chapter';
import { buildPrison, type PrisonHandles } from './prison';
import { v3, placeChar, walkChar, run, clipChar, lookChar, shot, ots, closeUp, twoShot, npcWalk, npcPlace, npcClip, poseChar } from './cs';
import type { Line } from '../game/dialogue';
import type { ScriptStep } from '../game/player';

const SIDE_OUT = -Math.PI / 2; // east cells face -x

export class Chapter1 extends Chapter {
  readonly num = 1;
  readonly title = 'Prison Life';
  readonly subtitle = 'Redmoor State Correctional Facility';
  P!: PrisonHandles;
  music = 'music_explore';
  readonly checkpoints: Record<string, CheckpointDef> = {
    arrival: { spawn: { elias: { pos: [11.6, 0, -10.6], yaw: SIDE_OUT }, jax: { pos: [0, 0, -24.5], yaw: 0 } }, objective: '', intro: 'cs_arrival' },
    morning: { spawn: { elias: { pos: [11.4, 0, -10.6], yaw: SIDE_OUT }, jax: { pos: [11.4, 0, -8.0], yaw: SIDE_OUT } }, objective: 'Morning recreation — head out to the yard' },
    yard: { spawn: { elias: { pos: [-1, 0, 9], yaw: 0 }, jax: { pos: [1, 0, 9], yaw: 0 } }, objective: 'Morning recreation — head out to the yard' },
    workshop: { spawn: { elias: { pos: [-8, 0, -28.2], yaw: Math.PI }, jax: { pos: [-6.6, 0, -28.4], yaw: Math.PI } }, objective: 'Steal a screwdriver from Haskins\' tool cage', intro: 'cs_workshop' },
    laundry: { spawn: { elias: { pos: [3.2, 0, -35.6], yaw: Math.PI / 2 }, jax: { pos: [3.0, 0, -34.4], yaw: Math.PI / 2 } }, objective: 'Reach the air duct above the laundry shelves — don\'t let Okafor see you' },
    count: { spawn: { elias: { pos: [11.8, 0, -7.6], yaw: SIDE_OUT }, jax: { pos: [12.6, 0, -8.6], yaw: SIDE_OUT } }, objective: 'Evening count — Elias, get back into C-16 before the guard reaches it', intro: 'cs_count' },
  };

  constructor() {
    super();
    this.flagsDefault = { jump: false, sprint: true, combat: false, crouch: true };
    this.defineNpcs();
    this.defineDialogue();
  }

  private defineNpcs(): void {
    const d = this.npcDefs;
    d.push({ id: 'pruitt', char: 'guard1', role: 'guard', name: 'Officer Pruitt', pos: [0.4, 0, -19.6], yaw: 0, idleClip: 'idle_look', catches: true, passive: true, vision: { range: 15, fov: 110 } });
    d.push({ id: 'vance', char: 'guard2', role: 'guard', name: 'Officer Vance', pos: [9.6, 3.5, -20], yaw: 0, catches: true, passive: true, vision: { range: 16, fov: 95 },
      patrol: [[9.6, -20, 2, 0], [9.6, -5, 3, -Math.PI / 2], [-9.6, -5, 0], [-9.6, -20, 2, Math.PI]] });
    d.push({ id: 'haskins', char: 'guard1', role: 'guard', name: 'Haskins', pos: [-5.9, 0, -28.6], yaw: Math.PI / 2 + 0.3, idleClip: 'idle_breathe', catches: true, vision: { range: 11, fov: 100 } });
    d.push({ id: 'okafor', char: 'guard2', role: 'guard', name: 'Officer Okafor', pos: [9.5, 0, -32], yaw: 0, catches: true, vision: { range: 12, fov: 95 },
      patrol: [[9.5, -32, 3, Math.PI], [4.2, -32.5, 2, -Math.PI / 2], [9.5, -39.5, 2, Math.PI], [15.2, -33.5, 4, Math.PI * 0.2]] });
    d.push({ id: 'yardguard', char: 'guard1', role: 'guard', name: 'Officer Kemp', pos: [2, 0, 9.2], yaw: 0, idleClip: 'idle_look2', catches: false, passive: true });
    d.push({ id: 'mo', char: 'mo', role: 'story', name: 'Old Mo', pos: [0, 0, -9.0], yaw: Math.PI, idleClip: 'sit_table', passive: true });
    // Dayroom inmates
    d.push({ id: 'inm_a', char: 'inmate2', role: 'inmate', name: 'Dutch', pos: [-4.2, 0, -14.6], yaw: Math.PI, idleClip: 'sit_table_relaxed', passive: true });
    d.push({ id: 'inm_b', char: 'inmate4', role: 'inmate', name: 'Ramos', pos: [-5.1, 0, -15.5], yaw: Math.PI / 2, idleClip: 'talk', passive: true });
    d.push({ id: 'inm_c', char: 'inmate6', role: 'inmate', name: 'Tully', pos: [10.0, 0, 3.6], yaw: Math.PI / 2, idleClip: 'phone_talk', passive: true });
    d.push({ id: 'inm_d', char: 'inmate1', role: 'inmate', name: 'Sal', pos: [4.2, 0, -3.6], yaw: Math.PI, idleClip: 'sit_table', passive: true });
    // Yard: Brick and his crew + ambient
    d.push({ id: 'brick', char: 'inmate3', role: 'thug', name: 'Brick', pos: [8.5, 0, 15.6], yaw: Math.PI, idleClip: 'idle_angry', passive: true, hp: 90, damage: 12, walk: 1.2, run: 3.2, noTakedown: true, loco: 'normal' });
    d.push({ id: 'brick_a', char: 'inmate5', role: 'thug', name: 'Hollis', pos: [6.8, 0, 16.8], yaw: Math.PI, idleClip: 'idle_stretch', passive: true, hp: 55, damage: 9, run: 3.4, loco: 'normal' });
    d.push({ id: 'brick_b', char: 'inmate1', role: 'thug', name: 'Pike', pos: [10.2, 0, 17.0], yaw: Math.PI, idleClip: 'idle_shake', passive: true, hp: 55, damage: 9, run: 3.4, loco: 'normal' });
    d.push({ id: 'yd_a', char: 'inmate2', role: 'inmate', name: 'Inmate', pos: [-9, 0, 20], yaw: 0.8, idleClip: 'clap', passive: true });
    d.push({ id: 'yd_b', char: 'inmate4', role: 'inmate', name: 'Inmate', pos: [-6.5, 0, 22.5], yaw: -2.2, idleClip: 'talk_excited', passive: true });
    d.push({ id: 'yd_c', char: 'inmate6', role: 'inmate', name: 'Inmate', pos: [12, 0, 28.6], yaw: Math.PI, idleClip: 'sit_chair', passive: true });
    // Workshop + laundry workers
    d.push({ id: 'ws_a', char: 'inmate2', role: 'inmate', name: 'Inmate', pos: [-12.5, 0, -37.8], yaw: Math.PI, idleClip: 'work_table', passive: true });
    d.push({ id: 'ws_b', char: 'inmate5', role: 'inmate', name: 'Inmate', pos: [-7.5, 0, -33.8], yaw: Math.PI, idleClip: 'work_table', passive: true });
    d.push({ id: 'ld_a', char: 'inmate4', role: 'inmate', name: 'Inmate', pos: [7, 0, -33.3], yaw: Math.PI, idleClip: 'work_mid', passive: true });
    d.push({ id: 'ld_b', char: 'inmate6', role: 'inmate', name: 'Inmate', pos: [12, 0, -29.3], yaw: Math.PI, idleClip: 'work_mid', passive: true });
  }

  private defineDialogue(): void {
    const D = this.dialogues;
    D.mo_elias = [
      { who: 'mo', text: 'Morning, professor. Still counting the bricks?', anim: 'talk_relaxed' },
      { who: 'elias', text: 'Somebody has to, Mo.' },
      { who: 'mo', text: 'Your new neighbour came in last night. County transfer, middle of the month.', anim: 'talk' },
      { who: 'mo', text: 'Paperwork in a sealed envelope. Thirty-one years in this place, I never seen that.' },
      { who: 'elias', text: 'Maybe the county ran out of envelopes.' },
      { who: 'mo', text: 'Maybe. Watch your back anyhow. Brick\'s been eyeing him since breakfast.', anim: 'talk_nervous' },
    ];
    D.mo_jax = [
      { who: 'mo', text: 'You\'re the fish from C-17.', anim: 'talk' },
      { who: 'jax', text: 'And you\'re the welcoming committee?' },
      { who: 'mo', text: 'I\'m the guy who\'s been here long enough to know the vents in the laundry run all the way to the east chase.', anim: 'talk_relaxed' },
      { who: 'mo', text: 'Not that a smart young man would need to know that.' },
      { who: 'jax', text: 'Course not.' },
      { who: 'mo', text: 'Stay away from the weights. That\'s Brick\'s church, and he don\'t like converts.', anim: 'talk_nervous' },
    ];
    D.dutch = [{ who: 'inm_a', text: 'Don\'t sit there. That\'s Ramos\'s seat. Everything here is somebody\'s.' }];
    D.ramos = [{ who: 'inm_b', text: '...so I tell the judge, your honour, the car was already on fire when I got in it.', anim: 'talk_excited' }];
    D.tully = [{ who: 'inm_c', text: 'Yeah, Ma. No, they feed us fine. ...No, I\'m not lying. Ma. Ma.', anim: 'phone_talk' }];
    D.sal = [{ who: 'inm_d', text: 'Count\'s at nine. Miss it and they lock the whole block down. Nobody\'ll thank you.' }];
    D.pruitt_talk = [{ who: 'pruitt', text: 'Keep moving, inmate. Yard\'s that way.' }];
    D.kemp = [{ who: 'yardguard', text: 'Thirty minutes. Then everybody back inside.' }];
    D.arm_hint = [{ who: 'jax', text: 'Hey, accountant. Table by the stairs. Let\'s see what those arms are good for.', dur: 3.6 }];
    D.yard_hint = [{ who: 'elias', text: 'Brick holds court by the weights. Best not to give him an audience.' }];
    D.fight_tip = [{ who: 'narrator', text: 'Hit to punch, hold Block to guard, Dodge to sidestep. Help each other — knock out Brick\'s crew.', dur: 5 }];
    D.distract = [
      { who: 'jax', text: 'Hey, boss. Haskins, right? Is that window supposed to rattle like that?', anim: 'talk' },
      { who: 'haskins', text: 'What window?' },
      { who: 'jax', text: 'That one. Every time the wind picks up. Sounds like the frame\'s about to go.', anim: 'talk_excited' },
      { who: 'haskins', text: 'Huh. Maintenance said they fixed that in March.' },
      { who: 'jax', text: 'March of what year? Look at the bottom corner, the bolt\'s backed right out.', anim: 'talk' },
      { who: 'haskins', text: '...Son of a gun. Write that up and it\'ll be March again before anyone shows.' },
      { who: 'jax', text: 'I\'d write it up for you, but they took my pen privileges.', anim: 'laugh' },
      { who: 'haskins', text: 'Alright, alright. That\'s enough, Rourke. Back to your bench.' },
    ];
    D.got_tool = [
      { who: 'elias', text: 'Got it. Now we just need to get it out of here.' },
      { who: 'jax', text: 'Through the metal detector? They\'ll have it out of you before you can say "screw".' },
      { who: 'elias', text: 'Mo says the laundry vents run to the east chase. We take the long way.' },
    ];
    D.laundry_in = [
      { who: 'jax', text: 'Okafor walks the floor like he\'s got somewhere to be. Time it.' },
      { who: 'elias', text: 'The duct over the shelves. I\'ll need a lift.' },
    ];
    D.in_duct = [
      { who: 'jax', text: 'Cozy. Smells like twenty years of socks.' },
      { who: 'elias', text: 'Keep moving. Count is at nine.' },
    ];
    D.in_chase = [
      { who: 'elias', text: 'This chase runs behind every cell on the east tier.' },
      { who: 'jax', text: 'And the vent behind my bunk is loose. Funny how that works.' },
      { who: 'elias', text: 'Nothing in here is funny, Jax. It\'s all just waiting to be noticed.' },
    ];
    D.caught_hint = [{ who: 'narrator', text: 'Stay out of the guards\' sight — crouch to move quietly and watch their awareness markers.', dur: 4 }];
  }

  async build(): Promise<void> {
    const g = this.g;
    const w = g.world;
    await w.setEnvironment({
      hdr: 'env/hangar.hdr', envIntensity: 0.55, background: 0x6d7378,
      fog: { color: 0x8a8f8f, near: 24, far: 90 },
      hemi: { sky: 0xdfe6ee, ground: 0x4a4238, intensity: 0.55 },
      sun: { color: 0xfff0d8, intensity: 2.6, dir: [0.35, 1, 0.5], shadows: true },
      grade: { saturation: 0.86, contrast: 1.06, lift: [0.01, 0.012, 0.016], gain: [1.02, 1.0, 0.96], shadowTint: [0.93, 1.0, 1.04], highlightTint: [1.05, 1.0, 0.94], bloom: 0.55, vignette: 0.55 },
      reverb: 0.55,
    });
    this.P = await buildPrison(w, 'day');
    const P = this.P;
    P.kit.initLightPool(Math.max(2, g.deps.renderer.q.maxLights - 1));
    g.setNav(P.nav);
    // Doors
    for (const c of P.cells) this.addDoor({ id: c.id, obj: c.door, collider: c.doorCollider, kind: 'slide', open: new THREE.Vector3(0.12 * (c.side === 'east' ? -1 : 1), 0, -1.3), speed: 0.8, sound: 'cell' });
    this.addDoor({ id: 'gate', obj: P.mainGate, collider: P.mainGateCol, kind: 'slide', open: new THREE.Vector3(3.1, 0, 0), speed: 0.6, sound: 'gate' });
    this.addDoor({ id: 'yard', obj: P.yardDoor.children[0], collider: P.yardDoorCol, kind: 'swing', open: -Math.PI / 2, speed: 1.2, sound: 'metal' });
    this.addDoor({ id: 'workshop', obj: P.workshopDoor.children[0], collider: P.workshopDoorCol, kind: 'swing', open: Math.PI / 2, speed: 1.2, sound: 'metal' });
    this.addDoor({ id: 'laundry', obj: P.laundryDoor.children[0], collider: P.laundryDoorCol, kind: 'swing', open: Math.PI / 2, speed: 1.2, sound: 'metal' });
    this.addDoor({ id: 'cage', obj: P.cageDoor, collider: P.cageDoorCol, kind: 'swing', open: -Math.PI * 0.55, speed: 1.4, sound: 'gate' });
    this.addDoor({ id: 'shop_laundry', obj: P.shopLaundryDoor.children[0], collider: P.shopLaundryDoorCol, kind: 'swing', open: -Math.PI / 2, speed: 1.2, sound: 'metal' });
    this.addDoor({ id: 'chase', obj: P.chaseDoor.children[0], collider: P.chaseDoorCol, kind: 'swing', open: Math.PI / 2, speed: 1.2, sound: 'metal' });
    // Ambience
    w.ambientLoop('amb_hvac', 0.32);
    w.ambientLoop('amb_warehouse', 0.18, v3(0, 4, -8));
    w.ambientLoop('amb_wind', 0.12, v3(0, 3, 25));
    w.tickers.add((dt) => {
      P.kit.updateLightPool(g.local?.body.pos ?? v3(0, 0, 0), dt);
      // TV flicker
      (P.tvScreen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.random() * 0.4;
    });
    this.buildInteractions();
    this.buildTriggers();
    this.buildCutscenes();
  }

  // ---------------------------------------------------------------- interactions
  private buildInteractions(): void {
    const g = this.g;
    const I = g.interact;
    const talk = (id: string, npc: string, dlg: string | ((who: CharacterId) => string), who: CharacterId | 'any' = 'any', label?: string) => {
      const n = this.npcDefs.find((x) => x.id === npc)!;
      I.add({
        id, pos: v3(n.pos[0], n.pos[1], n.pos[2]), radius: 1.9, label: label ?? `Talk to ${n.name}`, who, icon: 'talk', cooldown: 6,
        enabled: () => !g.dialogue.active && this.flags.phase === 'morning',
        onUse: (c) => g.session.request('talk', { dlg: typeof dlg === 'function' ? dlg(c) : dlg, npc, who: c }),
      });
    };
    talk('talk_mo', 'mo', (c) => (c === 'elias' ? 'mo_elias' : 'mo_jax'));
    // Optional memories (either player can examine; both hear the exchange).
    const morning = () => this.flags.phase === 'morning';
    g.extras.addMemory({ id: 'c1_photo', pos: v3(12.4, 0, -11.2), radius: 1.0, label: 'Look at the photo', enabled: morning, lines: [
      { who: 'jax', text: 'Who\'s the guy with the terrible tie?' },
      { who: 'elias', text: 'Tom Harlan. My partner. That\'s the day we signed our first big client.' },
      { who: 'elias', text: 'Crane Development. First client. Last client.', pause: 0.6 },
    ] });
    g.extras.addMemory({ id: 'c1_tally', pos: v3(12.4, 0, -8.6), radius: 1.0, label: 'Look at the marks on the wall', enabled: morning, lines: [
      { who: 'elias', text: 'Forty-one marks. Counting down to parole?' },
      { who: 'jax', text: 'Counting up. Days since somebody lied to my mother about my brother.', anim: 'talk_sad' },
    ] });
    g.extras.addMemory({ id: 'c1_tv', pos: v3(0, 0, 4.2), radius: 2.0, label: 'Watch the news', enabled: morning, lines: [
      { who: 'narrator', radio: true, text: '…opening the new Harlow flood barrier, Victor Crane thanked the town for "thirty years of trust"…', dur: 4.2 },
      { who: 'jax', text: 'Look at him smile.' },
      { who: 'elias', text: 'He smiled exactly like that at my sentencing.', anim: 'talk_angry' },
    ] });
    // Arm wrestling at a free dayroom table (best of as many rounds as you like).
    g.minigames.addArmWrestling({ id: 'arm_dayroom', center: v3(4.2, 0, -10), table: 0.785, axis: 'z', enabled: () => this.flags.phase === 'morning' && !g.flags.combat });
    talk('talk_dutch', 'inm_a', 'dutch');
    talk('talk_ramos', 'inm_b', 'ramos', 'any', 'Listen');
    talk('talk_tully', 'inm_c', 'tully', 'any', 'Listen');
    talk('talk_sal', 'inm_d', 'sal');
    talk('talk_pruitt', 'pruitt', 'pruitt_talk');
    I.add({ id: 'talk_kemp', pos: v3(2, 0, 9.2), radius: 1.8, label: 'Talk to Officer Kemp', icon: 'talk', cooldown: 6, enabled: () => !g.dialogue.active && this.flags.phase === 'morning', onUse: (c) => g.session.request('talk', { dlg: 'kemp', npc: 'yardguard', who: c }) });
    // Workshop: Jax distracts Haskins, Elias picks the cage and takes the tool.
    I.add({
      id: 'distract', who: 'jax', pos: v3(-5.6, 0, -28.6), radius: 2.2, label: 'Distract Haskins', icon: 'talk', priority: 2,
      enabled: () => this.flags.phase === 'workshop' && !this.flags.distracting && !this.flags.tool,
      onUse: () => g.session.request('distract', {}),
    });
    I.add({
      id: 'pick_cage', who: 'elias', pos: v3(-3.75, 0, -29.0), radius: 1.2, label: 'Pick the cage lock', icon: 'tool', mode: 'hold', holdTime: 3.2, pose: 'use', poseCtx: { k: { height: 1.1 } }, facing: Math.PI / 2,
      enabled: () => this.flags.phase === 'workshop' && !this.flags.cageOpen,
      onUse: () => g.session.request('cageOpen', {}),
    });
    I.add({
      id: 'take_tool', who: 'elias', pos: v3(0.2, 0, -30.4), radius: 1.3, label: 'Take the screwdriver', icon: 'hand', facing: Math.PI,
      enabled: () => this.flags.phase === 'workshop' && !!this.flags.cageOpen && !this.flags.tool,
      onUse: () => { g.local.body.setPose('pick_low', {}, { restart: true }); g.session.request('takeTool', {}); },
    });
    // Laundry: boost (Jax gives, Elias climbs) then Elias pulls Jax up.
    I.add({ id: 'boost_give', who: 'jax', coop: 'boost', role: 'giver', pos: v3(15.6, 0, -27.75), radius: 1.3, label: 'Give Elias a boost', icon: 'coop', mode: 'hold', pose: 'boost_give', facing: 0, stand: v3(15.6, 0, -27.75),
      enabled: () => this.flags.phase === 'laundry' && !this.flags.eliasUp });
    I.add({ id: 'boost_climb', who: 'elias', coop: 'boost', role: 'climber', pos: v3(15.6, 0, -28.4), radius: 1.6, label: 'Climb up (needs a boost)', icon: 'climb', mode: 'hold', facing: 0, stand: v3(15.6, 0, -28.5),
      enabled: () => this.flags.phase === 'laundry' && !this.flags.eliasUp });
    I.add({ id: 'pull_give', who: 'elias', coop: 'pull', role: 'puller', pos: v3(15.2, 2.6, -25.8), radius: 1.4, label: 'Pull Jax up', icon: 'coop', mode: 'hold', facing: Math.PI, pose: 'revive',
      enabled: () => !!this.flags.eliasUp && !this.flags.jaxUp });
    I.add({ id: 'pull_climb', who: 'jax', coop: 'pull', role: 'climber', pos: v3(15.6, 0, -27.75), radius: 1.5, label: 'Grab Elias\'s hand', icon: 'climb', mode: 'hold', facing: 0,
      enabled: () => !!this.flags.eliasUp && !this.flags.jaxUp });
    I.add({ id: 'ladder_down', pos: v3(15.2, 2.6, -21.7), radius: 1.0, label: 'Climb down the ladder', icon: 'climb',
      enabled: () => !!this.flags.jaxUp, onUse: () => this.climbDown() });
    I.add({ id: 'vent_c17', pos: v3(14.6, 0, -8.65), radius: 1.1, label: 'Squeeze through the loose vent', icon: 'climb',
      enabled: () => this.flags.phase === 'chase', onUse: () => this.squeezeVent() });
  }

  private climbDown(): void {
    const g = this.g;
    const b = g.local.body;
    if (b.pos.y < 1) return;
    g.local.crawlMode = false;
    g.local.runScript([
      { to: v3(15.2, 2.6, -21.55), dur: 0.4, yaw: Math.PI },
      { to: v3(15.2, 0, -21.55), dur: 1.6, yaw: Math.PI, pose: 'climb', poseCtx: { points: { ledge: v3(15.2, 2.4, -21.3) }, k: { phase: 0.5 } } },
      { to: v3(15.2, 0, -20.5), dur: 0.6, anim: 1.2 },
    ]);
    g.audio.play('metal_hit', { pos: b.pos, volume: 0.4 });
  }

  private squeezeVent(): void {
    const g = this.g;
    g.local.runScript([
      { to: v3(14.45, 0, -8.65), dur: 0.4, yaw: -Math.PI / 2 },
      { to: v3(13.5, 0, -8.65), dur: 1.6, yaw: -Math.PI / 2, pose: 'crawl', poseCtx: { k: { speed: 0.6 } }, anim: 0.6 },
      { to: v3(12.6, 0, -8.4), dur: 0.8, yaw: -Math.PI / 2, anim: 1 },
    ], () => g.session.request('throughVent', { who: g.localChar }));
    g.audio.play('vent_crawl', { pos: v3(14.1, 0.4, -8.65), volume: 0.6 });
    g.audio.play('metal_sheet', { pos: v3(14.1, 0.4, -8.65), volume: 0.4, delay: 0.5 });
  }

  // ---------------------------------------------------------------- triggers
  private buildTriggers(): void {
    this.addTrigger({ id: 'yard_both', min: [-18, -1, 10.5], max: [20, 3, 40], who: 'both', enabled: () => this.flags.phase === 'morning' });
    this.addTrigger({ id: 'yard_any', min: [-18, -1, 7], max: [20, 3, 40], who: 'any', enabled: () => this.flags.phase === 'morning' });
    this.addTrigger({ id: 'laundry_enter', min: [1.7, -1, -42], max: [20, 3, -26.2], who: 'any', enabled: () => this.flags.phase === 'workshop' && !!this.flags.tool });
    this.addTrigger({ id: 'duct_both', min: [14.6, 2.3, -26.4], max: [15.8, 3.7, -21.3], who: 'both', enabled: () => this.flags.phase === 'laundry' });
    this.addTrigger({ id: 'chase_any', min: [14.3, -1, -21], max: [16.1, 3, -4.2], who: 'any', enabled: () => this.flags.phase === 'laundry' });
    this.addTrigger({ id: 'shop_exit_tool', min: [-8.2, -1, -26.4], max: [-6.3, 3, -24.6], who: 'elias', once: false, enabled: () => this.flags.phase === 'workshop' && !!this.flags.tool });
  }

  // ---------------------------------------------------------------- cutscenes
  private buildCutscenes(): void {
    const g = this.g;
    const C = this.cutscenes;
    const c16 = () => this.P.cell('C-16');
    const c17 = () => this.P.cell('C-17');
    C.cs_arrival = {
      id: 'cs_arrival', music: 'music_theme',
      start: () => {
        this.setDoorNow('gate', 1);
        placeChar(g, 'jax', v3(0, 0, -24.6), 0);
        placeChar(g, 'elias', v3(11.0, 0, -10.6), SIDE_OUT);
        npcPlace(g, 'vance', v3(0.9, 0, -25.4), 0);
        g.npcs.get('vance')!.setState('scripted');
        clipChar(g, 'elias', 'docs_idle');
        g.audio.play('buzzer', { pos: v3(0, 3, -22), volume: 0.5 });
      },
      beats: [
        { dur: 5.5, shot: () => shot(v3(-8.8, 7.2, 3), v3(0, 1.2, -19), 5.5, { toEnd: v3(2.5, 1.2, -15), fov: 48 }),
          run: () => { walkChar(g, 'jax', [v3(0, 0, -21), v3(3, 0, -16), v3(8.6, 0, -9.6)], 1.15); npcWalk(g, 'vance', v3(8.2, 0, -11.2), 1.2); },
          lines: [{ who: 'inm_a', text: 'Fresh fish on the floor!', dur: 2 }, { who: 'inm_b', text: 'Look at the shoes on this one!', dur: 2.2 }] },
        { dur: 4.2, shot: () => closeUp(g, 'elias', 4.2, 1.1, -0.35, { fov: 32 }), run: () => lookChar(g, 'elias', v3(4, 1.6, -14)) },
        { dur: 4.5, shot: () => shot(v3(6.2, 1.7, -6.0), v3(9.0, 1.4, -9.4), 4.5, { fov: 40, fromEnd: v3(6.6, 1.65, -7.0) }),
          lines: [{ who: 'vance', text: 'C-17, Rourke. Your new address.' }, { who: 'jax', text: 'Smaller than the brochure.' }] },
        { dur: 3.6, shot: () => shot(v3(8.3, 1.5, -8.0), v3(11.5, 1.3, -8.2), 3.6, { fov: 44 }),
          run: () => { walkChar(g, 'jax', [v3(10.0, 0, -8.2), v3(11.8, 0, -8.4)], 1.0); this.door('C-17', false); },
          lines: [{ who: 'vance', text: 'Inside. And behave, Rourke. You know the deal.', dur: 3.2 }] },
        { shot: () => shot(v3(9.6, 1.55, -9.3), v3(11.0, 1.5, -9.0), 9, { fov: 38 }),
          run: () => { run(g, 'jax', [{ to: v3(11.0, 0, -7.9), dur: 1.2, anim: 0.8 }, { to: v3(11.0, 0, -7.9), dur: 0.4, yaw: Math.PI }]); clipChar(g, 'elias', null); lookChar(g, 'elias', null); npcWalk(g, 'vance', v3(9.6, 0, -16), 1.2); },
          lines: [
            { who: 'jax', text: 'Hey. Neighbour. What are you in for?', anim: 'talk' },
            { who: 'elias', text: 'Reading.' },
            { who: 'jax', text: 'Huh. They hand out life for that now?', anim: 'laugh' },
            { who: 'elias', text: 'Only if you\'re bad at it.' },
          ] },
        { dur: 2.5, fade: 'out', shot: () => shot(v3(0, 6, -2), v3(0, 2, -12), 2.5, { fov: 50 }) },
      ],
      end: () => {
        this.setDoorNow('gate', 0);
        for (const c of ['C-16', 'C-17']) this.setDoorNow(c, 0);
        placeChar(g, 'elias', c16().center.clone(), SIDE_OUT);
        placeChar(g, 'jax', c17().center.clone(), SIDE_OUT);
        clipChar(g, 'elias', null);
        g.npcs.get('vance')?.release();
        if (this.authority) {
          this.g.session.emit('morning', {});
        }
      },
    };
    C.cs_brick = {
      id: 'cs_brick',
      start: () => {
        placeChar(g, 'jax', v3(7.6, 0, 13.2), 0.2);
        placeChar(g, 'elias', v3(2.5, 0, 11.4), 0.6);
        npcPlace(g, 'brick', v3(8.2, 0, 15.0), Math.PI + 0.2);
        npcPlace(g, 'brick_a', v3(6.4, 0, 16.4), Math.PI - 0.4);
        npcPlace(g, 'brick_b', v3(10.0, 0, 15.8), Math.PI + 0.6);
        for (const id of ['brick', 'brick_a', 'brick_b']) npcClip(g, id, null);
      },
      beats: [
        { shot: () => ots(g, 'jax', 'brick', 8, 1), lines: [
          { who: 'brick', text: 'That\'s my bench you\'re breathing on, fish.' },
          { who: 'jax', text: 'Didn\'t see your name on it.', anim: 'talk_cool' },
          { who: 'brick', text: 'You\'re about to. Carved in your forehead.' },
        ] },
        { shot: () => closeUp(g, 'jax', 3, 1.0, 0.3), lines: [{ who: 'jax', text: 'Three of you. That seems fair.', anim: 'shrug' }] },
        { dur: 2.0, shot: () => twoShot(g, 'jax', 'brick', 2, 3.4, 1.3), run: () => g.audio.play('crowd_cheer', { pos: v3(0, 1, 20), volume: 0.7 }) },
      ],
      end: () => {
        if (this.authority) g.session.emit('fightStart', {});
      },
    };
    C.cs_afterfight = {
      id: 'cs_afterfight', music: 'music_explore',
      start: () => {
        this.g.flags.combat = false;
        placeChar(g, 'jax', v3(12.3, 0, 40.0), Math.PI);
        placeChar(g, 'elias', v3(13.2, 0, 39.8), Math.PI + 0.3);
        g.audio.play('bell', { volume: 0.5 });
      },
      beats: [
        { dur: 3, shot: () => shot(v3(5, 1.3, 30), v3(12.6, 1.5, 39.6), 3, { fov: 35, fromEnd: v3(7, 1.4, 33) }),
          lines: [{ who: 'yardguard', text: 'Show\'s over! Everybody back on the wall!', dur: 2.6 }] },
        { shot: () => twoShot(g, 'jax', 'elias', 30, 2.4, 1.5, -1), lines: [
          { who: 'jax', text: 'You didn\'t have to jump in.', anim: 'talk' },
          { who: 'elias', text: 'I know. You went down twice and got up twice. That\'s rare in here.', look: 'jax' },
          { who: 'jax', text: 'Is that a compliment, professor?' },
          { who: 'elias', text: 'It\'s an observation. Six years, I\'ve watched this place breathe. Shifts, counts, deliveries. Who sleeps on the night watch.', anim: 'thoughtful' },
          { who: 'jax', text: 'And?' },
          { who: 'elias', text: 'And there\'s a way out under the east wing. It needs two people who can keep their nerve. I\'ve had one for a long time.', look: 'jax' },
          { who: 'jax', text: 'Why would you trust me? You met me yesterday.', anim: 'shrug' },
          { who: 'elias', text: 'I don\'t trust anyone. But I can use someone who doesn\'t stay down.' },
          { who: 'jax', text: '...What do you need?', anim: 'listen' },
          { who: 'elias', text: 'A screwdriver. Haskins keeps the tool cage in the workshop like it\'s his firstborn. Work detail is this afternoon.' },
          { who: 'jax', text: 'Then I guess I\'m about to make a new friend.', anim: 'laugh' },
        ] },
        { dur: 2.4, fade: 'out', shot: () => shot(v3(12.8, 4.5, 30), v3(12.8, 2, 40), 2.4, { fov: 45 }) },
      ],
      end: () => {
        if (this.authority) {
          this.g.session.emit('toWorkshop', {});
        }
      },
    };
    C.cs_workshop = {
      id: 'cs_workshop',
      start: () => { g.hud.showTitle('Afternoon', 'Work detail'); this.setDoorNow('workshop', 1); },
      beats: [
        { dur: 4.5, shot: () => shot(v3(-14.8, 3.6, -40.5), v3(-4, 1.2, -29.5), 4.5, { fov: 46, fromEnd: v3(-13.5, 3.2, -38.5) }),
          lines: [{ who: 'elias', text: 'Haskins never leaves that cage unwatched. You talk, I work.', dur: 3.8 }] },
        { dur: 3.0, shot: () => shot(v3(-4.2, 1.6, -27.6), v3(0.3, 1.0, -30.8), 3, { fov: 34 }), lines: [{ who: 'jax', text: 'Talking. I can do talking.', dur: 2.4 }] },
      ],
      end: () => { /* gameplay */ },
    };
    C.cs_count = {
      id: 'cs_count',
      start: () => {
        g.audio.play('bell', { volume: 0.7 });
        g.audio.play('buzzer', { pos: v3(0, 4, -12), volume: 0.6 });
      },
      beats: [
        { dur: 4.2, shot: () => shot(v3(-6, 5.5, -2), v3(9.5, 1.2, -16), 4.2, { fov: 48 }),
          run: () => { npcPlace(g, 'pruitt', v3(9.6, 0, -19.2), 0); g.npcs.get('pruitt')!.setState('scripted'); },
          lines: [{ who: 'pruitt', text: 'COUNT! Every inmate in his cell! Doors close in two minutes!', dur: 3.6 }] },
        { dur: 4, shot: () => closeUp(g, 'jax', 4, 0.9, 0.3), lines: [{ who: 'jax', text: 'Your cell\'s next door. Go — Vance is on the catwalk.', dur: 3.5 }] },
      ],
      end: () => { if (this.authority) g.session.emit('countStart', {}); },
    };
    C.cs_night = {
      id: 'cs_night', music: 'music_sad',
      start: () => {
        for (const c of this.P.cells) this.setDoorNow(c.id, 0);
        placeChar(g, 'elias', v3(13.3, 0, -10.0), Math.PI / 2 + 0.3);
        placeChar(g, 'jax', v3(13.3, 0, -9.0), Math.PI / 2 + 2.8);
        poseChar(g, 'elias', 'sit_ground');
        poseChar(g, 'jax', 'sit_ground');
        for (const f of this.P.kit.fixtures) if (f.zone === 'dayroom' || f.zone === 'catwalk') f.on = false;
        g.world.sun!.intensity = 0.25;
      },
      beats: [
        { dur: 4, shot: () => shot(v3(0, 6, -4), v3(10, 1, -10), 4, { fov: 50, fromEnd: v3(4, 4.5, -7) }), lines: [{ who: 'pruitt', text: 'Lights out, C block.', dur: 2 }] },
        { shot: () => shot(v3(12.6, 0.9, -9.6), v3(13.5, 0.6, -9.6), 40, { fov: 40 }), lines: [
          { who: 'jax', text: 'You awake?', pause: 1 },
          { who: 'elias', text: 'I don\'t sleep much.' },
          { who: 'jax', text: 'So that\'s the plan. Screwdriver, vent, chase. Then what?' },
          { who: 'elias', text: 'The chase drops into the maintenance tunnels. From there, the yard. From the yard, the river.' },
          { who: 'jax', text: 'You make it sound like a bus route.', pause: 0.5 },
          { who: 'elias', text: 'I\'ve walked it in my head every night for two years.' },
          { who: 'jax', text: 'Why now? What changed?' },
          { who: 'elias', text: 'A man named Victor Crane is getting out of a courtroom next month. He bought himself a jury.', pause: 1 },
          { who: 'jax', text: '...Crane.', pause: 1.5 },
          { who: 'elias', text: 'You know the name.' },
          { who: 'jax', text: 'Everybody downtown knows the name. Get some sleep, professor. Tomorrow night, right?' },
          { who: 'elias', text: 'Tomorrow night. Two a.m., when the shift changes.' },
        ] },
        { dur: 3, fade: 'out', shot: () => shot(v3(12.6, 0.9, -9.6), v3(13.5, 0.6, -9.6), 3, { fov: 36 }) },
      ],
      end: () => { if (this.authority) g.session.emit('chapterEnd', { next: 2 }); },
      skippable: true,
    };
  }

  private setDoorNow(id: string, t: number): void {
    const d = this.doors.get(id);
    if (!d) return;
    d.t = d.target = t;
    this.applyDoor(d);
  }

  // ---------------------------------------------------------------- checkpoints
  setupCheckpoint(id: string): void {
    const g = this.g;
    g.flags.combat = false;
    g.local.crawlMode = false;
    for (const c of this.P.cells) this.setDoorNow(c.id, 0);
    for (const k of ['gate', 'yard', 'workshop', 'laundry', 'cage', 'shop_laundry', 'chase']) this.setDoorNow(k, 0);
    this.P.screwdriver.visible = !this.flags.tool;
    const zone = (ids: string[], on: boolean) => { for (const i of ids) { const n = g.npcs.get(i); if (n) { n.enabled = on; n.body.visible = on; n.body.solid = on; } } };
    const all = [...g.npcs.keys()];
    zone(all, false);
    const dayroom = ['pruitt', 'vance', 'mo', 'inm_a', 'inm_b', 'inm_c', 'inm_d'];
    const yard = ['yardguard', 'brick', 'brick_a', 'brick_b', 'yd_a', 'yd_b', 'yd_c'];
    const shop = ['haskins', 'ws_a', 'ws_b', 'okafor', 'ld_a', 'ld_b'];
    for (const n of g.npcs.values()) { n.reset(); n.hostile = !!n.def.hostile; }
    const setPassive = (ids: string[], v: boolean) => { for (const i of ids) { const d = this.npcDefs.find((x) => x.id === i); if (d) d.passive = v; } };
    setPassive(['pruitt', 'vance', 'haskins', 'okafor'], true);
    switch (id) {
      case 'arrival':
        this.flags.phase = 'arrival';
        zone(dayroom, true);
        break;
      case 'morning':
        this.flags.phase = 'morning';
        zone([...dayroom, ...yard], true);
        for (const c of this.P.cells) this.setDoorNow(c.id, 1);
        this.setDoorNow('yard', 1);
        break;
      case 'yard':
        this.flags.phase = 'morning';
        zone([...dayroom, ...yard], true);
        this.setDoorNow('yard', 1);
        for (const c of this.P.cells) this.setDoorNow(c.id, 1);
        break;
      case 'workshop':
        this.flags.phase = 'workshop';
        delete this.flags.distracting;
        delete this.flags.cageOpen;
        zone(shop, true);
        setPassive(['haskins', 'okafor'], false);
        this.setDoorNow('shop_laundry', 1);
        this.setDoorNow('workshop', 0);
        break;
      case 'laundry':
        this.flags.phase = 'laundry';
        this.flags.tool = true;
        this.P.screwdriver.visible = false;
        zone(shop, true);
        setPassive(['okafor'], false);
        this.setDoorNow('shop_laundry', 1);
        delete this.flags.eliasUp;
        delete this.flags.jaxUp;
        break;
      case 'count':
        this.flags.phase = 'count';
        zone(['pruitt', 'vance', 'inm_d'], true);
        for (const c of this.P.cells) this.setDoorNow(c.id, 1);
        setPassive(['vance'], false);
        break;
    }
    g.flags.jump = false;
  }

  // ---------------------------------------------------------------- events
  onEvent(type: string, args: unknown): boolean {
    const g = this.g;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'morning':
        g.hud.showTitle('Next morning', 'Redmoor State Correctional Facility');
        g.audio.play('bell', { volume: 0.6 });
        g.audio.play('buzzer', { pos: v3(0, 4, -12), volume: 0.5 });
        this.flags.phase = 'morning';
        this.setupCheckpoint('morning');
        for (const c of this.P.cells) { const d = this.doors.get(c.id)!; d.t = 0; d.target = 1; }
        this.setDoorNow('yard', 0);
        this.doors.get('yard')!.target = 1;
        if (this.authority) {
          this.saveCheckpoint('morning');
          this.objective('Morning recreation — head out to the yard', [0, 1.5, 8]);
          setTimeout(() => this.say('arm_hint'), 9000);
        }
        return true;
      case 'talk': {
        const lines = this.dialogues[String(a.dlg)];
        if (lines) g.dialogue.play(lines);
        const npc = g.npcs.get(String(a.npc));
        if (npc) {
          const who = g.body(a.who as CharacterId);
          npc.body.model.lookTarget = who.head();
          setTimeout(() => { npc.body.model.lookTarget = null; }, 8000);
          who.model.lookTarget = npc.body.head();
          setTimeout(() => { who.model.lookTarget = null; }, 6000);
        }
        return true;
      }
      case 'distract': {
        this.flags.distracting = true;
        g.dialogue.play(this.dialogues.distract, () => {
          if (this.authority) g.session.emit('distractEnd', {});
        });
        const has = g.npcs.get('haskins')!;
        npcWalk(g, 'haskins', v3(-7.0, 0, -40.6), 1.0, Math.PI);
        if (g.isLocal('jax')) g.local.runScript([{ to: v3(-6.2, 0, -39.4), dur: 4.2, anim: 1.1, ease: 'linear' }, { to: v3(-6.2, 0, -39.4), dur: 0.3, yaw: Math.PI + 0.4 }]);
        has.body.model.lookTarget = null;
        return true;
      }
      case 'distractEnd': {
        delete this.flags.distracting;
        const has = g.npcs.get('haskins')!;
        npcWalk(g, 'haskins', v3(-5.9, 0, -28.6), 1.1, Math.PI / 2 + 0.3, () => has.release());
        return true;
      }
      case 'cageOpen':
        this.flags.cageOpen = true;
        this.doors.get('cage')!.target = 1;
        g.audio.play('lock_open', { pos: v3(-3.5, 1.1, -29), volume: 0.7 });
        return true;
      case 'takeTool':
        this.flags.tool = true;
        this.P.screwdriver.visible = false;
        g.audio.play('tools', { pos: v3(0.2, 1, -30.8), volume: 0.6 });
        if (this.authority) {
          this.say('got_tool');
          this.objective('The metal detector will find the screwdriver — slip through the laundry instead', [3, 1.5, -34.2]);
        }
        return true;
      case 'flag':
        return true;
      case 'fightStart':
        g.flags.combat = true;
        for (const id of ['brick', 'brick_a', 'brick_b']) {
          const n = g.npcs.get(id)!;
          n.hostile = true;
          const d = this.npcDefs.find((x) => x.id === id)!;
          d.passive = false;
          n.awareness.jax = n.awareness.elias = 1;
          n.target = id === 'brick_a' ? 'elias' : 'jax';
          n.setState('combat');
        }
        if (this.authority) {
          this.objective('Fight off Brick\'s crew');
          this.say('fight_tip');
        }
        g.audio.playMusic('music_action', 1);
        return true;
      case 'ko': {
        if (!this.authority) return true;
        const crew = ['brick', 'brick_a', 'brick_b'].map((i) => g.npcs.get(i)!);
        if (this.flags.phase === 'morning' && g.flags.combat && crew.every((n) => !n.alive)) {
          setTimeout(() => this.cutscene('cs_afterfight'), 1800);
        }
        return true;
      }
      case 'toWorkshop':
        this.saveCheckpoint('workshop');
        g.session.emit('restart', { checkpoint: 'workshop' });
        setTimeout(() => this.cutscene('cs_workshop'), 300);
        return true;
      case 'throughVent': {
        this.flags[`vent_${a.who}`] = true;
        if (this.flags.vent_elias && this.flags.vent_jax && this.authority) {
          this.saveCheckpoint('count');
          g.session.emit('restart', { checkpoint: 'count' });
          setTimeout(() => this.cutscene('cs_count'), 300);
        }
        return true;
      }
      case 'countStart': {
        this.flags.counting = 1;
        const pr = g.npcs.get('pruitt')!;
        pr.setState('scripted');
        this.countStep = 0;
        this.countT = 0;
        if (this.authority) g.audio.play('keys', { pos: pr.body.pos, volume: 0.5 });
        return true;
      }
      case 'countDone':
        this.flags.counting = 0;
        for (const c of this.P.cells) this.doors.get(c.id)!.target = 0;
        g.audio.play('buzzer', { pos: v3(0, 4, -12), volume: 0.6 });
        if (this.authority) setTimeout(() => this.cutscene('cs_night'), 2500);
        return true;
      case 'coop': {
        const group = String(a.group);
        if (group === 'boost') this.doBoost();
        if (group === 'pull') this.doPull();
        return true;
      }
      case 'spotted': {
        // In these stealth sections being fully spotted ends the attempt (after a short shout).
        if (this.authority && ['workshop', 'laundry', 'count'].includes(String(this.flags.phase))) {
          const who = a.who as CharacterId;
          setTimeout(() => { if (g.state === 'playing') g.session.emit('caught', { who, by: a.npc }); }, 900);
        }
        return true;
      }
      case 'restarted': {
        const cp = String(a.checkpoint);
        if (this.authority && cp === 'count') setTimeout(() => g.session.emit('countStart', {}), 2500);
        if (this.authority && cp === 'laundry') this.objective('Reach the air duct above the laundry shelves — don\'t let Okafor see you', [16.4, 2.4, -26.8]);
        if (this.authority && cp === 'workshop') this.objective('Steal a screwdriver from Haskins\' tool cage', [-3.6, 1.2, -29]);
        return true;
      }
    }
    return false;
  }

  private countStep = 0;
  private countT = 0;

  private doBoost(): void {
    const g = this.g;
    this.flags.eliasUp = true;
    g.audio.play('grunt', { pos: v3(15.6, 1, -27.7), volume: 0.5 });
    const ledge = v3(15.2, 2.65, -26.2);
    const climb: ScriptStep[] = [
      { to: v3(15.6, 0, -28.2), dur: 0.35, yaw: 0 },
      { to: v3(15.5, 0.75, -27.9), dur: 0.7, yaw: 0, pose: 'climb', poseCtx: { points: { ledge }, k: { phase: 0.2 } } },
      { to: v3(15.3, 1.9, -27.2), dur: 0.9, yaw: 0, pose: 'climb', poseCtx: (t: number) => ({ points: { ledge }, k: { phase: 0.3 + t * 0.6 } }) },
      { to: v3(15.2, 2.62, -26.0), dur: 0.8, yaw: 0, pose: 'crawl', poseCtx: { k: { speed: 0.5 } }, anim: 0.4 },
      { to: v3(15.2, 2.62, -25.6), dur: 0.5, yaw: Math.PI, pose: 'crawl', poseCtx: { k: { speed: 0.3 } } },
    ];
    run(g, 'elias', climb, () => { if (g.isLocal('elias')) g.local.crawlMode = true; });
    const jaxPose = (k: number) => ({ k: { lift: k } });
    run(g, 'jax', [
      { to: v3(15.6, 0, -27.75), dur: 0.6, yaw: 0, pose: 'boost_give', poseCtx: jaxPose(0) },
      { to: v3(15.6, 0, -27.75), dur: 1.0, yaw: 0, pose: 'boost_give', poseCtx: (t: number) => jaxPose(t) },
      { to: v3(15.6, 0, -27.75), dur: 0.5, yaw: 0 },
    ]);
  }

  private doPull(): void {
    const g = this.g;
    this.flags.jaxUp = true;
    g.audio.play('grunt', { pos: v3(15.4, 2, -26.5), volume: 0.5 });
    const ledge = v3(15.2, 2.65, -26.2);
    run(g, 'jax', [
      { to: v3(15.5, 0.6, -27.4), dur: 0.6, yaw: 0, pose: 'climb', poseCtx: { points: { ledge }, k: { phase: 0.1 } } },
      { to: v3(15.3, 1.95, -26.9), dur: 1.3, yaw: 0, pose: 'climb', poseCtx: (t: number) => ({ points: { ledge }, k: { phase: 0.2 + t * 0.7 } }) },
      { to: v3(15.2, 2.62, -25.8), dur: 0.8, yaw: 0, pose: 'crawl', poseCtx: { k: { speed: 0.5 } }, anim: 0.4 },
    ], () => { if (g.isLocal('jax')) g.local.crawlMode = true; });
    run(g, 'elias', [{ to: v3(15.2, 2.62, -24.6), dur: 1.4, yaw: Math.PI, pose: 'crawl', poseCtx: { k: { speed: 0.6 } }, anim: 0.6 }], () => { if (g.isLocal('elias')) g.local.crawlMode = true; });
  }

  onTrigger(id: string, who: CharacterId | 'both'): void {
    const g = this.g;
    switch (id) {
      case 'yard_any':
        if (this.authority) this.say('yard_hint');
        break;
      case 'yard_both':
        if (this.authority) {
          this.saveCheckpoint('yard');
          this.cutscene('cs_brick');
        }
        break;
      case 'laundry_enter':
        if (this.authority) {
          this.saveCheckpoint('laundry');
          this.say('laundry_in');
          this.objective('Reach the air duct above the laundry shelves — don\'t let Okafor see you', [16.4, 2.4, -26.8]);
          g.session.emit('flag', { k: 'phase', v: 'laundry' });
          setTimeout(() => this.setupLaundryLive(), 50);
        }
        break;
      case 'duct_both':
        if (this.authority) {
          this.say('in_duct');
          this.objective('Crawl through the duct and climb down into the chase', [15.2, 1.5, -21.3]);
        }
        break;
      case 'chase_any':
        if (this.authority) {
          g.session.emit('flag', { k: 'phase', v: 'chase' });
          this.say('in_chase');
          this.objective('Find the loose vent behind Jax\'s cell (C-17)', [14.4, 0.6, -8.65]);
        }
        break;
      case 'shop_exit_tool':
        if (this.authority && !this.flags.warnedDetector) {
          g.session.emit('flag', { k: 'warnedDetector', v: true });
          g.session.emit('dlg', { lines: [{ who: 'jax', text: 'Not that way — the detector will light up like Christmas.', dur: 3 } satisfies Line], at: g.session.sharedNow() });
        }
        break;
    }
    void who;
  }

  private setupLaundryLive(): void {
    const d = this.npcDefs.find((x) => x.id === 'okafor');
    if (d) d.passive = false;
  }

  validate(type: string, _args: unknown, _from: 'local' | 'peer'): boolean {
    if (type === 'distract') return this.flags.phase === 'workshop' && !this.flags.distracting;
    if (type === 'cageOpen') return this.flags.phase === 'workshop' && !this.flags.cageOpen;
    if (type === 'takeTool') return !!this.flags.cageOpen && !this.flags.tool;
    return true;
  }

  update(dt: number): void {
    const g = this.g;
    // Crawl mode inside the duct volume.
    const lp = g.local.body.pos;
    const inDuct = lp.x > 14.6 && lp.x < 15.8 && lp.y > 2.3 && lp.z > -26.5 && lp.z < -21.3;
    if (!g.local.scripted) g.local.crawlMode = inDuct;
    // Haskins faces the cage area when idle; when distracted he's away at the window.
    if (!this.authority) return;
    if (this.flags.counting) this.updateCount(dt);
  }

  private updateCount(dt: number): void {
    const g = this.g;
    const pr = g.npcs.get('pruitt')!;
    const stops = ['C-13', 'C-14', 'C-15', 'C-16', 'C-17', 'C-18'].map((id) => this.P.cell(id));
    const cur = stops[this.countStep];
    if (!cur) {
      this.flags.counting = 0;
      g.session.emit('countDone', {});
      return;
    }
    const target = v3(9.2, 0, cur.front.z);
    if (pr.body.pos.distanceTo(target) > 0.4) {
      if (pr.state !== 'scripted' || !pr.scriptTarget || pr.scriptTarget.distanceTo(target) > 0.1) pr.walkTo(target, 1.0, undefined, Math.PI / 2);
      return;
    }
    pr.body.yaw = THREE.MathUtils.lerp(pr.body.yaw, Math.PI / 2, dt * 4);
    this.countT += dt;
    if (this.countT > 2.2) {
      // Check that the right inmate is inside the cell being counted.
      const inside = (c: CharacterId, cell: typeof cur) => {
        const p = g.body(c).pos;
        return p.x > 10.6 && Math.abs(p.z - cell.center.z) < 1.2;
      };
      if (cur.id === 'C-16' && !inside('elias', cur)) { g.session.emit('caught', { who: 'elias', by: 'pruitt' }); return; }
      if (cur.id === 'C-17' && !inside('jax', cur)) { g.session.emit('caught', { who: 'jax', by: 'pruitt' }); return; }
      if (cur.id === 'C-16' || cur.id === 'C-17') g.session.emit('dlg', { lines: [{ who: 'pruitt', text: cur.id === 'C-16' ? 'Varga. Sixteen.' : 'Rourke. Seventeen.', dur: 1.6 }], at: g.session.sharedNow() });
      this.countT = 0;
      this.countStep++;
    }
  }

  suspicion(who: CharacterId, p: THREE.Vector3, npc: string): number {
    const ph = this.flags.phase;
    if (ph === 'workshop' && npc === 'haskins') {
      const inCage = p.x > -3.5 && p.x < 1.3 && p.z > -31.5 && p.z < -27.2;
      const atDoor = Math.hypot(p.x + 3.7, p.z + 29) < 1.3 && this.g.body(who).poseName === 'use';
      return inCage ? 1.6 : atDoor ? 1.2 : 0;
    }
    if (ph === 'laundry' || ph === 'workshop') {
      const nearShelf = p.x > 14 && p.z > -28.6;
      return p.y > 0.5 || nearShelf ? 1.3 : 0;
    }
    if (ph === 'count' && this.flags.counting) return p.x < 10.5 && p.y < 1 ? 1.4 : 0;
    return 0;
  }

  lightAt(p: THREE.Vector3): number {
    // Inside cells and the chase it is darker; the duct is very dark.
    if (p.x > 14.3) return 0.35;
    return this.P.kit.lightLevel(p, 0.45);
  }
}
