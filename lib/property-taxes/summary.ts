// lib/property-taxes/summary.ts
//
// One labeled tax figure for underwriting checks and the exec summary deck:
// the latest tax year with a bill for every account, its total, and exactly
// what that total does and doesn't cover. "complete" only when the Property
// Taxes workspace itself would report the full property levy.

import type { TaxState } from "./types";
import { annualTotal, effectiveFact } from "./model";
import { obligationLimitation } from "./obligation";

export interface TaxSummary {
  year: number;
  amount: number;
  status: "complete" | "partial";
  /** e.g. "Dallas County tax office: County, Parkland Hospital, Dallas College, Dallas ISD, City of Dallas". */
  coverage: string;
  /** Plain-language reasons the figure may be incomplete (empty when complete). */
  caveats: string[];
  accounts: string[];
  /** Up to five most recent years, newest first; null = not every account has that year. */
  history: Array<{ year: number; amount: number | null }>;
}

const titleCase = (s: string) => s.replace(/^\d{4}\s*-\s*/, "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bIsd\b/g, "ISD").replace(/\bCisd\b/g, "CISD").replace(/\bMud\b/g, "MUD");

export function taxSummary(state: TaxState): TaxSummary | null {
  const parcels = state.parcels.filter((p) => p.review !== "excluded");
  if (!parcels.length) return null;
  const amountFor = (key: string, year: number) => {
    const rows = state.records.filter((r) => r.parcelKey === key && r.year === year);
    if (rows.length !== 1) return null;
    const f = effectiveFact(state, rows[0], "levied");
    return typeof f?.value === "number" && Number.isFinite(f.value) && f.stage !== "proposed" ? { value: f.value, row: rows[0] } : null;
  };
  const years = [...new Set(state.records.map((r) => r.year))].sort((a, b) => b - a);
  const full = years.filter((y) => parcels.every((p) => amountFor(p.key, y)));
  const year = full[0] ?? years.find((y) => parcels.some((p) => amountFor(p.key, y)));
  if (year == null) return null;

  const rows = parcels.map((p) => ({ p, a: amountFor(p.key, year) }));
  const amount = Math.round(rows.reduce((t, x) => t + (x.a?.value ?? 0) * 100, 0)) / 100;
  const official = annualTotal(state, year, "levied");
  // Most material first: what the amount leaves out, then what's unconfirmed.
  const caveats: string[] = [];
  const missing = rows.filter((x) => !x.a).map((x) => x.p.accountId);
  if (missing.length) caveats.push(`No ${year} bill for account${missing.length === 1 ? "" : "s"} ${missing.join(", ")}; total covers the others only.`);
  for (const { p, a } of rows) {
    if (!a) continue;
    const limit = obligationLimitation(p, a.row, state);
    if (!limit) continue;
    if (/collector subtotal|separately billed/i.test(limit)) {
      const hasSchool = a.row.jurisdictions.some((j) => /\b(ISD|CISD|school)\b/i.test(j.name));
      caveats.push(hasSchool ? `${p.accountId}: only authorities on the ${p.county.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} County tax office record; any separately billed district is not included.`
        : `${p.accountId}: ${p.county.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} County tax office only — school district not included.`);
    } else if (/temporary/i.test(limit)) caveats.push(`${p.accountId}: temporary or appealed bill; final amount may differ.`);
    else caveats.push(`${p.accountId}: whether other districts bill this property separately has not been checked.`);
  }
  const pending = parcels.filter((p) => p.review === "pending").map((p) => p.accountId);
  if (pending.length) caveats.push(`Parcel match not yet approved: ${pending.join(", ")}.`);
  if (!state.scopeReview || official.limitations.some((l) => /parcel set/i.test(l))) caveats.push("Acquisition parcel set not verified; other parcels may be taxed separately.");

  const authorities = [...new Set(rows.flatMap((x) => x.a?.row.jurisdictions.map((j) => titleCase(j.name)) ?? []))];
  const counties = [...new Set(parcels.map((p) => p.county.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())))];
  const coverage = `${counties.join(" / ")} County tax office${authorities.length ? `: ${authorities.slice(0, 8).join(", ")}${authorities.length > 8 ? ", …" : ""}` : ""}`;
  return {
    year, amount, status: official.total != null ? "complete" : "partial", coverage,
    caveats: official.total != null ? [] : [...new Set(caveats)],
    accounts: parcels.map((p) => p.accountId),
    history: years.slice(0, 5).map((y) => ({ year: y, amount: parcels.every((p) => amountFor(p.key, y)) ? Math.round(parcels.reduce((t, p) => t + amountFor(p.key, y)!.value * 100, 0)) / 100 : null })),
  };
}
