import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, deps={}) {const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>deps[name]});return exports;}
const location=load("lib/location.ts");
for(const pair of [{},{latitude:" ",longitude:-95},{latitude:0,longitude:0},{latitude:true,longitude:-95},{latitude:91,longitude:-95},{latitude:30,longitude:Infinity}])assert.equal(location.validCoordinates(pair),false);
assert.equal(location.validCoordinates({latitude:30,longitude:-95}),true);
assert.equal(location.locationReady({latitude:30,longitude:-95,geocode_precision:"approximate"}),false);
assert.equal(location.locationReady({latitude:30,longitude:-95,geocode_precision:"manual"}),true);
assert.equal(location.parseCoordinatePair("30.45"),null);
assert.equal(location.parseCoordinatePair("30.45, -97.2").longitude,-97.2);
const {compIssue}=load("lib/comps/intake-validation.ts",{"../stage-rules":load("lib/stage-rules.ts")});
const base={address:"8615 Golden Spike Ln",assetClass:"ios",compType:"lease",rent:4000,rentBasis:"per_acre_monthly",dateCommenced:"2026-09-01"};
assert.equal(compIssue(base),null);
for(const patch of [{rentBasis:"per_month"},{rent:-1},{rent:NaN},{assetClass:null},{compType:"other"},{dateCommenced:"2026-02-30"},{acres:-5}]) assert.ok(compIssue({...base,...patch}));
assert.equal(compIssue({...base,compType:"sale",salePrice:4200000,closedOn:"2026-09-01"}),null);
console.log("Location intake tests passed: invalid and approximate pins, coordinate pairs, lease/sale terms, dates, asset class and units.");
