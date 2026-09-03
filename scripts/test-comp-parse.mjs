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
const { parseCompTable, parseCompDate, parseCompHtml, parseCompInput } = await import(tmpUrl.href);

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

// --------------------------------------------------------------- HTML paste
// Shaped like what Outlook actually puts on the clipboard: MsoNormalTable
// classes, inline styles, &nbsp; padding, a tracking image and a <style> block.
console.log("\n== pasted email HTML (clipboard text/html) ==");
const REAL_HTML = `
<html><head><style>p.MsoNormal{margin:0}</style></head><body>
<p class=MsoNormal>Hey Jadon/&nbsp;Rhett-</p>
<p class=MsoNormal>See below comps. These sold at&nbsp;low 7 caps.</p>
<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0>
<tr><td><b>Addres</b></td><td><b>Year Built</b></td><td><b>SF</b></td><td><b>AC</b></td>
    <td><b>Coverage</b></td><td><b>Sale Date</b></td><td><b>Price</b></td><td><b>Price/SF</b></td></tr>
<tr><td>2933 E Davis St</td><td>2017</td><td>&plusmn;9,900</td><td>&plusmn;1.40</td>
    <td>16.40%</td><td>Jan 2026</td><td>$1,485,000</td><td>$150.00</td></tr>
<tr><td>11368 FM 2854 Rd</td><td>2005</td><td>&plusmn;4,700</td><td>&plusmn;1.94</td>
    <td>6.00%</td><td>&mdash;</td><td>$715,000</td><td>$152.13</td></tr>
</table>
<p class=MsoNormal>Here are some buildings that were leased:</p>
<table class=MsoNormalTable>
<tr><td>Addres</td><td>Year Built</td><td>SF</td><td>AC</td><td>Coverage</td>
    <td>Lease Type</td><td>Monthly Base</td><td>Price/SF</td></tr>
<tr><td>601 Aurora Business Park Dr</td><td>2013</td><td>&plusmn;9,900</td><td>&plusmn;2.11</td>
    <td>10.79%</td><td>NNN</td><td>$11,385</td><td>$1.15</td></tr>
</table>
<img src="https://tracking.example.com/pixel.gif" width=1 height=1>
<div>From: Jadon Potts &lt;jpotts@dalfen.com&gt;</div>
<table><tr><td>Addres</td><td>SF</td><td>AC</td><td>Sale Date</td><td>Price</td></tr>
<tr><td>9999 Quoted History</td><td>1,000</td><td>1.00</td><td>Jan 2020</td><td>$100,000</td></tr></table>
</body></html>`;

const html = parseCompHtml(REAL_HTML, { city: "Conroe", market: "Houston" });
check("html comps found", html.comps.length, 3);
check("html sale count", html.comps.filter((c) => c.compType === "sale").length, 2);
check("html lease count", html.comps.filter((c) => c.compType === "lease").length, 1);
check("html quoted history excluded", html.comps.some((c) => c.address.includes("Quoted History")), false);
check("html address clean", html.comps[0].address, "2933 E Davis St");
check("html &plusmn; entity handled", html.comps[0].buildingSf, 9900);
check("html percent", html.comps[0].coveragePct, 0.164);
check("html month date", html.comps[0].closedOn, "2026-01-01");
check("html price", html.comps[0].salePrice, 1485000);
check("html &mdash; date -> null", html.comps[1].closedOn, null);
check("html lease type", html.comps[2].leaseType, "nnn");
check("html monthly rent", html.comps[2].rent, 11385);

// The HTML and text paths must agree -- same email, same numbers.
const viaText = parseCompTable(REAL_EMAIL, { city: "Conroe", market: "Houston" });
const pickSale = (r) => r.comps.find((c) => c.address === "2933 E Davis St");
check("html and text agree on price", pickSale(html).salePrice, pickSale(viaText).salePrice);
check("html and text agree on coverage", pickSale(html).coveragePct, pickSale(viaText).coveragePct);
check("html and text agree on lot SF", pickSale(html).lotSf, pickSale(viaText).lotSf);

// Entity decoding must be single-pass: a chain that expands &amp; before &lt;
// turns the literal text "&amp;lt;" into "<", decoding its own output.
console.log("\n== entity decoding ==");
const ENTITIES = [
  "Address | SF | AC | Sale Date | Price",
  "1 A&amp;B Industrial Park | &plusmn;10,000 | &plusmn;2.00 | Jan 2026 | $1,000,000",
].join("\n");
const ent = parseCompHtml(`<table><tr><td>${ENTITIES.split("\n")[0].replace(/ \| /g, "</td><td>")}</td></tr>` +
  `<tr><td>${ENTITIES.split("\n")[1].replace(/ \| /g, "</td><td>")}</td></tr></table>`, {});
check("&amp; in an address decodes once", ent.comps[0].address, "1 A&B Industrial Park");
check("&plusmn; before a number", ent.comps[0].buildingSf, 10000);
check("numeric entity", parseCompHtml("<table><tr><td>Address</td><td>SF</td><td>AC</td><td>Price</td><td>Sale Date</td></tr>" +
  "<tr><td>2 Test&#8212;St</td><td>1,000</td><td>1.00</td><td>$500,000</td><td>Jan 2026</td></tr></table>", {})
  .comps[0].address, "2 Test—St");

console.log("\n== parseCompInput prefers HTML ==");
const both = parseCompInput(
  { html: REAL_HTML, text: "garbled plain text fallback with no table" },
  { city: "Conroe" }
);
check("chose the HTML", both.comps.length, 3);
const textOnly = parseCompInput({ html: null, text: REAL_EMAIL }, { city: "Conroe" });
check("falls back to text", textOnly.comps.length, 10);
const htmlNoTable = parseCompInput({ html: "<p>no tables here</p>", text: REAL_EMAIL }, {});
check("ignores HTML without a table", htmlNoTable.comps.length, 10);

// ------------------------------------------- regressions from a real failure
// A Ctrl+C of the whole message in Outlook's reading pane. Two things here
// broke the first implementation and neither was in the earlier fixture:
//   1. every cell's contents are wrapped in <p class=MsoNormal>, and turning
//      </p> into a newline shattered each row into one line per cell;
//   2. the copy begins with the message's OWN From:/Sent:/To:/Subject: block,
//      which the quoted-reply stripper treated as a quote boundary and so
//      discarded the entire email.
console.log("\n== real Outlook reading-pane copy (regression) ==");
const OUTLOOK_COPY = `
<div>
<p class=MsoNormal>From: Doc Perrier &lt;doc.perrier@matthews.com&gt;<br>
Sent: Thursday, September 3, 2026 5:59 AM<br>
To: Jadon Potts &lt;jpotts@dalfen.com&gt;; Rhett Anderson &lt;randerson@dalfen.com&gt;<br>
Subject: Re: Stabalized Deals</p>
<p class=MsoNormal>EXTERNAL: This email originated outside of DALFEN INDUSTRIAL</p>
<p class=MsoNormal>Hey Jadon/ Rhett-</p>
<p class=MsoNormal>See below comps. These sold at low 7 caps.</p>
<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 width=0>
 <tr>
  <td width=140 valign=top style='padding:0in 5.4pt'><p class=MsoNormal><b>Addres</b></p></td>
  <td width=70 valign=top style='padding:0in 5.4pt'><p class=MsoNormal><b>Year Built</b></p></td>
  <td width=60 valign=top><p class=MsoNormal><b>SF</b></p></td>
  <td width=50 valign=top><p class=MsoNormal><b>AC</b></p></td>
  <td width=60 valign=top><p class=MsoNormal><b>Coverage</b></p></td>
  <td width=70 valign=top><p class=MsoNormal><b>Sale Date</b></p></td>
  <td width=80 valign=top><p class=MsoNormal><b>Price</b></p></td>
  <td width=60 valign=top><p class=MsoNormal><b>Price/SF</b></p></td>
 </tr>
 <tr>
  <td valign=top><p class=MsoNormal>2933 E Davis St</p></td>
  <td valign=top><p class=MsoNormal>2017</p></td>
  <td valign=top><p class=MsoNormal>&plusmn;9,900</p></td>
  <td valign=top><p class=MsoNormal>&plusmn;1.40</p></td>
  <td valign=top><p class=MsoNormal>16.40%</p></td>
  <td valign=top><p class=MsoNormal>Jan 2026</p></td>
  <td valign=top><p class=MsoNormal>$1,485,000</p></td>
  <td valign=top><p class=MsoNormal>$150.00</p></td>
 </tr>
 <tr>
  <td valign=top><p class=MsoNormal>2346 FM 1484 Rd</p></td>
  <td valign=top><p class=MsoNormal>2024</p></td>
  <td valign=top><p class=MsoNormal>&plusmn;7,500</p></td>
  <td valign=top><p class=MsoNormal>&plusmn;1.00</p></td>
  <td valign=top><p class=MsoNormal>17.00%</p></td>
  <td valign=top><p class=MsoNormal>Jan 2025</p></td>
  <td valign=top><p class=MsoNormal>$1,350,000</p></td>
  <td valign=top><p class=MsoNormal>$180.00</p></td>
 </tr>
</table>
<p class=MsoNormal>Thank you,</p>
<table class=MsoNormalTable><tr><td><p class=MsoNormal>Doc Perrier</p></td></tr>
<tr><td><p class=MsoNormal>First Vice President | Matthews</p></td></tr></table>
</div>`;

const oc = parseCompHtml(OUTLOOK_COPY, { city: "Conroe", market: "Houston" });
check("survives the message's own header block", oc.comps.length, 2);
check("MsoNormal <p> inside <td> doesn't shatter the row", oc.comps[0].address, "2933 E Davis St");
check("cell numbers intact", oc.comps[0].buildingSf, 9900);
check("cell acres intact", oc.comps[0].acres, 1.4);
check("cell price intact", oc.comps[0].salePrice, 1485000);
check("cell date intact", oc.comps[0].closedOn, "2026-01-01");
check("second row too", oc.comps[1].address, "2346 FM 1484 Rd");
check("signature layout table ignored", oc.comps.some((c) => /Doc Perrier|Vice President/.test(c.address)), false);
check("clean rows, no warnings", oc.comps[0].warnings, []);

// The stripper must still cut a genuine quoted reply -- the fix must not
// simply disable it.
console.log("\n== quoted reply is still stripped ==");
const WITH_QUOTE = `Hey Rhett, see below.
Address | SF | AC | Sale Date | Price
1 Live St | 10,000 | 2.00 | Jan 2026 | $1,500,000
Thanks,
Doc
From: Rhett Anderson <randerson@dalfen.com>
Sent: Tuesday
Address | SF | AC | Sale Date | Price
2 Old Quoted St | 9,000 | 1.00 | Jan 2020 | $900,000`;
const wq = parseCompTable(WITH_QUOTE, {});
check("live table kept", wq.comps.length, 1);
check("quoted table dropped", wq.comps[0].address, "1 Live St");

const HEADER_FIRST_THEN_QUOTE = `From: Doc Perrier <doc.perrier@matthews.com>
Sent: Thursday
Subject: comps
Address | SF | AC | Sale Date | Price
1 Live St | 10,000 | 2.00 | Jan 2026 | $1,500,000
From: Rhett Anderson <randerson@dalfen.com>
Address | SF | AC | Sale Date | Price
2 Old Quoted St | 9,000 | 1.00 | Jan 2020 | $900,000`;
const hq = parseCompTable(HEADER_FIRST_THEN_QUOTE, {});
check("own headers skipped, later quote still cut", hq.comps.length, 1);
check("...keeping the live row", hq.comps[0].address, "1 Live St");

// ---------------------------------------------------------- diagnostics
console.log("\n== failure explains itself ==");
const noHeader = parseCompTable("1 Somewhere St | 10,000 | 2.00 | Jan 2026 | $1,000,000", {});
check("no comps without a header", noHeader.comps.length, 0);
check("says the header wasn't recognised", noHeader.warnings.some((w) => w.includes("no header row I recognised")), true);
check("returns what it saw", (noHeader.seen?.lines ?? []).length > 0, true);

const singleColumn = parseCompTable("2933 E Davis St\n$1,485,000\nJan 2026", {});
check("single-column paste explained", singleColumn.warnings.some((w) => w.includes("single column")), true);

// ------------------------------------------------------------------ garbage
console.log("\n== nothing parseable ==");
const empty = parseCompTable("Hey Rhett, give me a call about Conroe when you get a sec.", {});
check("no comps", empty.comps.length, 0);
// Prose with no columns takes the single-column branch, which tells the user
// the columns were lost rather than just that parsing failed.
check("explains itself", empty.warnings.some((w) => w.includes("single column")), true);
check("offers a way forward", empty.warnings.some((w) => w.includes("drop the spreadsheet")), true);

unlinkSync(fileURLToPath(tmpUrl));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
