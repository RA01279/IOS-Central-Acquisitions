import { describe,it,expect } from 'vitest';
import { blankHandoff,capexSchedule,handoffFilename,handoffHtml,missingInputs,seedHandoff,validateHandoff } from './uw-handoff';
describe('IOS handoff instructions',()=>{
  it('supports existing handoffs without current recovery and separates it from future leasing recovery',()=>{
    const h=blankHandoff();delete h.overview.recovery;expect(validateHandoff(h)).toBeNull();expect(missingInputs(h)).toContain('Deal: Recovery structure');
    h.overview.recovery='Modified gross; landlord pays insurance';h.market.recovery='NNN on renewal';expect(validateHandoff(h)).toBeNull();const html=handoffHtml(h,'2026-10-28');expect(html).toContain('Modified gross; landlord pays insurance');expect(html).toContain('NNN on renewal');
  });
  it('prefills only selected deal facts and preserves missing inputs and confirmed zeros',()=>{
    const h=seedHandoff({contract_price:3475000,closing_on:'2026-12-15',properties:{address:'303 RR',city:'Tomball',market:'Houston',lot_sf:93218,building_sf:28800},uw_versions:[{purchasePrice:9000000}]});
    expect(h.overview.price).toBe('3475000');expect(h.overview.buildingSf).toBe('28800');expect(Number(h.overview.grossAcres)).toBeCloseTo(2.14,3);expect(h.overview.yardAcres).toBe('');expect(h.market.marketRent).toBe('');expect(h.capex).toEqual([]);
    h.newLease.ti='0';expect(missingInputs(h)).not.toContain('New lease: TI amount');expect(missingInputs(h)).toContain('Renewal: TI amount');expect(validateHandoff(h)).toBeNull();
  });
  it('preserves explicit monthly/annual rent units and building/yard coverage in the output',()=>{
    const h=blankHandoff();Object.assign(h.overview,{currentRent:'20736',currentUnits:'$/property/month',currentCoverage:'Building and yard'});Object.assign(h.market,{marketRent:'0.95',marketUnits:'$/building SF/month',marketCoverage:'Building and yard',growth:'2.5',escalations:'3.5% each lease anniversary'});
    const html=handoffHtml(h,'2026-10-27T12:00:00Z');expect(html).toContain('20,736');expect(html).toContain('$/property/month');expect(html).toContain('$/building SF/month');expect(html).toContain('Building and yard');expect(html).toContain('3.5% each lease anniversary');expect(html).toContain('Not provided');expect(html).not.toContain('19902');
  });
  it('keeps capex projects independent from TI and LC and resolves inclusive spread spending',()=>{
    const h=blankHandoff();h.capexPlan='Projects';h.capex=[{description:'Gate',amount:'12000',timing:'At closing'},{description:'Drainage',amount:'90000',timing:'Specific month',month:'2027-02-01'},{description:'Surfacing',amount:'60000',timing:'Spread across period',start:'2027-03-01',end:'2027-05-01',dependency:'Before occupancy',completion:'2027-05-31'}];h.newLease.ti='75000';h.newLease.lc='7';
    expect(capexSchedule(h.capex[0])).toContain('month 0');expect(capexSchedule(h.capex[1])).toBe('In Feb 2027');expect(capexSchedule(h.capex[2])).toContain('3 months, approximately $20,000/month; total $60,000');expect(validateHandoff(h)).toBeNull();
    const html=handoffHtml(h,'2026-10-27T12:00:00Z');expect(html).toContain('Before occupancy');expect(html).toContain('75,000');expect(html).toContain('Count each cost');
  });
  it('distinguishes unspecified capital plan from explicit no capex',()=>{
    const h=blankHandoff();expect(missingInputs(h)).toContain('Capex plan');h.capexPlan='None';expect(missingInputs(h)).not.toContain('Capex plan');expect(handoffHtml(h,'2026-10-27')).toContain('Confirmed: no capex planned ($0)');
  });
  it('rejects reversed schedules, negative costs, impossible dates, and invalid URLs',()=>{
    const h=blankHandoff();h.capexPlan='Projects';h.capex=[{timing:'Spread across period',start:'2027-05-01',end:'2027-03-01'}];expect(validateHandoff(h)).toMatch(/end month/);h.capex=[];h.overview.price='-1';expect(validateHandoff(h)).toMatch(/non-negative/);h.overview.price='';h.overview.closing='2027-02-31';expect(validateHandoff(h)).toMatch(/closing/);h.overview.closing='';h.overview.folder='javascript:alert(1)';expect(validateHandoff(h)).toMatch(/http/);
  });
  it('escapes all user text in standalone shareable output',()=>{
    const h=blankHandoff();h.overview.property='<script>alert(1)</script>';h.notes='<img src=x onerror=alert(1)>';const html=handoffHtml(h,'2026-10-27');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;script&gt;');
  });
  it('retains distinct new and renewal payment instructions',()=>{
    const h=blankHandoff();Object.assign(h.newLease,{term:'60',freeRent:'2',ti:'75000',tiTiming:'50% at signing, 50% at occupancy',lc:'7',lcTiming:'At commencement'});Object.assign(h.renewal,{term:'36',freeRent:'0',ti:'0',tiTiming:'No payment',lc:'3',lcTiming:'At renewal signing'});const html=handoffHtml(h,'2026-10-27');for(const text of ['50% at signing, 50% at occupancy','At commencement','At renewal signing','No payment'])expect(html).toContain(text);
  });
});

describe('Handoff PDF filename',()=>{it('uses the deal name and requested suffix while removing unsafe filename characters',()=>{expect(handoffFilename('Golden Spike Lane')).toBe('Golden Spike Lane_UW handoff.pdf');expect(handoffFilename('A/B: Yard')).toBe('AB Yard_UW handoff.pdf');expect(handoffFilename('')).toBe('Deal_UW handoff.pdf');});});
