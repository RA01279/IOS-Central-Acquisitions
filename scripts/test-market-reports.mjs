// scripts/test-market-reports.mjs
//
// Tests the market-report and market-narrative agent contracts: what passes
// the worker's check, how values are normalised, and that every narrative
// point must cite a supplied source.
//   node scripts/test-market-reports.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (path) => {
  const m = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: m });
  return m;
};
const r = load("../lib/agents/market-report.ts");
const n = load("../lib/agents/market-narrative.ts");
let c = 0;
const ok = (v, msg) => { assert.ok(v, msg); c++; };

// Shaped like the Conroe Q2 2026 Avison Young snapshot.
const conroe = JSON.stringify({
  publisher: "Avison Young", title: "Industrial market snapshot", period: "Q2 2026", periodEnd: "2026-06-30", propertyType: "industrial",
  market: "Houston", submarkets: ["Conroe"], geography: "Properties 10,000 SF and greater within 8 miles of Conroe, TX",
  metrics: [
    { metric: "vacancy_pct", label: "Overall vacancy", value: 2.3, submarket: "Conroe", segment: null, basis: "current", period: "Q2 2026" },
    { metric: "vacancy_pct", label: "Pre-pandemic average vacancy", value: "4.8%", submarket: "Conroe", segment: null, basis: "average", period: null },
    { metric: "vacancy_pct", label: "Vacancy, 10K-15K SF", value: 9.6, submarket: "Conroe", segment: "10K-15K SF", basis: "current", period: "Q2 2026" },
    { metric: "leasing_sf", label: "Leasing activity H1", value: 150000, submarket: "Conroe", segment: null, basis: "current", period: "H1 2026" },
    { metric: "asking_rent_psf_annual", label: "Asking rent (NNN)", value: "$10.72", submarket: "Conroe", segment: null, basis: "current", period: "Q2 2026" },
    { metric: "made_up", label: "Something else", value: 3, basis: "weird" },
    { metric: "inventory_sf", label: "Inventory", value: "n/a" },
  ],
  summary: "Tight market, early signs of softening.", takeaways: ["Small bay is the soft spot"], transactions: [{ party: "Purge Rite", type: "lease", sf: null }], notes: [],
});
const p = r.parseMarketReport("```json\n" + conroe + "\n```");
ok(p && p.market === "Houston" && p.submarkets[0] === "Conroe", "market and submarket");
ok(p.metrics.length === 6, "a non-numeric value is dropped");
ok(p.metrics[1].value === 4.8 && p.metrics[4].value === 10.72, "'4.8%' and '$10.72' read as numbers");
ok(p.metrics[5].metric === "other" && p.metrics[5].basis === "current", "unknown metric -> other, unknown basis -> current");
ok(p.metrics[2].segment === "10K-15K SF", "size segment kept");
ok(r.parseMarketReport(JSON.stringify({ publisher: "X", metrics: [] })) === null, "no market -> rejected");
ok(r.parseMarketReport("not json") === null, "not JSON -> rejected");

const narrative = JSON.stringify({
  headline: "Conroe stays tight", narrative: "Vacancy is 2.3% (R1).\n\nSmall bay is softer (R1).",
  points: [{ text: "Vacancy 2.3% in Q2 2026", sources: ["R1"] }, { text: "IOS rents hold", sources: ["Hopper comps"] }],
  conflicts: [], gaps: ["No IOS-specific rents in the reports"],
});
ok(n.parseMarketNarrative(narrative, ["R1", "Hopper comps"]), "cited narrative accepted");
ok(n.parseMarketNarrative(narrative, ["R2", "Hopper comps"]) === null, "a point citing an unknown source is rejected");
ok(n.parseMarketNarrative(JSON.stringify({ headline: "x", narrative: "y", points: [{ text: "uncited", sources: [] }] })) === null, "uncited point rejected");
ok(n.parseMarketNarrative(narrative), "worker check without labels");
console.log(`market-reports: ${c} checks passed`);
