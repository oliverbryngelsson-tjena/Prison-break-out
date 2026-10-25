// Background download of a chapter's files (models, textures, music) into the browser cache, so
// its loading screen only has to read them back. One file at a time, low priority, and it stops
// whenever a chapter starts loading for real.
import { url as assetUrl } from '../engine/assets';

let list: Promise<Record<string, string[]> | null> | null = null;
let run = 0;
const done = new Set<string>();

function chapterList(): Promise<Record<string, string[]> | null> {
  list ??= fetch(assetUrl('chapter-assets.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return list;
}

/** Downloads chapter `ch`'s files, skipping the ones chapter `skip` already loaded. */
export async function prefetchChapter(ch: number, skip?: number): Promise<void> {
  const id = ++run;
  const all = await chapterList();
  if (!all || id !== run) return;
  const have = new Set(skip ? all[String(skip)] ?? [] : []);
  for (const f of all[String(ch)] ?? []) {
    if (id !== run) return;
    if (have.has(f) || done.has(f)) continue;
    try {
      const r = await fetch(assetUrl(f.replace(/^assets\//, '')), { priority: 'low' } as RequestInit);
      if (r.ok) { await r.arrayBuffer(); done.add(f); }
    } catch { /* offline or blocked: the real load will try again */ }
  }
}

/** Stops any background download in progress (a real load is starting). */
export function stopPrefetch(): void {
  run++;
}
