import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { load, parser, reader } from './starpoint-case.mjs';
const route = load('app/api/comps/parse/route.ts', {
  'next/server': { NextResponse: { json: (body, init) => ({body,status:init?.status??200}) } },
  '@/lib/auth': {getCurrentUser:async()=>({email:'test@example.com'})},
  '@/lib/comps/parse': parser, '@/lib/comps/fromWorkbook': reader,
});
async function upload(bytes,fileName) {
  const response=await route.POST({json:async()=>({fileName,fileBase64:bytes.toString('base64')})});
  assert.equal(response.status,200,JSON.stringify(response.body));
  return response.body;
}
async function fixture(name,rows,bookType='xlsx') {
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  return upload(XLSX.write(wb,{type:'buffer',bookType}),`broker.${bookType==='biff8'?'xls':bookType}`);
}
const norfolk=await fixture('Norfolk IOS Comps',[
 ['Landlord','Address','Execution Date','Tenant','Rent/AC/Mth','Building Size','Gross Acreage','Total Acreage (usable)','TI','Rate PSF','Paved or Gravel','Annual NOI','N/R/E'],
 ['Axis IOS','3265 McCall Dr, Atlanta, GA 30340','2025-10-01','Confidential',11500,15010,2.7,2.5,250000,24.82,'Gravel',372600,'N'],
]);
assert.equal(norfolk.comps.length,1);
const n=norfolk.comps[0];
assert.deepEqual([n.compType,n.rent,n.rentBasis,n.acres,n.yardAcres,n.buildingSf,n.dateCommenced,n.dealKind],['lease',11500,'per_acre_monthly',2.7,2.5,15010,'2025-10-01','new']);
assert.equal(n.tiPsf,null);assert.ok(n.warnings.some(w=>w.includes('TI')));
assert.equal(n.quotedPsf,24.82);assert.equal(n.noi,372600);
assert.ok(n.sourceTerms.some(t=>t.header==='TI'&&t.value==='250000'));
const sales=await fixture('IOS Sale Comps',[
 ['Address','Sale Price','Sale Date','Acreage','Building Size (If Applicable)','Gravel/Paved','Fenced','Flyer Link / Image'],
 ['4780 Old Dixie Hwy',3500000,'03/27/2025',4.07,7500,'Gravel','Y','https://example.com/flyer'],
]);
assert.equal(sales.comps[0].buildingSf,7500);assert.equal(sales.comps[0].surfaceType,'gravel');
assert.ok(sales.comps[0].notes.includes('Fenced: Y'));assert.ok(sales.comps[0].notes.includes('https://example.com/flyer'));
const ne=await fixture('IOS NE Sale Comps',[
 ['Address','Acreage','SF (Building)','FAR','Sale Price','Quarter','Buyer'],
 ['1 Alchemy Pl',22.69,65865,.0666,22500000,'2026 Q3','TPG'],
]);
assert.deepEqual([ne.comps[0].closedOn,ne.comps[0].datePrecision,ne.comps[0].buildingSf],['2026-07-01','quarter',65865]);
for(const input of ['Q3 2026','2026 Q3','2026-Q3']) assert.deepEqual(parser.parseCompDate(input),{date:'2026-07-01',precision:'quarter'});
assert.equal(parser.parseCompDate('2026 Q5'),null);
const old=await fixture('Sheet1',[
 ['Date','Address','Tenant','Landlord','Bldg SF','Acres','Surface','Month','Monthly per Acre','Term (Months)','Escalations','TI / $','Comments'],
 ['Q1 2023','4330 Bowman Industrial Ct','ABA','',12000,'8(5.5 Usable)','Paved','$42,500 NNN',5313,'87 (3 Free)',.04,'25k','Original comment'],
 ['Q2 2022','White Road','','',null,'16 AC (10 AC usable)','Heavy Asphalt','',7000,120,'','',''],
 ['Q3 2022','3070 Clifton Springs Road','Ross','',124170,'','','','',60,'','',''],
],'biff8');
assert.equal(old.comps.length,3);assert.ok(old.comps.every(c=>c.compType==='lease'));
assert.deepEqual([old.comps[0].acres,old.comps[0].yardAcres,old.comps[0].leaseTermMonths,old.comps[0].freeRentMonths],[8,5.5,87,3]);
assert.equal(old.comps[0].tiPsf,null);assert.ok(old.comps[0].notes.includes('25k'));
assert.deepEqual([old.comps[1].acres,old.comps[1].yardAcres],[16,10]);
assert.equal(old.comps[2].rent,null);assert.ok(old.comps[2].warnings.some(w=>w.includes('No rent')));
assert.ok(readFileSync('components/CompIntakeForm.tsx','utf8').includes('accept=".xlsx,.xlsm,.xls,.csv"'));
// Optional private workbook verification: pass their folder explicitly, never bundle them.
if(process.argv[2]) {
  const cases=[['Norfolk IOS Comps (1).xlsx',12,'lease'],['IOS Sale Comps.xlsx',7,'sale'],['IOS NE Sale Comps.xlsx',15,'sale'],['IOS Comps.xls',33,'lease']];
  for(const [file,count,type] of cases){
    const result=await upload(readFileSync(`${process.argv[2]}/${file}`),file);
    assert.equal(result.comps.length,count,file);assert.ok(result.comps.every(c=>c.compType===type),file);
    assert.ok(result.comps.every(c=>c.sourceTerms?.length&&c.notes),file+' source evidence');
    assert.ok(result.comps.every(c=>type==='sale'?c.closedOn:c.dateCommenced),file+' dates');
    if(file.includes('NE')) {assert.ok(result.comps.every(c=>c.datePrecision==='quarter'));assert.equal(result.comps[0].buildingSf,65865);}
    if(file==='IOS Sale Comps.xlsx') assert.equal(result.comps[0].buildingSf,7500);
    if(file==='IOS Comps.xls') {assert.equal(result.comps.filter(c=>!c.rent).length,1);assert.equal(result.comps[3].yardAcres,5.5);}
    console.log(`${file}: ${count} ${type} drafts; source evidence and dates verified`);
  }
}
console.log('Broker layouts: modern/legacy uploads, quarter dates, source retention, acreage, concessions and missing-rent review passed.');
