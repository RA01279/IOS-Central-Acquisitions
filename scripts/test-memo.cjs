const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),PizZip=require('pizzip');
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{exports:module.exports,module,require:n=>deps[n]||require(n),Buffer,process,Response,console});return module.exports;}
const memo=load('lib/agents/memo.ts'),ppt=load('lib/agents/memo-pptx.ts');
const deck={version:memo.MEMO_VERSION,property:'999 Example & Test Road',date:'September 2026',slides:memo.MEMO_SLIDES.map(([title],i)=>({number:i+1,title,bullets:['Synthetic verification only. Replace with selected-deal evidence.'],columns:['Metric','Value'],rows:[['Building SF','12,000'],['Price','Not provided']],sources:['Test & source <document>; https://example.com/?a=1&b=2'],missing:['Subject-specific exhibit not provided']}))};
assert(memo.parseMemo(JSON.stringify(deck)));assert.equal(memo.parseMemo('{}'),null);
const bad=structuredClone(deck);bad.slides[1].number=3;assert.equal(memo.parseMemo(JSON.stringify(bad)),null);
bad.slides[1].number=2;bad.slides[1].rows[0].push('extra');assert.equal(memo.parseMemo(JSON.stringify(bad)),null);
assert.throws(()=>ppt.validateImages([{slide:9,data:'https://example.com/private',source:'X'}]));
assert.throws(()=>ppt.validateImages([{slide:9,data:'data:image/png;base64,AAAA',source:'X'}]));
const bytes=ppt.renderMemo(deck);const zip=new PizZip(bytes);
assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,25);
assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/media\/image\d+\.png$/.test(n)).length,2);
for(const f of Object.keys(zip.files).filter(n=>/\.xml$|\.rels$/.test(n))){const text=zip.file(f).asText();assert(!/12803|Marek|1,315,000|Delivery Dr|\{\{PROPERTY\}\}/i.test(text),f);}
assert(zip.file('ppt/slides/slide2.xml').asText().includes('<a:tbl>'));
assert(zip.file('ppt/notesSlides/notesSlide2.xml').asText().includes('Test &amp; source &lt;document&gt;'));
fs.mkdirSync('.tmp-memo',{recursive:true});fs.writeFileSync('.tmp-memo/memo-synthetic.pptx',bytes);fs.writeFileSync('.tmp-memo/deck.json',JSON.stringify(deck));
const calls=[];let record={agent:'investment-memo',status:'completed',result:{report:JSON.stringify(deck)}};
let auth={email:'owner@example.com',db:{from:()=>{const b={select:()=>b,eq:(...a)=>{calls.push(a);return b},maybeSingle:async()=>({data:record,error:null})};return b;}}};
const route=load('app/api/agents/powerpoint/route.ts',{'@/lib/agents/server':{userContext:async()=>auth,json:(body,status=200)=>({body,status})},'@/lib/agents/catalog':{UUID:/^[a-f0-9-]{36}$/},'@/lib/agents/memo':memo,'@/lib/agents/memo-pptx':ppt});
const req={text:async()=>JSON.stringify({id:'00000000-0000-4000-8000-000000000001',exhibits:[]})};
(async()=>{let r=await route.POST(req);assert.equal(r.status,200);assert(calls.some(c=>c[0]==='owner_email'&&c[1]===auth.email));assert(r.headers.get('content-type').includes('presentationml'));
record=null;assert.equal((await route.POST(req)).status,404);
auth={response:{status:401}};assert.equal((await route.POST(req)).status,401);
console.log('PASS: 25-slide contract, safe XML, native editable tables, no example-deal carryover, source notes, image validation and authenticated owner-scoped download.');})();
