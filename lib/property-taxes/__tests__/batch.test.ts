import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
const worker=vi.hoisted(()=>vi.fn());
vi.mock('../worker',()=>({runTaxJob:worker}));
import {runTaxBatch} from '../batch';
it('keeps each scheduled batch serial and bounded to three subjects',async()=>{
 let active=0,max=0;worker.mockImplementation(async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return {status:'needs_review'};});
 expect(await runTaxBatch({})).toHaveLength(3);expect(max).toBe(1);
 worker.mockResolvedValue(null);expect(await runTaxBatch({})).toEqual([]);
});
it('provides six staggered daily slots without requiring a higher-frequency hosting plan',()=>{
 const config=JSON.parse(readFileSync('vercel.json','utf8'));
 const crons=config.crons.filter((c:any)=>c.path.startsWith('/api/cron/property-taxes'));
 expect(crons).toHaveLength(6);expect(new Set(crons.map((c:any)=>c.schedule)).size).toBe(6);
 for(const c of crons)expect(c.schedule).toMatch(/^0 \d+ \* \* \*$/);
});
