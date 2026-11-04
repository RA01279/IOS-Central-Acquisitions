import {execFileSync} from 'node:child_process';
import Module from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';
import {load,bytes,json} from './portfolio-sale-case.mjs';
const baseline='eb9037d';
function old(file,deps={}){const m=new Module(process.cwd()+'/'+file);m.require=n=>deps[n];m._compile(ts.transpileModule(execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'}),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return m.exports;}
const parser=old('lib/comps/parse.ts');
const route=old('app/api/comps/parse/route.ts',{'next/server':{NextResponse:{json}},'@/lib/auth':{getCurrentUser:async()=>({email:'regression@example.com'})},'@/lib/comps/parse':parser,'@/lib/comps/fromWorkbook':{}});
const response=await route.POST({json:async()=>({fileName:'Starpoint Sale Comps 10.12.26.pdf',fileBase64:bytes.toString('base64')})});
const pdf=await load('lib/comps/fromPdf.ts').pdfSaleTables(bytes);
const prior=parser.parseCompInput({text:pdf.text}).comps;
const result={baseline,directPdfUploadStatus:response.status,directPdfUploadError:response.body.error,flattenedRecords:prior.length,portfolioRelationships:prior.filter(c=>c.portfolio).length,multiAddressRecords:prior.filter(c=>c.address.includes(',')).map(c=>({address:c.address,salePrice:c.salePrice})),componentRowsTreatedAsSeparateSales:prior.filter(c=>['2015 Pasket Ln','15800 Export Plaza','12400 Taylor Rd'].includes(c.address)).length};
fs.mkdirSync('.scratch/starpoint-sales',{recursive:true});fs.writeFileSync('.scratch/starpoint-sales/baseline.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
