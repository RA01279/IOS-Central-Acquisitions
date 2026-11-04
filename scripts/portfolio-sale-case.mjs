import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();
export function load(file,overrides={}){
 const absolute=path.resolve(file);if(cache.has(absolute)&&!Object.keys(overrides).length)return cache.get(absolute);
 const m=new Module(absolute);m.paths=Module._nodeModulePaths(path.dirname(absolute));
 m.require=name=>name in overrides?overrides[name]:name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(absolute),name).replace(/\.ts$/,'')+'.ts'):require(name);
 m._compile(ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,absolute);
 cache.set(absolute,m.exports);return m.exports;
}
export const json=(body,init)=>({body,status:init?.status??200,json:async()=>body});
export const bytes=fs.readFileSync(new URL('./fixtures/starpoint-sale-comps.pdf',import.meta.url));
export async function saleCase(){
 const route=load('app/api/comps/parse/route.ts',{'next/server':{NextResponse:{json}},'@/lib/auth':{getCurrentUser:async()=>({email:'regression@example.com'})}});
 const response=await route.POST({json:async()=>({fileBase64:bytes.toString('base64'),fileName:'Starpoint Sale Comps 10.12.26.pdf'})});
 if(response.status!==200)throw Error(JSON.stringify(response.body));
 return response.body;
}
if(process.argv.includes('--inspect'))console.log(JSON.stringify(await saleCase(),null,2));
