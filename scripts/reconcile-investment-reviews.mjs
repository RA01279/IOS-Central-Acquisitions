// Offline only. Usage: node scripts/reconcile-investment-reviews.mjs <audit-directory>
// Emits a reconciliation list; never connects to the database or changes records.
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const root=process.argv[2];if(!root)throw new Error('Provide the retained read-only audit snapshot directory');
const module={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/investment-review.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(module,module.exports);
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n+'.json'),'utf8')).data;
const versions=read('versions');
const list=read('deals').map(d=>{
 const deal={...d,properties:d.properties??d.property,uw_versions:versions.filter(v=>v.deal_id===d.id)},check=module.exports.modelIdentity(deal),income=module.exports.incomePosition(deal),v=module.exports.latestVersion(deal),issues=[...check.issues];
 if(check.state==='missing')issues.length=0;
 if(v?.returns_summary?.marketRentPsfMo!=null&&!v.returns_summary.marketRentSourceBasis)issues.push('Historical model rent units lack retained source-basis evidence');
 if(!income.current&&Number(d.in_place_rent)>0)issues.push('Recorded in-place rent lacks verified current execution/commencement evidence');
 if(!['closed','archived'].includes(d.stage)&&d.disposition==='passed')issues.push('Active pursuit retains passed disposition; reconcile current action and historical reason');
 return {id:d.id,address:deal.properties?.address,modelState:check.state,issues,income:income.label,action:'Review original identity, scope, rent units, execution and current follow-up; do not bulk correct'};
}).filter(d=>d.issues.length);
process.stdout.write(JSON.stringify({method:'Offline snapshot reconciliation only; no automatic corrections',items:list},null,2)+'\n');
