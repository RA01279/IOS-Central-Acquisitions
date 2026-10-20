// scripts/test-comp-import.mjs
//
// Tests lib/agents/comp-import.ts and that its tables read through the real
// comp parser: the agent's PDF rows must land with the right type, rate basis
// and dates, exactly like a pasted broker table.
//   node scripts/test-comp-import.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const loaded = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { exports: loaded, require: (name) => dependencies[name], console }
  );
  return loaded;
}
const { parseCompImport, LEASE_COLUMNS, SALE_COLUMNS } = load("../lib/agents/comp-import.ts");
const parse = load("../lib/comps/parse.ts", { "../stage-rules": load("../lib/stage-rules.ts") });

let n = 0;
const check = (label, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${label}`); throw e; } };
const row = (cols, values) => cols.map((c) => values[c] ?? "");

const report = JSON.stringify({
  leases: [
    row(LEASE_COLUMNS, { Address: "3412 Kelli Ct", City: "Fort Worth", State: "TX", Market: "Dallas", Tenant: "The Landscape Partners", Commencement: "2026-04-01", "Term Months": "60", "Rate (AC/Mo)": "8500", Acres: "3.2", "Free Rent": "2" }),
    row(LEASE_COLUMNS, { Address: "100 Warehouse Way", City: "Houston", State: "TX", Market: "Houston", Tenant: "Acme", Commencement: "2026-02", "Rate Annual": "9.60", "Building SF": "50000" }),
    row(LEASE_COLUMNS, { Address: "", Tenant: "No address" }),
  ],
  sales: [row(SALE_COLUMNS, { Address: "2591 NE 28th St", City: "Fort Worth", State: "TX", "Sale Price": "10750000", "Sale Date": "2026-03-24", Buyer: "Birddog Investments", Acres: "6.1" })],
  notes: ["Skipped two asking rents."],
});

const imp = parseCompImport(report);
check("contract parses", () => assert.ok(imp));
check("rows without an address are dropped", () => assert.equal(imp.leases.split("\n").length, 3));
check("notes kept", () => assert.equal(imp.notes[0], "Skipped two asking rents."));
check("not the contract", () => { assert.equal(parseCompImport("Here are the comps"), null); assert.equal(parseCompImport("{}"), null); });
check("fenced JSON accepted", () => assert.ok(parseCompImport("```json\n" + report + "\n```")));
check("tabs and newlines in cells can't break the table", () => {
  const t = parseCompImport(JSON.stringify({ leases: [row(LEASE_COLUMNS, { Address: "1 A St\t\nSuite 2" })], sales: [] }));
  assert.equal(t.leases.split("\n").length, 2); assert.equal(t.sales, null);
});

const leases = parse.parseCompInput({ text: imp.leases }, { defaultCompType: "lease" }).comps;
check("both leases read", () => assert.equal(leases.length, 2));
check("per-acre rate keeps its basis", () => {
  const k = leases.find((c) => c.address.startsWith("3412"));
  assert.equal(k.compType, "lease"); assert.equal(k.rent, 8500); assert.equal(k.rentBasis, "per_acre_monthly");
  assert.equal(k.dateCommenced, "2026-04-01"); assert.equal(k.tenantName, "The Landscape Partners");
  assert.equal(k.leaseTermMonths, 60); assert.equal(k.freeRentMonths, 2);
});
check("annual per-SF rate keeps its basis", () => {
  const w = leases.find((c) => c.address.startsWith("100"));
  assert.equal(w.rent, 9.6); assert.equal(w.rentBasis, "per_sf_bldg_annual"); assert.equal(w.buildingSf, 50000);
});
const sales = parse.parseCompInput({ text: imp.sales }, { defaultCompType: "sale" }).comps;
check("sale reads", () => {
  assert.equal(sales.length, 1);
  assert.equal(sales[0].compType, "sale"); assert.equal(sales[0].salePrice, 10750000);
  assert.equal(sales[0].closedOn, "2026-03-24"); assert.equal(sales[0].buyer, "Birddog Investments");
});


// The agent writes month-only dates as YYYY-MM and a whole-site rent in "Total Monthly".
const loose = parseCompImport(JSON.stringify({
  leases: [row(LEASE_COLUMNS, { Address: "8811 W Little York", Tenant: "Big Rig Towing", Commencement: "2025-07", "Term Months": "36", "Total Monthly": "12500", "Lease Type": "Gross", Acres: "2.1" })],
  sales: [row(SALE_COLUMNS, { Address: "4710 Aldine Bender", "Sale Price": "4100000", "Sale Date": "2025-04", Acres: "5.6" })],
}));
const ll = parse.parseCompInput({ text: loose.leases }, { defaultCompType: "lease" }).comps[0];
check("Total Monthly is a whole-site rent", () => { assert.equal(ll.rent, 12500); assert.equal(ll.rentBasis, "total_monthly"); });
check("month-only commencement", () => { assert.equal(ll.dateCommenced, "2025-07-01"); assert.equal(ll.datePrecision, "month"); });
const ls = parse.parseCompInput({ text: loose.sales }, { defaultCompType: "sale" }).comps[0];
check("month-only close date", () => assert.equal(ls.closedOn, "2025-04-01"));
check("M/YYYY and YYYY/MM", () => {
  assert.deepEqual({ ...parse.parseCompDate("4/2025") }, { date: "2025-04-01", precision: "month" });
  assert.deepEqual({ ...parse.parseCompDate("2025/11") }, { date: "2025-11-01", precision: "month" });
  assert.equal(parse.parseCompDate("2025-13"), null);
});

console.log(`${n} comp import checks passed`);
