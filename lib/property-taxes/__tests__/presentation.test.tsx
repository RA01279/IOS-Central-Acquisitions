import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {taxFixture,reviewFixture} from './fixtures';
import {emptyTaxState} from '../types';
import {taxAvailability,subjectRecords,taxMoney,combinedDisplay} from '../presentation';
import TaxOverview from '../../../components/property-taxes/TaxOverview';
it('keeps absent evidence unavailable while preserving explicitly reviewed zero amounts',()=>{
 expect(combinedDisplay(emptyTaxState(),2026,'levied')).toBe('No subject accounts included');
 const s=taxFixture();delete s.scopeReview;delete s.records[0].facts.levied;expect(combinedDisplay(s,2026,'levied')).toContain('Unavailable');expect(combinedDisplay(s,2026,'levied')).not.toContain('$0.00');
 s.records[0].facts.levied={value:0,sourceId:s.sources[0].id,stage:'issued',reviewed:true};expect(combinedDisplay(s,2026,'levied')).toContain('$0.00 partial subtotal');
});
it('distinguishes not-run, source gap, valuation-only and bill evidence',()=>{
 const s=emptyTaxState();expect(taxAvailability(s).kind).toBe('not-run');s.research={at:'2026-10-22',status:'partial',gaps:['No county connector']};expect(taxAvailability(s).kind).toBe('gap');
 const x=taxFixture();delete x.records[0].facts.levied;expect(taxAvailability(x).kind).toBe('assessment');x.records[0].facts.levied={value:7259.41,stage:'issued',sourceId:x.sources[0].id,reviewed:false};expect(taxAvailability(x).kind).toBe('bill');
});
it('shows exact source amounts before review while blocking combined totals',()=>{
 const s=taxFixture();s.parcels[0].review='pending';s.records[0].facts.levied!.value=7259.41;s.records[0].facts.levied!.reviewed=false;
 expect(combinedDisplay(s,2026,'levied')).toBe('Parcel review required');
 const html=renderToStaticMarkup(createElement(TaxOverview,{state:s,dealId:'synthetic'}));
 expect(html).toContain('$7,259.41');expect(html).toContain('figure needs review');expect(html).toContain('Synthetic county record');expect(html).toContain('account evidence');
});
it('shows Texas market-only findings and excludes neighboring records',()=>{
 const s=taxFixture();delete s.records[0].facts.assessed;delete s.records[0].facts.levied;
 expect(renderToStaticMarkup(createElement(TaxOverview,{state:s,dealId:'synthetic'}))).toContain('$100,000.00');
 s.parcels[0].review='excluded';expect(subjectRecords(s)).toHaveLength(0);expect(taxAvailability(s).kind).toBe('not-run');
});
it('uses retained manual corrections and reports missing years and figure review honestly',()=>{
 const s=taxFixture();s.overrides.push({parcelKey:s.parcels[0].key,year:2026,metric:'levied',value:900.25,sourceId:s.sources[0].id,reason:'Synthetic corrected bill'});
 reviewFixture(s);expect(combinedDisplay(s,2026,'levied')).toBe('$900.25');expect(combinedDisplay(s,2025,'levied')).toContain('Missing or unreviewed');
 expect(taxMoney(0)).toBe('$0.00');expect(taxMoney(null)).toBe('Unavailable');
});
