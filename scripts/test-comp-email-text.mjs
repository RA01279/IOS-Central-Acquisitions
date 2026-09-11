import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/comps/parse.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports});
const parse=text=>exports.parseCompInput({text});
const base='Address: 123 Test Road\nTenant: Example Tenant\nCommencement: Jan 2026\n';
for(const [rent,basis,amount] of [['$5,000/month','total_monthly',5000],['$1.20/SF/mo','per_sf_bldg_monthly',1.2],['$12/SF/year','per_sf_bldg_annual',12],['$4,000/acre/mo','per_acre_monthly',4000]]) {
 const result=parse(base+'Rent: '+rent);assert.equal(result.comps.length,1);assert.equal(result.comps[0].compType,'lease');assert.equal(result.comps[0].rent,amount);assert.equal(result.comps[0].rentBasis,basis);assert.ok(result.comps[0].notes.includes(rent));
}
let r=parse(base+'Rent: $5,000');assert.equal(r.comps[0].rent,null);assert.equal(r.comps[0].rentBasis,null);
r=parse('Address\n123 Test Road\nMonthly Rent\n$5,000\nCommencement\nJan 2026');assert.equal(r.comps[0].rent,5000);
r=parse('Address: 123 Test Road\nSale Price: $1,000,000\nSale Date: Jan 2026');assert.equal(r.comps[0].compType,'sale');assert.equal(r.comps[0].salePrice,1000000);
assert.equal(parse(base+'Rent: $5,000/month\n'+base.replace('123','456')+'Rent: $6,000/month').comps.length,2);
assert.equal(parse(base+'Rent: $5,000/month\nRent: $6,000/month').comps.length,0);
assert.equal(parse('Just leased somewhere for $5,000').comps.length,0);
console.log('Email text checks passed: lease/sale labels, stacked values, explicit rent units, ambiguous rent, multiple properties, repeated fields and prose.');

const incomplete=exports.parseCompEmailText(base+'City: Houston\nMarket: Houston\nBuilding SF: 10000\nRent: $5000');assert.equal(exports.asPropertyReport(incomplete.comps),null);
