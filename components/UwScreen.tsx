"use client";
// components/UwScreen.tsx
//
// The deal's Underwriting tab: Hopper's screening engine run on this deal's
// inputs -- from the Excel model where there is one, else the deal and its
// comps -- every input editable and labelled with where it came from, checked
// against the comp range, compared side by side with the Excel model, and
// saveable as a run. The Excel model stays the approved underwriting.

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/ui";
import { runUnderwriting } from "@/lib/uw/engine";
import { buildUwView, fmtPct, fmtRatio, fmtUsd, type UwCashFlowRow, type UwSensitivityGrid } from "@/lib/uw/view-model";
import {
  checkAgainstComps, compareWithModel, engineInputs, exitRolloverWarnings,
  type CompContext, type CompRange, type DealUwBuild, type DealUwInputs, type InputSource, type SourceKey, type Sourced,
} from "@/lib/uw/deal-inputs";
import type { UwModelSnapshot } from "@/lib/uw/model-snapshot";
import type { ByScenario, CapexItem, ScenarioName, Tenant } from "@/lib/uw/types";
import type { SavedRunRow } from "@/lib/uw-screen";

const SOURCE_STYLE: Record<InputSource, { label: string; bg: string; fg: string }> = {
  model: { label: "Excel model", bg: "var(--blue-50)", fg: "var(--brand-strong)" },
  comps: { label: "Comps", bg: "var(--strong-bg)", fg: "var(--strong)" },
  deal: { label: "Deal", bg: "var(--n100)", fg: "var(--n700)" },
  default: { label: "Default", bg: "var(--watch-bg)", fg: "var(--warn-text)" },
  manual: { label: "Manual", bg: "var(--n700)", fg: "#fff" },
};
const SCENARIOS: ScenarioName[] = ["Base", "Upside", "Downside"];
const CENTER_CELL: React.CSSProperties = { fontWeight: 600, background: "var(--warn-bg)", color: "var(--warn-text)" };
const SMALL: React.CSSProperties = { width: 92 };
const TINY: React.CSSProperties = { width: 62 };

function Chip({ s }: { s?: Sourced }) {
  if (!s) return null;
  const st = SOURCE_STYLE[s.source];
  return (
    <span title={s.note} style={{ background: st.bg, color: st.fg, fontSize: 11, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", cursor: "help" }}>
      {st.label}
    </span>
  );
}

type Kind = "pct" | "usd" | "num" | "int";
const toText = (v: number | null | undefined, kind: Kind) =>
  v === null || v === undefined || !Number.isFinite(v) ? "" : kind === "pct" ? String(Math.round(v * 1e6) / 1e4) : kind === "usd" ? Math.round(v).toLocaleString("en-US") : String(v);
function fromText(s: string, kind: Kind): number | null {
  const t = s.replace(/[$,%\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return kind === "pct" ? n / 100 : kind === "int" ? Math.round(n) : n;
}

/** A number box that commits on blur or Enter, so half-typed values never reach the engine. */
function Num({ value, kind, onCommit, allowBlank, style, label }: { value: number | null | undefined; kind: Kind; onCommit: (v: number | null) => void; allowBlank?: boolean; style?: React.CSSProperties; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = fromText(draft, kind);
    setDraft(null);
    if (v === null && !allowBlank) return;
    if (v !== value) onCommit(v);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={draft ?? toText(value, kind)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...(style ?? SMALL), textAlign: "right" }}
    />
  );
}

function cell(v: number | null, format: UwCashFlowRow["format"]) {
  if (v === null) return "";
  if (format === "ratio") return fmtRatio(v);
  if (format === "pct") return fmtPct(v, 1);
  return fmtUsd(v);
}

function SensitivityTable({ grid }: { grid: UwSensitivityGrid }) {
  return (
    <div className="card" style={{ gap: 8 }}>
      <span className="overline">{grid.title}</span>
      <div className="table-scroll">
        <table className="summary-table">
          <thead>
            <tr>
              <th scope="col">Growth ↓ · Exit cap →</th>
              {grid.exitCapLabels.map((c) => <th key={c} scope="col">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.cells.map((row, i) => (
              <tr key={grid.growthLabels[i]}>
                <th scope="row">{grid.growthLabels[i]}</th>
                {row.map((c, j) => <td key={j} style={c.center ? CENTER_CELL : undefined}>{c.display}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const rangeText = (r: CompRange | null, unit: string) =>
  !r ? "—" : `${fmtUsd(r.p25)}–${fmtUsd(r.p75)}${unit} (median ${fmtUsd(r.median)}, n ${r.n}${r.basis === "band" ? `, ${r.band} ac band` : ", whole market"})${r.reference ? ` · ${r.reference}` : ""}`;

function fmtCompare(v: number | null, f: "usd" | "pct" | "ratio" | "years") {
  if (v === null) return "—";
  return f === "usd" ? fmtUsd(v) : f === "pct" ? fmtPct(v) : f === "ratio" ? fmtRatio(v) : `${v} yrs`;
}
function fmtDelta(h: number | null, m: number | null, f: "usd" | "pct" | "ratio" | "years") {
  if (h === null || m === null) return "";
  const d = h - m;
  if (Math.abs(d) < 1e-9) return "same";
  const sign = d > 0 ? "+" : "−";
  if (f === "pct") return `${sign}${Math.round(Math.abs(d) * 10000)} bp`;
  if (f === "usd") return `${sign}${fmtUsd(Math.abs(d))}`;
  if (f === "ratio") return `${sign}${Math.abs(d).toFixed(2)}x`;
  return `${sign}${Math.abs(d)}`;
}

export default function UwScreen(props: {
  dealId: string;
  initial: DealUwBuild;
  comps: CompContext;
  model: { versionNumber: number; snapshot: UwModelSnapshot } | null;
  modelPending: boolean;
  ios: boolean;
  runs: SavedRunRow[];
}) {
  const { initial, comps, model } = props;
  const [inputs, setInputs] = useState<DealUwInputs>(initial.inputs);
  const [sources, setSources] = useState<Record<SourceKey, Sourced>>(initial.sources);
  const [runs, setRuns] = useState<SavedRunRow[]>(props.runs);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showMore, setShowMore] = useState(false);

  /** Edit one or more fields and mark the input as manual. */
  const edit = (key: SourceKey, patch: Partial<DealUwInputs>) => {
    setInputs((cur) => ({ ...cur, ...patch }));
    setSources((cur) => (cur[key]?.source === "manual" ? cur : { ...cur, [key]: { source: "manual", note: `Edited here (was ${SOURCE_STYLE[cur[key]?.source ?? "default"].label.toLowerCase()}: ${cur[key]?.note ?? ""})` } }));
  };
  const editLever = (key: keyof DealUwInputs["levers"] & SourceKey, i: number, v: number) => {
    const next = [...(inputs.levers[key] ?? [0, 0, 0])] as number[];
    next[i] = v;
    edit(key, { levers: { ...inputs.levers, [key]: next as unknown as ByScenario<number> } });
  };
  const editTenant = (i: number, patch: Partial<Tenant>) => edit("rentRoll", { rentRoll: inputs.rentRoll.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const editCapex = (i: number, patch: Partial<CapexItem>) => edit("capex", { capex: inputs.capex.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const computed = useMemo(() => {
    try {
      const run = engineInputs(inputs);
      return { view: buildUwView(run), result: runUnderwriting(run), error: null as string | null };
    } catch (e: any) {
      return { view: null, result: null, error: String(e.message ?? e) };
    }
  }, [inputs]);
  const checks = useMemo(() => checkAgainstComps(inputs, comps), [inputs, comps]);
  const tenantChecks = (i: number) => checks.filter((c) => c.key === `tenant:${i}`);
  const fieldCheck = (k: SourceKey) => checks.find((c) => c.key === k);
  const rollover = useMemo(() => exitRolloverWarnings(inputs), [inputs]);
  const compare = computed.result && model ? compareWithModel(computed.result, inputs, model.snapshot) : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/deals/${props.dealId}/uw-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs, sources, label }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't save the run");
      setRuns((r) => [j.run, ...r]);
      setLabel("");
      setMsg({ ok: true, text: "Run saved, with the comp set as it stands today." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function remove(runId: string) {
    if (!confirm("Delete this saved run?")) return;
    const res = await fetch(`/api/deals/${props.dealId}/uw-runs`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
    if (res.ok) setRuns((r) => r.filter((x) => x.id !== runId));
  }
  function load(run: SavedRunRow & { sources?: Record<SourceKey, Sourced> }) {
    setInputs(run.inputs as DealUwInputs);
    if (run.sources) setSources((cur) => ({ ...cur, ...run.sources }));
    setMsg({ ok: true, text: `Loaded "${run.label ?? new Date(run.created_at).toLocaleDateString()}". Its numbers are re-run on today's engine.` });
  }
  function reset() {
    setInputs(initial.inputs);
    setSources(initial.sources);
    setMsg(null);
  }

  const L = inputs.levers;
  const field = (k: SourceKey, labelText: string, value: number | null, kind: Kind, patch: (v: number) => Partial<DealUwInputs>) => (
    <label key={k} className="stack" style={{ gap: 2 }}>
      <span className="label" style={{ display: "flex", gap: 6, alignItems: "center" }}>{labelText} <Chip s={sources[k]} /></span>
      <Num label={labelText} value={value} kind={kind} onCommit={(v) => v !== null && edit(k, patch(v))} />
      {fieldCheck(k) && <span className="hint" style={{ color: "var(--warn-text)" }}>{fieldCheck(k)!.message}</span>}
    </label>
  );

  return (
    <div className="ws-body">
      <div className="warning" role="note" style={{ marginTop: 0 }}>
        <strong>Screening underwriting.</strong>{" "}
        {model
          ? `Started from Excel model v${model.versionNumber} (${model.snapshot.fileName}). The Excel model remains the approved underwriting for IC.`
          : props.modelPending
            ? "There is an Excel model on this deal, but it was uploaded before Hopper kept its rent roll -- these inputs come from the deal and comps until it is re-uploaded or backfilled."
            : "No Excel model yet: inputs come from the deal and its comps. The Excel model, once uploaded, is the approved underwriting."}
        {!props.ios && " This engine is built for IOS (rent and price per acre); read industrial results with care."}
      </div>

      {computed.error ? (
        <div className="error">The engine can&apos;t run these inputs: {computed.error}</div>
      ) : (
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {computed.view!.kpis.map((k) => <KpiCard key={k.key} label={k.label} value={k.display} sub={k.sub} />)}
        </div>
      )}

      {(initial.warnings.length > 0 || rollover.length > 0 || (computed.view?.warnings.length ?? 0) > 0) && (
        <div className="warning">
          <ul style={{ margin: 0 }}>
            {[...initial.warnings, ...rollover, ...(computed.view?.warnings ?? [])].map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      {compare && (
        <section className="panel">
          <h2>Hopper vs the Excel model</h2>
          <p className="hint">Same deal, two engines. Differences point at assumptions worth a second look; the Excel model is the one that goes to IC.</p>
          <div className="table-scroll">
            <table className="summary-table">
              <thead><tr><th scope="col"></th><th scope="col">Hopper ({inputs.scenario})</th><th scope="col">Excel model v{model!.versionNumber}</th><th scope="col">Difference</th></tr></thead>
              <tbody>
                {compare.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{fmtCompare(r.hopper, r.format)}</td>
                    <td>{fmtCompare(r.model, r.format)}</td>
                    <td>{fmtDelta(r.hopper, r.model, r.format)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Assumptions</h2>
        <p className="hint">Hover a tag to see where a value came from. Anything you change is tagged Manual and checked against the comps.</p>
        <div className="stage-actions" style={{ gap: 6, marginBottom: 10 }}>
          <span className="label">Scenario</span>
          {SCENARIOS.map((s) => (
            <button key={s} type="button" className={inputs.scenario === s ? undefined : "secondary"} onClick={() => setInputs((c) => ({ ...c, scenario: s }))}>{s}</button>
          ))}
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {field("PurchPrice", "Purchase price ($)", inputs.PurchPrice, "usd", (v) => ({ PurchPrice: v }))}
          {field("Acres", "Acres", inputs.Acres, "num", (v) => ({ Acres: v }))}
          {field("Hold", "Hold (years)", inputs.Hold, "int", (v) => ({ Hold: Math.min(10, Math.max(1, v)) }))}
          {field("CloseCost", "Closing costs (% of price)", inputs.CloseCost, "pct", (v) => ({ CloseCost: v }))}
          {field("SaleCost", "Sale costs (%)", inputs.SaleCost, "pct", (v) => ({ SaleCost: v }))}
          {field("TgtUnlev", "Target unlevered IRR (%)", inputs.TgtUnlev, "pct", (v) => ({ TgtUnlev: v }))}
        </div>

        <h3 style={{ marginTop: 18 }}>Scenario levers</h3>
        <div className="table-scroll">
          <table className="summary-table">
            <thead><tr><th scope="col"></th>{SCENARIOS.map((s) => <th key={s} scope="col">{s}</th>)}<th scope="col">Source</th></tr></thead>
            <tbody>
              {([
                ["ExitCap", "Exit cap (%)", "pct"],
                ["RentGrowth", "Market rent growth (%)", "pct"],
                ["Vacancy", "General vacancy (%)", "pct"],
                ["RenewProb", "Renewal probability (%)", "pct"],
                ["CapexOverrun", "Capex overrun (%)", "pct"],
                ["LeaseDelay", "Lease-up delay (months)", "int"],
              ] as const).map(([k, text, kind]) => (
                <tr key={k}>
                  <th scope="row">{text}</th>
                  {SCENARIOS.map((s, i) => (
                    <td key={s}><Num label={`${text} ${s}`} value={(L[k] ?? [0, 0, 0])[i]} kind={kind} style={TINY} onCommit={(v) => v !== null && editLever(k, i, v)} /></td>
                  ))}
                  <td><Chip s={sources[k]} /> {fieldCheck(k) && <span className="hint" style={{ color: "var(--warn-text)" }}>{fieldCheck(k)!.message}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Exit cap stays a manual input until the market has at least 5 sale comps with a cap rate.</p>

        <h3 style={{ marginTop: 18 }}>Operating expenses & debt</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" checked={inputs.NnnRecovered} onChange={(e) => edit("NnnRecovered", { NnnRecovered: e.target.checked })} />
          Net leases: tenants reimburse taxes, insurance and other opex <Chip s={sources.NnnRecovered} />
        </label>
        <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, opacity: 1 }}>
          {!inputs.NnnRecovered && (
            <>
              <label className="stack" style={{ gap: 2 }}>
                <span className="label" style={{ display: "flex", gap: 6 }}>Property tax <Chip s={sources.TaxSwitch} /></span>
                <select value={inputs.TaxSwitch} onChange={(e) => edit("TaxSwitch", { TaxSwitch: Number(e.target.value) as 0 | 1 })}>
                  <option value={1}>Reassessed at price</option>
                  <option value={0}>Seller&apos;s current tax</option>
                </select>
              </label>
              {inputs.TaxSwitch === 1
                ? field("TaxRate", "Tax rate (% of price)", inputs.TaxRate, "pct", (v) => ({ TaxRate: v }))
                : field("SellerTax", "Seller's tax ($/yr)", inputs.SellerTax, "usd", (v) => ({ SellerTax: v }))}
              {field("Insurance", "Insurance ($/yr)", inputs.Insurance, "usd", (v) => ({ Insurance: v }))}
              {field("OtherOpex", "Other opex ($/yr)", inputs.OtherOpex, "usd", (v) => ({ OtherOpex: v }))}
            </>
          )}
          {field("MgmtPct", "Management (% of revenue)", inputs.MgmtPct, "pct", (v) => ({ MgmtPct: v }))}
          {field("ReservePerAcre", "Reserves ($/ac/yr)", inputs.ReservePerAcre, "usd", (v) => ({ ReservePerAcre: v }))}
          {field("LoanLTV", "Loan to price (%)", inputs.LoanLTV, "pct", (v) => ({ LoanLTV: v }))}
          {field("LoanRate", "Loan rate (%)", inputs.LoanRate, "pct", (v) => ({ LoanRate: v }))}
          {field("IOYrs", "Interest-only (years)", inputs.IOYrs, "int", (v) => ({ IOYrs: Math.max(0, v) }))}
          {field("AmortYrs", "Amortization (years)", inputs.AmortYrs, "int", (v) => ({ AmortYrs: Math.max(1, v) }))}
          {showMore && (
            <>
              {field("ExpGrowth", "Expense growth (%)", inputs.ExpGrowth, "pct", (v) => ({ ExpGrowth: v }))}
              {field("LoanFee", "Loan fee (%)", inputs.LoanFee, "pct", (v) => ({ LoanFee: v }))}
              {field("TgtLev", "Target levered IRR (%)", inputs.TgtLev, "pct", (v) => ({ TgtLev: v }))}
              {field("MinDSCR", "DSCR floor (x)", inputs.MinDSCR, "num", (v) => ({ MinDSCR: v }))}
            </>
          )}
        </div>
        <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setShowMore((s) => !s)}>{showMore ? "Fewer" : "More"} inputs</button>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="checkbox" checked={inputs.LevOn === 1} onChange={(e) => edit("LevOn", { LevOn: e.target.checked ? 1 : 0 })} /> Levered
        </label>
      </section>

      <section className="panel">
        <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}>Rent roll <Chip s={sources.rentRoll} /></h2>
        <p className="hint">{sources.rentRoll?.note}. Months count from closing; a blank lease end means no expiry. Market rent is what a renewal or a new tenant pays; downtime and free months apply to a new tenant.</p>
        <div className="table-scroll">
          <table className="summary-table">
            <thead>
              <tr>
                <th scope="col">Tenant</th><th scope="col">Status</th><th scope="col">Acres</th><th scope="col">Rent $/mo</th><th scope="col">Bump %</th>
                <th scope="col">Start mo</th><th scope="col">Lease end mo</th><th scope="col">Renewal %</th><th scope="col">Market $/mo</th>
                <th scope="col">Downtime mo</th><th scope="col">Free mo</th><th scope="col">TI new $</th><th scope="col">LC new $</th>
                <th scope="col">In B/U/D %</th><th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {inputs.rentRoll.map((t, i) => {
                const monthly = (v: number | null | undefined) => (v === null || v === undefined ? null : t.rentPeriod === "Annual" ? v / 12 : v);
                const toPeriod = (m: number | null) => (m === null ? null : t.rentPeriod === "Annual" ? m * 12 : m);
                return (
                  <tr key={i}>
                    <td><input aria-label="Tenant" value={t.name} onChange={(e) => editTenant(i, { name: e.target.value })} style={{ width: 170 }} /></td>
                    <td>
                      <select aria-label="Status" value={t.status} onChange={(e) => editTenant(i, { status: e.target.value as Tenant["status"] })}>
                        <option>In-place</option><option>Pipeline</option>
                      </select>
                    </td>
                    <td><Num label="Acres" value={t.acres} kind="num" style={TINY} allowBlank onCommit={(v) => editTenant(i, { acres: v })} /></td>
                    <td><Num label="Rent per month" value={monthly(t.rent)} kind="usd" onCommit={(v) => v !== null && editTenant(i, { rent: toPeriod(v)! })} /></td>
                    <td><Num label="Bump" value={t.bump} kind="pct" style={TINY} allowBlank onCommit={(v) => editTenant(i, { bump: v })} /></td>
                    <td><Num label="Start month" value={t.startMonth} kind="int" style={TINY} onCommit={(v) => v !== null && editTenant(i, { startMonth: Math.max(0, v) })} /></td>
                    <td><Num label="Lease end month" value={t.leaseEndMonth} kind="int" style={TINY} allowBlank onCommit={(v) => editTenant(i, { leaseEndMonth: v === null ? null : Math.max(1, v) })} /></td>
                    <td><Num label="Renewal probability" value={t.renewalProbOverride} kind="pct" style={TINY} allowBlank onCommit={(v) => editTenant(i, { renewalProbOverride: v === null ? null : Math.min(1, Math.max(0, v)) })} /></td>
                    <td><Num label="Market rent per month" value={monthly(t.newDealRent)} kind="usd" allowBlank onCommit={(v) => editTenant(i, { newDealRent: toPeriod(v), renewalRent: toPeriod(v) })} /></td>
                    <td><Num label="Downtime months" value={t.newDealDowntimeMonths ?? 0} kind="int" style={TINY} onCommit={(v) => v !== null && editTenant(i, { newDealDowntimeMonths: Math.min(60, Math.max(0, v)) })} /></td>
                    <td><Num label="Free months" value={t.newDealFreeRentMonths ?? 0} kind="int" style={TINY} onCommit={(v) => v !== null && editTenant(i, { newDealFreeRentMonths: Math.min(60, Math.max(0, v)) })} /></td>
                    <td><Num label="TI new" value={t.newDealTI ?? 0} kind="usd" onCommit={(v) => v !== null && editTenant(i, { newDealTI: v })} /></td>
                    <td><Num label="LC new" value={t.newDealLC ?? 0} kind="usd" onCommit={(v) => v !== null && editTenant(i, { newDealLC: v })} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {[0, 1, 2].map((s) => (
                        <Num key={s} label={`Include ${SCENARIOS[s]}`} value={t.include[s]} kind="pct" style={{ width: 44 }}
                          onCommit={(v) => { if (v === null) return; const inc = [...t.include] as number[]; inc[s] = Math.min(1, Math.max(0, v)); editTenant(i, { include: inc as unknown as ByScenario<number> }); }} />
                      ))}
                    </td>
                    <td><button type="button" className="secondary" aria-label={`Remove ${t.name}`} onClick={() => edit("rentRoll", { rentRoll: inputs.rentRoll.filter((_, j) => j !== i) })}>✕</button></td>
                  </tr>
                );
              })}
              {inputs.rentRoll.flatMap((_, i) => tenantChecks(i)).map((c) => (
                <tr key={c.message}><td colSpan={15} className="hint" style={{ color: "var(--warn-text)" }}>{c.message}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="secondary"
          style={{ marginTop: 8 }}
          onClick={() =>
            edit("rentRoll", {
              rentRoll: [...inputs.rentRoll, {
                name: `Tenant ${inputs.rentRoll.length + 1}`, status: "Pipeline", acres: null, rent: 0, rentPeriod: "Monthly", bump: null, startMonth: 6,
                leaseEndMonth: null, retention: null, renewalProbOverride: null, renewalRent: null, newDealRent: null, newDealDowntimeMonths: 0, newDealFreeRentMonths: 0, include: [1, 1, 1],
              }],
            })
          }
        >
          + Add tenant
        </button>
      </section>

      <section className="panel">
        <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}>Capex <Chip s={sources.capex} /></h2>
        {inputs.capex.length === 0 ? <p className="muted">No capex items.</p> : (
          <table className="summary-table">
            <thead><tr><th scope="col">Item</th><th scope="col">Cost $</th><th scope="col">Year</th><th scope="col"></th></tr></thead>
            <tbody>
              {inputs.capex.map((c, i) => (
                <tr key={i}>
                  <td><input aria-label="Capex item" value={c.name} onChange={(e) => editCapex(i, { name: e.target.value })} style={{ width: 240 }} /></td>
                  <td><Num label="Capex cost" value={c.unitCost * (typeof c.units === "number" ? c.units : 1)} kind="usd" onCommit={(v) => v !== null && editCapex(i, { unitCost: v, units: 1 })} /></td>
                  <td><Num label="Capex year" value={c.year} kind="int" style={TINY} onCommit={(v) => v !== null && editCapex(i, { year: Math.min(10, Math.max(1, v)) })} /></td>
                  <td><button type="button" className="secondary" aria-label={`Remove ${c.name}`} onClick={() => edit("capex", { capex: inputs.capex.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => edit("capex", { capex: [...inputs.capex, { name: "New item", unitCost: 0, units: 1, year: 1, include: [1, 1, 1] }] })}>+ Add capex</button>
      </section>

      <section className="panel">
        <h2>Comps behind the inputs</h2>
        <p className="hint">{comps.market ?? "No market"} · confirmed comps from the last {comps.months} months · the middle half (25th–75th percentile) is the range values are checked against.</p>
        <div className="metrics-grid">
          <div><span className="label">Lease rent</span><div>{rangeText(comps.rent, "/ac/mo")}</div></div>
          <div><span className="label">Sale price</span><div>{rangeText(comps.sale, "/ac")}</div></div>
          <div><span className="label">Escalations</span><div>{comps.escalation ? `${fmtPct(comps.escalation.p25, 1)}–${fmtPct(comps.escalation.p75, 1)} (median ${fmtPct(comps.escalation.median, 1)}, n ${comps.escalation.n})` : "too few stated"}</div></div>
          <div><span className="label">Evidence tiers</span><div>Lease {comps.tiers.lease.confirmed} confirmed / {comps.tiers.lease.screened} screened · Sale {comps.tiers.sale.confirmed} / {comps.tiers.sale.screened}</div></div>
        </div>
        {comps.messages.length > 0 && <ul className="hint" style={{ paddingLeft: 18 }}>{comps.messages.map((m) => <li key={m}>{m}</li>)}</ul>}
      </section>

      {computed.view && (
        <>
          <section className="panel">
            <h2>Annual cash flow</h2>
            <p className="hint">{computed.view.scenario} scenario · {computed.view.hold}-year hold · Year 0 is closing.</p>
            <div className="table-scroll">
              <table className="summary-table">
                <thead><tr><th scope="col">$</th>{computed.view.years.map((y) => <th key={y} scope="col">Yr {y}</th>)}</tr></thead>
                <tbody>
                  {computed.view.cashFlow.map((row) => (
                    <tr key={row.label} className={row.emphasis ? "summary-total" : undefined}>
                      <th scope="row">{row.label}</th>
                      {row.values.map((v, i) => <td key={i}>{cell(v, row.format)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Sensitivities</h2>
            <p className="hint">Exit cap across, market rent growth down (applies only to tenants with no stated bump). The highlighted cell is the headline case.</p>
            <div className="stack" style={{ gap: 14 }}>
              <SensitivityTable grid={computed.view.sensitivities[0]} />
              <SensitivityTable grid={computed.view.sensitivities[1]} />
            </div>
          </section>
        </>
      )}

      <section className="panel">
        <h2>Saved runs</h2>
        <div className="inline-add-form" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Run label" placeholder="Label (optional), e.g. 'at LOI price'" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} style={{ minWidth: 240 }} />
          <button type="button" disabled={busy || !!computed.error} onClick={save}>{busy ? "Saving…" : "Save run"}</button>
          <button type="button" className="secondary" onClick={reset}>Reset to defaults</button>
        </div>
        {msg && <p className={msg.ok ? "hint" : "error"}>{msg.text}</p>}
        {runs.length === 0 ? <p className="muted">No saved runs yet. A run freezes these inputs, their sources and the comp set.</p> : (
          <div className="table-scroll">
            <table className="summary-table">
              <thead><tr><th scope="col">Run</th><th scope="col">Scenario</th><th scope="col">Unlevered</th><th scope="col">Levered</th><th scope="col">Solved price</th><th scope="col">By</th><th scope="col"></th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label ?? "—"} <span className="muted">{new Date(r.created_at).toLocaleString()}</span></td>
                    <td>{r.scenario}</td>
                    <td>{fmtPct(r.results?.returns?.unleveredIrr ?? null)}</td>
                    <td>{fmtPct(r.results?.returns?.leveredIrr ?? null)}</td>
                    <td>{fmtUsd(r.results?.returns?.solvedPrice ?? null)}</td>
                    <td>{r.created_by}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="secondary" onClick={() => load(r as any)}>Load</button>{" "}
                      <button type="button" className="secondary" onClick={() => remove(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {computed.view && (
        <section className="panel">
          <h2>Model notes</h2>
          <ul className="hint" style={{ paddingLeft: 18 }}>
            <li>The exit is priced on the NOI of the year after the sale, as the source workbook does; a lease rolling near the sale lowers it.</li>
            <li>Renewal and new-deal rents grow from Year 1 at the tenant&apos;s bump (or market growth), like current rent.</li>
            {computed.view.modelNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
