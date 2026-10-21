import { normalizedAddress, nameKey } from "./address";
import { METRICS, type TaxState, type TaxParcel, type TaxRecord, type Metric, type RateUnit, type TaxScenario, type ProjectionYear, type TaxSchedule } from "./types";

export function rateFraction(value: number, unit: RateUnit): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Tax rates must be nonnegative finite numbers.");
  const divisor = { per_100: 100, mills: 1000, percent: 100, decimal: 1 }[unit];
  if (!divisor) throw new Error("Choose an explicit rate unit.");
  return value / divisor;
}
export const parcelKey = (state: string, county: string, account: string) => [state, county.replace(/\s+county$/i, ""), account].map(nameKey).join(":");
export function matchParcel(subject: { address: string; county?: string; state?: string }, parcel: Pick<TaxParcel, "address" | "county" | "state">, intersects: boolean) {
  const sameAddress = !!normalizedAddress(subject.address) && normalizedAddress(subject.address) === normalizedAddress(parcel.address);
  const wrongCounty = subject.county && nameKey(subject.county.replace(/ county$/i, "")) !== nameKey(parcel.county.replace(/ county$/i, ""));
  const wrongState = subject.state && nameKey(subject.state) !== nameKey(parcel.state);
  return { ambiguous: !sameAddress || !!wrongCounty || !!wrongState, evidence: [sameAddress ? "Normalized situs address matches subject." : "Situs address differs or is missing; verify boundaries and legal description.", intersects ? "Official GIS polygon intersects the subject pin; this does not establish the entire acquisition boundary." : "No verified boundary intersection.", ...(wrongCounty || wrongState ? ["County/state conflicts with the subject."] : [])] };
}
export function includedParcels(state: TaxState): TaxParcel[] {
  const rows = state.parcels.filter(p => p.review === "included");
  const ids = new Set<string>(), groups = new Map<string, Set<string>>();
  for (const p of rows) {
    const id = parcelKey(p.state, p.county, p.accountId);
    if (ids.has(id)) throw new Error(`Duplicate account ${p.accountId}; include it once.`);
    ids.add(id);
    if (!p.reviewNote.trim() || !p.assessmentGroup.trim() || p.component === "unknown") throw new Error(`Review the match and account coverage for ${p.accountId}.`);
    const group = `${nameKey(p.state)}:${nameKey(p.county)}:${nameKey(p.assessmentGroup)}`;
    const parts = groups.get(group) ?? new Set();
    if (parts.has(p.component) || (parts.size && (parts.has("combined") || p.component === "combined"))) throw new Error(`Overlapping land/building coverage in ${p.assessmentGroup}; exclude the overlapping account.`);
    parts.add(p.component); groups.set(group, parts);
  }
  return rows;
}
export function effectiveFact(state: TaxState, record: TaxRecord, metric: Metric) {
  const override = state.overrides.find(o => o.parcelKey === record.parcelKey && o.year === record.year && o.metric === metric);
  return override ? { value: override.value, sourceId: override.sourceId, stage: override.stage ?? "reported" as const, reviewed: true, manual: true } : record.facts[metric];
}
export function annualTotal(state: TaxState, year: number, metric: Metric) {
  const parcels = includedParcels(state), missing: string[] = state.parcels.filter(p=>p.review==="pending").map(p=>p.accountId); let total = 0;
  for (const parcel of parcels) {
    const row = state.records.find(r => r.parcelKey === parcel.key && r.year === year);
    const fact = row && effectiveFact(state, row, metric);
    if (!fact || typeof fact.value !== "number" || fact.stage === "proposed" || !fact.reviewed) missing.push(parcel.accountId);
    else total += fact.value;
  }
  return { total: parcels.length && !missing.length ? total : null, knownSubtotal: total, missing };
}
/** Keep manual overrides and reviewer decisions. Changed research facts lose review. */
export function mergeResearch(current: TaxState, incoming: TaxState): TaxState {
  const next = structuredClone(current);
  const correctedAccounts=new Set<string>();
  for (const source of incoming.sources) if (!next.sources.some(s => s.id === source.id)) next.sources.push(source);
  for (const parcel of incoming.parcels) {
    const index = next.parcels.findIndex(p => p.key === parcel.key);
    if (index < 0) next.parcels.push(parcel);
    else {
      const old = next.parcels[index];
      if(old.identityOverride) {
        if(parcelKey(old.state,old.county,old.accountId)!==parcelKey(parcel.state,parcel.county,parcel.accountId)) correctedAccounts.add(old.key);
        next.parcels[index]={...old,sourceIds:[...new Set([...old.sourceIds,...parcel.sourceIds])],matchEvidence:[...old.matchEvidence,...parcel.matchEvidence.filter(e=>!old.matchEvidence.includes(e))]};
        continue;
      }
      const changed = ["address", "county", "state", "owner", "legal"].some(k => old[k as keyof TaxParcel] !== parcel[k as keyof TaxParcel]);
      next.parcels[index] = { ...parcel, review: changed ? "pending" : old.review, reviewNote: old.reviewNote, component: old.component, assessmentGroup: old.assessmentGroup, sourceIds: [...new Set([...old.sourceIds, ...parcel.sourceIds])] };
    }
  }
  for (const row of incoming.records) {
    if(correctedAccounts.has(row.parcelKey)) continue;
    const old = next.records.find(r => r.parcelKey === row.parcelKey && r.year === row.year);
    if (!old) { next.records.push(row); continue; }
    for (const metric of METRICS) {
      const fact = row.facts[metric], prior = old.facts[metric];
      if (fact) old.facts[metric] = { ...fact, reviewed: prior?.value === fact.value && prior?.stage === fact.stage ? prior.reviewed : false, ...(prior && prior.value !== fact.value ? { previous: prior.value } : prior?.previous!==undefined ? {previous:prior.previous} : {}) };
    }
    if(row.jurisdictions.length) {
      const manual=old.jurisdictions.filter(j=>current.sources.some(s=>s.id===j.sourceId && s.kind!=="official"));
      old.jurisdictions=[...row.jurisdictions,...manual.filter(j=>!row.jurisdictions.some(n=>n.name===j.name&&n.sourceId===j.sourceId))];
    }
  }
  for (const rule of incoming.rules) {
    const old=next.rules.find(r=>r.jurisdiction===rule.jurisdiction && r.notes===rule.notes);
    if(old) old.sourceIds=[...new Set([...old.sourceIds,...rule.sourceIds])];
    else next.rules.push({...rule,reviewed:false});
  }
  if(incoming.records.some(r=>r.facts && Object.values(r.facts).some(Boolean)) || incoming.parcels.length) next.scenarios=next.scenarios.map(s=>({...s,rulesReviewed:false}));
  next.research = incoming.research ? {...incoming.research,gaps:[...incoming.research.gaps,...[...correctedAccounts].map(key=>`Manual account correction retained for ${key}. New figures from the old account were not imported; verify the corrected account's dated records.`)]} : next.research;
  return next;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function projectRow(row: ProjectionYear, previousAssessed: number | null) {
  for (const [key, value] of Object.entries(row)) if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Invalid projection ${key}.`);
  if (row.market < 0 || row.ratio < 0 || row.ratio > 1 || row.exemption < 0 || row.special < 0 || row.reimbursement < 0 || row.growth <= -1 || (row.cap != null && row.cap < 0)) throw new Error("Check valuation, ratio, exemption, cap, growth and special assessments.");
  const uncapped = row.market * row.ratio;
  const capApplies = !row.reassess && previousAssessed !== null && row.cap !== null && row.capThrough !== null && row.year <= row.capThrough;
  const assessed = capApplies ? Math.min(uncapped, previousAssessed! * (1 + row.cap!)) : uncapped;
  const taxable = Math.max(0, assessed - row.exemption);
  const calculated = round(taxable * rateFraction(row.rate, row.unit) + row.special);
  const gross = row.grossOverride ?? calculated;
  if (gross < 0 || row.reimbursement > gross) throw new Error("Gross tax cannot be negative; reimbursements cannot exceed gross tax.");
  return { assessed, taxable, gross, reimbursement: row.reimbursement, net: round(gross - row.reimbursement), formula: row.grossOverride !== null ? "User annual tax override; not an official bill" : `max(0, ${round(assessed)} assessed − ${row.exemption} exemptions) × ${rateFraction(row.rate, row.unit)} + ${row.special} special assessments`, capApplies };
}
export function projectScenario(state: TaxState, scenario: TaxScenario) {
  if (!state.rules.length || state.rules.some(r=>!r.reviewed || !r.sourceIds.length)) throw new Error("Retain and review the applicable jurisdiction rules in Sources & history before calculating.");
  if (!scenario.rulesReviewed || !scenario.notes.trim()) throw new Error("Review the local assessment rules and document scenario assumptions first.");
  if (!Number.isInteger(scenario.hold) || scenario.hold < 1 || scenario.hold > 10) throw new Error("Choose a hold of 1–10 years.");
  const parcels = includedParcels(state);
  if (!parcels.length || state.parcels.some(p => p.review === "pending")) throw new Error("Review all parcel candidates before projecting; include or exclude each one.");
  for(const parcel of parcels) {
    const county=nameKey(parcel.county.replace(/ county$/i,"")),stateCode=nameKey(parcel.state);
    if(!state.rules.some(rule=>nameKey(rule.jurisdiction).includes(county) && nameKey(rule.jurisdiction).split(" ").includes(stateCode))) throw new Error(`Retain reviewed rules naming ${parcel.county}, ${parcel.state} before calculating this parcel.`);
  }
  const rows = Array.from({ length: scenario.hold + 1 }, (_, i) => ({ year: scenario.startYear + i, gross: 0, reimbursement: 0, net: 0, details: [] as { account: string; formula: string; assessed: number; taxable: number }[] }));
  for (const parcel of parcels) {
    const plan = scenario.parcels.find(p => p.parcelKey === parcel.key);
    if (!plan || plan.rows.length !== rows.length) throw new Error(`Complete the hold plus forward exit year for ${parcel.accountId}.`);
    let previous: number | null = null;
    const prior = state.records.find(r => r.parcelKey === parcel.key && r.year === scenario.startYear - 1);
    const priorFact = prior && effectiveFact(state, prior, "assessed");
    if (priorFact?.reviewed && typeof priorFact.value === "number") previous = priorFact.value;
    for (let i = 0; i < rows.length; i++) {
      const input = plan.rows[i];
      if (input.year !== rows[i].year) throw new Error("Projection years must align with the schedule start year.");
      if (input.cap !== null && input.capThrough !== null && input.year <= input.capThrough && previous === null && !input.reassess) throw new Error("A cap needs the prior reviewed assessed value.");
      const out = projectRow(input, previous); previous = out.assessed;
      rows[i].gross = round(rows[i].gross + out.gross); rows[i].reimbursement = round(rows[i].reimbursement + out.reimbursement); rows[i].net = round(rows[i].net + out.net);
      rows[i].details.push({ account: parcel.accountId, formula: out.formula, assessed: out.assessed, taxable: out.taxable });
    }
  }
  return rows;
}
export function makeScenario(state: TaxState, id: TaxScenario["id"], startYear: number, hold: number): TaxScenario {
  return { id, name: { continuation: "Continue current assessment", acquisition: "Acquisition sensitivity", custom: "User-defined case" }[id], startYear, hold, notes: "", rulesReviewed: false,
    parcels: includedParcels(state).map(parcel => {
      const latest = state.records.filter(r => r.parcelKey === parcel.key && r.year <= startYear).sort((a,b) => b.year-a.year)[0];
      const market = latest && effectiveFact(state, latest, "market"), assessed = latest && effectiveFact(state, latest, "assessed");
      const amount = market?.reviewed && typeof market.value === "number" ? market.value : assessed?.reviewed && typeof assessed.value === "number" ? assessed.value : 0;
      return { parcelKey: parcel.key, rows: Array.from({ length: hold + 1 }, (_, i) => ({ year: startYear+i, market: amount, ratio: 1, exemption: 0, growth: 0, cap: null, capThrough: null, rate: 0, unit: "per_100" as const, special: 0, reimbursement: 0, grossOverride: null, reassess: false })) };
    }) };
}
export function toTaxSchedule(state: TaxState, scenario: TaxScenario, at: string): TaxSchedule {
  const rows = projectScenario(state, scenario);
  return { scenario: scenario.name, startYear: scenario.startYear, gross: rows.map(r => r.gross), reimbursements: rows.map(r => r.reimbursement), provenance: `${scenario.notes}\nRules: ${state.rules.map(r => r.jurisdiction + ': ' + r.notes).join('; ')}\nSources: ${state.sources.map(s => s.url || s.label).join('; ')}`, appliedAt: at };
}
