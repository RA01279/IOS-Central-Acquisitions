const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const helperModule = new Module(require('node:path').resolve('lib/loi-docx.ts'), module);
helperModule._compile(ts.transpileModule(fs.readFileSync('lib/loi-docx.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, 'lib/loi-docx.ts');
const templateZip = new PizZip();
templateZip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
templateZip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{property_description}</w:t></w:r></w:p><w:p><w:r><w:t>${price}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
const templateBytes = templateZip.generate({ type: 'nodebuffer' });

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
      maybeSingle() { return Promise.resolve({ data: { deal_portfolio_id: 'portfolio', deal_portfolios: { name: 'Central IOS Portfolio' }, loi_terms: { price: '500000' } }, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: operation === 'select' ? sites : null, error: null }).then(resolve, reject); },
    }; return q;
  },
  storage: { from() { return {
    async download(path) { template = path; return { data: { async arrayBuffer() { return templateBytes; } } }; },
    async upload() { return { error: null }; },
  }; } },
};
const stubs = {
  '@/lib/supabase': { getServiceClient: () => db },
  '@/lib/auth': { getCurrentUser: async () => ({ email: 'test@example.com' }) },
  '@/lib/deals': { logDealEvent: async (...args) => events.push(args), recordOffer: async (...args) => offers.push(args) },
  '@/lib/money': { parseMoney: (value) => value == null ? null : Number(String(value).replace(/[$,]/g, '')) },
  '@/lib/stage-rules': { validDate: () => true },
  '@/lib/loi-docx': helperModule.exports,
  pizzip: PizZip,
  docxtemplater: class extends Docxtemplater { render(data) { rendered = data; return super.render(data); } },
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
  const response = await post({ ...body, selectedDealIds: ['b'], propertyDescription: 'Injected excluded property', portfolioTitle: 'Injected title' });
  assert.equal(response.status, 200);
  assert.equal(template, 'templates/loi-ios.docx');
  assert.equal(rendered.property_description, 'Central IOS Portfolio');
  assert.match(rendered.portfolio_assets, /200 Second St/);
  assert.doesNotMatch(rendered.portfolio_assets, /100 First St|Injected/);
  assert.match(response.headers.get('Content-Disposition'), /LOI-Central-IOS-Portfolio-/);
  const outputXml = new PizZip(Buffer.from(await response.arrayBuffer())).file('word/document.xml').asText();
  assert.match(outputXml, /Central IOS Portfolio/);
  assert.match(outputXml, /Exhibit A/);
  assert.match(outputXml, /200 Second St/);
  assert.doesNotMatch(outputXml, /100 First St|Injected|following \d+ properties/);
  assert.equal((outputXml.match(/9,000,000/g) ?? []).length, 1);
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
  reset();
  assert.equal((await post({ ...body, offerChannel: 'direct', attn: '', brokerFirm: 'Stale Brokerage', brokerClauseName: 'Stale Broker' })).status, 200);
  assert.equal(rendered.attn, 'Property Owner');
  assert.equal(rendered.broker_clause_name, '');
  assert.equal(saved.loi_terms.portfolioOfferTerms.offerChannel, 'direct');
  assert.equal(saved.loi_terms.portfolioOfferTerms.brokerFirm, '');
  const directXml = '<w:body><w:p><w:r><w:t>{seller_name}</w:t></w:r></w:p><w:p><w:r><w:t>{broker_</w:t></w:r><w:r><w:t>firm}</w:t></w:r></w:p><w:p><w:r><w:t>{broker_address1}</w:t></w:r></w:p><w:p><w:r><w:t>Broker: {broker_clause_name}; {commission_payer} pays commission.</w:t></w:r></w:p><w:p><w:r><w:t>Price: {price}</w:t></w:r></w:p></w:body>';
  const direct = helperModule.exports.omitBrokerDetails(directXml);
  assert.doesNotMatch(direct, /broker_|commission_payer|pays commission/);
  assert.match(direct, /seller_name/);
  assert.match(direct, /Price: \{price\}/);
  assert.equal((direct.match(/<w:p>/g) ?? []).length, 2);
  console.log('Portfolio LOI: selection validation, IOS template, total-only pricing, filing, and offer recording passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
