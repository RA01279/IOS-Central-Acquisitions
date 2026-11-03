import {it,expect} from 'vitest';
import {resolveDecisionFlags,type SignalRow} from './site-score';
const rows:SignalRow[]=[{key:'rent',auto_state:'strong',auto_note:'Old comparison',auto_source:'old',auto_at:'2026-10-01',override_state:null,override_note:null,override_by:null,override_at:null}];
it('does not report stale cached rent guidance as current after an evidence review',()=>{
 const flags=resolveDecisionFlags(rows,{deal_analysis_versions:[{kind:'comps',created_at:'2026-10-30'}]});expect(flags.find(f=>f.key==='rent')?.state).toBe('unknown');expect(flags.find(f=>f.key==='rent')?.note).toMatch(/stale/);
});
it('vacancy cannot retain a strong automatic in-place rent comparison while explicit manual overrides remain identifiable',()=>{
 expect(resolveDecisionFlags(rows,{properties:{occupancy_status:'vacant'}}).find(f=>f.key==='rent')?.state).toBe('watch');
 const manual=resolveDecisionFlags([{...rows[0],override_state:'watch',override_note:'Reviewed yard leasing risk',override_by:'analyst'}],{properties:{occupancy_status:'vacant'}}).find(f=>f.key==='rent');expect(manual?.overridden).toBe(true);expect(manual?.note).toBe('Reviewed yard leasing risk');
});
