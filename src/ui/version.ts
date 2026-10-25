// Build version and update check. Browsers and installed home-screen apps may keep an old copy of
// the page for a while after a deploy; this notices a newer build and loads it.
export const BUILD: string = __BUILD__;
export const BUILD_DATE: string = __BUILD_DATE__;

const TRIED = 'pbo.updateTried';

/** The build id currently deployed, or null if unknown (offline, dev server). */
async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: string };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null;
  }
}

/**
 * Reload into the newest build if one is deployed and `allowed()` still holds (never mid-game).
 * Each new build is tried once per tab, so a stale cache can never cause a reload loop.
 * Returns true if a reload was started.
 */
export async function updateIfNewer(allowed: () => boolean = () => true): Promise<boolean> {
  if (BUILD === 'dev') return false;
  const latest = await latestBuild();
  if (!latest || latest === BUILD || !allowed()) return false;
  let tried: string | null = null;
  try { tried = sessionStorage.getItem(TRIED); } catch { /* ignore */ }
  if (tried === latest) return false;
  try { sessionStorage.setItem(TRIED, latest); } catch { /* ignore */ }
  // A new query string makes the browser fetch the page itself again instead of using its cache.
  const url = new URL(location.href);
  url.searchParams.set('v', latest);
  location.replace(url.toString());
  return true;
}
