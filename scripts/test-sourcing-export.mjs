import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import ts from 'typescript';
import ExcelJS from 'exceljs';
const require = createRequire(import.meta.url);
const module = new Module(process.cwd() + '/export-test.cjs'); module.paths = Module._nodeModulePaths(process.cwd());
const src = ts.transpileModule(readFileSync('lib/sourcing/export.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
module._compile(src, process.cwd() + '/export-test.cjs');
const site = { ref: 'S1', address: '=1+1', lat: 30, lng: -95, operators: [{ name: 'Test Yard' }], categories: ['Trucking'], ownerUser: true, parcel: { owner: 'Owner LLC', acres: 0, propId: '00123', source: 'County roll' } };
for (const qualified of [false, true]) {
 const research = { ref: 'S1', ownerType: 'unknown', acres: 2.5, signals: [], sources: [], unverified: [], outreach: 'PRIVATE DRAFT' };
 const book = await module.exports.buildSourcingWorkbook([site], 'Test', qualified ? [research] : undefined);
 const reopened = new ExcelJS.Workbook();
 await reopened.xlsx.load(await book.xlsx.writeBuffer());
 const sheet = reopened.getWorksheet('Opportunities');
 assert.equal(sheet.rowCount, 5);
 assert.equal(sheet.getCell('B5').value, '=1+1');
 assert.equal(sheet.getCell('B5').type, ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('H5').value, qualified ? 2.5 : 0);
 assert.equal(sheet.getCell('E5').value, 'Owner LLC');
 assert.equal(sheet.getCell('L5').value, '00123');
 assert.match(sheet.getCell('U5').value.hyperlink, /30,-95/);
 assert.equal(sheet.views[0].ySplit, 4);
 assert.ok(sheet.autoFilter);
 assert.ok(!JSON.stringify(sheet.model).includes('PRIVATE DRAFT'));
}
console.log('PASS: sweep and qualified XLSX round trips, numeric fields, text safety, IDs, links, filters, frozen headers and outreach exclusion');

