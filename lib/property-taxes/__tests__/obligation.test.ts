import {it,expect} from 'vitest';
import {taxFixture} from './fixtures';
import {annualTotal,effectiveFact} from '../model';
import {combinedDisplay} from '../presentation';
it('reviewed Harris collector charges remain a partial subtotal, including legacy saved metadata',()=>{
 const state=taxFixture();state.parcels[0].county='Harris';
 state.records[0].billEvidence={kind:'collector_history',sourceId:state.sources[0].id,collectorAccount:'1',scope:'Collector scope',notes:'School billed separately'};
 expect(annualTotal(state,2026,'levied')).toMatchObject({total:null,knownSubtotal:2000});
 expect(combinedDisplay(state,2026,'levied')).toContain('partial subtotal');
 expect(combinedDisplay(state,2026,'levied')).toContain('separately billed');
});
it('a temporary bill survives as evidence without becoming a final annual total or erasing a correction',()=>{
 const state=taxFixture();state.records[0].facts.appeal={value:'Temporary bill under appeal',stage:'issued',sourceId:state.sources[0].id,reviewed:true};
 state.overrides=[{parcelKey:state.parcels[0].key,year:2026,metric:'levied',value:2100,sourceId:state.sources[0].id,reason:'Supported manual correction'}];
 expect(effectiveFact(state,state.records[0],'levied')?.value).toBe(2100);
 expect(annualTotal(state,2026,'levied')).toMatchObject({total:null,knownSubtotal:2100});
 expect(combinedDisplay(state,2026,'levied')).toContain('supplemental bill not verified');
});
it('unverified annual scope cannot silently become complete merely by reviewing its figures',()=>{
 const state=taxFixture();state.records[0].billEvidence={kind:'collector_history',sourceId:state.sources[0].id,collectorAccount:'1',scope:'Unverified authority coverage',notes:'Published history',obligationStatus:'unverified'};
 expect(annualTotal(state,2026,'levied').total).toBeNull();
 expect(combinedDisplay(state,2026,'levied')).toContain('scope not reconciled');
});
