import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const env={ZONEOMICS_API_KEY:"test-secret-never-return"};
let calls=0, responseStatus=200;
const raw={status:true,link:"https://api.zoneomics.com/?api_key=test-secret-never-return",data:{meta:{city_id:42,city_name:"Plano",last_updated:"2026-09-01"},zone_details:{zone_code:"LC",zone_name:"Light Commercial",link:"https://api.zoneomics.com/?api_key=test-secret-never-return"}}};
const modules=new Map();
function load(file,extra={}) {
  if(modules.has(file)) return modules.get(file);
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{
    exports,process:{env},URL,URLSearchParams,AbortSignal,Buffer,console,
    fetch:async()=>{calls++;return {ok:responseStatus===200,status:responseStatus,json:async()=>raw};},
    require:n=>n.startsWith("./")?load("lib/zoning/"+n.slice(2)+".ts"):require(n),...extra,
  });
  modules.set(file,exports);return exports;
}
const geo=load("lib/zoning/geometry.ts");
const polygon={rings:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,3],[3,3],[3,1],[1,1]]]};
assert.equal(geo.containsPoint({lng:0.5,lat:0.5},polygon),true);
assert.equal(geo.containsPoint({lng:2,lat:2},polygon),false);
assert.equal(geo.containsPoint({lng:5,lat:2},polygon),false);
const z=load("lib/zoning/zoneomics.ts");
const record=z.parseZoneomics(raw);
assert.equal(record.zoning.district,"LC");
assert.equal(JSON.stringify(record).includes("test-secret"),false);
assert.equal(record.zoning.modifiersVerified,false);
assert.equal(z.compareProviderZoning(record,{...record,cityId:"another"}),"outside");
assert.equal(z.compareProviderZoning(record,record),"same_code");
assert.equal(z.compareProviderZoning(record,{...record,zoning:{...record.zoning,district:"LI-1"}}),"different");
assert.throws(()=>z.parseZoneomics({status:true,data:{zone_code:"LC"}}));
const point={lat:33.0138832,lng:-96.6723418};
await Promise.all([z.lookupZoneomics(point),z.lookupZoneomics(point)]);
assert.equal(calls,1,"concurrent lookups share one provider request");
responseStatus=403;
await assert.rejects(()=>z.lookupZoneomics({...point,lat:33.02}),/API access/);
responseStatus=200;
await z.lookupZoneomics({...point,lat:33.02});
assert.equal(calls,3,"failed requests are not cached");
delete env.ZONEOMICS_API_KEY;
await assert.rejects(()=>z.lookupZoneomics(point),/administrator/);
const ExcelJS=require("exceljs");
const parser=load("lib/excel-parser.ts");
const ios=new ExcelJS.Workbook(), sheet=ios.addWorksheet("Summary Table");
sheet.getCell("F7").value=4200000;
sheet.getCell("G24").value={formula:"0.2",result:0.2};
sheet.getCell("G25").value=2.1;
const summary=await parser.parseReturnsSummary(Buffer.from(await ios.xlsx.writeBuffer()));
assert.equal(summary.purchasePrice,4200000);assert.equal(summary.irrPct,0.2);assert.equal(summary.equityMultiple,2.1);
const industrial=new ExcelJS.Workbook(),upload=industrial.addWorksheet("_Upload_");
upload.addRow([null,"Purchase Price",5000000]);upload.addRow([null,"Last sale",60]);upload.addRow([null,"Gross IRR Lev",0.18]);
const summary2=await parser.parseReturnsSummary(Buffer.from(await industrial.xlsx.writeBuffer()));
assert.equal(summary2.purchasePrice,5000000);assert.equal(summary2.holdPeriodYears,5);assert.equal(summary2.irrPct,0.18);
console.log("PASS: zoning boundaries, municipality/code matching, response validation, secret redaction, request deduplication, retry, IOS and industrial workbook parsing.");
