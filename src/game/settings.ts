// Persistent settings and campaign save data.
import type { CharacterId, Progress } from '../../shared/protocol';
import type { QualityLevel } from '../engine/quality';

export interface Settings {
  name: string;
  quality: QualityLevel | 'auto';
  sens: { touch: number; mouse: number; gamepad: number };
  invertY: boolean;
  volumes: { master: number; music: number; sfx: number; dialogue: number; ambience: number };
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  tts: boolean;
  touchScale: number;
  touchOpacity: number;
  showFps: boolean;
  vibration: boolean;
  autoCamera: boolean;
  serverUrl: string;
  preferredCharacter: CharacterId;
  /** Interface size multiplier on top of the automatic screen-based scale. */
  uiScale: number;
}

const KEY = 'pbo.settings';
const SAVE_KEY = 'pbo.save';

export function defaultSettings(): Settings {
  return {
    name: '',
    quality: 'auto',
    sens: { touch: 1, mouse: 1, gamepad: 1 },
    invertY: false,
    volumes: { master: 0.9, music: 0.55, sfx: 0.9, dialogue: 1, ambience: 0.7 },
    subtitles: true,
    subtitleSize: 'medium',
    tts: true,
    touchScale: 1,
    touchOpacity: 0.75,
    showFps: false,
    vibration: true,
    autoCamera: true,
    serverUrl: '',
    preferredCharacter: 'elias',
    uiScale: 1,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...d, ...s, sens: { ...d.sens, ...s.sens }, volumes: { ...d.volumes, ...s.volumes } };
    }
  } catch { /* ignore */ }
  return d;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface SaveData {
  progress: Progress | null;
  /** Highest chapter reached. */
  unlocked: number;
  endings: string[];
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { progress: null, unlocked: 1, endings: [], ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { progress: null, unlocked: 1, endings: [] };
}

export function writeSave(p: Progress | null, ending?: string): SaveData {
  const s = loadSave();
  if (p) {
    s.progress = p;
    s.unlocked = Math.max(s.unlocked, p.chapter);
  }
  if (ending && !s.endings.includes(ending)) s.endings.push(ending);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
