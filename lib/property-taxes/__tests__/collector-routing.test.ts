import {expect,it,vi} from 'vitest';
import {parcel} from './fixtures';
const act=vi.hoisted(()=>vi.fn(async()=>({sources:[],records:[],gaps:[]})));
vi.mock('../act',()=>({researchActHistory:act}));
import {researchAccount} from '../collector-research';
it('routes Dallas and Bexar candidates through the shared collector, including alphanumeric Dallas IDs',async()=>{
 for(const [county,accountId] of [['DALLAS','26095600010010000'],['Dallas County','380930000102R0000'],['Bexar','542790']]){
  const p={...parcel,county,accountId};const r=await researchAccount(p);
  expect(act).toHaveBeenLastCalledWith(p,expect.any(Function),undefined);
  expect(r.attempt.status).toBe('retrieved');expect(r.attempt.message).not.toContain('not connected');
 }
});
