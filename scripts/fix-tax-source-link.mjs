import {readFileSync,writeFileSync} from 'node:fs';
const p='components/property-taxes/PropertyTaxes.tsx';
writeFileSync(p,readFileSync(p,'utf8').replace('<SourceLink state={state} id={r.facts.levied!.sourceId}/>','<SourceLink source={state.sources.find(s=>s.id===r.facts.levied!.sourceId)} dealId={dealId}/>'));
