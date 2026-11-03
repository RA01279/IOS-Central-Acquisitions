import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import ts from 'typescript';
import ExcelJS from 'exceljs';
const require = createRequire(import.meta.url);
const compile = (file) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const summary = new Module(process.cwd() + '/usable-summary-test.cjs'); summary._compile(compile('lib/sourcing/usable-summary.ts'), process.cwd() + '/usable-summary-test.cjs');
const module = new Module(process.cwd() + '/export-test.cjs'); module.paths = Module._nodeModulePaths(process.cwd());
module.require = (name) => (name === './usable-summary' ? summary.exports : require(name));
const src = ts.transpileModule(readFileSync('lib/sourcing/export.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
module._compile(src, process.cwd() + '/export-test.cjs');
assert.equal(module.exports.sourcingExportFilename('Houston: Northwest (US-290 / Beltway 8)', {brokerName:'Preston Fleenor',firmName:'Younger Partners'}), 'Houston_Northwest_Preston Fleenor.xlsx');
assert.equal(module.exports.sourcingExportFilename('Houston: Northwest (US-290 / Beltway 8) | 1 mi | Profiles: Equipment', {firmName:'Younger Partners'}), 'Houston_Northwest_Younger Partners.xlsx');
assert.equal(module.exports.sourcingExportFilename('Houston: North (IAH / Aldine)'), 'Houston_North_Unassigned.xlsx');
assert.equal(module.exports.sourcingExportFilename('Houston'), 'Houston_Unspecified submarket_Unassigned.xlsx');
assert.equal(module.exports.sourcingExportFilename('Houston: East', {brokerName:'A/B: Smith?'}), 'Houston_East_A-B- Smith-.xlsx');
const site = { ref: 'S1', address: '=1+1', lat: 30, lng: -95, operators: [{ name: 'Test Yard' }], categories: ['Trucking'], ownerUser: true, parcel: { owner: 'Owner LLC', acres: 0, propId: '00123', source: 'County roll' } };
for (const qualified of [false, true]) {
 const research = { ref: 'S1', ownerType: 'unknown', acres: 2.5, signals: [], sources: [], unverified: [], outreach: 'PRIVATE DRAFT' };
 const book = await module.exports.buildSourcingWorkbook([site], 'Test', qualified ? [research] : undefined);
 const reopened = new ExcelJS.Workbook();
 await reopened.xlsx.load(await book.xlsx.writeBuffer());
 const sheet = reopened.getWorksheet('Opportunities');
 assert.equal(sheet.rowCount, 5);
 assert.equal(sheet.getCell('B5').value, '=1+1');
 assert.equal(sheet.getCell('B5').type, ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('H5').value, qualified ? 2.5 : 0);
 assert.equal(sheet.getCell('E5').value, 'Owner LLC');
 assert.equal(sheet.getCell('L5').value, '00123');
 assert.match(sheet.getCell('U5').value.hyperlink, /30,-95/);
 assert.equal(sheet.views[0].ySplit, 4);
 assert.ok(sheet.autoFilter);
 assert.ok(!JSON.stringify(sheet.model).includes('PRIVATE DRAFT'));
}
console.log('PASS: sweep and qualified XLSX round trips, numeric fields, text safety, IDs, links, filters, frozen headers and outreach exclusion');

const assignmentModule = new Module(process.cwd() + '/assignment-test.cjs');
assignmentModule.paths = Module._nodeModulePaths(process.cwd());
assignmentModule._compile(ts.transpileModule(readFileSync('lib/sourcing/export-assignment.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, process.cwd() + '/assignment-test.cjs');
const { exportAssignees, assignmentFor } = assignmentModule.exports;
const firm = { id: 'firm-1', name: 'Test Brokerage', company_type: 'broker' };
const candidates = exportAssignees([firm], [
 { id: 'one', name: 'Alex Smith', email: 'alex@example.com', phone: '555-0101', contact_type: 'broker', companies: firm },
 { id: 'two', name: 'Alex Smith', contact_type: 'broker', companies: null },
 { id: 'old', name: 'Historical Broker', companies: { id: 'old-firm', name: 'Historical Firm', company_type: 'other' } },
 { id: 'owner', name: 'Property Owner', contact_type: 'owner_user' },
], new Set(['old']));
assert.equal(candidates.filter((a) => a.key === 'firm:firm-1').length, 1);
assert.ok(candidates.some((a) => a.key === 'firm:old-firm'));
assert.ok(!candidates.some((a) => a.key === 'broker:owner'));
assert.equal(assignmentFor(candidates, 'broker:one').brokerEmail, 'alex@example.com');
assert.equal(assignmentFor(candidates, 'broker:two').brokerEmail, undefined);
assert.equal(assignmentFor(candidates, 'unknown'), undefined);
assert.equal(assignmentFor(candidates, ''), undefined);
for (const key of ['', 'broker:one', 'broker:two', 'firm:firm-1']) {
 const assignment = assignmentFor(candidates, key);
 const book = await module.exports.buildSourcingWorkbook([site, { ...site, ref: 'S2' }], 'Assigned test', undefined, assignment);
 const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await book.xlsx.writeBuffer());
 const sheet = reopened.getWorksheet('Opportunities');
 assert.equal(sheet.rowCount, 6);
 for (const row of [5, 6]) {
  assert.equal(sheet.getCell(`AB${row}`).value ?? null, assignment?.brokerName ?? null);
  assert.equal(sheet.getCell(`AC${row}`).value ?? null, assignment?.firmName ?? null);
  assert.equal(sheet.getCell(`AD${row}`).value ?? null, assignment?.brokerEmail ?? null);
  assert.equal(sheet.getCell(`AE${row}`).value ?? null, assignment?.brokerPhone ?? null);
 }
 assert.ok(sheet.getCell('H1').value.includes(assignment?.brokerName ?? assignment?.firmName ?? 'Unassigned'));
}
console.log('PASS: broker/firm/unassigned workbook metadata and every row, duplicate-name ID selection, historical brokers, missing contacts and stale assignment rejection');

const fetchAllModule = new Module(process.cwd() + '/paging-test.cjs');
fetchAllModule._compile(ts.transpileModule(readFileSync('lib/fetch-all.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, 'paging-test.cjs');
let currentUser = { email: 'test@example.com' }, directoryFailure = false, reads = 0;
const pages = [];
const contactRows = [...Array.from({length:1000},(_,i)=>({id:'owner'+i,name:'Owner '+i,contact_type:'owner_user'})), {id:'late',name:'Last-page Broker',contact_type:'broker',companies:firm}];
const db = { from(table) {
 const q = { select:()=>q, eq:()=>q, in:()=>q, order:()=>q, range:async(f,t)=>{
  reads++; pages.push([table,f,t]);
  return {data: directoryFailure ? null : (table==='contacts'?contactRows:table==='companies'?[firm]:[]).slice(f,t+1),error:directoryFailure?{message:'offline'}:null};
 }};return q;
}};
const routeModule = new Module(process.cwd() + '/directory-route-test.cjs');
routeModule.require = (name) => ({
 'next/server': {NextResponse:{json:(body,init)=>({body,status:init?.status??200})}},
 '@/lib/auth': {getCurrentUser:async()=>currentUser},
 '@/lib/supabase': {getServiceClient:()=>db},
 '@/lib/fetch-all': fetchAllModule.exports,
 '@/lib/sourcing/export-assignment': assignmentModule.exports,
}[name] ?? require(name));
routeModule._compile(ts.transpileModule(readFileSync('app/api/sourcing/export-assignees/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,'directory-route-test.cjs');
let directory = await routeModule.exports.GET();
assert.equal(directory.status,200);
assert.deepEqual(directory.body.assignees.map(a=>a.key).sort(),['broker:late','firm:firm-1']);
assert.ok(pages.some(([t,f])=>t==='contacts'&&f===1000));
directoryFailure=true;
assert.equal((await routeModule.exports.GET()).status,503);
currentUser=null; const before=reads;
assert.equal((await routeModule.exports.GET()).status,401); assert.equal(reads,before);
console.log('PASS: authenticated directory, broker beyond 1000-row cap, no partial directory on errors and no unauthenticated reads');

