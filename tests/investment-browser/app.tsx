import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import InvestmentReview from "../../components/InvestmentReview";
import DecisionContext from "../../components/DecisionContext";
import DealCompsPanel from '../../components/DealCompsPanel';
import CompUnderwritingPanel from '../../components/CompUnderwritingPanel';
import {compUnderwriting} from '../../lib/comps/underwriting';
import {compReview} from '../../lib/comps/reviewed-evidence';
import {comps,subject} from './comps';
import UwScreen from '../../components/UwScreen';
import {compContext,SOURCE_KEYS} from '../../lib/uw/deal-inputs';
import reference from '../../lib/uw/fixtures/kennedale-audit.json';
const screenFixture:any={inputs:{...reference.cases[0].inputs,property:'100 Fixture Yard Rd',RecoveryStartMonth:0},sources:Object.fromEntries(SOURCE_KEYS.map(key=>[key,{source:'manual',note:'Isolated screening fixture'}])),rentRollSource:'model',warnings:['Fictional local screening case; no approved investment conclusion.']};
import "../../app/globals.css";
function App(){const [deal,setDeal]=useState<any>(null);useEffect(()=>{const load=()=>fetch('/fixture/deal').then(r=>r.json()).then(setDeal);load();window.addEventListener('fixture-refresh',load);return()=>window.removeEventListener('fixture-refresh',load);},[]);const review=deal?compReview(deal,comps,subject):null;return <main style={{maxWidth:1000,margin:'20px auto'}}><h1>Isolated investment controls</h1><p>Fictional local fixture. No production connection. Actual review forms, decision report and API handlers.</p>{deal&&review&&<><InvestmentReview key={deal.investment_review?.updatedAt??deal.uw_versions[0].returns_summary.identityResolution?.at??"initial"} deal={deal}/><DecisionContext deal={deal}/><p>{review.label}</p><CompUnderwritingPanel uw={compUnderwriting(review.comps,subject)} ios modelHoldYears={5}/><DealCompsPanel dealId={deal.id} comps={comps} subject={subject} subjectAddress="100 Fixture Yard Rd"/></>}</main>;}
createRoot(document.getElementById('root')!).render(location.search.includes('screen')?<UwScreen dealId="11111111-1111-4111-8111-111111111111" initial={screenFixture} comps={compContext([],'Fort Worth',8.7,'2026-10-29')} model={null} modelPending={false} ios runs={[]}/>:<App/>);
