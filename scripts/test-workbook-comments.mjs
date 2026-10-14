// scripts/test-workbook-comments.mjs
//
// Regression: a workbook whose cell comments sit where newer Excel saves them
// (xl/comments/comment1.xml, linked by an absolute path) made ExcelJS 4.4 throw
// "Cannot read properties of undefined (reading 'comments')", so dropping it
// on Comps failed. It must read, with its comps intact.
//   node scripts/test-workbook-comments.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const PizZip = require("pizzip");

const loaded = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/comps/fromWorkbook.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText,
  { exports: loaded, require, Buffer, console }
);
const { workbookToDelimitedText, withoutComments } = loaded;

async function newerExcelWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Lease Comps");
  ws.addRow(["Address", "City", "Tenant", "Rate (AC/Mo)", "Acres", "Commencement"]);
  ws.addRow(["3412 Kelli Ct", "Fort Worth", "Landscape Partners", 8500, 3.2, "2026-04-01"]);
  ws.getCell("A2").note = "Checked with broker";
  const zip = new PizZip(Buffer.from(await wb.xlsx.writeBuffer()));
  const rels = "xl/worksheets/_rels/sheet1.xml.rels";
  let r = zip.file(rels).asText();
  const target = r.match(/Target="([^"]*comments[^"]*)"/)[1];
  const src = "xl/" + target.replace(/^\.\.\//, "");
  zip.file("xl/comments/comment1.xml", zip.file(src).asText());
  zip.remove(src);
  zip.file(rels, r.replace(target, "/xl/comments/comment1.xml"));
  zip.file("[Content_Types].xml", zip.file("[Content_Types].xml").asText().replace("/" + src, "/xl/comments/comment1.xml"));
  return zip.generate({ type: "nodebuffer" });
}

let n = 0;
const buf = await newerExcelWorkbook();
await assert.rejects(new ExcelJS.Workbook().xlsx.load(buf), /reading 'comments'/); n++; // the bug is real
const out = await workbookToDelimitedText(buf, "comps.xlsx");
assert.equal(out.sheets.length, 1); n++;
assert.match(out.sheets[0].text, /3412 Kelli Ct/); n++;
assert.match(out.sheets[0].text, /8500/); n++;
assert.ok(out.warnings.some((w) => /comments were skipped/.test(w))); n++;

// A workbook without comments is untouched and reads with no warning.
const plain = new ExcelJS.Workbook();
plain.addWorksheet("Sales").addRow(["Address", "Sale Price"]);
const plainBuf = Buffer.from(await plain.xlsx.writeBuffer());
assert.equal(withoutComments(plainBuf), null); n++;
assert.equal((await workbookToDelimitedText(plainBuf, "s.xlsx")).warnings.length, 0); n++;
// Not a zip at all: the original error stands.
await assert.rejects(workbookToDelimitedText(Buffer.from("not a workbook"), "x.xlsx"), /Could not read that workbook/); n++;

console.log(`${n} workbook comment checks passed`);
