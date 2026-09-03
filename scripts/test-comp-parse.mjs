// scripts/test-comp-parse.mjs
//
// Exercises lib/comps/parse.ts against the real Matthews comp email (Doc
// Perrier, Conroe, Sep 2026) plus the awkward variants brokers actually send.
// Run after touching the parser:  node scripts/test-comp-parse.mjs
//
// Uses the TypeScript source through a tiny transpile step so there's one copy
// of the parser, not a JS duplicate that drifts.
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

// The parser is plain logic with no runtime TS features, so transpiling away
// the type annotations is enough to exercise the real source rather than a JS
// copy that would drift from it. typescript is already a devDependency.
const ts = (await import("typescript")).default;
const srcPath = fileURLToPath(new URL("../lib/comps/parse.ts", import.meta.url));
const tmpUrl = new URL("../lib/comps/.parse.test.mjs", import.meta.url);
writeFileSync(
  fileURLToPath(tmpUrl),
  ts.transpileModule(readFileSync(srcPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
);
const { parseCompTable, parseCompDate } = await import(tmpUrl.href);

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------- real email
// Exactly as it flattens out of the Outlook HTML, both tables, prose between,
// and a quoted reply underneath.
const REAL_EMAIL = `Hey Jadon/ Rhett-
See below comps. Trade Ridge and 105 were leased, others were vacant. These sold at low 7 caps.
Addres | Year Built | SF | AC | Coverage | Sale Date | Price | Price/SF
2933 E Davis St | 2017 | ±9,900 | ±1.40 | 16.40% | Jan 2026 | $1,485,000 | $150.00
2017 Trader Ridge Dr | 2019 | ±15,030 | ±2.16 | 16.00% | Sep 2025 | $2,464,920 | $164.00
2346 FM 1484 Rd | 2024 | ±7,500 | ±1.00 | 17.00% | Jan 2025 | $1,350,000 | $180.00
11368 FM 2854 Rd | 2005 | ±4,700 | ±1.94 | 6.00% | — | $715,000 | $152.13
12087 Highway 105 E | 2012 | ±9,600 | ±1.84 | 12.00% | Mar 2025 | $1,675,000 | $174.47
Here are some buildings that were leased:
Addres | Year Built | SF | AC | Coverage | Lease Type | Monthly Base | Price/SF
601 Aurora Business Park Dr | 2013 | ±9,900 | ±2.11 | 10.79% | NNN | $11,385 | $1.15
1571 Hawthorne Dr | 2022 | ±9,000 | ±1.50 | 13.77% | NNN | $9,900 | $1.10
630 Aurora Business Park Dr | 2013 | ±9,960 | ±1.41 | 16.18% | NNN | $10,956 | $1.10
2004 Trader Ridge Dr | 2022 | ±20,000 | ±2.35 | — | NNN | $20,000 | $1.00
12087 Highway 105 E | 2012 | ±9,600 | ±1.84 | 12.00% | — | $10,000 | $1.04
Thank you,
Doc Perrier
From: Jadon Potts <jpotts@dalfen.com>
Sent: Wednesday, September 2, 2026 5:31 PM
Addres | Year Built | SF | AC | Coverage | Sale Date | Price | Price/SF
9999 Should Not Appear | 2000 | ±1,000 | ±1.00 | 2.00% | Jan 2020 | $100,000 | $100.00`;

console.log("== real Matthews comp email ==");
const real = parseCompTable(REAL_EMAIL, { city: "Conroe", market: "Houston" });
check("total comps", real.comps.length, 10);
check("sale comps", real.comps.filter((c) => c.compType === "sale").length, 5);
check("lease comps", real.comps.filter((c) => c.compType === "lease").length, 5);
check("quoted history excluded", real.comps.some((c) => c.address.includes("Should Not Appear")), false);

const s0 = real.comps[0];
check("sale address", s0.address, "2933 E Davis St");
check("sale ± stripped from building SF", s0.buildingSf, 9900);
check("sale acres", s0.acres, 1.4);
check("acres -> lot SF", s0.lotSf, 60984);
check("month-only date", s0.closedOn, "2026-01-01");
check("date precision recorded", s0.datePrecision, "month");
check("sale price", s0.salePrice, 1485000);
check("quoted psf kept", s0.quotedPsf, 150);
check("coverage as fraction", s0.coveragePct, 0.164);
check("context city applied", s0.city, "Conroe");
check("no warnings on a clean row", s0.warnings, []);

const missingDate = real.comps.find((c) => c.address === "11368 FM 2854 Rd");
check("em-dash date -> null", missingDate.closedOn, null);
check("missing date warned", missingDate.warnings.includes("No sale date found"), true);

const l0 = real.comps.find((c) => c.address === "601 Aurora Business Park Dr");
check("lease type parsed", l0.leaseType, "nnn");
check("monthly rent", l0.rent, 11385);
check("rent basis inferred", l0.rentBasis, "total_monthly");
check("lease missing commencement warned", l0.warnings.some((w) => w.includes("commencement")), true);

const bothTables = real.comps.filter((c) => c.address === "12087 Highway 105 E");
check("same address in both tables kept", bothTables.length, 2);
check("...as one sale and one lease", bothTables.map((c) => c.compType).sort(), ["lease", "sale"]);

// ------------------------------------------------------------------- dates
console.log("\n== date formats ==");
check("Jan 2026", parseCompDate("Jan 2026"), { date: "2026-01-01", precision: "month" });
check("September 2025", parseCompDate("September 2025"), { date: "2025-09-01", precision: "month" });
check("Q3 2025", parseCompDate("Q3 2025"), { date: "2025-07-01", precision: "quarter" });
check("3/15/2026", parseCompDate("3/15/2026"), { date: "2026-03-15", precision: "day" });
check("2026-03-15", parseCompDate("2026-03-15"), { date: "2026-03-15", precision: "day" });
check("Jan-26", parseCompDate("Jan-26"), { date: "2026-01-01", precision: "month" });
check("2024", parseCompDate("2024"), { date: "2024-01-01", precision: "year" });
check("em-dash", parseCompDate("—"), null);
check("garbage", parseCompDate("soon"), null);

// ------------------------------------------------------------ tab-delimited
console.log("\n== tab-delimited paste from Excel ==");
const TABBED = [
  "Address\tBuilding SF\tAcres\tSale Date\tSale Price\tCap Rate",
  "100 Industrial Way\t12,000\t3.50\t6/1/2026\t$2,100,000\t6.75%",
].join("\n");
const tabbed = parseCompTable(TABBED, { market: "DFW" });
check("tab rows", tabbed.comps.length, 1);
check("tab cap rate to fraction", tabbed.comps[0].capRate, 0.0675);
check("tab sale price", tabbed.comps[0].salePrice, 2100000);
check("tab computed coverage", tabbed.comps[0].coveragePct, 0.0787);

// --------------------------------------------------------- mismatch warnings
console.log("\n== cross-check catches a misread column ==");
const BAD = [
  "Address | SF | AC | Sale Date | Price | Price/SF",
  "5 Wrong St | 10,000 | 2.00 | Jan 2026 | $1,000,000 | $500.00",
].join("\n");
const bad = parseCompTable(BAD, {});
check("psf mismatch warned", bad.comps[0].warnings.some((w) => w.includes("doesn't match price")), true);

const BADCOV = [
  "Address | SF | AC | Coverage | Sale Date | Price",
  "6 Wrong St | 10,000 | 2.00 | 80.00% | Jan 2026 | $1,000,000",
].join("\n");
const badcov = parseCompTable(BADCOV, {});
check("coverage mismatch warned", badcov.comps[0].warnings.some((w) => w.includes("coverage")), true);

// ------------------------------------------------------------------ garbage
console.log("\n== nothing parseable ==");
const empty = parseCompTable("Hey Rhett, give me a call about Conroe when you get a sec.", {});
check("no comps", empty.comps.length, 0);
check("explains itself", empty.warnings.some((w) => w.includes("No comp rows recognised")), true);

unlinkSync(fileURLToPath(tmpUrl));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
