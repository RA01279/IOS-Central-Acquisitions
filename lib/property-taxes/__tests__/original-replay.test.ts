import {expect,it} from 'vitest';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {actPdfCells,parseActRecord,actAccount} from '../act';
import {parseHarrisHistory} from '../harris';
import {parseTravisHistory} from '../travis';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
// The retained county originals (docs/tax-system-audit-20261026) hold portfolio tax records and stay out of git
// (the repository is public); these checks run where that folder exists and skip in CI.
const audit=existsSync('docs/tax-system-audit-20261026'),itAudit=it.skipIf(!audit);
const root='docs/tax-system-audit-20261026';
function audits(){return readdirSync(`${root}/properties`).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>JSON.parse(readFileSync(`${root}/properties/${n}`,'utf8')));}
itAudit('reparses retained official originals against all 17 independently entered reference amounts, including Mills penalty-bearing 2022',async()=>{
 const reference=JSON.parse(readFileSync(`${root}/independent-expected.json`,'utf8')),rows=audits();let checked=0;
 for(const expected of reference.samples){
  const audit=rows.find(a=>a.subject.address===expected.address);
  for(const [year,amount] of expected.years){
   const saved=audit.state.records.find((r:any)=>r.year===year&&r.billEvidence?.collectorAccount===expected.collectorAccount);
   const p=audit.state.parcels.find((p:any)=>p.key===saved.parcelKey),s=audit.state.sources.find((s:any)=>s.id===saved.facts.levied.sourceId);
   const retained=audit.manifest.find((m:any)=>m.sourceId===s.id),bytes=readFileSync(retained.file);
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(retained.sha256);
   let parsed;
   if(p.county.toLowerCase()==='harris'){
    const raw=JSON.parse(bytes.toString());parsed=parseHarrisHistory(raw.history,raw.statement,p,s).find(r=>r.year===year);
   }else if(p.county.toLowerCase()==='travis'){
    const doc=await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true}).promise;
    try{const first=await(await doc.getPage(1)).getTextContent(),second=await(await doc.getPage(2)).getTextContent();
     const cells=second.items.filter((i:any)=>'str'in i).map((i:any)=>({text:i.str.trim(),x:i.transform[4],y:i.transform[5]}));
     parsed=parseTravisHistory(cells,first.items.map((i:any)=>i.str??'').join(' '),p,s).find(r=>r.year===year);
    }finally{await doc.destroy();}
   }else{
    const cells=await actPdfCells(new Uint8Array(bytes));
    parsed=parseActRecord(cells,p,s,cells.some(c=>/^PAYMENT RECORD(?: VIA WEB)?$/.test(c.text))?year:undefined);
   }
   expect(parsed?.facts.levied?.value,`${expected.address} ${year} reparsed original`).toBe(amount);
   expect(saved.facts.levied.value).toBe(amount);checked++;
  }
 }
 expect(checked).toBe(17);
},60000);
itAudit('handles a retained Dallas alphanumeric account without claiming the acquisition match is verified',async()=>{
 const audit=audits().find(a=>a.subject.address==='355 Grand Junction Blvd'),p=audit.state.parcels.find((p:any)=>p.accountId==='380930000102R0000');
 const row=audit.state.records.find((r:any)=>r.parcelKey===p.key&&r.year===2026),s=audit.state.sources.find((s:any)=>s.id===row.facts.levied.sourceId),m=audit.manifest.find((m:any)=>m.sourceId===s.id);
 expect(actAccount({...p,accountId:'380930000102r0000'})).toBe('380930000102R0000');
 expect(parseActRecord(await actPdfCells(new Uint8Array(readFileSync(m.file))),p,s).facts.levied?.value).toBe(69902.49);
 expect(p.review).toBe('pending');
},30000);
