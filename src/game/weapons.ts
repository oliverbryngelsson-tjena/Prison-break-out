// Weapon stats and how each one is held. Pure data (shared by the game and the model tools).
//
// Hit model: every bullet rolls against its spread at the target's distance, so an SMG that fires
// fast but wide hits less often per bullet the further away you are; a sniper almost never misses.

export type WeaponId = 'pistol' | 'smg' | 'suomi' | 'ak47' | 'm4' | 'shotgun' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** One-line description for the shop. */
  blurb: string;
  /** Damage per bullet (per pellet for shotguns). */
  dmg: number;
  /** Seconds between shots. */
  rate: number;
  /** Hold the trigger to keep firing. */
  auto: boolean;
  mag: number;
  reload: number;
  /** Bullets per shot (shotgun pellets). */
  pellets: number;
  /** Cone half-angle in radians for the first shot, and how much each shot in a burst adds. */
  spread: number;
  bloom: number;
  /** Max useful range (m). */
  range: number;
  /** Camera kick per shot. */
  kick: number;
  /** Gunshot sound: pitch, low-pass cutoff, loudness. */
  sound: { rate: number; cutoff: number; volume: number; tail: number };
  /** Two-handed long gun (rifle hold) or pistol. */
  long: boolean;
  /** Real overall length (m) of the model. */
  length: number;
  /** Where the hands go, in the model's frame (rear at z = 0, barrel along +Z, bore at y = 0), metres. */
  grip: [number, number];
  fore: [number, number];
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'Makarov PM', blurb: 'Light and accurate. Fires as fast as you can tap.',
    dmg: 30, rate: 0.28, auto: false, mag: 15, reload: 1.3, pellets: 1, spread: 0.012, bloom: 0.006, range: 32, kick: 0.07,
    sound: { rate: 1.1, cutoff: 6500, volume: 0.85, tail: 0.6 }, long: false, length: 0.168, grip: [0.025, -0.06], fore: [0.03, -0.065],
  },
  smg: {
    id: 'smg', name: 'M3 Grease Gun', blurb: 'Submachine gun. Sprays bullets fast — deadly up close, wild at range.',
    dmg: 14, rate: 0.075, auto: true, mag: 30, reload: 1.9, pellets: 1, spread: 0.035, bloom: 0.012, range: 26, kick: 0.045,
    sound: { rate: 1.25, cutoff: 5000, volume: 0.65, tail: 0.4 }, long: true, length: 0.627, grip: [0.12, -0.06], fore: [0.37, -0.07],
  },
  suomi: {
    id: 'suomi', name: 'Suomi KP/-31', blurb: 'Drum-fed SMG. 70 rounds and a ridiculous fire rate. Hold on tight.',
    dmg: 12, rate: 0.065, auto: true, mag: 70, reload: 2.9, pellets: 1, spread: 0.04, bloom: 0.014, range: 24, kick: 0.04,
    sound: { rate: 1.35, cutoff: 4800, volume: 0.6, tail: 0.35 }, long: true, length: 0.875, grip: [0.36, -0.035], fore: [0.6, -0.02],
  },
  ak47: {
    id: 'ak47', name: 'AK-47', blurb: 'Assault rifle. Hits hard, kicks hard. Burst it.',
    dmg: 26, rate: 0.1, auto: true, mag: 30, reload: 2.3, pellets: 1, spread: 0.022, bloom: 0.011, range: 40, kick: 0.11,
    sound: { rate: 0.85, cutoff: 7000, volume: 1.0, tail: 1.0 }, long: true, length: 0.877, grip: [0.29, -0.07], fore: [0.54, -0.03],
  },
  m4: {
    id: 'm4', name: 'M4A1', blurb: 'Assault rifle. Steady and accurate on full auto.',
    dmg: 22, rate: 0.085, auto: true, mag: 30, reload: 2.0, pellets: 1, spread: 0.014, bloom: 0.006, range: 44, kick: 0.07,
    sound: { rate: 1.0, cutoff: 7500, volume: 0.92, tail: 0.8 }, long: true, length: 0.859, grip: [0.24, -0.065], fore: [0.5, -0.02],
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Shotgun', blurb: 'Eight pellets per shell. Close range only — and then nothing survives.',
    dmg: 13, rate: 0.85, auto: false, mag: 6, reload: 2.8, pellets: 8, spread: 0.09, bloom: 0, range: 16, kick: 0.25,
    sound: { rate: 0.7, cutoff: 4200, volume: 1.15, tail: 1.2 }, long: true, length: 1.219, grip: [0.34, -0.04], fore: [0.8, -0.03],
  },
  sniper: {
    id: 'sniper', name: 'Hunting Rifle', blurb: 'Bolt action. One shot, one drop, from anywhere you can see.',
    dmg: 140, rate: 1.3, auto: false, mag: 5, reload: 2.8, pellets: 1, spread: 0.002, bloom: 0, range: 70, kick: 0.3,
    sound: { rate: 0.75, cutoff: 8000, volume: 1.25, tail: 1.6 }, long: true, length: 1.12, grip: [0.38, -0.05], fore: [0.62, -0.035],
  },
};

export const SHOP: WeaponId[] = ['smg', 'suomi', 'ak47', 'm4', 'shotgun', 'sniper', 'pistol'];

/** Default picks when a chapter is started from the menu without a visit to Dutch. */
export const DEFAULT_LOADOUT: Record<'elias' | 'jax', WeaponId> = { elias: 'm4', jax: 'ak47' };

/** Chance (0..1) that one bullet hits a person-sized target at distance d with this cone. */
export function hitChance(spread: number, d: number): number {
  // A person is ~0.45 m wide: the share of the cone's disc that covers them.
  const r = Math.max(0.05, Math.tan(spread) * d);
  return Math.min(0.97, Math.max(0.03, (0.32 / r) ** 2 > 1 ? 0.97 : (0.32 / r) ** 1.4));
}
