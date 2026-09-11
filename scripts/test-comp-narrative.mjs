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
const cunningham = `6210 Cunningham Rd
$1.35/SF ($63,057/mo NNN) 3 yr lease, no TI, 4% bumps
46,709 SF on 5.0 AC
1,170 SF office
14,400 SF high bay
(1) 30T, (3) 10T, (4) 5T
Two power services - 2,000A & 1,600A`;
const cc = exports.parseCompInput({text:cunningham}).comps;
assert.equal(cc.length,1);
for(const [key,value] of Object.entries({address:'6210 Cunningham Rd',compType:'lease',rent:63057,rentBasis:'total_monthly',buildingSf:46709,acres:5,officeSf:1170,dateCommenced:null,leaseTermMonths:36,leaseType:'nnn',tiPsf:0,powerAmps:null,escalationsPct:null,clearHeightFt:null})) assert.equal(cc[0][key],value,key);
assert.equal(cc[0].notes,cunningham);
assert.ok(cc[0].warnings.some(w=>w.includes('commencement')));
assert.equal(exports.parseCompInput({text:cunningham.replace('3 yr lease','Sale price: $4,000,000')}).comps.length,0);
assert.equal(exports.parseCompInput({text:cunningham+'\n'+text}).comps.length,2);
assert.equal(exports.parseCompInput({html:cunningham.split('\n').map(l=>'<p>'+l+'</p>').join('')}).comps[0].buildingSf,46709);
assert.equal(exports.parseCompInput({text:cunningham.replace('4% bumps','4% annual bumps')}).comps[0].escalationsPct,4);
console.log('PASS: exact Cunningham email, no date invented, total vs office/high-bay SF, five acres, separate services, unspecified vs annual escalations, mixed blocks, and HTML paste.');
