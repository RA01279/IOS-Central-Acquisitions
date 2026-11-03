import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function load(file, deps = {}) {
  const m = new Module(process.cwd() + '/' + file); m.paths = Module._nodeModulePaths(process.cwd());
  m.require = (name) => deps[name] ?? require(name);
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
export const parser = load('lib/comps/parse.ts');
export const reader = load('lib/comps/fromWorkbook.ts');
export const file = new URL('./fixtures/starpoint-lease-comps.xlsx', import.meta.url);
export const bytes = readFileSync(file);
export async function reproduce() {
  const workbook = await reader.workbookToDelimitedText(bytes, 'Starpoint Lease Comps.xlsx');
  const assessed = workbook.sheets.map((s) => parser.assessSheet(s.name, s.text));
  const route = load('app/api/comps/parse/route.ts', { 'next/server': { NextResponse: { json: (body, init) => ({body,status:init?.status??200}) } }, '@/lib/auth': {getCurrentUser:async()=>({email:'test@example.com'})}, '@/lib/comps/parse': parser, '@/lib/comps/fromWorkbook': reader });
  const response = await route.POST({json:async()=>({fileName:'Starpoint Lease Comps.xlsx',fileBase64:bytes.toString('base64')})});
  console.log(JSON.stringify({assessed,status:response.status,drafts:response.body.comps.length,warnings:response.body.warnings},null,2));
  return {workbook,response};
}
if (process.argv.includes('--reproduce')) await reproduce();
