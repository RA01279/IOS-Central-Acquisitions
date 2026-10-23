import {it,expect} from 'vitest';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import TaxBillHistory from '../../../components/property-taxes/TaxBillHistory';import {taxFixture} from './fixtures';import {emptyTaxState} from '../types';
it('displays historical billed amounts even before review, with actual years and sources',()=>{
 const state=taxFixture();state.parcels[0].review='pending';state.records[0].year=2025;state.records[0].facts.levied!.value=27462.14;state.records[0].billEvidence={kind:'collector_history',sourceId:state.sources[0].id,scope:'Collector only; school may bill separately.',notes:'Official historical total'};
 const html=renderToStaticMarkup(createElement(TaxBillHistory,{state,dealId:'synthetic'}));expect(html).toContain('Historical tax bills');expect(html).toContain('$27,462.14');expect(html).toContain('2025');expect(html).toContain('2021');expect(html).toContain('Collector-reported bill history');expect(html).toContain('parcel match needs review');expect(html).toContain('school may bill separately');
});
it('does not display proposals, assessed values, excluded neighbors or missing years as original bills',()=>{
 const state=taxFixture();state.records[0].facts.levied!.stage='proposed';const html=renderToStaticMarkup(createElement(TaxBillHistory,{state,dealId:'synthetic'}));expect(html).not.toContain('$2,000.00');expect(html).toContain('Not retrieved');
 state.records[0].facts.levied!.stage='issued';state.parcels[0].review='excluded';expect(renderToStaticMarkup(createElement(TaxBillHistory,{state,dealId:'synthetic'}))).not.toContain('$2,000.00');
 expect(renderToStaticMarkup(createElement(TaxBillHistory,{state:emptyTaxState(),dealId:'synthetic'}))).toContain('Parcel not identified');
});
