// lib/format.ts -- display formatting shared by the redesign's screens and the
// IC slide. Pure; safe on client and server.

export const SQFT_PER_ACRE = 43560;

/** $8.4M, $1.35M, $640K, $130. Null-safe ("—"). */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export function acres(lotSf: number | null | undefined): number | null {
  return lotSf ? Number(lotSf) / SQFT_PER_ACRE : null;
}

export function fmtAcres(lotSf: number | null | undefined): string {
  const a = acres(lotSf);
  return a == null ? "—" : `${a >= 10 ? a.toFixed(1) : a.toFixed(2).replace(/0$/, "")} ac`;
}

export function fmtSf(sf: number | null | undefined): string {
  if (!sf) return "—";
  return sf >= 1000 ? `${(Number(sf) / 1000).toFixed(1).replace(/\.0$/, "")}K SF` : `${Math.round(sf)} SF`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

/** "Oct 9" from YYYY-MM-DD, without timezone drift. */
export function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Whole days from `today` (YYYY-MM-DD) to `d`. */
export function daysUntil(d: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function dealRef(ref: number | null | undefined): string {
  return ref ? `D-${ref}` : "";
}
