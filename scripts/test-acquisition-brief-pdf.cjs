const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {acquisitionBrief}=require('../lib/acquisition-brief.ts'),{acquisitionBriefPdf}=require('../lib/acquisition-brief-pdf.ts');
(async()=>{
 const out=path.resolve('.scratch/acquisition-brief-review');fs.mkdirSync(out,{recursive:true});
 const canvas=require('@napi-rs/canvas');global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const deal={id:'fixture-a',asset_class:'ios',stage:'uw',properties:{address:'100 Test Road',city:'Houston',market:'Houston',lot_sf:174240,building_sf:20000},contract_price:2950000,investment_review:{incomeStatus:'unknown'},documents:[],mla_data:[],uw_versions:[{id:'model-1',deal_id:'fixture-a',version_number:1,created_at:'2026-11-18T15:00:00Z',returns_summary:{sourceProperty:'100 Test Road',purchasePrice:3000000,allInCost:3400000,irrPct:-.05,equityMultiple:.9,goingInYieldPct:0,stabilizedReturnOnCostPct:.08,exitCapPct:.06,holdPeriodYears:4,stabilizedCashOnCashPct:0,warnings:['Confirm saved source values before relying on this draft.']},model_detail:{uw:{fileName:'IOS_fixture.xlsx',year1Noi:100000,recoveriesYear1:25000,capexByYear:[0,50000,0,0],rentRoll:Array.from({length:5},(_,i)=>({tenant:'Fixture Logistics '+(i+1),start:'2025-01-01',expiration:'2028-12-31',rentAnnual:120000,marketAnnual:150000}))}}}]};
 for(const name of ['sample','missing']){
  const fixture=structuredClone(deal);if(name==='missing'){fixture.uw_versions[0].returns_summary={};fixture.uw_versions[0].model_detail={};}
  const b=acquisitionBrief(fixture),bytes=await acquisitionBriefPdf(b);fs.writeFileSync(path.join(out,name+'.pdf'),bytes);
  const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false}).promise;assert.equal(pdf.numPages,1);
  const page=await pdf.getPage(1),items=(await page.getTextContent()).items,text=items.map(t=>t.str).join(' ');
  for(const item of items)if(item.transform)assert(item.transform[5]>=20 && item.transform[5]<=770,'Text outside printable page');
  if(name==='sample')for(const expected of ['-5.00%','0.00%','$100,000','$25,000','IOS_fixture.xlsx','additional tenants'])assert(text.includes(expected),expected);
  else assert(text.includes('Not available'));
  const viewport=page.getViewport({scale:1.5}),image=canvas.createCanvas(viewport.width,viewport.height);
  await page.render({canvasContext:image.getContext('2d'),canvas:image,viewport}).promise;fs.writeFileSync(path.join(out,name+'.png'),image.toBuffer('image/png'));
 }
 console.log('PASS: one-page rendered acquisition briefs, source values, zero and negative returns; '+out);
})().catch(e=>{console.error(e);process.exitCode=1;});
