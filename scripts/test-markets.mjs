// scripts/test-markets.mjs
//
// Tests lib/markets.ts: one spelling per metro, Dallas vs Fort Worth by city,
// and escalations stored as fractions.
//   node scripts/test-markets.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/markets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);
const { canonicalMarket: cm, escalationFraction: esc, stateOfMarket } = m;

let n = 0;
const check = (label, actual, expected) => { assert.equal(actual, expected, label); n++; };

check("DFW in Irving is Dallas", cm("DFW", "Irving"), "Dallas");
check("DFW in Arlington is Fort Worth", cm("DFW", "Arlington"), "Fort Worth");
check("Grand Prairie is Dallas", cm("DFW", "Grand Prairie", -97.05), "Dallas");
check("comp tagged Fort Worth in Grand Prairie moves to Dallas", cm("Fort Worth", "Grand Prairie"), "Dallas");
check("Dallas label in Fort Worth city", cm("Dallas", "Fort Worth"), "Fort Worth");
check("Ft. Worth spelling", cm("dfw", "Ft. Worth"), "Fort Worth");
check("DFW, unknown city, west longitude", cm("DFW", "Somewhere", -97.4), "Fort Worth");
check("DFW, unknown city, east longitude", cm("DFW", "Somewhere", -96.8), "Dallas");
check("DFW, nothing else known", cm("DFW", null, null), "Dallas");
check("Dallas/Fort Worth label", cm("Dallas/Fort Worth", "Euless"), "Fort Worth");
check("Dallas, no city, stays Dallas", cm("Dallas", ""), "Dallas");
check("Fort Worth, no city, stays Fort Worth", cm("Fort Worth", null), "Fort Worth");
check("suburb as market: Frisco", cm("Frisco", "Frisco"), "Dallas");
check("suburb as market: Burleson", cm("Burleson", null), "Fort Worth");
check("La Porte -> Houston", cm("La Porte", "La Porte"), "Houston");
check("typo Hoston", cm("Hoston", null), "Houston");
check("Round Rock -> Austin", cm("Round Rock", null), "Austin");
check("New Braunfels -> San Antonio", cm("New Braunfels", null), "San Antonio");
check("other metros pass through", cm(" Chicago ", "Elk Grove"), "Chicago");
check("blank market, DFW city", cm("", "Haltom City"), "Fort Worth");
check("blank market, Houston suburb", cm(null, "Pasadena"), "Houston");
check("blank market, unknown city", cm(null, "Nowhere"), null);

check("Pooler -> Savannah", cm("Pooler", "Pooler"), "Savannah");
check("Port Wentworth -> Savannah", cm("Port Wentworth", null), "Savannah");
check("Marietta -> Atlanta", cm("Marietta", null), "Atlanta");
check("Fulton Industrial -> Atlanta", cm("Fulton Industrial", null), "Atlanta");
check("blank market, McDonough city", cm(null, "McDonough"), "Atlanta");
check("Atlanta is GA", stateOfMarket("Atlanta"), "GA");
check("Savannah is GA, not TX", stateOfMarket("Savannah"), "GA");
check("Houston is TX", stateOfMarket("Houston"), "TX");
check("unknown market has no state", stateOfMarket("Narnia"), null);
check("3 is 3%", esc(3), 0.03);
check("'3.5%' is 3.5%", esc("3.5%"), 0.035);
check("0.03 stays", esc(0.03), 0.03);
check("'0.5%' is 0.005", esc("0.5%"), 0.005);
check("blank", esc(""), null);
check("junk", esc("abc"), null);
check("negative", esc(-1), null);

console.log(`markets: ${n} checks passed`);
