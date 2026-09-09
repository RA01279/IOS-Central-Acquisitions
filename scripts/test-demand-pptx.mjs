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
const demand = load("../lib/ic-deck/iosDemandMap.ts", { "./geo": geo });
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
await demand.exportToPptx({
  address: "8615 Golden Spike Lane", center: { lat: 29.9, lng: -95.5 }, radiusMiles: 5, zoom: 12,
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
console.log("Generated regression PPTX for XML validation.");
