// lib/recent.ts
//
// CLIENT ONLY. "Fast re-entry": the deals you opened most recently, with the
// tab you left each one on, plus the last route overall so an installed app
// reopens where you were. Per-browser by design (localStorage) -- it's a
// convenience, never data anyone else needs to see. Every access is guarded:
// private windows and blocked storage must not break a page.

export interface RecentDeal {
  id: string;
  name: string;
  tab: string;
  href: string;
  at: number;
}

const KEY = "hopper.recent.v1";
const LAST = "hopper.lastRoute.v1";
const MAX = 10;

export function readRecent(): RecentDeal[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: Omit<RecentDeal, "at">) {
  try {
    const list = readRecent().filter((r) => r.id !== entry.id);
    list.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event("hopper-recent"));
  } catch {
    /* storage unavailable */
  }
}

export function rememberRoute(href: string) {
  try {
    localStorage.setItem(LAST, JSON.stringify({ href, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

export function lastRoute(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST) ?? "null");
    return v && typeof v.href === "string" && v.href.startsWith("/") ? v.href : null;
  } catch {
    return null;
  }
}

export function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yday" : `${d}d`;
}
