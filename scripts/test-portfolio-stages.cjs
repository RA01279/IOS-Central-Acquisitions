const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file, stubs = {}) {
  const filename = path.resolve(file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = (name) => stubs[name] ?? require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const rules = load('lib/stage-rules.ts');
const stages = load('lib/portfolio-stages.ts', { './stage-rules': rules });
assert.equal(stages.portfolioStageAction('prospect', 'uw').action, 'start_underwriting');
assert(stages.portfolioStageAction('prospect', 'offered').error);
assert.equal(stages.portfolioStageAction('offered', 'moving_to_psa').action, 'confirm_psa');
assert.equal(stages.portfolioStageAction('closed', 'prospect').action, 'set_acq_stage');
assert(stages.portfolioStageAction('archived', 'uw').error);
assert(stages.portfolioStageAction('uw', 'not-a-stage').error);
const priced = [
  { id: 'prospect', stage: 'prospect', allocatedPrice: 100 },
  { id: 'uw', stage: 'uw', allocatedPrice: 200 },
  { id: 'unpriced', stage: 'prospect', allocatedPrice: null },
  { id: 'closed', stage: 'closed', allocatedPrice: 100 },
  { id: 'archived', stage: 'archived', allocatedPrice: 100 },
];
assert.deepEqual(stages.pricedPortfolioAssets(priced, 'uw').map((a) => a.id), ['prospect']);
assert.deepEqual(stages.pricedPortfolioAssets(priced, 'offered').map((a) => a.id), ['uw']);
let user, allowed, deals, calls, failId;
function reset() {
  user = { email: 'test@example.com' }; allowed = true; calls = []; failId = null;
  deals = ['a', 'b'].map((id) => ({ id, ref: id, stage: 'prospect', properties: { address: id } }));
}
const db = { from(table) {
  const query = {
    select() { return query; }, eq() { return query; },
    maybeSingle: async () => ({ data: { id: 'portfolio', name: 'Portfolio' } }),
    then(resolve, reject) { return Promise.resolve({ data: deals, error: null }).then(resolve, reject); },
  }; return query;
} };
const { NextRequest, NextResponse } = require('next/server');
const api = load('app/api/deal-portfolios/[id]/route.ts', {
  '@/lib/supabase': { getServiceClient: () => db },
  '@/lib/auth': { getCurrentUser: async () => user, canConfirmPsa: () => allowed },
  '@/lib/deal-archive': {}, '@/lib/portfolio-stages': stages,
  '@/lib/stage-rules': rules,
  '@/lib/money': { parseMoney: (v) => v == null ? null : Number(v) },
  '../../deals/[id]/route': { PATCH: async (req, props) => {
    const { id } = await props.params; calls.push({ id, body: await req.json() });
    return id === failId ? NextResponse.json({ error: 'Concurrent stage change' }, { status: 400 }) : NextResponse.json({ ok: true });
  } },
});
const body = { action: 'change_stage', selectedDealIds: ['a', 'b'], toStage: 'uw' };
const post = (value) => api.POST(new NextRequest('http://localhost/api/deal-portfolios/00000000-0000-0000-0000-000000000001', { method: 'POST', body: JSON.stringify(value) }), { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }) });
(async () => {
  reset(); user = null; assert.equal((await post(body)).status, 401);
  reset(); assert.equal((await post({ ...body, selectedDealIds: ['outside'] })).status, 400); assert.equal(calls.length, 0);
  reset(); assert.equal((await post({ ...body, toStage: 'offered' })).status, 400); assert.equal(calls.length, 0);
  reset(); assert.equal((await post({ ...body, selection: 'priced' })).status, 400); assert.equal(calls.length, 0);
  reset(); deals.forEach((d) => { d.asking_price = 1000000; });
  assert.equal((await (await post({ ...body, selection: 'priced' })).json()).moved, 2);
  reset(); const subset = await post({ ...body, selectedDealIds: ['b'] });
  assert.equal((await subset.json()).moved, 1); assert.deepEqual(calls.map((c) => c.id), ['b']);
  assert.equal(calls[0].body.action, 'start_underwriting');
  reset(); deals[0].stage = 'uw';
  const mixed = await (await post(body)).json(); assert.equal(mixed.moved, 1); assert.equal(mixed.skipped.length, 1);
  reset(); deals.forEach((d) => { d.stage = 'offered'; }); allowed = false;
  assert.equal((await post({ ...body, toStage: 'moving_to_psa' })).status, 403); assert.equal(calls.length, 0);
  reset(); deals.forEach((d) => { d.stage = 'due_diligence'; });
  assert.equal((await post({ ...body, toStage: 'closed', closedOn: '2026-10-21', closedPrices: { a: '1000000' } })).status, 400); assert.equal(calls.length, 0);
  const closed = await (await post({ ...body, toStage: 'closed', closedOn: '2026-10-21', closedPrices: { a: '1000000', b: '2000000' } })).json();
  assert.equal(closed.moved, 2); assert.deepEqual(calls.map((c) => c.body.closedPrice), ['1000000', '2000000']);
  reset(); failId = 'b'; const partial = await (await post(body)).json();
  assert.equal(partial.moved, 1); assert.equal(partial.failed.length, 1);
  console.log('Portfolio stages: selection, legal transitions, permissions, closing validation, and partial results passed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
