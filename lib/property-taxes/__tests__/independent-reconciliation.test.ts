import {it,expect} from 'vitest';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
// The retained county originals (docs/tax-system-audit-20261026) hold portfolio tax records and stay out of git
// (the repository is public); these checks run where that folder exists and skip in CI.
const audit=existsSync('docs/tax-system-audit-20261026'),itAudit=it.skipIf(!audit);
const root='docs/tax-system-audit-20261026';
itAudit('reconciles portfolio saved findings against independently transcribed original county records',()=>{
 const reference=JSON.parse(readFileSync(`${root}/independent-expected.json`,'utf8'));
 const rows=readdirSync(`${root}/properties`).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>JSON.parse(readFileSync(`${root}/properties/${n}`,'utf8')));
 for(const expected of reference.samples){const audit=rows.find(r=>r.subject.address===expected.address);expect(audit,expected.address).toBeDefined();for(const [year,amount] of expected.years){const record=audit.state.records.find((r:any)=>r.year===year&&r.billEvidence?.collectorAccount===expected.collectorAccount);expect(record?.facts.levied.value,`${expected.address} ${year}`).toBe(amount);const retained=audit.manifest.find((m:any)=>m.sourceId===record.facts.levied.sourceId);expect(retained,`Retained original ${expected.address} ${year}`).toBeDefined();expect(readFileSync(retained.file).length).toBeGreaterThan(100);}}
});
