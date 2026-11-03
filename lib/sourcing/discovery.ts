import { DEFAULT_CATEGORIES, rejectReason } from "./yard-users";

export type DiscoveryProfile = { id?: string; label: string; keywords: string[] };
export type DiscoveryPlace = { place_id: string; name: string; vicinity?: string; geometry: { location: { lat: number; lng: number } }; business_status?: string; types?: string[]; category: string; categories: string[]; profileIds: string[] };
export interface DiscoveryOptions { budget?: number; deadlineMs?: number; wait?: (ms: number) => Promise<void>; tile?: boolean }

/** Bound Google spend/time, page results, then subdivide dense search circles. */
export async function discoverYardUsers(center: { lat: number; lng: number }, radiusMiles: number, key: string, fetcher: typeof fetch = fetch, profiles: DiscoveryProfile[] = DEFAULT_CATEGORIES, options: DiscoveryOptions = {}) {
  const budget = Math.max(1, Math.min(options.budget ?? 96, 160));
  const deadline = Date.now() + (options.deadlineMs ?? 50000);
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const jobs = profiles.flatMap(cat => cat.keywords.map(keyword => ({ cat, keyword })));
  const found = new Map<string, DiscoveryPlace>();
  let requests = 0, screened = 0, skipped = 0;
  const searches = jobs.map(({ cat, keyword }) => ({ profileId: cat.id ?? cat.label, profile: cat.label, keyword, failed: false, returned: 0, limited: false, pages: 0, cells: 0, errors: 0 }));
  function collect(places: any[], cat: DiscoveryProfile) {
    for (const p of places) {
      if (rejectReason(p, cat.label)) { screened++; continue; }
      if (!p.place_id || !Number.isFinite(p.geometry?.location?.lat) || !Number.isFinite(p.geometry?.location?.lng)) continue;
      const prior = found.get(p.place_id);
      if (!prior) found.set(p.place_id, { ...p, category: cat.label, categories: [cat.label], profileIds: cat.id ? [cat.id] : [] });
      else { if (!prior.categories.includes(cat.label)) prior.categories.push(cat.label); if (cat.id && !prior.profileIds.includes(cat.id)) prior.profileIds.push(cat.id); }
    }
  }
  async function cell(index: number, point: typeof center, radius: number) {
    const { cat, keyword } = jobs[index], info = searches[index];
    let token: string | undefined, pages = 0, retries = 0, total = 0;
    const tokens = new Set<string>();
    info.cells++;
    while (pages < 3) {
      if (requests >= budget || Date.now() >= deadline) { skipped++; info.limited = true; if (!info.pages) info.failed = true; break; }
      if (token) await wait(2200);
      if (requests >= budget || Date.now() >= deadline) { skipped++; info.limited = true; if (!info.pages) info.failed = true; break; }
      requests++;
      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.search = new URLSearchParams(token ? { pagetoken: token, key } : { location: `${point.lat},${point.lng}`, radius: String(Math.round(radius * 1609.34)), keyword, key }).toString();
      try {
        const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(9000, deadline - Date.now()))) });
        const data = await response.json();
        if (data.status === "INVALID_REQUEST" && token && retries++ < 2) continue;
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") { info.errors++; if (!info.pages) info.failed = true; else info.limited = true; break; }
        const places = data.results ?? [];
        pages++; info.pages++; info.returned += places.length; total += places.length;
        collect(places, cat);
        const next = data.next_page_token;
        if (!next) { if (pages === 3 && places.length >= 20) info.limited = true; break; }
        if (tokens.has(next)) { info.limited = true; break; }
        tokens.add(next); token = next; retries = 0;
        if (pages === 3) info.limited = true;
      } catch { info.errors++; if (!info.pages) info.failed = true; else info.limited = true; break; }
    }
    return total >= 60;
  }
  async function run(items: { index: number; point: typeof center; radius: number }[]) {
    let cursor = 0;
    const saturated = new Set<number>();
    await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
      while (cursor < items.length) { const item = items[cursor++]; if (await cell(item.index, item.point, item.radius)) saturated.add(item.index); }
    }));
    return saturated;
  }
  const saturated = await run(jobs.map((_, index) => ({ index, point: center, radius: radiusMiles })));
  if (options.tile !== false && saturated.size && requests < budget && Date.now() < deadline) {
    const cells = [];
    // Round robin among keywords so a dense profile cannot consume every cell.
    for (const [dy, dx] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) for (const index of saturated) cells.push({ index,
      point: { lat: center.lat + dy * radiusMiles * .5 / 69, lng: center.lng + dx * radiusMiles * .5 / (69 * Math.cos(center.lat * Math.PI / 180)) }, radius: radiusMiles * .72 });
    await run(cells);
  }
  const failedSearches = searches.filter(s => s.failed).length;
  return { places: [...found.values()], screened, failedSearches, totalSearches: jobs.length, searches,
    coverage: { requests, budget, budgetExhausted: requests >= budget, deadlineReached: Date.now() >= deadline, skipped, limitedSearches: searches.filter(s => s.limited).length, partial: searches.some(s => s.failed || s.errors || s.limited), inventory: false as const } };
}
