// scripts/test-checklist-docx.mjs
//
// Tests lib/checklist-docx.ts on a synthetic document in counsel's layout:
// heading block, Date | Action table, Document | Responsible | Signatories |
// Status table with section rows.
//   node scripts/test-checklist-docx.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/checklist-docx.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m, Date }
);
const p = (...lines) => lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("");
const tc = (...lines) => `<w:tc>${p(...lines)}</w:tc>`;
const tr = (...cells) => `<w:tr>${cells.join("")}</w:tr>`;
const xml = `<w:document><w:body>${p("Critical Dates and closing checklist", "Example Seller, LLC (“Seller”)", "100 Example Yard Rd, Katy, Texas 77493", "Real Estate Contract dated March 2, 2027", "$2,150,000.00")}
<w:tbl>${tr(tc("Date"), tc("Action"))}
${tr(tc("3/2/2027", "(Tuesday)"), tc("Effective Date (Sec. 1.4)"))}
${tr(tc("3/5/2027"), tc("Earnest Money Deposit Due [within 3 BDs] ($25,000.00; Sec. 1.7)"))}
${tr(tc("4/16/2027"), tc("Expiration of the Inspection Period/Title Review [45 days] (Sec. 1.5)", "Purchaser shall deliver an Approval Notice"))}
${tr(tc("4/1/2027"), tc("Survey Objection Deadline (Sec. 3.3)"))}
${tr(tc("5/3/2027"), tc("Closing Date [15 days after inspection] (Sec. 1.6)"))}
${tr(tc("TBD"), tc("Lender Approval"))}</w:tbl>
<w:tbl>${tr(tc(""), tc("Document"), tc("Responsible Party"), tc("Signatories"), tc("Status"))}
${tr(tc(""), tc("TRANSACTION DOCUMENTS"), tc(""), tc(""), tc(""))}
${tr(tc(""), tc("Real Estate Contract"), tc("PC", "Seller"), tc("Purchaser", "Seller"), tc("Executed"))}
${tr(tc(""), tc("Estoppel Certificates"), tc("SC"), tc("Tenants"), tc("5 BDs prior to Closing"))}
${tr(tc(""), tc("SELLER’S DELIVERIES"), tc(""), tc(""), tc(""))}
${tr(tc(""), tc("Deed (Sec. 6.2.1)"), tc("SC"), tc("Seller"), tc(""))}</w:tbl></w:body></w:document>`;

const r = m.parseChecklistDocx(xml);
let n = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); n++; };
eq(r.property, "100 Example Yard Rd, Katy, Texas 77493", "property line");
eq(r.contractDate, "2027-03-02", "contract date");
eq(r.price, 2150000, "price");
eq(r.dates.map((d) => d.key).join(","), "psa_effective,deposit,dd_end,title_objections,closing,", "keys; combined inspection/title row is DD expiry");
eq(r.dates[1].label, "Earnest Money Deposit Due", "label stops at the bracket");
eq(r.dates[1].notes, "[within 3 BDs] ($25,000.00; Sec. 1.7)", "rule and cite kept as notes");
eq(r.dates[2].notes.includes("Approval Notice"), true, "later paragraphs kept");
eq(r.dates[2].due_on, "2027-04-16", "date parsed");
eq(r.dates[5].due_on, null, "TBD has no date");
eq(r.checklist.length, 3, "section rows aren't items");
eq(r.checklist[0].section, "Transaction Documents", "section title-cased");
eq(r.checklist[0].responsible, "PC / Seller", "two-line cell joined");
eq(r.checklist[0].done, true, "Executed is done");
eq(r.checklist[1].done, false, "a deadline in Status is not done");
eq(r.checklist[2].section, "Seller’s Deliveries", "next section");
eq(m.parseDate("October 14, 2026"), "2026-10-14");
eq(m.parseDate("2/30/2027"), null, "impossible date rejected");
console.log(`checklist-docx: ${n} checks passed`);
