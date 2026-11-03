import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const loaded = new Map();
function load(file, deps = {}) {
  if (loaded.has(file)) return loaded.get(file);
  const m = new Module(process.cwd() + '/' + file);
  m.paths = Module._nodeModulePaths(process.cwd());
  m.require = (name) => deps[name] ?? require(name);
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
  loaded.set(file, m.exports); return m.exports;
}
const yard = load('lib/sourcing/yard-users.ts');
const profiles = load('lib/sourcing/profiles.ts', { './yard-users': yard });
const parcels = load('lib/sourcing/parcels.ts');
const identity = load('lib/sourcing/identity.ts');
const discovery = load('lib/sourcing/discovery.ts', { './yard-users': yard });
const sweep = load('lib/sourcing/sweep.ts', { '@/lib/comps/match': load('lib/comps/match.ts'), './yard-users': yard, './parcels': parcels , './identity': identity, './discovery': discovery });
const exporter = load('lib/sourcing/export.ts');
const E = require('exceljs');
const center = { lat: 29.87, lng: -95.55 };
const pick = (ids) => profiles.selectedProfiles(ids);
const A = ['trucking-towing'], B = ['equipment'], AB = [...A, ...B];
const expectedTerms = { 'trucking-towing': ['trucking company', 'towing service'], equipment: ['equipment rental sales', 'crane service'] };
const distance = (p) => {
  const rad = (n) => n * Math.PI / 180;
  const lat = rad(p.geometry.location.lat - center.lat), lng = rad(p.geometry.location.lng - center.lng);
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.sin(lat / 2) ** 2 + Math.cos(rad(center.lat)) * Math.cos(rad(p.geometry.location.lat)) * Math.sin(lng / 2) ** 2));
};
const idsOf = (sites) => sites.flatMap((s) => s.operators.map((o) => o.placeId)).sort();
const make = (id, name, address, lat = center.lat + 0.001, lng = center.lng) => ({ place_id: id, name, vicinity: address, geometry: { location: { lat, lng } }, business_status: 'OPERATIONAL' });
const same = make('shared', 'Shared Yard', '100 Yard Rd');
const records = {
  'trucking company': [same, make('a', 'Branch Trucking', '200 Yard Rd'), make('branch', 'Branch Trucking', '900 Other Rd', center.lat + .01), make('outside', 'Far Trucking', 'Outside', center.lat + 1)],
  'towing service': [same, make('a-copy', 'Branch Trucking', '200 Yard Rd'), make('closed', 'Closed Yard', '800 Yard Rd')],
  'equipment rental sales': [same, make('b', 'Crane Rental', '100 Yard Rd Ste 2'), make('adjacent', 'Adjacent Crane', '102 Yard Rd')],
  'crane service': [make('b', 'Crane Rental', '100 Yard Rd Ste 2')],
};
records['towing service'][2].business_status = 'CLOSED_PERMANENTLY';
assert.equal(pick([]), null); assert.equal(pick(['bogus']), null); assert.equal(pick(['equipment', 'equipment']).length, 1);
assert.deepEqual(pick(AB).map((p) => p.id).sort(), [...AB].sort());
const fixtureRequests = [];
const fakeFetch = async (input) => {
  const u = new URL(input); fixtureRequests.push(u);
  if (u.pathname.includes('details')) return { json: async () => u.searchParams.get('place_id') === 'adjacent' ? { status: 'REQUEST_DENIED' } : { status: 'OK', result: { formatted_phone_number: '713-555-0100', website: 'https://example.com', url: 'https://maps.google.com/?cid=123' } } };
  assert.equal(u.searchParams.get('location'), `${center.lat},${center.lng}`);
  assert.equal(u.searchParams.get('radius'), '1609');
  return { json: async () => ({ status: 'OK', results: records[u.searchParams.get('keyword')] }) };
};
for (const [selection, expected] of [[A, ['a', 'branch', 'shared']], [B, ['adjacent', 'b', 'shared']], [AB, ['a', 'adjacent', 'b', 'branch', 'shared']]]) {
  fixtureRequests.length = 0;
  const result = await sweep.searchYardUsers(center, 1, 'not-a-key', fakeFetch, pick(selection));
  assert.deepEqual(fixtureRequests.map((u) => u.searchParams.get('keyword')).sort(), selection.flatMap((id) => expectedTerms[id]).sort());
  const sites = sweep.buildSites(center, 1, result.places, []);
  assert.deepEqual(idsOf(sites), expected.sort(), 'complete independent fixture membership');
  assert.ok(sites.every((s) => s.distanceMi <= 1));
  if (selection.length === 2) {
    assert.equal(sites.length, 4, 'one shared property, adjacent separate property, two separate chain branches');
    const shared = sites.find((s) => s.operators.some((o) => o.placeId === 'shared'));
    assert.deepEqual(shared.profileIds.sort(), AB.sort());
    assert.equal(shared.operators.length, 2, 'different occupiers at shared property survive');
    assert.deepEqual(shared.operators.find((o) => o.placeId === 'shared').profileIds.sort(), AB.sort());
    assert.deepEqual(sites.find((s) => s.address === '200 Yard Rd').operators[0].sourcePlaceIds.sort(), ['a', 'a-copy']);
    const contacts = await sweep.enrichBusinessContacts(sites, 'not-a-key', fakeFetch);
    assert.equal(contacts.failed, 1); assert.equal(contacts.requested, 5);
    assert.ok(fixtureRequests.filter((u) => u.pathname.includes('details')).every((u) => u.searchParams.get('fields') === 'formatted_phone_number,website,url'));
    const filtered = sites.filter((s) => s.operators.some((o) => ['a', 'branch'].includes(o.placeId)));
    const book = await exporter.buildSourcingWorkbook(filtered, 'Combined fixture');
    const reopened = new E.Workbook(); await reopened.xlsx.load(await book.xlsx.writeBuffer());
    const sheet = reopened.getWorksheet('Opportunities');
    assert.equal(sheet.rowCount - 4, filtered.length);
    assert.deepEqual(sheet.getColumn(1).values.slice(5), filtered.map((s) => s.ref));
    assert.deepEqual(sheet.getColumn(2).values.slice(5), ['200 Yard Rd', '900 Other Rd']);
    assert.match(sheet.getCell('Y5').value, /https:\/\/example.com/);
    assert.match(sheet.getCell('Z5').value, /https:\/\/maps.google.com/);
    assert.match(sheet.getCell('X5').value, /Business|Branch Trucking/);
    assert.match(sheet.getCell('AA5').value, /Trucking & Towing/);
    const attached = sweep.attachParcels(sites, sites.map(() => ({ propId: 'same-parcel', county: 'Test', owner: 'YARD LLC' })));
    assert.equal(attached.length, 1); assert.equal(attached[0].operators.length, 4, 'same business twice on one parcel collapses, other businesses remain');
    assert.deepEqual(attached[0].profileIds.sort(), AB.sort());
  }
}
const partial = await sweep.searchYardUsers(center, 1, 'k', async (input) => ({ json: async () => new URL(input).searchParams.get('keyword') === 'crane service' ? { status: 'OVER_QUERY_LIMIT' } : { status: 'ZERO_RESULTS' } }), pick(AB));
assert.equal(partial.failedSearches, 1); assert.equal(partial.totalSearches, 4); assert.equal(partial.searches.filter((s) => s.failed).length, 1);
// More than one Google page / UI viewport: no slicing in the reviewed/exported set.
const many = sweep.buildSites(center, 1, Array.from({ length: 45 }, (_, i) => ({ ...make('m'+i, 'Yard '+i, `${100+i} Test St`), category: 'Trucking & Towing' })), []);
assert.equal(many.length, 45);
const manyBook = await exporter.buildSourcingWorkbook(many, '45 properties');
assert.equal(manyBook.getWorksheet('Opportunities').rowCount - 4, 45);
assert.deepEqual(manyBook.getWorksheet('Opportunities').getColumn('ref').values.slice(5), many.map((s) => s.ref));
console.log('PASS: individual/OR profile keywords, exact complete membership, geography, provenance, repeat listings vs shared properties vs chain branches, partial searches, contacts and full XLSX membership');

if (process.argv.includes('--live')) {
  const env = readFileSync('C:/Users/randerson/hopper-sourcing/.env.local', 'utf8');
  const key = env.match(/^GOOGLE_MAPS_SERVER_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
  assert.ok(key, 'Existing Google server key required');
  const evidence = [];
  for (const selection of [A, B, AB]) {
    const raw = [];
    const capture = async (input, options) => {
      const u = new URL(input), response = await fetch(input, options);
      const data = await response.json();
      raw.push({ keyword: u.searchParams.get('keyword'), center: u.searchParams.get('location'), radius: u.searchParams.get('radius'), status: data.status, results: data.results ?? [], limited: !!data.next_page_token });
      return { json: async () => data };
    };
    const result = await sweep.searchYardUsers(center, 1, key, capture, pick(selection));
    const expected = new Map();
    for (const request of raw) {
      assert.equal(request.center, `${center.lat},${center.lng}`); assert.equal(request.radius, '1609');
      assert.ok(selection.flatMap((id) => expectedTerms[id]).includes(request.keyword));
      const profile = pick(selection).find((p) => p.keywords.includes(request.keyword));
      for (const p of request.results) if (!yard.rejectReason(p, profile.label) && distance(p) <= 1) {
        const row = expected.get(p.place_id) ?? { placeId: p.place_id, profiles: new Set() };
        row.profiles.add(profile.id); expected.set(p.place_id, row);
      }
    }
    const returned = result.places.filter((p) => distance(p) <= 1);
    assert.deepEqual(returned.map((p) => p.place_id).sort(), [...expected.keys()].sort());
    for (const p of returned) assert.deepEqual([...p.profileIds].sort(), [...expected.get(p.place_id).profiles].sort());
    const grouped = sweep.buildSites(center, 1, result.places, []);
    const [rolls, contacts] = await Promise.all([parcels.lookupParcels(grouped), sweep.enrichBusinessContacts(grouped, key)]);
    const sites = sweep.attachParcels(grouped, rolls);
    // All eligible Google listings remain represented, including duplicate
    // listings consolidated into another operator's canonical place ID.
    const represented = sites.flatMap((s) => s.operators.flatMap((o) => o.sourcePlaceIds ?? [o.placeId]));
    assert.deepEqual([...new Set(represented)].sort(), [...expected.keys()].sort());
    const reviewed = sites.filter((s) => s.parcel?.ownerClass !== 'public');
    const workbook = await exporter.buildSourcingWorkbook(reviewed, `Live ${selection.join(' OR ')}; first-page sample`);
    const bytes = await workbook.xlsx.writeBuffer(), reopened = new E.Workbook(); await reopened.xlsx.load(bytes);
    assert.deepEqual(reopened.getWorksheet('Opportunities').getColumn(1).values.slice(5), reviewed.map((s) => s.ref));
    assert.equal(reopened.getWorksheet('Opportunities').rowCount - 4, reviewed.length);
    evidence.push({ selection: [...selection], requests: raw, expectedBusinessIds: [...expected.keys()].sort(), returnedBusinessIds: returned.map((p) => p.place_id).sort(), searches: result.searches, contacts, sites, reviewedRefs: reviewed.map((s) => s.ref), exportedRows: reviewed.length });
    console.log(JSON.stringify({ liveSelection: selection, actualKeywords: raw.map((r) => r.keyword), matchedBusinessIds: returned.map((p) => p.place_id).sort(), properties: sites.length, exportedProperties: reviewed.length, contacts, failedSearches: result.failedSearches }));
    mkdirSync('.scratch/profile-evidence', { recursive: true });
    writeFileSync(`.scratch/profile-evidence/${selection.join('-')}.xlsx`, bytes);
  }
  writeFileSync('.scratch/profile-evidence/google-records.json', JSON.stringify(evidence, null, 2));
  console.log('PASS: live Google request/record reference sets and XLSX membership; evidence in .scratch/profile-evidence (no keys)');
}
