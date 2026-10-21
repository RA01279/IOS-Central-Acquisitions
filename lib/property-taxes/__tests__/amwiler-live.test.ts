import {it,expect} from 'vitest';
import {researchTaxes} from '../research';
import {emptyTaxState} from '../types';
it.runIf(process.env.VERIFY_AMWILER==='1')('retrieves official Amwiler evidence without writing to Hopper',async()=>{
 const report=await researchTaxes({address:'3000 Amwiler Rd',city:'Peachtree Corners',state:'GA',county:'Gwinnett',latitude:33.928951,longitude:-84.260391,precision:'manual'},emptyTaxState(),()=>{});
 expect(report.parcels.map(p=>p.accountId),report.research?.gaps.join('\n')).toEqual(['R6250 010']);
 expect(report.records[0]?.facts.levied?.value,report.research?.gaps.join('\n')).toBe(7259.41);
},90000);
