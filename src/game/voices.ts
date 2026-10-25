// Voice cast for the recorded dialogue. Shared by the game and tools/voices.mjs, which records every
// line ahead of time (Kokoro-82M, Apache-2.0), so keep this file free of browser and three.js imports.

export interface VoiceDef {
  /** Kokoro voice id: a = American, b = British; f = female, m = male. */
  v: string;
  /** Base speaking speed (lines are sped up further when needed to fit their time slot). */
  speed?: number;
}

/** Named speakers. Anyone else gets a voice from their role's pool. */
export const CAST: Record<string, VoiceDef> = {
  elias: { v: 'am_michael', speed: 0.96 },
  jax: { v: 'am_fenrir', speed: 1.04 },
  crane: { v: 'bm_george', speed: 0.94 },
  marsh: { v: 'af_kore' },
  mia: { v: 'af_heart' },
  mo: { v: 'bm_lewis', speed: 0.9 },
  narrator: { v: 'bm_fable', speed: 0.95 },
  radio: { v: 'af_nova', speed: 1.08 },
  walt: { v: 'am_echo', speed: 0.92 },
  vance: { v: 'am_onyx' },
  pruitt: { v: 'am_adam' },
  haskins: { v: 'am_liam' },
  yardguard: { v: 'am_eric' },
  towerguard: { v: 'bm_daniel' },
  kessler: { v: 'am_onyx', speed: 0.95 },
  brick: { v: 'am_puck' },
  guard: { v: 'am_adam' },
  inmate: { v: 'am_echo' },
  cop: { v: 'am_eric' },
  thug: { v: 'am_onyx' },
};

export const POOLS: Record<string, string[]> = {
  guard: ['am_adam', 'am_liam', 'am_eric', 'bm_daniel', 'am_onyx'],
  police: ['am_echo', 'am_eric', 'bm_lewis', 'am_adam'],
  thug: ['am_onyx', 'am_puck', 'am_liam', 'bm_daniel'],
  inmate: ['am_puck', 'am_echo', 'bm_lewis', 'am_liam'],
  other: ['am_echo', 'am_liam'],
};

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Voice for a speaker id (NPC ids fall back to their role's pool, picked by id). */
export function voiceFor(id: string, role?: string): VoiceDef {
  const named = CAST[id] ?? CAST[id.replace(/\d+$/, '')];
  if (named) return named;
  const pool = POOLS[role ?? ''] ?? POOLS.other;
  return { v: pool[hash32(id) % pool.length] };
}

/** Stable file key for a recorded line. */
export function voiceKey(voice: string, text: string): string {
  return hash32(voice + '|' + text).toString(36).padStart(7, '0');
}

/** On-screen time of a line (seconds), before any pause. Recordings are fitted to this. */
export function lineDuration(l: { text: string; dur?: number }): number {
  if (l.dur) return l.dur;
  const words = l.text.split(/\s+/).length;
  return Math.max(1.6, words * 0.34 + 0.7);
}

/** Lines the game builds in code (the voice tool reads these directly). */
export const BARKS = {
  suspicious: ['Hm? Who\'s there?', 'What was that?', 'Somebody there?', 'I heard something…'],
  alert: {
    guard: ['Hey! You! Stop right there!', 'Inmate out of bounds!', 'Don\'t move!'],
    police: ['Police! Get on the ground!', 'Suspect spotted!'],
    other: ['There they are!', 'Get them!', 'You\'re dead!'],
  },
  lost: ['Must have been nothing.', 'Damn rats.', 'Lost them…'],
  search: ['Where did you go?', 'Come out, come out…', 'I know you\'re here.'],
  hit: ['Argh!', 'Son of a—', 'Ugh!'],
  attack: ['Come here!', 'Take this!', ''],
};
export const BARK_DUR = 1.8;

export const QUIPS: Record<'elias' | 'jax', string[]> = {
  elias: ['Patience. That\'s all it takes.', 'Six years of push-ups in a cell. You didn\'t stand a chance.', 'Again? You sure?'],
  jax: ['Told you. Quick hands.', 'Don\'t feel bad. Everybody loses to me.', 'Want to go again, old man?'],
};
export const QUIP_DUR = 2.6;
