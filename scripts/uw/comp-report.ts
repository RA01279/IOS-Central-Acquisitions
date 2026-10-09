// scripts/uw/comp-report.ts
//
// Read-only: SELECTs the comps table, runs the comp adapter and stats, and
// prints market rent / price per acre, flags, and the rent roll marked to
// market. Never writes. Credentials come from .env.local via @next/env.
//
//   npx tsx@4.23.15 scripts/uw/comp-report.ts [--market "Fort Worth"] [--acres 37] [--months 36|24] [--as-of YYYY-MM-DD]

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { adaptComps, BANDS, type CompRow, type LeaseComp, type NormalizedComp, type SaleComp } from "../../lib/uw/comp-adapter";
import { exitCapStats, markToMarket, rentBands, selectComps, valueStats, type Selection, type ValueStats } from "../../lib/uw/comp-stats";
import { rendon } from "../../lib/uw/fixtures/rendon";

loadEnvConfig(process.cwd());

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const market = arg("market", "Fort Worth");
const subjectAcres = Number(arg("acres", "37"));
const months = Number(arg("months", "36")) === 24 ? 24 : 36;
const asOf = arg("as-of", new Date().toISOString().slice(0, 10));

const COLUMNS = [
  "id", "comp_type", "address", "project_name", "suite", "market", "submarket", "status", "source_ref",
  "lot_sf", "building_sf", "rent", "rent_basis", "lease_type", "cam_psf_annual", "escalations_pct",
  "date_commenced", "sale_price", "closed_on", "cap_rate", "noi",
].join(",");

async function readComps(): Promise<CompRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local)");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows: CompRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("comps").select(COLUMNS).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as unknown as CompRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const pctTxt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const h = (title: string) => console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 74 - title.length))}`);

function counts(label: string, sel: Selection<NormalizedComp>) {
  const byBand = BANDS.map((b) => `${b}: ${sel.usable.filter((c) => c.band === b).length}`).join("  ");
  console.log(`${pad(label, 6)} usable ${lpad(String(sel.usable.length), 3)}   by band  ${byBand}`);
  console.log(`       tiers: confirmed ${sel.tiers.confirmed}, screened ${sel.tiers.screened}, verified ${sel.tiers.verified} (no verified_at column yet)`);
  console.log(`       left out: ${sel.excluded.duplicate.length} suspect duplicate, ${sel.excluded.notConvertible.length} not convertible`);
}

function statsBlock(label: string, s: ValueStats) {
  console.log(`\n${label}`);
  if (s.status !== "ok") {
    console.log(`  ${s.message}`);
    console.log(`  no downside / base / upside`);
    for (const w of s.warnings) console.log(`  ! ${w}`);
    return;
  }
  if (s.reference) console.log(`  *** ${s.reference.toUpperCase()} ***`);
  console.log(`  basis: ${s.basis === "band" ? `${s.subjectBand} ac band` : "whole market (fallback)"}; comps' acreage ${s.acresRange ? `${s.acresRange.min.toFixed(1)}-${s.acresRange.max.toFixed(1)} ac` : "—"}`);
  const row = (name: string, x: { n: number; min: number | null; downside: number | null; base: number | null; upside: number | null; max: number | null } | null | undefined) =>
    console.log(
      `  ${pad(name, 24)} ${x ? `n ${lpad(String(x.n), 3)}  min ${lpad(usd(x.min), 11)}  p25 ${lpad(usd(x.downside), 11)}  median ${lpad(usd(x.base), 11)}  p75 ${lpad(usd(x.upside), 11)}  max ${lpad(usd(x.max), 11)}` : "none"}`
    );
  row("with review_extreme", s.withExtreme);
  row("without review_extreme", s.withoutExtreme);
  if (s.compType === "lease") row("without assumed NNN", s.withoutAssumedNnn);
  console.log(`  -> downside / base / upside: ${usd(s.withExtreme.downside)} / ${usd(s.withExtreme.base)} / ${usd(s.withExtreme.upside)}`);
  if (s.extremeIds.length) console.log(`  review_extreme ids: ${s.extremeIds.join(", ")}`);
  for (const w of s.warnings) console.log(`  ! ${w}`);
  console.log(`  comp ids (${s.withExtreme.compIds.length}): ${s.withExtreme.compIds.join(", ")}`);
}

async function main() {
  const rows = await readComps();
  const comps = adaptComps(rows);
  const leases = comps.filter((c): c is LeaseComp => c.compType === "lease");
  const sales = comps.filter((c): c is SaleComp => c.compType === "sale");

  h(`Comp report: ${market}, subject ${subjectAcres} ac, last ${months} months to ${asOf}`);
  console.log(`Read ${rows.length} comps (${leases.length} lease, ${sales.length} sale). Read-only; nothing written.`);

  const leaseSel = selectComps(leases, "lease", { market, months, asOf });
  const saleSel = selectComps(sales, "sale", { market, months, asOf });
  h("Counts (in market and window, status confirmed)");
  console.log(`window starts ${leaseSel.windowStart}`);
  counts("lease", leaseSel);
  counts("sale", saleSel);

  h("Rent per acre per month (NNN) and price per acre");
  statsBlock("LEASE  rent / acre / month", valueStats(leaseSel.usable, "lease", subjectAcres));
  statsBlock("SALE   price / acre", valueStats(saleSel.usable, "sale", subjectAcres));
  const cap = exitCapStats(saleSel.usable);
  console.log(`\nEXIT CAP  ${cap.source === "manual" ? cap.message : `n ${cap.n}: downside ${cap.downside} / base ${cap.base} / upside ${cap.upside}`}`);

  h("Flags across the whole repository");
  const flagCount = (type: string, flag: string) => comps.filter((c) => c.compType === type && c.flags.includes(flag as never)).length;
  for (const type of ["lease", "sale"]) {
    console.log(`${pad(type, 6)} suspect_duplicate ${flagCount(type, "suspect_duplicate")}   not_convertible ${flagCount(type, "not_convertible")}   review_extreme ${flagCount(type, "review_extreme")}   market_conflict ${flagCount(type, "market_conflict")}`);
  }
  const nnn = leases.reduce<Record<string, number>>((m, c) => ((m[c.nnnStatus] = (m[c.nnnStatus] ?? 0) + 1), m), {});
  console.log(`lease nnnStatus: ${Object.entries(nnn).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`\nsuspect duplicates (flagged row -> kept row; the LATER date is kept):`);
  console.log(`  NEEDS A HUMAN CHECK: the ~388-day pairs from "TX IOS Lease Comps (ver.2.0).xlsx" look like a`);
  console.log(`  date-parsing error in that import (1st of a month vs the 22nd-24th a year later). Keeping the`);
  console.log(`  later date may make those comps look a year more recent than they are.`);
  for (const c of comps.filter((x) => x.flags.includes("suspect_duplicate"))) {
    console.log(`  ${c.id}  ${pad(c.compType, 5)} ${pad(c.market ?? "—", 12)} ${pad(c.address, 32)} ${c.date}  ${c.reasons.suspect_duplicate}`);
  }
  // At the old 5x threshold only ratios beyond 5 (or under 1/5) were flagged.
  const newAt3x = (c: NormalizedComp) => c.ratioToBandMedian !== undefined && c.ratioToBandMedian <= 5 && c.ratioToBandMedian >= 1 / 5;
  console.log(`\nreview_extreme (3x threshold; NEW = would not have been flagged at the old 5x):`);
  for (const c of comps.filter((x) => x.flags.includes("review_extreme"))) {
    console.log(`  ${newAt3x(c) ? "NEW " : "    "}${c.id}  ${pad(c.compType, 5)} ${pad(c.market ?? "—", 12)} ${pad(c.address, 32)} ${lpad(usd(c.valuePerAcre), 12)}/ac  ${c.reasons.review_extreme}`);
  }
  console.log(`\nmarket_conflict (same address, different markets; not excluded):`);
  for (const c of comps.filter((x) => x.flags.includes("market_conflict")).sort((a, b) => a.address.localeCompare(b.address))) {
    console.log(`  ${c.id}  ${pad(c.compType, 5)} ${pad(c.market ?? "—", 12)} ${pad(c.address, 32)} ${c.date}  ${c.reasons.market_conflict}`);
  }
  const ncReasons = comps
    .filter((c) => c.flags.includes("not_convertible"))
    .reduce<Record<string, number>>((m, c) => {
      const r = `${c.compType}: ${c.reasons.not_convertible ?? "?"}`;
      m[r] = (m[r] ?? 0) + 1;
      return m;
    }, {});
  console.log(`\nnot_convertible reasons:`);
  for (const [r, n] of Object.entries(ncReasons).sort((a, b) => b[1] - a[1])) console.log(`  ${lpad(String(n), 3)}  ${r}`);

  h(`Mark to market: ${rendon.property} rent roll vs ${market} lease comps`);
  console.log(`${pad("Tenant", 34)} ${lpad("Acres", 5)} ${lpad("$/ac/mo", 9)}  ${pad("Band", 6)} ${pad("Basis", 7)} ${lpad("p25", 8)} ${lpad("median", 8)} ${lpad("p75", 8)} ${lpad("vs med", 7)}  Position`);
  for (const r of markToMarket(rendon.rentRoll, rentBands(leaseSel.usable, market))) {
    console.log(
      `${pad(r.tenant, 34)} ${lpad(r.acres?.toString() ?? "—", 5)} ${lpad(usd(r.rentPerAcreMo), 9)}  ${pad(r.band ?? "—", 6)} ${pad(r.basis ?? "—", 7)} ${lpad(usd(r.p25), 8)} ${lpad(usd(r.median), 8)} ${lpad(usd(r.p75), 8)} ${lpad(pctTxt(r.vsMedian), 7)}  ${r.position}${r.note ? `  (${r.note})` : ""}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
