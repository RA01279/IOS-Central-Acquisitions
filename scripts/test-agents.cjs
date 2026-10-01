const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(path, mocks = {}) {
 const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
 const module = { exports: {} };
 vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || require(name), Date, URL, console });
 return module.exports;
}
const catalog = load('lib/agents/catalog.ts', { './memo': load('lib/agents/memo.ts'), './ic-narrative': load('lib/agents/ic-narrative.ts') });
assert.equal(catalog.AGENTS.length, 7);
assert.match(catalog.buildPrompt('ic-narrative', [], '', '2026-10-01'), /ic-narrative-v1/);
assert.equal(catalog.isAgentId('__proto__'), false);
assert.equal(catalog.isAgentId('comp-analyst'), true);
assert.match(catalog.buildPrompt('underwriting-review', [], 'source', '2026-09-29'), /not performed/);
const json = (body, status = 200) => ({ body, status });
let user = null;
const owner = 'owner@example.com';
const calls = [];
const db = { from(table) {
 const chain = {};
 for (const method of ['select','eq','gt','order','limit','update']) chain[method] = (...args) => { calls.push([table,method,...args]); return chain; };
 chain.maybeSingle = async () => ({ data: null, error: null });
 return chain;
} };
const server = load('lib/agents/server.ts', {
 '@/lib/supabase': { getServiceClient: () => db },
 '@/lib/auth': { getCurrentUser: async () => user },
 '@/lib/outlook-helper': { helperJson: json, helperTokenHash: x => 'hash:'+x },
});
const req = (origin = 'https://hopper.test', token = '') => ({ headers: { get: n => ({ origin, host:'hopper.test', authorization:token })[n] || null } });
(async () => {
 assert.equal((await server.userContext(req())).response.status,401);
 user = { email: owner };
 assert.equal((await server.userContext(req('https://evil.test'),true)).response.status,403);
 assert.equal((await server.userContext(req('invalid'),true)).response.status,403);
 assert.equal((await server.userContext(req(),true)).email,owner);
 assert.equal(await server.workerContext(req()),null);
 await server.workerContext(req(undefined,'Bearer '+'a'.repeat(43)));
 assert(calls.some(c => c[1]==='eq' && c[2]==='token_hash'));
 assert(calls.some(c => c[1]==='gt' && c[2]==='expires_at'));
 const route = load('app/api/agents/route.ts', {
  '@/lib/agents/server': { userContext: async () => ({db,email:owner}),json,reap:async()=>{} },
  '@/lib/agents/catalog':catalog, '@/lib/agents/context': { loadEvidence:async()=>[] },
 });
 const missing = await route.GET({nextUrl:new URL('https://hopper.test/api/agents?id=00000000-0000-4000-8000-000000000001')});
 assert.equal(missing.status,404);
 assert(calls.some(c=>c[0]==='agent_runs'&&c[1]==='eq'&&c[2]==='owner_email'&&c[3]===owner));
 const bad = await route.POST({text:async()=>JSON.stringify({agent:'comp-analyst',text:''})});
 assert.equal(bad.status,400);
 const intake = await route.POST({text:async()=>JSON.stringify({agent:'deal-intake',text:''})});
 assert.equal(intake.status,400);
 const oversized = await route.POST({text:async()=>'x'.repeat(120001)}); assert.equal(oversized.status,413);
 const sql=fs.readFileSync('supabase/migrations/20260929205444_hopper_agents.sql','utf8');
 assert.match(sql,/enable row level security/); assert.match(sql,/revoke all .*anon,authenticated/);
 console.log('Agent checks passed: seven roles, origin checks, owner scoping, token expiry, input bounds, and required evidence.');
})().catch(e=>{console.error(e);process.exitCode=1});
