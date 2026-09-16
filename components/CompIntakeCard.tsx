"use client";
import LocationPreview from "./LocationPreview";
import { validCoordinates } from "@/lib/location";
import { RENT_BASES } from "@/lib/comps/intake-validation";

export default function CompIntakeCard({ draft: d, update, issue }: { draft: any; update: (patch: any) => void; issue: string | null }) {
  const text = (label: string, key: string, type = "text") => <label>{label}<input type={type} value={d[key] ?? ""} onChange={e => update({ [key]: e.target.value || null })} /></label>;
  const number = (label: string, key: string) => <label>{label}<input type="number" min="0" step="any" value={d[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>;
  return <section className="panel-inset" style={{ padding: 16, marginTop: 12 }}>
    <label><input type="checkbox" checked={d._include} onChange={e=>update({_include:e.target.checked})} /> Include this {d.compType} comp</label>
    <div className="grid-2">
      {text("Street address", "address")}{text("City", "city")}{text("State (two letters)", "state")}{text("Market", "market")}
      <label>Asset class<select value={d.assetClass ?? ""} onChange={e => update({assetClass:e.target.value})}><option value="">Choose class</option><option value="ios">IOS</option><option value="industrial">Industrial</option></select></label>
      {d.compType === "lease" ? <>
        {number("Rent as quoted", "rent")}
        <label>Rent units<select value={d.rentBasis ?? ""} onChange={e=>update({rentBasis:e.target.value})}><option value="">Choose rent units</option>{RENT_BASES.map(b=><option key={b} value={b}>{b.replace(/_/g," ")}</option>)}</select></label>
        {text("Commencement date", "dateCommenced", "date")}{text("Tenant", "tenantName")}{text("Suite", "suite")}
      </> : <>{number("Total sale price ($)", "salePrice")}{text("Closing date", "closedOn", "date")}</>}
      {number("Building SF", "buildingSf")}{number("Land acres", "acres")}
    </div>
    <LocationPreview key={JSON.stringify([d.address,d.city,d.state,d.market])} address={d.address ?? ""} city={d.city} state={d.state} market={d.market}
      value={validCoordinates(d) ? { latitude:Number(d.latitude), longitude:Number(d.longitude), geocode_precision:d.geocodePrecision || "supplied" } : null}
      onChange={p=>update({latitude:p?.latitude ?? null,longitude:p?.longitude ?? null,geocodePrecision:p?.geocode_precision ?? null})} />
    {d.yardAcres != null && <p className="hint">Usable yard: {d.yardAcres} acres</p>}
    {d.notes && <details><summary>Original broker wording</summary><pre style={{whiteSpace:"pre-wrap"}}>{d.notes}</pre></details>}
    {d._locationMessage && <p className="hint">{d._locationMessage}</p>}
    {issue && <p className="error">{issue}</p>}
    {(d.warnings ?? []).map((w:string,i:number)=><p key={i} className="hint">{w}</p>)}
  </section>;
}
