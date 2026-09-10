import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, URL, URLSearchParams, Buffer, AbortSignal, ...globals,
  });
  return exports;
}

const geo = load("../lib/ic-deck/geo.ts");
const shapes = [];
let slides = 0;
class Presentation {
  ShapeType = { rect: "rect", ellipse: "ellipse" };
  addSlide() {
    slides++;
    return {
      addText: (text, options) => shapes.push({ text, ...options }),
      addShape: (_, options) => shapes.push(options),
      addImage: (options) => shapes.push(options),
      addTable: (rows, options) => shapes.push({ ...options, h: rows.length * options.rowH }),
    };
  }
  async writeFile() {}
}
const portfolio = load("../lib/ic-deck/portfolioMap.ts", { "./geo": geo }, {
  window: { PptxGenJS: Presentation },
});
const data = {
  target: { address: '=HYPERLINK("example")', market: "Dallas", lat: 32, lng: -96 },
  radiusMiles: 25, zoom: geo.zoomForRadiusMiles(25, 32), mapLogicalSize: 640,
  imageBase64: "data:image/png;base64,test",
  assets: Array.from({ length: 40 }, (_, i) => ({
    id: String(i), address: `Property ${i}, Suite "A"`, city: "Dallas", status: "owned",
    occupancy: "available", latitude: 32, longitude: -96, distanceMi: i / 2,
  })),
  pipeline: [{ address: "Pipeline", stage: "prospect", latitude: 32, longitude: -96, distanceMi: 2 }],
  comps: ["lease", "sale"].map((comp_type) => ({ comp_type, address: "Comp", latitude: 32, longitude: -96, distanceMi: 3 })),
};
await portfolio.exportPortfolioMap(data);
assert.equal(slides, 1);
for (const shape of shapes) {
  assert.ok(shape.x >= 0 && shape.y >= 0);
  assert.ok(shape.x + shape.w <= 13.334, `Horizontal overflow: ${shape.text}`);
  assert.ok(shape.y + shape.h <= 7.5, `Vertical overflow: ${shape.text}`);
}
const csv = portfolio.portfolioMapCsv({ ...data, radiusMiles: 0 });
assert.ok(csv.includes("Radius (miles),All"));
assert.ok(csv.includes("\"'=HYPERLINK("));
assert.ok(csv.includes('"Property 0, Suite ""A"""'));
assert.equal(csv.split("\n").filter((line) => line.startsWith("Our asset,")).length, 40);

let queryFailure = false;
let authenticated = true;
let basemapCalls = 0;
const client = {
  from(table) {
    const result = { data: [], error: queryFailure ? { message: "Database unavailable" } : null };
    const chain = new Proxy({}, { get(_, name) {
      if (name === "then") return Promise.resolve(result).then.bind(Promise.resolve(result));
      if (name === "maybeSingle") return () => Promise.resolve({
        data: { id: "target", stage: "prospect", properties: { address: "Target", latitude: 32, longitude: -96 } },
        error: null,
      });
      return () => chain;
    } });
    return chain;
  },
};
const route = load("../app/api/deals/[id]/portfolio-map/route.ts", {
  "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  "@/lib/auth": { getCurrentUser: async () => authenticated ? { email: "test@example.com" } : null },
  "@/lib/supabase": { getServiceClient: () => client },
  "@/lib/ic-deck/geo": geo,
}, { process: { env: {} }, fetch: async () => { basemapCalls++; throw Error("Unexpected basemap call"); } });
const request = (query) => route.GET({ nextUrl: new URL(`https://hopper.test/map?${query}`) }, { params: { id: "target" } });
assert.equal((await request("image=0&radius=0")).status, 200);
assert.equal(basemapCalls, 0);
assert.equal((await request("image=0&radius=NaN")).status, 400);
assert.equal((await request("image=0&radius=-1")).status, 400);
queryFailure = true;
assert.equal((await request("image=0&radius=25")).status, 500);
authenticated = false;
assert.equal((await request("image=0&radius=25")).status, 401);
console.log("Portfolio map checks passed: slide bounds, CSV completeness/escaping, radius validation, auth, database failures, and CSV without a maps key.");
