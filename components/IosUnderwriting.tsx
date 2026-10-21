"use client";

import { useRef, useState } from "react";
import { convertTenantRentPeriod, createUwDraft, restoreUwSnapshot, type UwDealSeed } from "@/lib/ios-uw/draft";
import { buildUwView, fmtUsd, type UwView } from "@/lib/ios-uw/view-model";
import { SCENARIOS, type Tenant, type UwInputs, type ScenarioLevers, type ByScenario } from "@/lib/ios-uw/types";
import { rendon } from "@/lib/ios-uw/fixtures/rendon";
import { annualRent, capexIncl, capexUnits } from "@/lib/ios-uw/engine";
import UwResults from "./UwResults";
import TaxScheduleReview from "./property-taxes/TaxScheduleReview";

const TABS = ["Assumptions", "Rent roll", "Capital plan", "Results"] as const;
type FieldSpec = { key: keyof UwInputs; label: string; unit: string; percent?: boolean; min?: number; max?: number; step?: number };
const ACQUISITION: FieldSpec[] = [
  { key: "PurchPrice", label: "Purchase price", unit: "$ total", min: 1 }, { key: "Acres", label: "Total site area", unit: "acres", min: 0.01 },
  { key: "Hold", label: "Hold period", unit: "years", min: 1, max: 10, step: 1 }, { key: "CloseCost", label: "Acquisition closing costs", unit: "% of price", percent: true, min: 0, max: 100 },
  { key: "SaleCost", label: "Selling costs", unit: "% of sale", percent: true, min: 0, max: 100 }, { key: "TgtUnlev", label: "Target unlevered IRR", unit: "% / year", percent: true },
];
const OPERATING: FieldSpec[] = [
  { key: "TaxRate", label: "Reassessed property tax rate", unit: "% of purchase price", percent: true, min: 0, max: 100 },
  { key: "SellerTax", label: "Seller property tax bill", unit: "$ / year", min: 0 },
  { key: "Insurance", label: "Insurance", unit: "$ / year", min: 0 }, { key: "MgmtPct", label: "Management fee", unit: "% of effective revenue", percent: true, min: 0, max: 100 },
  { key: "ReservePerAcre", label: "Replacement reserves", unit: "$ / acre / year", min: 0 }, { key: "OtherOpex", label: "Other operating expenses", unit: "$ / year", min: 0 },
  { key: "ExpGrowth", label: "Expense growth", unit: "% / year", percent: true },
];
const DEBT: FieldSpec[] = [
  { key: "LoanLTV", label: "Loan to purchase price", unit: "%", percent: true, min: 0, max: 100 }, { key: "LoanRate", label: "Interest rate", unit: "% / year", percent: true, min: 0 },
  { key: "AmortYrs", label: "Amortization", unit: "years after IO", min: 1, step: 1 }, { key: "IOYrs", label: "Interest-only period", unit: "years", min: 0, step: 1 },
  { key: "LoanFee", label: "Loan fee", unit: "% of loan", percent: true, min: 0, max: 100 }, { key: "MinDSCR", label: "Minimum DSCR", unit: "× NOI / debt service", min: 0 },
];
const LEVERS: Array<{ key: keyof ScenarioLevers; label: string; percent: boolean }> = [
  { key: "RentGrowth", label: "Market rent growth / year", percent: true }, { key: "Vacancy", label: "Vacancy & credit loss", percent: true },
  { key: "ExitCap", label: "Exit cap rate", percent: true }, { key: "CapexOverrun", label: "Capital cost overrun", percent: true },
  { key: "LeaseDelay", label: "Pipeline delay · months", percent: false }, { key: "RenewProb", label: "Renewal probability · method 2", percent: true },
];

function NumberField({ label, value, onChange, unit, percent = false, min, max, step = "any" }: { label: string; value: number; onChange: (value: number) => void; unit?: string; percent?: boolean; min?: number; max?: number; step?: number | "any" }) {
  const scale = percent ? 100 : 1;
  const display = (v: number) => Number.isFinite(v) ? String(Number((v * scale).toPrecision(12))) : "";
  const [draft, setDraft] = useState({ value, text: display(value) });
  if (!Object.is(value, draft.value)) setDraft({ value, text: display(value) });
  const invalid = Number.isFinite(value) && ((min !== undefined && value * scale < min) || (max !== undefined && value * scale > max));
  return <label className="uw-field"><span>{label}</span><div className="uw-number"><input type="number" inputMode="decimal" value={draft.text} step={step} min={min} max={max} aria-invalid={invalid || undefined} onChange={e => {
    const text = e.target.value;
    const next = text.trim() === "" ? NaN : Number(text) / scale;
    setDraft({ value: next, text }); onChange(next);
  }} /><small>{unit ?? (percent ? "%" : "")}</small></div></label>;
}

export default function IosUnderwriting({ seed }: { seed: UwDealSeed }) {
  const [inputs, setInputs] = useState(() => createUwDraft(seed));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Assumptions");
  const [sample, setSample] = useState(false);
  const [vacant, setVacant] = useState(false);
  const [capitalReviewed, setCapitalReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{ inputs: UwInputs; view: UwView; calculatedAt: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const priceEdited = inputs.PurchPrice !== seed.price;
  const dirty = run?.inputs !== inputs || !capitalReviewed || (!inputs.rentRoll.length && !vacant);

  function update<K extends keyof UwInputs>(key: K, value: UwInputs[K]) { setInputs(prev => ({ ...prev, [key]: value })); }
  function tenantUpdate(index: number, patch: Partial<Tenant>) { setInputs(prev => ({ ...prev, rentRoll: prev.rentRoll.map((t, i) => i === index ? { ...t, ...patch } : t) })); }
  function calculate() {
    setError(null);
    try {
      if (!inputs.rentRoll.length && !vacant) throw new Error("Add the rent roll or explicitly confirm that the property is vacant.");
      if (!capitalReviewed) throw new Error("Review the capital plan and confirm the planned improvements, including a zero-capex plan.");
      const view = buildUwView(inputs);
      setRun({ inputs, view, calculatedAt: new Date().toISOString() }); setTab("Results");
    } catch (e) { setError(e instanceof Error ? e.message : "Check the model inputs."); }
  }
  function loadSample() {
    setInputs(structuredClone(rendon)); setSample(true); setVacant(false); setCapitalReviewed(true); setRun(null); setError(null); setRevision(r => r + 1); setTab("Assumptions");
  }
  function reset() {
    setInputs(createUwDraft(seed)); setSample(false); setVacant(false); setCapitalReviewed(false); setRun(null); setError(null); setRevision(r => r + 1); setTab("Assumptions");
  }
  function download() {
    if (!run || dirty) return;
    const snapshot = { schema: "hopper-ios-uw-v1", dealId: seed.id, sample, vacant, capitalReviewed, calculatedAt: run.calculatedAt, inputs: run.inputs, results: run.view };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `ios-underwriting-${sample ? "sample" : seed.id}-${inputs.scenario.toLowerCase()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importSnapshot(file: File) {
    setError(null);
    try {
      if (file.size > 2_000_000) throw new Error("Use an underwriting snapshot smaller than 2 MB.");
      const restored = restoreUwSnapshot(await file.text(), seed);
      setInputs(restored.inputs); setRun({ inputs: restored.inputs, view: restored.view, calculatedAt: new Date().toISOString() }); setSample(restored.sample); setVacant(restored.vacant); setCapitalReviewed(true); setRevision(r => r + 1); setTab("Results");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read that snapshot."); }
  }
  const fields = (specs: FieldSpec[]) => specs.map(({ key, ...f }) => <NumberField key={key} {...f} value={inputs[key] as number} onChange={v => update(key, v as never)} />);

  return <div className="ws-body uw-workbench">
    <header className="uw-header"><div><span className="overline">IOS underwriting · working draft</span><h1>{inputs.property}</h1><p>Review the rent roll, costs and debt. Trace every return back to the annual cash flow.</p></div><div className="uw-actions"><button type="button" className="secondary" onClick={() => fileInput.current?.click()}>Open snapshot</button><button type="button" className="secondary" disabled={!run || dirty} onClick={download}>Download snapshot</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importSnapshot(file); e.target.value = ""; }} /></div></header>
    <div className={sample ? "warning" : "uw-draft-note"} role="note">{sample ? <><strong>REFERENCE SAMPLE: {rendon.property}.</strong> These are not this deal’s numbers. <button type="button" className="secondary" onClick={reset}>Return to this deal</button></> : <><strong>Session draft for this deal.</strong> Inputs and results are not saved as an approved underwriting version. Download a snapshot to retain your work. Scenario and financing defaults are template assumptions; confirm or replace them.</>}</div>
    <nav className="uw-tabs" aria-label="Underwriting sections">{TABS.map(name => <button key={name} type="button" aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}{name === "Rent roll" ? ` (${inputs.rentRoll.length})` : ""}</button>)}</nav>
    <div className="uw-runbar"><label>Scenario<select value={inputs.scenario} onChange={e => update("scenario", e.target.value as UwInputs["scenario"])}>{SCENARIOS.map(s => <option key={s}>{s}</option>)}</select></label><div><span className="uw-source">{Number.isFinite(inputs.PurchPrice) ? `${fmtUsd(inputs.PurchPrice)} · ` : ""}{Number.isFinite(inputs.Acres) ? `${inputs.Acres.toLocaleString()} acres` : "Site acreage needed"}</span><span className="hint">{run && dirty ? "Inputs changed. Recalculate to display current results." : run ? "Results match the current inputs." : "Complete the assumptions before calculating."}</span></div><button type="button" onClick={calculate}>Calculate returns</button></div>
    {error && <div className="error" role="alert"><strong>Model not calculated.</strong> {error}</div>}

    <div key={revision}>
      {tab === "Assumptions" && <div className="uw-input-sections">
        {!sample && <TaxScheduleReview dealId={seed.id} inputs={inputs} onApply={setInputs}/>}
        <section className="panel"><div className="uw-section-heading"><h2>Acquisition & return target</h2><span className="uw-source">{sample ? "Reference workbook" : `Price: ${priceEdited ? "manual draft" : seed.priceSource} · area: ${inputs.Acres !== seed.acres ? "manual draft" : "recorded lot SF ÷ 43,560"}`}</span></div><div className="uw-field-grid">{fields(ACQUISITION)}</div></section>
        <section className="panel"><h2>Property operating costs</h2>
          <p className="hint">{inputs.TaxSchedule ? "The applied annual schedule replaces legacy tax inputs and shows gross taxes and reimbursements separately. Other costs remain annual owner expenses. Enter expected tax reimbursements actually collected, outside rent; they receive no additional vacancy haircut or management fee." : "Amounts are annual owner expenses. Without an annual tax schedule, tenant reimbursements are not modeled separately; enter net owner costs consistently with the rent roll. Blank costs block calculation; enter zero only when reviewed."}</p>
          <fieldset disabled={!!inputs.TaxSchedule} className="tax-workspace-fields"><label className="uw-check"><input type="checkbox" checked={inputs.TaxSwitch===1} onChange={e=>update("TaxSwitch",e.target.checked?1:0)}/>Legacy purchase-price × tax-rate sensitivity — verify local assessment rules first</label>
            <div className="uw-field-grid">{fields(OPERATING.filter(f=>["SellerTax","TaxRate"].includes(f.key as string)&&(inputs.TaxSwitch===1?f.key!=="SellerTax":true)))}</div>
            <p className="hint">A purchase does not establish an automatic taxable-value reset. The legacy rate is retained for comparison; annual schedules use their explicit valuations and timing.</p>
          </fieldset><div className="uw-field-grid">{fields(OPERATING.filter(f=>!["SellerTax","TaxRate"].includes(f.key as string)))}</div>
        </section>
        <section className="panel"><h2>Financing</h2><label className="uw-check"><input type="checkbox" checked={inputs.LevOn === 1} onChange={e => update("LevOn", e.target.checked ? 1 : 0)} />Use debt financing</label><p className="hint">The loan is sized on purchase price. Annual debt service sums monthly payments after the interest-only period. Zero interest is supported.</p><fieldset disabled={inputs.LevOn === 0} className="uw-field-grid">{fields(DEBT)}</fieldset></section>
        <section className="panel"><h2>Scenario assumptions</h2><p className="hint">These are editable template defaults, not comp-derived or verified market assumptions. Percentages are entered as 7 for 7%, not 0.07.</p><div className="table-scroll"><table className="summary-table uw-levers"><thead><tr><th scope="col">Assumption</th>{SCENARIOS.map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead><tbody>{LEVERS.map(f => <tr key={f.key}><th scope="row">{f.label}</th>{SCENARIOS.map((s, i) => <td key={s}><NumberField label={`${s} ${f.label}`} value={(inputs.levers[f.key] ?? [0.7, 0.8, 0.5])[i]} percent={f.percent} unit={f.percent ? "%" : "months"} onChange={v => { const values = [...(inputs.levers[f.key] ?? [0.7, 0.8, 0.5])] as [number, number, number]; values[i] = v; update("levers", { ...inputs.levers, [f.key]: values }); }} /></td>)}</tr>)}</tbody></table></div><div className="uw-field-grid">{fields([{ key: "StepCap", label: "Exit cap sensitivity step", unit: "percentage points", percent: true, min: 0 }, { key: "StepG", label: "Rent growth sensitivity step", unit: "percentage points", percent: true, min: 0 }])}</div></section>
      </div>}

      {tab === "Rent roll" && <section className="panel"><div className="uw-section-heading"><div><h2>Tenant rent roll</h2><p className="hint">Months are measured from closing: 0 means at closing, 12 means one year later. Rent is total dollars per selected period. Blank bump uses market growth; blank lease end continues through the hold.</p></div><button type="button" onClick={() => { setVacant(false); update("rentRoll", [...inputs.rentRoll, { name: "", status: "In-place", acres: null, rent: NaN, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1] }]); }}>Add tenant</button></div>
        {!inputs.rentRoll.length && <label className="uw-check"><input type="checkbox" checked={vacant} onChange={e => setVacant(e.target.checked)} />I confirm this property is vacant; model zero rent until tenants are added.</label>}
        <label className="uw-field">Rollover method<select value={inputs.RollMethod ?? 1} onChange={e => update("RollMethod", Number(e.target.value) as 1 | 2)}><option value={1}>Retention percentage of existing rent</option><option value={2}>Probability-weighted renewal and new lease</option></select></label>
        <div className="uw-tenants">{inputs.rentRoll.map((t, index) => <article className="uw-tenant" key={index}><div className="uw-section-heading"><h3>Tenant {index + 1}{t.name ? ` · ${t.name}` : ""}</h3><button className="secondary" type="button" onClick={() => {
          // Resolve workbook links before removing a row, so indices cannot silently relink capex.
          const capex = inputs.capex.map(item => ({ ...item, units: capexUnits(item, inputs.rentRoll), include: SCENARIOS.map(s => capexIncl(item, { ...inputs, scenario: s })) as unknown as ByScenario<number> }));
          setInputs(prev => ({ ...prev, capex, rentRoll: prev.rentRoll.filter((_, i) => i !== index) }));
        }}>Remove tenant</button></div><div className="uw-field-grid"><label className="uw-field">Tenant name<input value={t.name} onChange={e => tenantUpdate(index, { name: e.target.value })} /></label><label className="uw-field">Status<select value={t.status} onChange={e => tenantUpdate(index, { status: e.target.value as Tenant["status"] })}><option>In-place</option><option>Pipeline</option></select></label><NumberField label="Leased acreage · optional" value={t.acres ?? NaN} unit="acres" min={0} onChange={v => tenantUpdate(index, { acres: Number.isNaN(v) ? null : v })} /><NumberField label="Total contract rent" value={t.rent} unit={t.rentPeriod === "Monthly" ? "$ / month total" : "$ / year total"} min={0} onChange={v => tenantUpdate(index, { rent: v })} /><label className="uw-field">Rent period<select value={t.rentPeriod} onChange={e => {
          const period = e.target.value as Tenant["rentPeriod"];
          tenantUpdate(index, convertTenantRentPeriod(t, period));
        }}><option>Monthly</option><option>Annual</option></select></label><NumberField label="Contract annual bump · blank = market" value={t.bump ?? NaN} percent unit="% / year" onChange={v => tenantUpdate(index, { bump: Number.isNaN(v) ? null : v })} /><NumberField label="Lease start" value={t.startMonth} unit="month from closing" min={0} step={1} onChange={v => tenantUpdate(index, { startMonth: v })} /><NumberField label="Lease end · blank = no expiry" value={t.leaseEndMonth ?? NaN} unit="month from closing" min={0} step={1} onChange={v => tenantUpdate(index, { leaseEndMonth: Number.isNaN(v) ? null : v })} /><NumberField label="Rent retention after expiry" value={t.retention ?? 0} percent min={0} max={100} onChange={v => tenantUpdate(index, { retention: v })} /><NumberField label="Initial free rent" value={t.freeRentMonths ?? 0} unit="months" min={0} max={60} step={1} onChange={v => tenantUpdate(index, { freeRentMonths: v })} /><NumberField label="Renewal free rent" value={t.freeRentOnRenewalMonths ?? 0} unit="months" min={0} max={60} step={1} onChange={v => tenantUpdate(index, { freeRentOnRenewalMonths: v })} /></div>
        <p className="uw-source">Annual contract rent: {fmtUsd(annualRent(t))}{t.acres && t.acres > 0 ? ` · ${fmtUsd(annualRent(t) / 12 / t.acres)} / acre / month` : " · Enter leased acreage to show a rate per acre"}. Changing rent period converts the amount and preserves annual rent.</p>
        <div className="uw-field-grid">{SCENARIOS.map((s, i) => <NumberField key={s} label={`${s} inclusion`} value={t.include[i]} percent min={0} max={100} onChange={v => { const include = [...t.include] as [number, number, number]; include[i] = v; tenantUpdate(index, { include }); }} />)}</div>
        {inputs.RollMethod === 2 && <details open><summary>Renewal and new-deal economics</summary><div className="uw-field-grid"><NumberField label="Renewal probability · blank = scenario" value={t.renewalProbOverride ?? NaN} percent min={0} max={100} onChange={v => tenantUpdate(index, { renewalProbOverride: Number.isNaN(v) ? null : v })} />{([ ["renewalRent", "Renewal total rent · blank = current"], ["newDealRent", "New-lease total rent · blank = current"], ["newDealDowntimeMonths", "New-deal downtime"], ["newDealFreeRentMonths", "New-deal free rent"], ["renewalTI", "Renewal tenant improvements"], ["renewalLC", "Renewal leasing commission"], ["newDealTI", "New-lease tenant improvements"], ["newDealLC", "New-lease leasing commission"] ] as const).map(([key, label]) => <NumberField key={key} label={label} value={t[key] ?? (key === "renewalRent" || key === "newDealRent" ? NaN : 0)} unit={key.includes("Months") ? "months" : key.endsWith("Rent") ? `$ / ${t.rentPeriod === "Annual" ? "year" : "month"}` : "$ total at rollover"} min={0} max={key.includes("Months") ? 60 : undefined} onChange={v => tenantUpdate(index, { [key]: Number.isNaN(v) && (key === "renewalRent" || key === "newDealRent") ? null : v })} />)}</div></details>}
        </article>)}</div></section>}

      {tab === "Capital plan" && <section className="panel"><div className="uw-section-heading"><div><h2>Capital improvements</h2><p className="hint">Costs are unit cost × quantity × scenario inclusion, plus that scenario’s overrun. Costs after the hold appear as a warning and are excluded from hold cash flows.</p></div><button type="button" onClick={() => { setCapitalReviewed(false); update("capex", [...inputs.capex, { name: "", unitCost: NaN, units: 1, year: 1, include: [1, 1, 1] }]); }}>Add improvement</button></div>{inputs.capex.map((item, i) => <article className="uw-tenant" key={i}><div className="uw-section-heading"><h3>Improvement {i + 1}</h3><button className="secondary" type="button" onClick={() => { setCapitalReviewed(false); update("capex", inputs.capex.filter((_, index) => index !== i)); }}>Remove improvement</button></div><div className="uw-field-grid"><label className="uw-field">Description<input value={item.name} onChange={e => update("capex", inputs.capex.map((c, index) => index === i ? { ...c, name: e.target.value } : c))} /></label>{([ ["unitCost", "Unit cost", "$ / unit", item.unitCost], ["units", "Quantity", "units", capexUnits(item, inputs.rentRoll)], ["year", "Year incurred", "year from closing", item.year] ] as const).map(([key, label, unit, value]) => <NumberField key={key} label={label} value={value} unit={unit} min={key === "year" ? 1 : 0} step={key === "year" ? 1 : "any"} onChange={v => { setCapitalReviewed(false); update("capex", inputs.capex.map((c, index) => index === i ? { ...c, [key]: v } : c)); }} />)}{SCENARIOS.map((s, j) => <NumberField key={s} label={`${s} inclusion`} value={capexIncl(item, { ...inputs, scenario: s })} percent min={0} max={100} onChange={v => { const include = SCENARIOS.map(s => capexIncl(item, { ...inputs, scenario: s })) as [number, number, number]; include[j] = v; setCapitalReviewed(false); update("capex", inputs.capex.map((c, index) => index === i ? { ...c, include } : c)); }} />)}</div>{typeof item.units !== "number" || "tenantIncl" in item.include ? <p className="hint">This sample item follows a tenant link. Editing quantity or inclusion replaces that link with the entered value.</p> : null}</article>)}<label className="uw-check"><input type="checkbox" checked={capitalReviewed} onChange={e => setCapitalReviewed(e.target.checked)} />I reviewed the capital plan{inputs.capex.length === 0 ? " and confirm no planned capital improvements" : " and the timing of all planned improvements"}.</label></section>}

      {tab === "Results" && (run && !dirty ? <UwResults view={run.view} /> : <section className="panel uw-empty"><span className="overline">Ready when the assumptions are</span><h2>{run ? "Inputs changed" : "Build your underwriting case"}</h2><p>{run ? "Recalculate to display returns from your current inputs." : "Complete the operating assumptions, add the rent roll or confirm vacancy, and review the capital plan. Then calculate returns."}</p><button type="button" onClick={() => setTab("Assumptions")}>Review assumptions</button></section>)}
    </div>
    <footer className="uw-footer"><span className="hint">No automatic comp assumptions. Inputs remain analyst estimates unless independently verified.</span><div className="uw-actions"><button className="secondary" type="button" onClick={reset}>Reset to deal facts</button><button className="secondary" type="button" onClick={loadSample}>Load reference sample</button></div></footer>
  </div>;
}
