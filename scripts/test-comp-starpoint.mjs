import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parser, reader, bytes, load, reproduce } from './starpoint-case.mjs';
const { workbook, response } = await reproduce();
assert.equal(response.status, 200);
assert.equal(workbook.sheets.length, 1);
assert.equal(workbook.sheets[0].sourceRows.length, 20);
const drafts = response.body.comps;
assert.equal(drafts.length, 18);
// Independent transcription of all transaction addresses, quoted rates and areas.
const expected = [
  ['2705 Twinwood Pkwy.',1.01,14900], ['1150 Hall Ct.',.96,22600],
  ['612 Spring Hill Dr',1.25,10524], ['11217 Telephone Road',1.03,20898],
  ['604 Spring Hill Dr',1.27,10988], ['3508 Pasadena Fwy.',1.13,35559],
  ['6410 Langield Rd.',1.15,50995], ['20404 Whitewood Dr.',1.1,15000],
  ['13026 Gulf Commerce',1.18,12000], ['7738 Wright Rd.',1.2,31850],
  ['4421 Rex Rd.',1.16,15000], ['4421 Rex Rd.',1.16,15000], ['4421 Rex Rd.',1.18,15000],
  ['5430 Brittmoore Rd.',1.09,14250], ['3403 N Sam Houston Pkwy. W',1.18,11998],
  ['1612 Southcreek',1.1,27150], ['1500 Aldine Western Rd.',1.05,63071], ['2201 Genoa Red Bluff',1,24500],
];
assert.deepEqual(drafts.map(d=>[d.address,d.rent,d.leasedSf]),expected);
assert.deepEqual(drafts.map(d=>d.sourceRow),Array.from({length:18},(_,i)=>i+3));
const original = new ExcelJS.Workbook(); await original.xlsx.load(bytes);
const text = v => v == null ? '' : v.richText ? v.richText.map(t=>t.text).join('') : String(v);
const validation = load('lib/comps/intake-validation.ts', {'../stage-rules':load('lib/stage-rules.ts')});
const rates = load('lib/comps/rates.ts');
for (const [i,d] of drafts.entries()) {
  const row = original.worksheets[0].getRow(i+3);
  assert.equal(d.compType,'lease');
  assert.equal(d.sourceBuilding,text(row.getCell(1).value));
  assert.equal(d.tenantName,text(row.getCell(2).value));
  assert.equal(d.leaseDateText,text(row.getCell(5).value));
  assert.equal(d.datePrecision,'quarter');
  const [,q,y]=d.leaseDateText.match(/Q(\d)\s+(\d{4})/);
  assert.equal(d.dateCommenced,`${y}-${String((Number(q)-1)*3+1).padStart(2,'0')}-01`);
  assert.equal(d.buildingSf,null);
  assert.equal(d.rentBasis,null);
  for(const k of ['leaseTermMonths','freeRentMonths','tiPsf','escalationsPct']) assert.equal(d[k],null,`${i+3}: ${k} must not infer units`);
  for(let col=1;col<=16;col++) {
    const cell=row.getCell(col); const value=text(cell.value);
    if(value) {
      const term=d.sourceTerms.find(t=>t.header===text(original.worksheets[0].getCell(2,col).value).replace(/\n/g,' '));
      assert.ok(term,`missing source column ${col} row ${i+3}`);
      assert.equal(term.value,value,`source row ${i+3}, column ${col}`);
      if(cell.numFmt && cell.numFmt!=='General') assert.equal(term.format,cell.numFmt);
      assert.ok(d.notes.includes(value),`notes retain row ${i+3} col ${col}`);
    }
  }
  assert.equal(validation.compIssue({...d,assetClass:'industrial'}),'Choose the rent units');
  assert.equal(validation.compIssue({...d,assetClass:'industrial',rentBasis:'per_sf_bldg_monthly'}),null);
  assert.equal(rates.rateViews({rent:d.rent,rent_basis:d.rentBasis,building_sf:10000}).perSfBldgAnnual,null);
  assert.ok(d.warnings.some(w=>w.includes('Confirm rent units')));
}
assert.deepEqual(drafts.slice(10,13).map(d=>d.projectName),['Rex Road Industrial Park - Bldg. 3','Rex Road Industrial Park - Bldg. 4','Rex Road Industrial Park - Bldg. 8']);
assert.equal(drafts[6].projectName,'Bldg. F');
assert.ok(drafts[1].warnings.some(w=>w.includes('differs from comments')));
assert.ok(drafts[15].notes.includes('Flat rate'));
assert.ok(drafts[16].notes.includes('$1,500,000'));
for(const [label,basis] of [['Lease Rate ($/SF/mo)','per_sf_bldg_monthly'],['Lease Rate ($/SF/yr)','per_sf_bldg_annual']]) {
 const result=parser.parseCompTable(`Building | Tenant | ${label} | Lease Date\n1000 Main St | Test | 1.25 | Q1 2025`);
 assert.equal(result.comps.length,1); assert.equal(result.comps[0].rentBasis,basis);
}
const ambiguous=parser.parseCompTable('Building | Tenant | Lease Rate | Lease Date\nNamed Building | Test | 1.25 | Q1 2025');
assert.equal(ambiguous.comps.length,1); assert.equal(ambiguous.comps[0].address,'');
assert.ok(ambiguous.comps[0].warnings.some(w=>w.includes('no identifiable street address')));
// API access checks must still precede workbook parsing.
const denied=load('app/api/comps/parse/route.ts',{'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status??200})}},'@/lib/auth':{getCurrentUser:async()=>null},'@/lib/comps/parse':parser,'@/lib/comps/fromWorkbook':reader});
assert.equal((await denied.POST({json:async()=>{throw Error('must not read unauthenticated payload')}})).status,401);
// Exercise the actual save handler with a fake repository: unconfirmed units
// must never reach geocoding/DB; reviewed rows must keep precision and evidence.
const match=load('lib/comps/match.ts');
let stored=[];
const save=load('app/api/comps/route.ts', {
 'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status??200})}},
 '@/lib/auth':{getCurrentUser:async()=>({email:'test@example.com'})},
 '@/lib/locate-site':{locateMany:async rows=>{assert.equal(rows.length,0);return [];}},
 '@/lib/location':load('lib/location.ts'), '@/lib/money':load('lib/money.ts'), '@/lib/markets':load('lib/markets.ts'),
 '@/lib/comps/cache':{invalidateComps:()=>{}}, '@/lib/comps/intake-validation':validation,
 '@/lib/comps/match':match, '@/lib/comps/review':load('lib/comps/review.ts',{'./match':match}),
 '@/lib/comps/mapData':load('lib/comps/mapData.ts'), '@/lib/comps/conflicts':load('lib/comps/conflicts.ts'),
 '@/lib/supabase':{getServiceClient:()=>({from:()=>({
  select:()=>({order:()=>({range:async()=>({data:[],error:null})})}),
  insert:rows=>({select:async()=>{stored.push(...(Array.isArray(rows)?rows:[rows]));return {data:(Array.isArray(rows)?rows:[rows]).map((r,i)=>({id:String(i),...r})),error:null};}}),
 })})},
});
const blocked=await save.POST({json:async()=>({comps:drafts.map(d=>({...d,assetClass:'industrial'}))})});
assert.equal(blocked.status,400); assert.equal(blocked.body.rejected.length,18); assert.equal(stored.length,0);
assert.ok(blocked.body.rejected.every(r=>r.reason==='Choose the rent units'));
const confirmed=await save.POST({json:async()=>({comps:drafts.map((d,i)=>({...d,_key:String(i),assetClass:'industrial',rentBasis:'per_sf_bldg_monthly',latitude:29.8,longitude:-95.4}))})});
assert.equal(confirmed.status,200); assert.equal(confirmed.body.saved,18); assert.equal(confirmed.body.duplicates,0);
assert.equal(stored.length,18);
for(const [i,s] of stored.entries()) {
 assert.equal(s.notes,drafts[i].notes); assert.equal(s.date_precision,'quarter');
 assert.equal(s.date_commenced,drafts[i].dateCommenced); assert.equal(s.project_name,drafts[i].projectName);
 assert.equal(s.building_sf,null); assert.equal(s.lease_term_months,null); assert.equal(s.ti_psf,null);
}
console.log('Starpoint: all 18 source rows reconciled across all 16 columns; units, quarters, building IDs, concessions, review gate and authentication verified.');
