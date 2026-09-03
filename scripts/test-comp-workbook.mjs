// scripts/test-comp-workbook.mjs
//
// Builds spreadsheets shaped like the ones brokers actually send -- title rows,
// two tabs, leading blank columns, sparse rows, formula cells, real Date cells,
// reordered columns -- and runs them through the same path the drop/pick
// handler uses. Run after touching the parser or the workbook reader:
//   node scripts/test-comp-workbook.mjs
import ExcelJS from "exceljs";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const ts = (await import("typescript")).default;
const compile = (rel, out) => {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  const o = new URL(out, import.meta.url);
  writeFileSync(
    fileURLToPath(o),
    ts.transpileModule(readFileSync(p, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText
  );
  return o;
};
const parseUrl = compile("../lib/comps/parse.ts", "../lib/comps/.x1.mjs");
const wbUrl = compile("../lib/comps/fromWorkbook.ts", "../lib/comps/.x2.mjs");
const { parseCompTable, asPropertyReport, assessSheet } = await import(parseUrl.href);
const { workbookToDelimitedText, parseCsv } = await import(wbUrl.href);

let pass = 0, fail = 0;
const ok = (l, c, extra = "") => { if (c) { pass++; console.log(`  PASS ${l}`); } else { fail++; console.log(`  FAIL ${l} ${extra}`); } };

// ---- a broker workbook: title row, blank row, header, data, two tabs ----
const wb = new ExcelJS.Workbook();
const s1 = wb.addWorksheet("Sale Comps");
s1.addRow(["Montgomery County Sale Comparables"]);        // title
s1.addRow([]);                                            // spacer
s1.addRow(["Property Address", "Year Built", "Building SF", "Acreage", "Close Date", "Sales Price", "Price PSF", "Cap Rate"]);
s1.addRow(["1100 Longmire Rd", 2018, 14200, 3.1, new Date("2026-02-11"), 2350000, 165.49, 0.0675]);
s1.addRow(["455 Sgt Ed Holcomb Blvd", 2021, 8600, 1.75, "Nov 2025", 1590000, 184.88, null]);
const s2 = wb.addWorksheet("Lease Comps");
s2.addRow(["Property Address", "Tenant", "Building SF", "Acreage", "Lease Structure", "Monthly Rent", "Rent PSF", "Commencement", "Term (months)", "Clear Height"]);
s2.addRow(["3200 Pollok Dr", "Gulf Coast Equipment", 12000, 2.6, "NNN", 13800, 1.15, new Date("2026-04-01"), 60, "24'"]);
const buf1 = Buffer.from(await wb.xlsx.writeBuffer());

const r1 = await workbookToDelimitedText(buf1, "comps.xlsx");
ok("both sheets read", r1.sheetNames.length === 2, JSON.stringify(r1.sheetNames));
const p1 = parseCompTable(r1.text, { city: "Conroe", market: "Houston" });
ok("all three comps parsed", p1.comps.length === 3, `got ${p1.comps.length}`);
const sales1 = p1.comps.filter((c) => c.compType === "sale");
const leases1 = p1.comps.filter((c) => c.compType === "lease");
ok("2 sales + 1 lease", sales1.length === 2 && leases1.length === 1, `${sales1.length}/${leases1.length}`);
ok("title row ignored", !p1.comps.some((c) => /Comparables/i.test(c.address)));
ok('"Property Address" aliased', sales1[0]?.address === "1100 Longmire Rd", sales1[0]?.address);
ok('"Sales Price" aliased', Number(sales1[0]?.salePrice) === 2350000, String(sales1[0]?.salePrice));
ok("real Date cell -> ISO", sales1[0]?.closedOn === "2026-02-11", String(sales1[0]?.closedOn));
ok('"Acreage" aliased', Number(sales1[0]?.acres) === 3.1, String(sales1[0]?.acres));
ok("cap rate from a decimal cell", Number(sales1[0]?.capRate) === 0.0675, String(sales1[0]?.capRate));
ok("text date on row 2", sales1[1]?.closedOn === "2025-11-01", String(sales1[1]?.closedOn));
ok('"Lease Structure" -> nnn', leases1[0]?.leaseType === "nnn", String(leases1[0]?.leaseType));
ok('"Monthly Rent" aliased', Number(leases1[0]?.rent) === 13800, String(leases1[0]?.rent));
ok("tenant from the sheet", leases1[0]?.tenantName === "Gulf Coast Equipment", String(leases1[0]?.tenantName));
ok("clear height 24'", Number(leases1[0]?.clearHeightFt) === 24, String(leases1[0]?.clearHeightFt));
ok("term months", Number(leases1[0]?.leaseTermMonths) === 60, String(leases1[0]?.leaseTermMonths));

// ---- data starting in column C, with sparse rows ----
const wb2 = new ExcelJS.Workbook();
const s3 = wb2.addWorksheet("Comps");
s3.getCell("C1").value = "Address";
s3.getCell("D1").value = "SF";
s3.getCell("E1").value = "AC";
s3.getCell("F1").value = "Sale Date";
s3.getCell("G1").value = "Price";
s3.getCell("C2").value = "9 Offset Rd";
s3.getCell("D2").value = 5000;
s3.getCell("E2").value = 1.2;
s3.getCell("F2").value = "Jan 2026";
s3.getCell("G2").value = 800000;
// A row missing its middle values entirely -- ExcelJS returns a sparse array.
s3.getCell("C3").value = "10 Sparse Rd";
s3.getCell("G3").value = 900000;
s3.getCell("F3").value = "Feb 2026";
const r2 = await workbookToDelimitedText(Buffer.from(await wb2.xlsx.writeBuffer()), "offset.xlsx");
const p2 = parseCompTable(r2.text, {});
ok("leading blank columns don't shift the mapping", p2.comps[0]?.address === "9 Offset Rd", p2.comps[0]?.address);
ok("...and values still align", Number(p2.comps[0]?.salePrice) === 800000, String(p2.comps[0]?.salePrice));
ok("sparse row keeps its column alignment", p2.comps[1]?.salePrice === 900000, String(p2.comps[1]?.salePrice));

// ---- the address NOT in the first column, so the fallback can't save us ----
const wb5 = new ExcelJS.Workbook();
const s5 = wb5.addWorksheet("Reordered");
s5.addRow(["Close Date", "Sales Price", "Property Address", "Building SF", "Acreage", "Price PSF"]);
s5.addRow(["Jan 2026", 1250000, "12 Header Mapped Rd", 7500, 1.4, 166.67]);
const r5 = await workbookToDelimitedText(Buffer.from(await wb5.xlsx.writeBuffer()), "reordered.xlsx");
const p5 = parseCompTable(r5.text, {});
ok('"Property Address" found by header, not position',
  p5.comps[0]?.address === "12 Header Mapped Rd", p5.comps[0]?.address);
ok("...with the price still right", Number(p5.comps[0]?.salePrice) === 1250000, String(p5.comps[0]?.salePrice));
ok('"Price PSF" recognised', Number(p5.comps[0]?.quotedPsf) === 166.67, String(p5.comps[0]?.quotedPsf));
ok("...and cross-checks clean", p5.comps[0]?.warnings.length === 0, JSON.stringify(p5.comps[0]?.warnings));

// ---- regressions from the real "Conroe Comps (09.02.26).xlsx" ----
// Every one of these produced wrong output on the actual file.
console.log("  -- real-workbook regressions --");

// 1. Header cells containing line breaks. "Type\n(N, R, EXP)" split one
//    spreadsheet row into several text lines, so a fragment was matched as the
//    header and addresses came out as "N" and "EXP" from the Type column.
const wbNl = new ExcelJS.Workbook();
const sNl = wbNl.addWorksheet("Wrapped");
sNl.addRow(["Address", "Type\n(N, R, EXP)", "Square Footage", "Starting Rate (Annual)", "Commencement Date", "Sprinkler\n(ESFR, Wet, or No)"]);
sNl.addRow(["1 Wrapped Header Rd", "N", 9750, 13.56, new Date("2026-01-01"), "ESFR"]);
const rNl = await workbookToDelimitedText(Buffer.from(await wbNl.xlsx.writeBuffer()), "nl.xlsx");
ok("newline in a header cell doesn't split the row", rNl.sheets[0].text.split("\n").length === 2,
  `${rNl.sheets[0].text.split("\n").length} lines`);
const pNl = parseCompTable(rNl.sheets[0].text, {});
ok("address is the address, not the Type column", pNl.comps[0]?.address === "1 Wrapped Header Rd", pNl.comps[0]?.address);
ok('"Square Footage" aliased', Number(pNl.comps[0]?.buildingSf) === 9750, String(pNl.comps[0]?.buildingSf));
ok('"Starting Rate (Annual)" -> annual basis',
  pNl.comps[0]?.rentBasis === "per_sf_bldg_annual" && Number(pNl.comps[0]?.rent) === 13.56,
  `${pNl.comps[0]?.rentBasis} ${pNl.comps[0]?.rent}`);

// 2. Sheets are returned separately. Tabs are often different datasets -- the
//    real file has two tabs of Conroe comps and one of Houston Southwest comps
//    from four years earlier, which must not be imported under one market.
const wbMulti = new ExcelJS.Workbook();
const mA = wbMulti.addWorksheet("Lease Comps");
mA.addRow(["Close Date", "Commencement Date", "Address", "Tenant", "SF", "Starting Rate (Monthly)"]);
mA.addRow(["2025-04-17", "2026-01-01", "2 Conroe Way", "GroupSix", 9750, 1.13]);
const mB = wbMulti.addWorksheet("Sale Comps");
mB.addRow(["Close Date", "Project Name", "Address", "Buyer Company Name", "Seller Company Name", "SF", "Sale Price ($)", "Sale Price ($/SF)"]);
mB.addRow(["2026-03-20", "Pine Crossing Business Park - Bldg. C", "3513 N Loop 336 W", "Khattak", "Black Mallard", 6000, 860000, 143.33]);
mB.addRow(["2026-03-20", "Pine Crossing Business Park - Bldg. D", "3513 N Loop 336 W", "Khattak", "Black Mallard", 6000, 860000, 143.33]);
const rMulti = await workbookToDelimitedText(Buffer.from(await wbMulti.xlsx.writeBuffer()), "multi.xlsx");
ok("sheets come back separately", rMulti.sheets.length === 2, String(rMulti.sheets.length));

// 3. A lease tab leading with "Close Date" must still be typed as a lease.
//    Taking that first signal mistyped six lease comps as sales with no price.
const pLease = parseCompTable(rMulti.sheets[0].text, {});
ok('"Close Date" on a lease tab still parses as LEASE',
  pLease.comps[0]?.compType === "lease", pLease.comps[0]?.compType);
ok("...using Commencement Date, not Close Date",
  pLease.comps[0]?.dateCommenced === "2026-01-01", String(pLease.comps[0]?.dateCommenced));
ok('"Starting Rate (Monthly)" -> monthly basis',
  pLease.comps[0]?.rentBasis === "per_sf_bldg_monthly", String(pLease.comps[0]?.rentBasis));

const pSale = parseCompTable(rMulti.sheets[1].text, {});
ok("sale tab parses as SALE", pSale.comps.every((c) => c.compType === "sale"));
ok('"Buyer Company Name" aliased', pSale.comps[0]?.buyer === "Khattak", String(pSale.comps[0]?.buyer));
ok('"Sale Price ($)" aliased', Number(pSale.comps[0]?.salePrice) === 860000, String(pSale.comps[0]?.salePrice));
// 4. Two buildings sharing a street address and close date are distinguished
//    only by project name -- without it the second is dropped as a duplicate.
ok("both same-address buildings kept", pSale.comps.length === 2, String(pSale.comps.length));
ok("project names differ", pSale.comps[0]?.projectName !== pSale.comps[1]?.projectName,
  `${pSale.comps[0]?.projectName} vs ${pSale.comps[1]?.projectName}`);
ok("project name ends in Bldg. C", /Bldg\. C$/.test(pSale.comps[0]?.projectName ?? ""), String(pSale.comps[0]?.projectName));

// ---- rent roll, shaped like a real one ----
// Mirrors Oakbrook Center: a title block holding the address, a tenant table
// keyed by suite, a TOTAL row, an annualized summary, and a LEASE EXPIRATION
// SCHEDULE that is itself a table. Every one of those trailing blocks imported
// as phantom comps before this was handled.
console.log("  -- rent roll --");
const wbRR = new ExcelJS.Workbook();
const rr = wbRR.addWorksheet("Rent Roll");
rr.addRow(["OAKBROOK CENTER", "", "", "", "", "", "", "", "", "", "", new Date("2026-06-23")]);
rr.addRow(["Rent Roll", "2025 Louisville Road, Savannah, Georgia"]);
rr.addRow(["Greenspace Management  ·  9 Judson Court, Savannah, GA 31410"]);
rr.addRow(["As of June 23, 2026"]);
rr.addRow([]);
rr.addRow(["Suite", "Tenant", "Square Feet", "Base Rent / Mo", "Rent $/SF/Yr", "CAM / Mo", "CAM $/SF/Yr", "Total Monthly", "Lease Expiration", "Months Remaining"]);
rr.addRow(["Ste A", "Fingersafe USA", 6250, 4219, 8.10048, 531, 1.01952, 4750, new Date("2030-05-31"), 47]);
rr.addRow(["Ste B", "KTK Host South", 6250, 4687.5, 9, 400, 0.768, 5087.5, new Date("2028-09-30"), 27]);
rr.addRow(["Ste I", "Marta McWhorter", 3900, 2437.5, 7.5, 325, 1, 2762.5, new Date("2026-07-31"), 1]);
rr.addRow(["TOTAL", "9 units  ·  100% leased", 51700, 39486, 9.165, 4192.25, 0.973, 43678.25]);
rr.addRow([]);
rr.addRow(["ANNUALIZED SUMMARY"]);
rr.addRow(["Gross Leasable Area (SF)", "", 51700]);
rr.addRow(["Annual Base Rent", "", 473832]);
rr.addRow([]);
rr.addRow(["LEASE EXPIRATION SCHEDULE"]);
rr.addRow(["Expiration", "Suites", "Square Feet", "% of GLA", "Base Rent / Mo"]);
rr.addRow([new Date("2026-07-31"), "F, I", 9600, 0.1857, 6475]);
rr.addRow([new Date("2030-05-31"), "A", 6250, 0.1209, 4219]);

const rrText = (await workbookToDelimitedText(Buffer.from(await wbRR.xlsx.writeBuffer()), "rr.xlsx")).sheets[0].text;
const rrRes = parseCompTable(rrText, {
  address: "2025 Louisville Rd", city: "Savannah", market: "Savannah, GA",
  assumedTermMonths: 60, defaultCompType: "lease",
});
ok("only the tenant rows import", rrRes.comps.length === 3, `got ${rrRes.comps.length}`);
ok("TOTAL row excluded", !rrRes.comps.some((c) => /total/i.test(String(c.suite ?? "") + String(c.address))));
ok("annualized summary excluded", !rrRes.comps.some((c) => /Gross Leasable|Annual Base/i.test(String(c.address))));
ok("expiration schedule excluded", rrRes.comps.every((c) => c.suite && /^Ste/.test(c.suite)),
  JSON.stringify(rrRes.comps.map((c) => c.suite)));
ok("suite captured", rrRes.comps[0].suite === "Ste A", String(rrRes.comps[0].suite));
ok("property address applied, not the suite", rrRes.comps[0].address === "2025 Louisville Rd", rrRes.comps[0].address);
ok("tenant captured", rrRes.comps[0].tenantName === "Fingersafe USA", String(rrRes.comps[0].tenantName));
ok('"Base Rent / Mo" no longer dropped', rrRes.comps[0].rent !== null, String(rrRes.comps[0].rent));
ok('"Rent $/SF/Yr" wins as the explicit basis',
  rrRes.comps[0].rentBasis === "per_sf_bldg_annual" && Math.abs(rrRes.comps[0].rent - 8.10048) < 0.001,
  `${rrRes.comps[0].rentBasis} ${rrRes.comps[0].rent}`);
ok('"CAM $/SF/Yr" captured', Math.abs(rrRes.comps[0].camPsfAnnual - 1.01952) < 0.001, String(rrRes.comps[0].camPsfAnnual));
ok("expiration captured", rrRes.comps[0].leaseExpiresOn === "2030-05-31", String(rrRes.comps[0].leaseExpiresOn));
// Expiry minus the assumed 60-month term, flagged and coarsened.
ok("commencement estimated from expiry", rrRes.comps[0].dateCommenced === "2025-05-31", String(rrRes.comps[0].dateCommenced));
ok("...flagged as an estimate", rrRes.comps[0].dateEstimated === true);
ok("...with coarse precision", rrRes.comps[0].datePrecision === "year", String(rrRes.comps[0].datePrecision));
ok("...and it says so in the warnings", rrRes.comps[0].warnings.some((w) => /estimated/i.test(w)));

// Dropping a roll with the term left blank must point at the fix, not just
// reject nine rows for a missing date.
const rrNoTerm = parseCompTable(
  ["Suite | Tenant | Square Feet | Base Rent / Mo | Lease Expiration",
   "Ste A | Someone | 1,000 | 1,000 | 2030-05-31"].join("\n"),
  { address: "1 Somewhere Rd", defaultCompType: "lease" }
);
ok("no term, no estimate", rrNoTerm.comps[0].dateCommenced === null, String(rrNoTerm.comps[0].dateCommenced));
ok("...not falsely flagged", rrNoTerm.comps[0].dateEstimated === false);
ok("...and the warning names the fix",
  rrNoTerm.comps[0].warnings.some((w) => /assumed lease term/i.test(w)),
  JSON.stringify(rrNoTerm.comps[0].warnings));

// A stated term must beat the assumption: that's arithmetic, not a guess.
const rrTerm = parseCompTable(
  ["Suite | Tenant | Square Feet | Base Rent / Mo | Lease Expiration | Term",
   "Ste Z | Someone | 1,000 | 1,000 | 2030-01-31 | 36"].join("\n"),
  { address: "1 Somewhere Rd", assumedTermMonths: 60, defaultCompType: "lease" }
);
ok("stated term used instead of the assumption", rrTerm.comps[0].dateCommenced === "2027-01-31", String(rrTerm.comps[0].dateCommenced));
ok("...and is NOT flagged as estimated", rrTerm.comps[0].dateEstimated === false);
ok("...with month precision", rrTerm.comps[0].datePrecision === "month", String(rrTerm.comps[0].datePrecision));

// Month arithmetic must not roll into the next month off a 31st.
const rrClamp = parseCompTable(
  ["Suite | Tenant | Square Feet | Base Rent / Mo | Lease Expiration | Term",
   "Ste Y | Someone | 1,000 | 1,000 | 2030-05-31 | 3"].join("\n"),
  { address: "1 Somewhere Rd", defaultCompType: "lease" }
);
ok("day clamped when the target month is shorter", rrClamp.comps[0].dateCommenced === "2030-02-28", String(rrClamp.comps[0].dateCommenced));

// ---- the standard TX IOS lease comp template ----
// Dalfen's canonical IOS lease comp format. Nine tabs, one of which holds the
// comps; a stranded reference list out past the last real column; free text
// containing the delimiter; and a rate column whose label is wrong.
console.log("  -- standard IOS lease comp template --");
const IOS_HEADER = [
  "Address", "City", "State", "CoStar Market", "CoStar Submarket Cluster", "Canvassing Submarket",
  "Region", "Gross Acres", "Usable Acres", "Parking Spaces", "Building Area", "Landlord",
  "Institutional Landlord (Yes/No)", "Tenant", "Tenant Usage", "Date", "Term (Months)",
  "Rate ($/Building SF/Mo)", "Rate ($/Land SF/Mo)", "Rate (AC/Mo)", "Coverage",
  "Rate (per stall/spot/door)", "Free Rent", "Escalations", "TI", "Lease Type", "Column1",
  "New/Renewal", "Comments", "Source", "Latitude", "Longitude", "", "City", "CoStar Market (MSA)",
];
// Real numbers off the file's first row: 6.19 AC, 20,200 SF, $6,785/AC/mo.
// $6,785 x 6.19 / 20,200 = $2.079/SF/mo -- and the sheet's "per month" column
// says 24.95, which is 12x that.
const iosRow = (over = {}) => {
  const r = [
    "2910 Pasadena Fwy", "Pasadena", "TX", "Houston", "East-Southeast Far", "", "South Central",
    6.19, 6.19, "", 20200, "The Allman Company", "", "Atlanta Pacific Equipment", "",
    "2026-09-01", 124, 24.95049504950495, 0.1557653195191747, 6785.13731825525,
    0.07491570129255545, "", 5, 0.0325, "", "NNN", "", "New", "Paved", "NAI: Josh Carl 7/8/2026",
    29.7117036688035, -95.1728786252406, "", "San Antonio", "San Antonio",
  ];
  for (const [i, v] of Object.entries(over)) r[Number(i)] = v;
  return r;
};

const wbIos = new ExcelJS.Workbook();
const shComps = wbIos.addWorksheet("IOS Lease Comps");
shComps.addRow(IOS_HEADER);
shComps.addRow(iosRow());
// A comment containing the delimiter, which used to shatter the row.
shComps.addRow(iosRow({ 0: "141 Balcones Rd N", 3: "San Antonio", 13: "United Rentals",
  28: "New asphalt, showroom good | Significant demand for IOS in NW Submarket 3-acres >" }));
shComps.addRow(iosRow({ 0: "1 Double Net Rd", 25: "NN", 27: "Renewal", 12: "Yes",
  14: "Equipment rental", 9: 40, 21: 125 }));
// On-Market: byte-identical header, asking rates.
const shOnMkt = wbIos.addWorksheet("On-Market Deals");
shOnMkt.addRow(IOS_HEADER);
shOnMkt.addRow(iosRow({ 0: "1901 Jasmine Dr", 28: "ON MARKET - asking rate, not a signed lease" }));
// Machinery, visible.
const shScreen = wbIos.addWorksheet("Comp Screener");
shScreen.addRow(["Comp Screener | Subject vs. Lease Comps"]);
shScreen.addRow(["Address", "City", "Building Area", "Rate (AC/Mo)", "Date", "Distance (mi)", "Total Score"]);
shScreen.addRow(["1571 Hawthorne Dr", "Conroe", 9000, 5000, "2025-01-01", 47.5, 22.7]);
const shGeo = wbIos.addWorksheet("Geocode Batch");
shGeo.addRow(["Table Row", "Address", "City", "State", "Latitude (paste)", "Longitude (paste)", "Lease Date"]);
shGeo.addRow([231, "615 S Wisteria St", "Mansfield", "TX", "", "", "2025-01-01"]);
// Hidden lookup: 3 rows here, 16,709 in the real file.
const shGroup = wbIos.addWorksheet("Submarket Grouping", { state: "hidden" });
shGroup.addRow(["Address", "City", "Submarket", "Market", "State", "State Abbreviation", "Region"]);
shGroup.addRow(["228 Irby Ln", "Irving", "Brookhollow / Trinity", "DFW", "Alabama", "AL", "Southeast"]);
shGroup.addRow(["2645 Irving Blvd", "Dallas", "Brookhollow / Trinity", "DFW", "Arizona", "AZ", "West"]);

const iosWb = await workbookToDelimitedText(Buffer.from(await wbIos.xlsx.writeBuffer()), "ios.xlsx");
ok("hidden tabs dropped before parsing", iosWb.sheets.length === 4 && iosWb.sheetNames.length === 5,
  `${iosWb.sheets.length} flattened of ${iosWb.sheetNames.length}`);
ok("...and the skip is reported", iosWb.warnings.some((w) => /hidden tab/i.test(w)));
ok("no [object Object] survives", !iosWb.text.includes("[object Object]"));

// -- tab selection --
const pick = Object.fromEntries(iosWb.sheets.map((s) => [s.name, assessSheet(s.name, s.text)]));
ok("the comp tab is read", pick["IOS Lease Comps"].include);
ok("on-market tab excluded", !pick["On-Market Deals"].include);
ok("...for the right reason", /asking or on-market/i.test(pick["On-Market Deals"].skipped ?? ""),
  String(pick["On-Market Deals"].skipped));
// The screener maps real comp fields AND carries a rate, so structure alone
// can't reject it -- 20 duplicates of comps already on the real tab.
ok("screener excluded despite looking comp-shaped", !pick["Comp Screener"].include,
  `${pick["Comp Screener"].fields} fields`);
ok("geocode helper excluded", !pick["Geocode Batch"].include);

const iosSheet = iosWb.sheets.find((s) => s.name === "IOS Lease Comps");
// Column alignment: the pipe-bearing comment must not shift anything right.
const iosLines = iosSheet.text.split("\n");
ok("no row is wider than the header",
  iosLines.every((l) => l.split(" | ").length <= IOS_HEADER.length),
  `widest ${Math.max(...iosLines.map((l) => l.split(" | ").length))} vs ${IOS_HEADER.length}`);

const iosRes = parseCompTable(iosSheet.text, { defaultCompType: "lease" });
ok("all three comps read", iosRes.comps.length === 3, `got ${iosRes.comps.length}`);
const i0 = iosRes.comps[0];
ok("address", i0.address === "2910 Pasadena Fwy", i0.address);
ok('"CoStar Market" aliased', i0.market === "Houston", String(i0.market));
ok("...not the stranded col-35 market", i0.market !== "San Antonio");
ok("...and city is col 2, not the stranded col 34", i0.city === "Pasadena", String(i0.city));
ok('"CoStar Submarket Cluster" aliased', i0.submarket === "East-Southeast Far", String(i0.submarket));
ok("region captured", i0.region === "South Central", String(i0.region));
ok("gross acres -> site", i0.acres === 6.19, String(i0.acres));
ok("usable acres -> yard", i0.yardAcres === 6.19, String(i0.yardAcres));
ok('"Building Area" is building SF', i0.buildingSf === 20200, String(i0.buildingSf));
ok("bare Date column read as commencement", i0.dateCommenced === "2026-09-01", String(i0.dateCommenced));
ok("term", i0.leaseTermMonths === 124, String(i0.leaseTermMonths));
// The rate that matters: IOS is priced per acre.
ok("per-acre rate wins", Math.abs(i0.rent - 6785.137) < 0.01, String(i0.rent));
ok("...with the per-acre basis", i0.rentBasis === "per_acre_monthly", String(i0.rentBasis));
// The mislabelled column, caught by arithmetic rather than trusted.
ok("mislabelled building-SF column detected",
  i0.warnings.some((w) => /is annual, not monthly/.test(w)), JSON.stringify(i0.warnings));
ok("coordinates taken from the file", i0.latitude === 29.7117036688035 && i0.longitude === -95.1728786252406,
  `${i0.latitude},${i0.longitude}`);
ok("row-level source captured", i0.sourceRef === "NAI: Josh Carl 7/8/2026", String(i0.sourceRef));
ok("new/renewal captured", i0.dealKind === "new", String(i0.dealKind));

const i1 = iosRes.comps[1];
ok("pipe in a comment doesn't shift the row", i1.address === "141 Balcones Rd N", i1.address);
ok("...market still right", i1.market === "San Antonio", String(i1.market));
ok("...coordinates still right", i1.latitude === 29.7117036688035, String(i1.latitude));
ok("...and the pipe became a slash in the note", /showroom good \/ Significant/.test(String(i1.notes)),
  String(i1.notes));

const i2 = iosRes.comps[2];
ok("NN kept as its own structure", i2.leaseType === "nn", String(i2.leaseType));
ok("renewal captured", i2.dealKind === "renewal", String(i2.dealKind));
ok("institutional landlord Yes -> true", i2.institutionalLandlord === true, String(i2.institutionalLandlord));
ok("tenant usage captured", i2.tenantUsage === "Equipment rental", String(i2.tenantUsage));
ok("parking spaces captured", i2.parkingSpaces === 40, String(i2.parkingSpaces));
ok("per-stall rate captured", i2.ratePerStall === 125, String(i2.ratePerStall));

// A multi-market file must not be silently filed under one market.
const iosOverridden = parseCompTable(iosSheet.text, { defaultCompType: "lease", market: "Conroe" });
ok("every row took the typed market", iosOverridden.comps.every((c) => c.market === "Conroe"));
ok("...but the override is reported",
  iosOverridden.warnings.some((w) => /markets of its own/i.test(w) && /Houston/.test(w) && /San Antonio/.test(w)),
  JSON.stringify(iosOverridden.warnings));
ok("no such warning when the market is left blank",
  !iosRes.warnings.some((w) => /markets of its own/i.test(w)));

// A correctly-labelled monthly column must NOT be flagged as annual.
const honest = parseCompTable(
  [["Address", "Usable Acres", "Building Area", "Rate ($/Building SF/Mo)", "Rate (AC/Mo)", "Date"].join(" | "),
   ["1 Honest Rd", 6.19, 20200, 2.079, 6785.137, "2026-09-01"].join(" | ")].join("\n"),
  { defaultCompType: "lease" }
);
ok("an honest monthly column raises no mislabel warning",
  !honest.comps[0].warnings.some((w) => /annual, not monthly/.test(w)),
  JSON.stringify(honest.comps[0].warnings));

// ---- CoStar property report ----
// The real Oakbrook export: 38 columns of attributes, two buildings sharing a
// street address, and no transaction anywhere in it. Not a comp table -- but
// it holds exactly the address and market a rent roll leaves out.
console.log("  -- property report --");
const PR_HEADER = [
  "Property Address", "Property Name", "Property Type", "Building Class", "Building Status",
  "RBA", "Total Available Space (SF)", "Market Name", "Submarket Name", "Leasing Company Name",
  "Submarket Cluster", "City", "State", "Zip", "County Name", "For Sale Price", "For Sale Status",
  "Last Sale Date", "Last Sale Price", "Percent Leased", "Year Built", "Tenancy",
  "Clear Height", "Land Area (AC)", "Land Area (SF)", "Zoning",
];
const prRow = (name, rba, ac, sf, saleDate = "", salePrice = "") => [
  "2025 Louisville Rd", name, "Industrial", "C", "Existing", rba, "", "Savannah, GA",
  "Greater Savannah", "Greenspace Management", "Greater Savannah", "Savannah", "GA", "31415",
  "Chatham", "", "N", saleDate, salePrice, "100", "1987", "Multi", "", ac, sf, "I-L",
];
const prText = [PR_HEADER, prRow("B", 24975, 1.62, 70567), prRow("A", 24430, 3.01, 131116)]
  .map((r) => r.join(" | ")).join("\n");
const prRes = parseCompTable(prText, {});

ok("both buildings read", prRes.comps.length === 2, `got ${prRes.comps.length}`);
// "Property Name" holds "B", not a street -- it used to alias to address, and
// was only right by accident of Property Address coming first.
ok("street address, not the building letter", prRes.comps[0].address === "2025 Louisville Rd", prRes.comps[0].address);
ok('"Property Name" is the project', prRes.comps[0].projectName === "B", String(prRes.comps[0].projectName));
ok('"Market Name" aliased', prRes.comps[0].market === "Savannah, GA", String(prRes.comps[0].market));
ok('"Submarket Name" beats "Submarket Cluster"', prRes.comps[0].submarket === "Greater Savannah", String(prRes.comps[0].submarket));
ok("RBA is building SF", prRes.comps[0].buildingSf === 24975, String(prRes.comps[0].buildingSf));
ok('"Land Area (SF)" aliased', prRes.comps[0].lotSf === 70567, String(prRes.comps[0].lotSf));
ok('"Land Area (AC)" aliased', prRes.comps[0].acres === 1.62, String(prRes.comps[0].acres));
ok("zoning captured", prRes.comps[0].zoning === "I-L", String(prRes.comps[0].zoning));
ok("no sale price invented", prRes.comps[0].salePrice === null, String(prRes.comps[0].salePrice));

// The classifier: attributes with no transaction is a property report.
const prClass = asPropertyReport(prRes.comps);
ok("recognised as a property report", prClass !== null && prClass.length === 2);

// "For Sale Price" is an ASKING price. Letting it through would seed the
// repository with list prices dressed as comps.
const asking = parseCompTable(
  [PR_HEADER.join(" | "),
   prRow("B", 24975, 1.62, 70567).map((c, i) => (i === 15 ? "2750000" : c)).join(" | ")].join("\n"),
  {}
);
ok("asking price is not a sale price", asking.comps[0].salePrice === null, String(asking.comps[0].salePrice));
ok("...so it's still just a property report", asPropertyReport(asking.comps) !== null);

// But a populated Last Sale IS a comp, and must stop being a property report.
const traded = parseCompTable(
  [PR_HEADER.join(" | "), prRow("B", 24975, 1.62, 70567, "3/14/2025", "2450000").join(" | ")].join("\n"),
  {}
);
ok('"Last Sale Price" is a sale price', traded.comps[0].salePrice === 2450000, String(traded.comps[0].salePrice));
ok('"Last Sale Date" is the close date', traded.comps[0].closedOn === "2025-03-14", String(traded.comps[0].closedOn));
ok("a traded building is a comp, not a report", asPropertyReport(traded.comps) === null);

// One row missing its rent inside a real comp table must stay a visible
// rejected comp -- never get reclassified into something the reviewer's
// drafts list won't show.
const gappy = parseCompTable(
  ["Address | City | Market | Building SF | Year Built | Rent $/SF/Yr | Commenced",
   "1 Real Comp Rd | Conroe | Houston | 10,000 | 2019 | 9.00 | 1/1/2026",
   "2 Missing Rent Rd | Conroe | Houston | 12,000 | 2020 |  | 1/1/2026"].join("\n"),
  {}
);
ok("gappy comp table is not a property report", asPropertyReport(gappy.comps) === null,
  `${gappy.comps.length} rows`);

// And a table we simply failed to read shouldn't masquerade as a report.
const unreadable = parseCompTable(
  ["Address | Some Column", "1 Nothing Rd | x", "2 Nothing Rd | y"].join("\n"), {}
);
ok("unreadable table is not a property report", asPropertyReport(unreadable.comps) === null);

// ---- a formula cell, which is what a Price PSF column usually is ----
const wb3 = new ExcelJS.Workbook();
const s4 = wb3.addWorksheet("F");
s4.addRow(["Address", "SF", "AC", "Sale Date", "Price", "Price/SF"]);
s4.addRow(["11 Formula St", 10000, 2.0, "Mar 2026", 1600000, { formula: "E2/B2", result: 160 }]);
const r3 = await workbookToDelimitedText(Buffer.from(await wb3.xlsx.writeBuffer()), "f.xlsx");
const p3 = parseCompTable(r3.text, {});
ok("formula cell uses its cached result", Number(p3.comps[0]?.quotedPsf) === 160, String(p3.comps[0]?.quotedPsf));
ok("...and cross-check passes", p3.comps[0]?.warnings.length === 0, JSON.stringify(p3.comps[0]?.warnings));

// ---- CSV with a quoted comma in the address ----
const csv = `Address,SF,AC,Sale Date,Price\n"1000 Main St, Suite 4",8000,1.5,Jan 2026,$1200000\n`;
const r4 = await workbookToDelimitedText(Buffer.from(csv, "utf8"), "c.csv");
const p4 = parseCompTable(r4.text, {});
ok("quoted comma survives CSV parsing", p4.comps[0]?.address === "1000 Main St, Suite 4", p4.comps[0]?.address);
ok("csv price", Number(p4.comps[0]?.salePrice) === 1200000, String(p4.comps[0]?.salePrice));

unlinkSync(fileURLToPath(parseUrl));
unlinkSync(fileURLToPath(wbUrl));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
