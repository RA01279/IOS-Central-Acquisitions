import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

const dir = 'C:/Users/randerson/Downloads';
const filename = readdirSync(dir).filter((p) => /^off-market-opportunities-\d{4}-\d{2}-\d{2}.*\.xlsx$/.test(p)).sort((a, b) => statSync(`${dir}/${b}`).mtimeMs - statSync(`${dir}/${a}`).mtimeMs)[0];
assert.ok(filename, 'Browser download exists');
const reference = JSON.parse(readFileSync('.scratch/profile-evidence/google-records.json', 'utf8')).find((r) => r.selection.length === 2);
const expected = reference.sites.filter((s) => s.parcel?.ownerClass !== 'public');
const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(`${dir}/${filename}`);
const sheet = workbook.getWorksheet('Opportunities');
const returned = sheet.getColumn(1).values.slice(5);
assert.deepEqual(returned, expected.map((s) => s.ref));
assert.deepEqual(sheet.getColumn(2).values.slice(5), expected.map((s) => s.address));
assert.deepEqual(sheet.getColumn(3).values.slice(5), expected.map((s) => s.operators.map((o) => o.name).join(', ')));
for (const [i, site] of expected.entries()) {
  assert.equal(sheet.getCell(`E${i+5}`).value ?? null, site.parcel?.owner ?? null);
  assert.equal(sheet.getCell(`H${i+5}`).value ?? null, site.parcel?.acres ?? null);
  assert.equal(sheet.getCell(`X${i+5}`).value ?? '', site.operators.filter((o) => o.phone).map((o) => `${o.name}: ${o.phone}`).join('\n'));
  assert.equal(sheet.getCell(`AA${i+5}`).value, site.operators.map((o) => `${o.name}: ${(o.categories ?? [o.category]).join(', ')}`).join('\n'));
}
const expectedAcreage = expected.filter((s) => s.parcel?.acres >= 1.5 && s.parcel?.acres <= 10).map((s) => s.ref);
assert.deepEqual(expectedAcreage, ['S1', 'S3', 'S5'], 'Independent parcel-based acreage set agrees with browser');
const evidence = { verified: true, filename, propertyRefs: returned, businessIds: expected.flatMap((s) => s.operators.map((o) => o.placeId)).sort(), exportedRows: sheet.rowCount-4, expectedAcreageRefs: expectedAcreage, fieldsCompared: ['site refs', 'addresses', 'all businesses', 'owners', 'numeric acres', 'business phones', 'matched profiles'] };
writeFileSync('.scratch/profile-evidence/browser-export-verification.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
