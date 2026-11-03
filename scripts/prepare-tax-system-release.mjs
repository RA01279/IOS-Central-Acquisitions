import {copyFileSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const from=resolve('C:/Users/randerson/hopper-tax-acceptance-release'),to=resolve('C:/Users/randerson/hopper-tax-system-release');
if(to!==resolve('C:/Users/randerson/hopper-tax-system-release'))throw Error('Release target mismatch');
const shared=['lib/property-taxes','components/property-taxes','app/api/deals/[id]/property-taxes/route.ts','vercel.json'];
const upstream=execFileSync('git',['diff','--name-only','efdab5f','4de8892','--',...shared],{cwd:from,encoding:'utf8'}).trim();if(upstream)throw Error('Tax baseline changed upstream: '+upstream);
const sha=b=>createHash('sha256').update(b).digest('hex');for(const p of ['package.json','package-lock.json'])if(sha(readFileSync(join(from,p)))!==sha(readFileSync(join(to,p))))throw Error('Dependency versions differ; do not share node_modules.');
function copy(p){mkdirSync(dirname(join(to,p)),{recursive:true});copyFileSync(join(from,p),join(to,p));}
function tree(p){for(const n of readdirSync(join(from,p),{withFileTypes:true})){if(n.isDirectory())tree(join(p,n.name));else copy(join(p,n.name));}}
for(const p of ['lib/property-taxes','components/property-taxes','app/property-taxes','app/api/property-taxes','app/api/cron/property-taxes','docs/tax-system-audit-20261026'])tree(p);
for(const p of ['app/api/deals/[id]/property-taxes/route.ts','vercel.json','supabase/migrations/20261026150538_property_tax_ingestion.sql','supabase/migrations/20261027130712_property_tax_worker_recovery.sql','docs/property-tax-history.md','.vercel/project.json','.env.local'])copy(p);
for(const n of readdirSync(join(from,'scripts')).filter(n=>/^(?:inspect-(?:dallas-statements|bexar-history|montgomery-history|official-portals)|read-dallas-original|write-tax-system-coverage|tax-audit-server|prepare-tax-system-release)\.mjs$/.test(n)))copy('scripts/'+n);
writeFileSync(join(to,'.vercelignore'),readFileSync(join(to,'.vercelignore'),'utf8')+'\ndocs/tax-system-*\nsupabase/.temp\n');
console.log('Overlaid tax-only source, migrations, tests and retained public evidence onto the current production baseline. Private local configuration was copied without printing it.');
