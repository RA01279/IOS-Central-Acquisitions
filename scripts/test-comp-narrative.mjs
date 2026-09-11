import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/comps/parse.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports});
const text="11505 Todd St (Leased 7/26)\n$1.30 PSF NNN ($28,442/mo NNN) 3 yr lease, no TI\n\u00b121,879 SF\n\u00b12.20 AC ($12,929/mo/AC)\n(3) 5-Ton & (1) 10-Ton cranes w \u00b126' hook height\n3P \u00b12,000 amp";
const result=exports.parseCompInput({text});assert.equal(result.comps.length,1);const c=result.comps[0];
for(const [key,value] of Object.entries({address:'11505 Todd St',compType:'lease',rent:28442,rentBasis:'total_monthly',buildingSf:21879,acres:2.2,dateCommenced:'2026-07-01',datePrecision:'month',leaseTermMonths:36,leaseType:'nnn',tiPsf:0,powerAmps:2000,clearHeightFt:null,city:null,market:null,latitude:null,longitude:null}))assert.equal(c[key],value,key);
assert.equal(c.notes,text);assert.equal(exports.asPropertyReport([c]),null);
assert.equal(exports.parseCompInput({text:text.replace('($28,442/mo NNN)','')}).comps[0].rent,null);
assert.equal(exports.parseCompInput({text:text.replace('Leased','Available')}).comps.length,0);
assert.equal(exports.parseCompInput({text:text+'\n'+text.replace('11505 Todd','123 Other')}).comps.length,2);
assert.equal(exports.parseCompInput({text:text.replace('7/26','13/26')}).comps[0].dateCommenced,null);
console.log('PASS: exact Todd St email, monthly rent vs per-acre amount, July 2026 month precision, 36-month term, no TI, power, notes, hook-height distinction, no location invented, missing units, availability, multiple comps and invalid month.');

assert.equal(exports.parseCompInput({html:text.split("\n").map(l=>"<p>"+l+"</p>").join("")}).comps[0].rent,28442);
