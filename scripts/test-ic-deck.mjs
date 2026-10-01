// IC deck from the acquisition model: extraction, model checks, rendering,
// and the route's input guard. Uses a synthetic workbook laid out like the
// Dalfen UW template (same sheet names and row labels); no real deal data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import PizZip from "pizzip";

const require = createRequire(import.meta.url);
// Values come from a vm context, so compare structure as JSON.
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const cache = new Map();
function load(path, deps = {}) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("../" + path.split("?")[0], import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, require: (n) => deps[n] ?? (n.startsWith("./") ? load("lib/ic-deck/" + n.slice(2) + ".ts", deps) : require(n)), Buffer, process, console, URL });
  cache.set(path, module.exports);
  return module.exports;
}
const xlsx = load("lib/ic-deck/xlsx-lite.ts");
const model = load("lib/ic-deck/model.ts", { "./xlsx-lite": xlsx });

// ---- synthetic workbook ------------------------------------------------------
const wb = new ExcelJS.Workbook();
const put = (ws, cells) => { for (const [a, v] of Object.entries(cells)) ws.getCell(a).value = v; };
const es = wb.addWorksheet("ES Summary");
put(es, { B4: "Address", D4: "100 Example Yard Rd", B5: "City", D5: "Testville, TX", B6: "State", D6: "TX", B7: "Portfolio Size (Ac.)", D7: 4,
  B8: "Site SF", D8: 20000, B9: "Building SF", D9: 20000, B12: "Capitalization", C13: "$ Amount", D13: "$ PSF",
  B14: "Price", C14: 5000000, D14: 250, B15: "Acquisition / Financing Costs", C15: 100000, D15: 5, B16: "Capex", C16: 0, D16: 0, B17: "Total", C17: 5100000, D17: 255,
  B19: "Yields", B20: "Going-in", C20: 0.07, B21: "Return on Cost at Exit", C21: 0.08, B22: "Exit Cap", C22: 0.065 });
const pf = wb.addWorksheet("Pro Forma");
put(pf, { B7: "Base Case", D7: "Levered LP Returns", E7: "Unlevered", F7: "Levered", B8: "IRR", D8: 0.15, E8: 0.11, F8: 0.18, B10: "Multiple", D10: 1.9, E10: 1.6, F10: 2.1,
  B150: "Month of Sale", D150: 60,
  B192: "Deal Level Returns", B194: "Exit Cap", C194: 0.0625, D194: 0.065, B195: "IRR / Equity Multiple", C195: "19.0% / 2.2x", D195: "16.0% / 1.9x",
  B202: "SUPPORT TABLE - DEAL LEVEL RETURNS", B204: "18.0% / 2.1x", C204: 0.0625, D204: 0.065, E204: 0.0675,
  B205: 4800000, C205: "20.0% / 2.3x", D205: "19.0% / 2.2x", E205: "18.0% / 2.1x",
  B206: 5000000, C206: "19.0% / 2.2x", D206: "18.0% / 2.1x", E206: "17.0% / 2.0x",
  B214: "SUPPORT TABLE - LP RETURNS", B216: "15.0% / 1.9x", C216: 0.0625, D216: 0.065, E216: 0.0675,
  B217: 4800000, C217: "17.0% / 2.0x", D217: "16.0% / 2.0x", E217: "15.5% / 1.9x",
  B218: 5000000, C218: "16.0% / 2.0x", D218: "15.0% / 1.9x", E218: "14.0% / 1.8x" });
const dov = wb.addWorksheet("Deal Overview");
put(dov, { B2: "100 Example Yard Rd: Deal Overview", B3: 46293, B26: "Acquisition Date", E26: 46357, B27: "Sale Date", E27: 48182, B38: "Profit", E38: 2000000,
  B54: "Total Loan", D54: 3000000, B55: "Total Equity", D55: 2100000, B74: "Leasing Assumptions", B76: "MLA Name", D76: "$9.99 FSG", B78: "Renewal Probability", D78: 0.7,
  B81: "Market Rent", D81: 1.5, B91: "Debt Assumptions", B93: "LTPP", D93: 0.6, B96: "LTC", D96: 0.59, B97: "Index", D97: 0.04, B98: "Spread over SOFR", D98: 0.02, B99: "Interest Only", D99: 60, B100: "Amort.", D100: 360 });
const rr = wb.addWorksheet("Rent Roll");
put(rr, { B2: "100 Example Yard Rd: Rent Roll", AB10: "Scheduled Base Rent at Closing", AE10: "Market Rent at Closing", AI10: "SBR at New Lease Start",
  B11: "Tenant", C11: "Suite / Bldg.", D11: "SF", E11: "% of SF", F11: "Lease Start", G11: "Lease Expiration", K11: "Remaining Term (mo.)", L11: "MLA Name", M11: "Renewal %", N11: "Downtime",
  AB11: "$ Rent / Yr.", AC11: "$ PSF", AE11: "$ Rent / Yr.", AF11: "$ PSF", AI11: "$ Rent / Yr.",
  B13: "Tenancy", B14: "  1. Example Tenant & Co.  ", C14: "ALL", D14: 20000, E14: 1, F14: "1/1/2026", G14: "12/31/2032", K14: 75, L14: "$1.50/Building SF/mo", M14: 0.7, N14: 6,
  AB14: 360000, AC14: 1.5, AE14: 360000, AF14: 1.5, AI14: 400000, B16: "Subtotal", B18: "Total", D18: 20000, K18: 6.25 });
const mpf = wb.addWorksheet("Memo Pro Forma");
const years = { D3: 0, E3: 1, F3: 2, G3: 3, H3: 4, I3: 5 };
put(mpf, { B2: "ANNUAL CASH FLOW", B3: "Year", ...years,
  B11: "Potential Base Rent", E11: 360000, F11: 370000, G11: 380000, H11: 390000, I11: 400000,
  B22: "TOTAL INCOME", D22: 450000, E22: 450000, F22: 460000, G22: 470000, H22: 480000, I22: 490000,
  B32: "NOI", D32: 350000, E32: 350000, F32: 360000, G32: 370000, H32: 380000, I32: 390000,
  B44: "LEASING AND CAPEX", B51: "ASSET SALE / FINANCING", B52: "Sale Price", I52: 6000000,
  B61: "LEVERED CASH FLOW", B71: "LEVERED CASH FLOW", D71: -2100000, E71: 100000, F71: 110000, G71: 120000, H71: 130000, I71: 3000000,
  B72: "Levered Cash-on-Cash", E72: 0.05, F72: 0.055, G72: 0.06, H72: 0.065, I72: 0.07 });
wb.addWorksheet("Memo Table", { state: "hidden" }).getCell("D5").value = "5863 Rue Ferrari, San Jose, CA";
const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

// ---- extraction --------------------------------------------------------------
const m = model.extractModel(xlsx.openWorkbook(bytes), "synthetic.xlsx");
assert.equal(m.property.address, "100 Example Yard Rd");
assert.equal(m.property.siteSf, 174240, "site SF falls back to acreage when ES Summary disagrees");
assert.equal(Math.round(m.property.coverage * 1000), 115);
same(m.capitalization.map((c) => c.label), ["Price", "Acquisition / Financing Costs"], "zero rows dropped");
assert.equal(m.totalCost.amount, 5100000);
same([m.returns.levered.irr, m.returns.unlevered.irr, m.returns.lp.irr], [0.18, 0.11, 0.15]);
assert.equal(m.returns.holdYears, 5);
assert.equal(m.dates.acquisition, "2026-12-01");
assert.equal(m.source.modelDate, "2026-09-28");
assert.equal(m.rentRoll.rows.length, 1);
assert.equal(m.rentRoll.rows[0].tenant, "Example Tenant & Co.");
assert.equal(m.rentRoll.rows[0].start, "2026-01-01", "typed m/d/yyyy dates are read");
assert.equal(m.rentRoll.rows[0].newLeaseAnnual, 400000);
assert.equal(m.rentRoll.waltYears, 6.25);
same(m.cashFlow.years, ["Year 0", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"]);
const lcf = m.cashFlow.rows.find((r) => r.label === "Levered Cash Flow");
assert.equal(lcf.values[0], -2100000, "section heading of the same name is skipped for the row with figures");
assert(m.cashFlow.rows.some((r) => r.label === "Levered Cash-on-Cash"), "small percentage rows are not treated as zero");
assert.equal(m.sensitivities.deal.rows.length, 2);
same(m.sensitivities.deal.cols, [0.0625, 0.065, 0.0675]);
// Model checks
const w = m.warnings.join("\n");
assert.match(w, /Site SF \(20,000\) doesn't match 4 acres/);
assert.match(w, /MLA "\$9\.99 FSG", but the rent roll uses "\$1\.50\/Building SF\/mo"/);
assert(!m.leasing.some((l) => l.label === "MLA Name"), "stale MLA name is dropped");
assert.match(w, /"Base Case" exit-cap table \(D195\) shows 16\.0% \/ 1\.9x, but the base case is 18\.0% \/ 2\.1x/);
assert(!/deal-level sensitivity shows/.test(w), "a matching support table raises no warning");
assert(!/Memo Table|San Jose/.test(JSON.stringify(m)), "hidden leftover sheets are never read");
assert.throws(() => model.extractModel({ sheetNames: [], sheet: () => null }, "x.xlsx"), /missing the ES Summary/);

// ---- route guard ---------------------------------------------------------------
assert.equal(model.validateModelSummary(JSON.parse(JSON.stringify(m))).version, model.MODEL_VERSION);
assert.throws(() => model.validateModelSummary({ ...m, version: "x" }), /unknown version/);
assert.throws(() => model.validateModelSummary({ ...m, warnings: ["x".repeat(700)] }), /text too long/);
assert.throws(() => model.validateModelSummary({ ...m, cashFlow: null }), /missing cashFlow/);

// ---- render ------------------------------------------------------------------
const kit = load("lib/ic-deck/pptx-kit.ts");
const deck = load("lib/ic-deck/deck.ts", { "./pptx-kit": kit });
const out = deck.renderIcDeck({
  model: m,
  deal: { id: "d", address: "100 Example Yard Rd", city: "Testville", state: "TX", market: "Testville", submarket: null, stage: "offered", stageLabel: "Offered",
    acquisitionType: "slb", contractPrice: null, lastOffer: { price: 5200000, date: "2026-09-01" }, ddEndOn: null, closingOn: null, loi: { depositAmount: "50,000", ddDays: "45", closingDays: "30" } },
  leaseComps: [{ n: 1, address: "1 Comp <Way> & Co", city: "Testville", date: "2026-03-01", buildingSf: 10000, acres: 2, quoted: "$5,000 / AC / mo", normalized: "$1.00", party: null, distanceMi: 1.2 }],
  saleComps: [], compRadiusMiles: 15, assets: [], maps: {}, preparedOn: new Date("2026-10-01T12:00:00"),
});
const zip = new PizZip(out);
const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
assert.equal(slides.length, 23);
const all = slides.map((n) => zip.file(n).asText()).join("");
for (const n of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) {
  const text = zip.file(n).asText();
  assert(!/Golden Spike|Prominent Solar|\{\{PROPERTY\}\}/.test(text), `no reference-deal text or placeholder left in ${n}`);
}
assert(all.includes("18.0%") && all.includes("15.0%") && all.includes("11.0%"), "returns rendered");
assert(all.includes("1 Comp &lt;Way&gt; &amp; Co"), "text is XML-escaped");
assert(zip.file("ppt/slides/slide10.xml").asText().includes("<a:tbl>"), "cash flow is a native table");
assert(all.includes("Confirm which price IC is approving"), "model vs Hopper price mismatch is called out");
assert(zip.file("ppt/notesSlides/notesSlide2.xml").asText().includes("MODEL CHECKS"), "model checks travel in the notes");
assert(all.includes("Exhibit needed"), "missing maps become marked placeholders");
assert.equal(zip.file("ppt/slideLayouts/slideLayout2.xml").asText().includes("100 Example Yard Rd"), true, "footer carries the subject");
console.log("PASS: model extraction by label, model checks (site SF, stale MLA, stale base-case table), hidden sheets ignored, input guard, 23-slide render with escaped text and native tables.");

// ---- route -------------------------------------------------------------------
{
  const tables = {
    deals: { id: "d1", stage: "offered", asset_class: "ios", acquisition_type: "slb", contract_price: null, dd_end_on: null, closing_on: null,
      loi_terms: { depositAmount: "50,000", ddDays: "45", junk: 7 },
      properties: { address: "100 Example Yard Rd", city: "Testville", market: "Testville", submarket: null, latitude: 30, longitude: -95, geocode_precision: "rooftop", building_sf: 20000, lot_sf: 174240 },
      offers: [{ price: 5000000, offered_at: "2026-09-01" }] },
    comps: [
      { id: "c1", comp_type: "lease", status: "confirmed", address: "Near Lease Rd", city: "Testville", asset_class: "ios", latitude: 30.01, longitude: -95.01, geocode_precision: "rooftop", building_sf: 15000, lot_sf: 130680, rent: 5000, rent_basis: "per_acre_monthly", date_commenced: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) },
      { id: "c2", comp_type: "lease", status: "confirmed", address: "Far Away Rd", city: "Elsewhere", asset_class: "ios", latitude: 31.5, longitude: -95, geocode_precision: "rooftop", building_sf: 15000, lot_sf: 130680, rent: 5000, rent_basis: "per_acre_monthly", date_commenced: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) },
    ],
    assets: [{ address: "Owned Yard Ln", city: "Testville", status: "owned", occupancy: "occupied", site_acres: 3, building_sf: 8000, latitude: 30.05, longitude: -95.02, geocode_precision: "rooftop" }],
  };

  const query = (table) => {
    const b = { select: () => b, eq: () => b, neq: () => b, not: () => b, order: () => b, limit: async () => ({ data: tables[table], error: null }),
      range: async (from) => ({ data: from === 0 ? tables[table] : [], error: null }), maybeSingle: async () => ({ data: tables[table], error: null }) };
    return b;
  };
  let user = { email: "a@example.com" };
  const NextResponse = class { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; this.headers = new Map(Object.entries(init?.headers ?? {})); } static json(body, init) { return { body, status: init?.status ?? 200 }; } };
  const route = load("app/api/deals/[id]/ic-deck/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth": { getCurrentUser: async () => user },
    "@/lib/supabase": { getServiceClient: () => ({ from: query }) }, "@/lib/deals": { STAGE_LABELS: { offered: "Offered" } },
    "@/lib/comps/mapData": load("lib/comps/mapData.ts"), "@/lib/comps/match": load("lib/comps/match.ts"),
    "@/lib/ic-deck/model": model, "@/lib/ic-deck/deck": deck,
    "@/lib/agents/ic-narrative": load("lib/agents/ic-narrative.ts"), "@/lib/agents/catalog": { UUID: /^[0-9a-f-]{36}$/i },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); }; // maps unavailable -> placeholders, not failure
  process.env.GOOGLE_MAPS_SERVER_KEY = "test";
  const req = (body) => ({ json: async () => body });
  const props = { params: Promise.resolve({ id: "d1" }) };
  try {
    const ok = await route.POST(req({ model: JSON.parse(JSON.stringify(m)) }), props);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("Content-Type"), /presentationml/);
    const z = new PizZip(ok.body);
    const lease = z.file("ppt/slides/slide16.xml").asText();
    assert(lease.includes("Near Lease Rd") && !lease.includes("Far Away Rd"), "comps ranked within the radius");
    assert(lease.includes("$5,000 / AC / mo"), "lease rent shown as quoted with its unit");
    assert(z.file("ppt/slides/slide21.xml").asText().includes("Owned Yard Ln"), "owned assets near the subject listed");
    assert(z.file("ppt/slides/slide3.xml").asText().includes("Exhibit needed"), "map failure falls back to a placeholder");
    assert(!z.file("ppt/slides/slide22.xml").asText().includes("Confirm which price"), "matching offer and model price raise no flag");
    assert.equal((await route.POST(req({ model: { version: "nope" } }), props)).status, 400);
    user = null;
    assert.equal((await route.POST(req({ model: m }), props)).status, 401);
  } finally { globalThis.fetch = realFetch; }
  console.log("PASS: route authenticates, rejects bad summaries, ranks comps within radius, lists nearby owned assets, survives map outages.");
}

// ---- agent narrative ---------------------------------------------------------
{
  const nar = load("lib/agents/ic-narrative.ts");
  const sec = (bullets) => ({ bullets, sources: bullets.length ? ["https://example.gov/zoning (accessed 2026-10-01)"] : [], unverified: [] });
  const good = { version: nar.NARRATIVE_VERSION, sections: { locationHighlights: sec(["1.1 miles to SH-249 <exit> & ramp."]), zoning: sec(["City has no zoning; deed restrictions govern."]), tenant: sec(["Example Tenant makes widgets."]), market: sec([]) } };
  assert(nar.parseNarrative(JSON.stringify(good)), "valid narrative parses");
  assert.equal(nar.parseNarrative(JSON.stringify({ ...good, version: "x" })), null);
  const unsourced = structuredClone(good); unsourced.sections.tenant.sources = [];
  assert.equal(nar.parseNarrative(JSON.stringify(unsourced)), null, "a bullet without a source is rejected");
  const missing = structuredClone(good); delete missing.sections.market;
  assert.equal(nar.parseNarrative(JSON.stringify(missing)), null, "every section must be present");
  assert.match(nar.NARRATIVE_INSTRUCTIONS, /Do not use or guess price, returns, rent/);

  const out2 = deck.renderIcDeck({ model: m, deal: { id: "d", address: "100 Example Yard Rd", city: null, state: "TX", market: "Testville", submarket: null, stage: "offered", stageLabel: "Offered", acquisitionType: null, contractPrice: null, lastOffer: null, ddEndOn: null, closingOn: null, loi: {} },
    leaseComps: [], saleComps: [], compRadiusMiles: 15, assets: [], maps: {}, preparedOn: new Date(), narrative: { sections: nar.parseNarrative(JSON.stringify(good)).sections, runAt: "2026-10-01" } });
  const z2 = new PizZip(out2);
  const s2 = z2.file("ppt/slides/slide2.xml").asText();
  assert(s2.includes("1.1 miles to SH-249 &lt;exit&gt; &amp; ramp.") && s2.includes("Agent draft — verify"), "drafts render escaped and tagged");
  assert(!s2.includes("[Analyst: highway access"), "drafted section replaces its open item");
  assert(s2.includes("[Analyst: governing") === false && z2.file("ppt/slides/slide7.xml").asText().includes("Example Tenant makes widgets."));
  assert(z2.file("ppt/slides/slide7.xml").asText().includes("do not assert creditworthiness"), "credit stays an analyst item");
  assert(z2.file("ppt/notesSlides/notesSlide2.xml").asText().includes("Source: https://example.gov/zoning"), "draft sources in notes");
  assert(!z2.file("ppt/slides/slide12.xml").asText().includes("Agent draft"), "empty market section stays a placeholder");

  // Route: the run must be the requester's, for this deal, completed.
  const filters = [];
  const runRow = { result: { report: JSON.stringify(good) }, finished_at: "2026-10-01T10:00:00Z" };
  const q = (table) => {
    const b = { select: () => b, eq: (k, v) => { if (table === "agent_runs") filters.push([k, v]); return b; }, neq: () => b, not: () => b, order: () => b,
      limit: async () => ({ data: [], error: null }), range: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: table === "agent_runs" ? (filters.some(([k, v]) => k === "owner_email" && v === "a@example.com") ? runRow : null)
        : { id: "d1", stage: "offered", properties: { address: "100 Example Yard Rd", latitude: null, longitude: null }, offers: [] }, error: null }) };
    return b;
  };
  const NR = class { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; } static json(body, init) { return { body, status: init?.status ?? 200 }; } };
  let who = { email: "A@example.com" };
  const route2 = load("app/api/deals/[id]/ic-deck/route.ts?narrative", {
    "next/server": { NextResponse: NR }, "@/lib/auth": { getCurrentUser: async () => who }, "@/lib/supabase": { getServiceClient: () => ({ from: q }) },
    "@/lib/deals": { STAGE_LABELS: {} }, "@/lib/comps/mapData": load("lib/comps/mapData.ts"), "@/lib/comps/match": load("lib/comps/match.ts"),
    "@/lib/ic-deck/model": model, "@/lib/ic-deck/deck": deck, "@/lib/agents/ic-narrative": nar, "@/lib/agents/catalog": { UUID: /^[0-9a-f-]{36}$/i },
  });
  const rid = "00000000-0000-4000-8000-000000000009", props2 = { params: Promise.resolve({ id: "d1" }) };
  const res = await route2.POST({ json: async () => ({ model: JSON.parse(JSON.stringify(m)), narrativeRunId: rid }) }, props2);
  assert.equal(res.status, 200);
  for (const want of [["id", rid], ["owner_email", "a@example.com"], ["deal_id", "d1"], ["agent", "ic-narrative"], ["status", "completed"]]) {
    assert(filters.some(([k, v]) => k === want[0] && v === want[1]), `narrative lookup filters on ${want[0]}`);
  }
  assert(new PizZip(res.body).file("ppt/slides/slide7.xml").asText().includes("Example Tenant makes widgets."));
  who = { email: "someone-else@example.com" }; filters.length = 0;
  assert.equal((await route2.POST({ json: async () => ({ model: m, narrativeRunId: rid }) }, props2)).status, 404, "another user's run is not usable");
  assert.equal((await route2.POST({ json: async () => ({ model: m, narrativeRunId: "nope" }) }, props2)).status, 400);
  console.log("PASS: narrative contract (sources required), tagged and escaped drafts, sources in notes, owner- and deal-scoped narrative lookup.");
}
