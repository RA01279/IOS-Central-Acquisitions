const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');

let sites, offers, events, documents, saved, rendered, template;
function reset() {
  sites = [{ id: 'a', properties: { address: '100 First St', city: 'Dallas' } }, { id: 'b', properties: { address: '200 Second St', city: 'Austin' } }];
  offers = []; events = []; documents = []; saved = null; rendered = null; template = null;
}
const db = {
  from(table) {
    let operation = 'select';
    const q = {
      select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; },
      update(value) { operation = 'update'; saved = value; return q; },
      insert(value) { operation = 'insert'; documents = value; return q; },
      maybeSingle() { return Promise.resolve({ data: { deal_portfolio_id: 'portfolio', loi_terms: { price: '500000' } }, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: operation === 'select' ? sites : null, error: null }).then(resolve, reject); },
    }; return q;
  },
  storage: { from() { return {
    async download(path) { template = path; return { data: { async arrayBuffer() { return new ArrayBuffer(0); } } }; },
    async upload() { return { error: null }; },
  }; } },
};
const stubs = {
  '@/lib/supabase': { getServiceClient: () => db },
  '@/lib/auth': { getCurrentUser: async () => ({ email: 'test@example.com' }) },
  '@/lib/deals': { logDealEvent: async (...args) => events.push(args), recordOffer: async (...args) => offers.push(args) },
  '@/lib/money': { parseMoney: (value) => value == null ? null : Number(String(value).replace(/[$,]/g, '')) },
  '@/lib/stage-rules': { validDate: () => true },
  '@/lib/loi-docx': { dropSecondSigner: (xml) => xml },
  pizzip: class {},
  docxtemplater: class { render(data) { rendered = data; } getZip() { return { generate: () => Buffer.from('docx') }; } },
};
const filename = require('node:path').resolve('app/api/deals/[id]/loi/route.ts');
const mod = new Module(filename, module);
mod.filename = filename; mod.paths = module.paths;
mod.require = (name) => stubs[name] ?? require(name);
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const post = (body) => mod.exports.POST({ json: async () => body }, { params: Promise.resolve({ id: 'anchor' }) });
const body = { portfolioId: 'portfolio', selectedDealIds: ['a', 'b'], loiType: 'slb', price: '9000000', depositAmount: '50000', date: '2026-10-21' };
(async () => {
  reset();
  assert.equal((await post({ ...body, selectedDealIds: [] })).status, 400);
  assert.equal(template, null);
  reset(); sites = sites.slice(0, 1);
  assert.equal((await post(body)).status, 400, 'Reject IDs outside portfolio');
  assert.equal(saved, null);
  reset(); sites = sites.slice(1);
  assert.equal((await post({ ...body, selectedDealIds: ['b'], propertyDescription: 'Injected excluded property' })).status, 200);
  assert.equal(template, 'templates/loi-ios.docx');
  assert.match(rendered.property_description, /200 Second St/);
  assert.doesNotMatch(rendered.property_description, /100 First St|Injected/);
  assert.equal(rendered.price, '9,000,000');
  assert.equal(offers.length, 1);
  assert.equal(offers[0][0], 'b');
  assert.equal(offers[0][1].price, null, 'Package total is never a building offer price');
  assert.deepEqual(documents.map((d) => d.deal_id), ['b']);
  assert.equal(saved.loi_terms.price, '500000', 'Keep individual LOI terms');
  assert.deepEqual(saved.loi_terms.portfolioOfferTerms.selectedDealIds, ['b']);
  assert.equal(events.find((e) => e[1] === 'portfolio_offer_generated')[2].totalPrice, 9000000);
  reset();
  assert.equal((await post(body)).status, 200);
  assert.equal(offers.length, 2);
  assert(offers.every((o) => o[1].price === null));
  console.log('Portfolio LOI: selection validation, IOS template, total-only pricing, filing, and offer recording passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
