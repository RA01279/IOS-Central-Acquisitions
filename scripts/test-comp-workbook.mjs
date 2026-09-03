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
const { parseCompTable } = await import(parseUrl.href);
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
