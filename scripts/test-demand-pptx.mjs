// Uses the exact browser bundle cached at .tmp-pptx/pptxgen.bundle.cjs from:
// https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js
// Follow with powershell -File scripts/validate-demand-pptx.ps1.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import PizZip from "pizzip";
const browser = { console, setTimeout, clearTimeout, setImmediate, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise };
vm.createContext(browser);
vm.runInContext(readFileSync(new URL("../.tmp-pptx/pptxgen.bundle.cjs", import.meta.url), "utf8"), browser);
let bytes;
class Pptx extends browser.PptxGenJS {
  async writeFile() { bytes = await this.write({ outputType: "arraybuffer" }); }
}
function load(path, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name) => deps[name], window: { PptxGenJS: Pptx } });
  return exports;
}
const geo = load("../lib/ic-deck/geo.ts");
const validation = load("../lib/analysis-validation.ts");
const review = load("../lib/demand-map-review.ts", { "./analysis-validation": validation, "./ic-deck/geo": geo });
const demand = load("../lib/ic-deck/iosDemandMap.ts", { "./geo": geo, "../demand-map-review": review });
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
await demand.exportToPptx({
  fetchedAt: "2026-10-06T21:57:35.620Z", address: "8615 Golden Spike Lane", center: { lat: 29.9, lng: -95.5 }, radiusMiles: 5, zoom: 12,
  imageBase64: png, tenants: [{ name: 'A & B "Rentals"', category: demand.DEFAULT_CATEGORIES[0].label,
    lat: 29.91, lng: -95.5, distanceMi: 0.5, placeId: "test", logoBase64: png,
    website: 'https://example.com/?a=1&b=2' }],
}, {});
writeFileSync(new URL("../.tmp-pptx/demand-regression.pptx", import.meta.url), Buffer.from(bytes));
const zip = new PizZip(bytes);
for (const name of Object.keys(zip.files).filter((p) => /\.xml$|\.rels$/.test(p))) {
  const xml = zip.file(name).asText();
  if (xml.includes("tooltip=")) console.log(name, xml.match(/.{0,50}tooltip=.{0,140}/g));
}
const slideXml=zip.file("ppt/slides/slide1.xml").asText();
for(const expected of ["DEMAND MAP","Selected business locations only","2026-10-06 21:57:35 UTC","Exported:"]) if(!slideXml.includes(expected)) throw new Error("Missing evidence text: "+expected);
if(slideXml.includes("potential IOS users")) throw new Error("Overstated demand claim");
console.log("Generated regression PPTX; source date, export date and limitations verified.");
