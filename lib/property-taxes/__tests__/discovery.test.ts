import {it,expect} from 'vitest';
import {discoverTaxSources,adapterFor} from '../discovery';
it('does not guess a URL or classify an unseen jurisdiction as a completed search',async()=>{
 const result=await discoverTaxSources('ZZ','Unseen County',async()=>{throw Error('No request expected');});expect(result.discovery.status).toBe('onboarding_required');expect(result.discovery.officialLinks).toEqual([]);expect(result.discovery.nextSteps[0]).toContain('seed required');expect(adapterFor('TX','Dallas County')).toBe('act-dallas');
});
it('keeps official-directory failure open and separate from account matching',async()=>{const r=await discoverTaxSources('TX','Bell',async()=>new Response('Unavailable',{status:503}));expect(r.discovery.status).toBe('directory_unavailable');expect(r.discovery.nextSteps[0]).toContain('503');});
it.runIf(process.env.LIVE_DISCOVERY==='1')('onboards Bell outside the development sample using actual official directory links',async()=>{const r=await discoverTaxSources('TX','Bell');console.log(JSON.stringify(r.discovery));expect(r.discovery.status).toBe('onboarding_required');expect(r.sources).toHaveLength(2);expect(r.discovery.officialLinks.some(l=>/bellcad\.org|bellcountytx/i.test(l.url))).toBe(true);},30000);
