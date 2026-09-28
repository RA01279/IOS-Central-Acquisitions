import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => dependencies[name], URL, Buffer, ...globals });
  return exports;
}
const parser = load("lib/comps/parse.ts");
const lease = "11505 Todd St (Leased 7/26)\n$1.30 PSF NNN ($28,442/mo NNN) 3 yr lease, no TI\n21,879 SF\n2.20 AC";
const sale = "11301 Boudreaux Rd, Houston, TX 77375\nSold for $2,950,000\n25k SF on 3.9 AC\nClosed on 8/15/2026";
const sale2 = "902 Second Road, Dallas, TX 75001\nSold for $4 million\n30k SF on 5 AC\nClosed on 8/20/2026";
const labeled = "Address: 303 Third Road\nSale Price: $1,000,000\nSale Date: Jan 2026";
const leaseTable = "Address\tMonthly Rent\tCommencement\n404 Fourth Road\t$5,000\tJan 2026";
function check(text, count) {
  const result = parser.parseCompInput({ text });
  assert.equal(result.comps.length, count, text);
  return result.comps;
}
for (const text of [sale+"\n"+lease, lease+"\n"+sale]) {
  const comps = check(text,2);
  const s = comps.find(c=>c.compType==="sale");
  const l = comps.find(c=>c.compType==="lease");
  assert.equal(s.address,"11301 Boudreaux Rd"); assert.equal(s.salePrice,2950000);
  assert.equal(l.address,"11505 Todd St"); assert.equal(l.rent,28442);
  assert.equal(s.rent,null); assert.equal(l.salePrice,null);
  assert.ok(!s.notes.includes("Todd")); assert.ok(!l.notes.includes("Boudreaux"));
}
const two = check(sale+"\n"+sale2,2);
assert.equal(two[1].address,"902 Second Road"); assert.equal(two[1].salePrice,4000000);
check(labeled+"\n"+lease+"\n"+sale,3);
check(leaseTable+"\n\n"+sale,2);
check(sale+"\n\n"+leaseTable,2);
const html = "<table><tr><th>Address</th><th>Monthly Rent</th><th>Commencement</th></tr><tr><td>404 Fourth Road</td><td>$5,000</td><td>Jan 2026</td></tr></table>"+sale.split("\n").map(l=>"<p>"+l+"</p>").join("");
assert.equal(parser.parseCompInput({html,text:leaseTable+"\n"+sale}).comps.length,2);
assert.equal(check(lease+"\nFrom: broker@example.com\n"+sale,1)[0].compType,"lease");
const missing = check(sale.replace("\nClosed on 8/15/2026","")+"\n"+lease.replace("(Leased 7/26)",""),2);
assert.equal(missing[0].closedOn,null); assert.equal(missing[1].dateCommenced,null);
assert.ok(parser.parseCompInput({text:sale+"\n999 Unknown Road\nTransaction details to follow"}).warnings.some(w=>w.includes("999 Unknown Road")));


console.log("PASS: mixed sale/lease emails, section isolation, tables, missing dates, HTML and quoted history.");
