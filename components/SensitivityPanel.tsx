// components/SensitivityPanel.tsx
//
// Sensitivities on the Financials tab. Two kinds:
//  - the model's own tables (deal-level and LP returns by purchase price x
//    exit cap), stored when the workbook was uploaded and shown exactly as the
//    model last calculated them, base case highlighted;
//  - a comp-based screen: exit value by market rent (comp low / mid / high)
//    x exit cap, for deals with no model yet or to sanity-check one.

import type { Grid } from "@/lib/ic-deck/model";
import type { CompUnderwriting } from "@/lib/comps/underwriting";
import { SALE_COST_PCT } from "@/lib/comps/underwriting";

const usdM = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

function ModelGrid({ grid, basePrice, baseCap }: { grid: Grid; basePrice: number | null; baseCap: number | null }) {
  const baseCol = baseCap == null ? -1 : grid.cols.findIndex((c) => Math.abs(c - baseCap) < 1e-6);
  const baseRow = basePrice == null ? -1 : grid.rows.findIndex((r) => Math.abs(r.key - basePrice) < 1);
  return (
    <div style={{ overflowX: "auto" }}>
      <p className="label" style={{ margin: "8px 0 4px" }}>{grid.title}</p>
      <table className="summary-table">
        <thead>
          <tr>
            <th>{grid.rowLabel} \ {grid.colLabel}</th>
            {grid.cols.map((c, i) => <th key={i} style={i === baseCol ? { background: "var(--accent-soft, #E8F0FA)" } : undefined}>{pct(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r, ri) => (
            <tr key={ri}>
              <th scope="row" style={ri === baseRow ? { background: "var(--accent-soft, #E8F0FA)" } : undefined}>{usdM(r.key)}</th>
              {r.cells.map((cell, ci) => (
                <td key={ci} style={ri === baseRow && ci === baseCol ? { fontWeight: 700, outline: "2px solid #0E5AA7" } : ri === baseRow || ci === baseCol ? { background: "var(--accent-soft, #F3F7FC)" } : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SensitivityPanel({
  model,
  basePrice,
  modelExitCap,
  uw,
  ios,
  exitCap,
  holdYears,
  cost,
  baseIrr,
  baseMultiple,
}: {
  /** The model's own base-case returns, shown above the tables. */
  baseIrr?: number | null;
  baseMultiple?: number | null;
  model: { sensitivities?: { deal: Grid | null; lp: Grid | null }; warnings?: string[] } | null;
  basePrice: number | null;
  modelExitCap: number | null;
  uw: CompUnderwriting;
  ios: boolean;
  /** The exit cap to centre the comp grid on, as a fraction. */
  exitCap: number | null;
  holdYears: number | null;
  /** All-in cost (or price) to compare exit values against. */
  cost: number | null;
}) {
  const grids = [model?.sensitivities?.deal, model?.sensitivities?.lp].filter(Boolean) as Grid[];
  // A table is only usable if it covers the deal: the purchase price inside
  // its price rows and the exit cap among its columns. A template whose price
  // rows are typed numbers keeps answering for another deal's price.
  const covers = (g: Grid) => {
    const keys = g.rows.map((r) => r.key);
    const priceOk = basePrice == null || (basePrice >= Math.min(...keys) - 1 && basePrice <= Math.max(...keys) + 1);
    const capOk = modelExitCap == null || g.cols.some((c) => Math.abs(c - modelExitCap) < 1e-6);
    return priceOk && capOk;
  };
  const stale = grids.filter((g) => !covers(g));
  const keysOf = (g: Grid) => g.rows.map((r) => r.key);

  // Comp screen: annual rent at comp low / mid / high, grown at the comp
  // escalation to the exit, capped, net of selling costs.
  const rent = ios
    ? uw.lease.monthlyByAcre && { low: uw.lease.monthlyByAcre.low, mid: uw.lease.monthlyByAcre.mid, high: uw.lease.monthlyByAcre.high }
    : uw.lease.annualBySf;
  const annual = (v: number | null | undefined) => (v == null ? null : ios ? v * 12 : v);
  const hold = holdYears && holdYears > 0 ? holdYears : 4;
  const centre = exitCap && exitCap > 0 ? exitCap : 0.065;
  const caps = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => Math.round((centre + d) * 10000) / 10000).filter((c) => c > 0.02);
  const rows = rent
    ? ([["Comp low", rent.low], ["Comp mid", rent.mid], ["Comp high", rent.high]] as const)
        .map(([label, v]) => ({ label, rent: annual(v) }))
        .filter((r) => r.rent != null)
    : [];
  const value = (r: number, cap: number) => (r * Math.pow(1 + uw.lease.escalation, hold) * (1 - SALE_COST_PCT)) / cap;

  return (
    <section className="panel">
      <h2>Sensitivities</h2>
      {(baseIrr != null || baseMultiple != null) && (
        <p style={{ marginTop: 0 }}>
          Model base case: <strong>{baseIrr != null ? pct(baseIrr, 1) : "—"} IRR / {baseMultiple != null ? `${baseMultiple.toFixed(2)}x` : "—"}</strong>
          {basePrice != null ? ` at ${usdM(basePrice)}` : ""}{modelExitCap != null ? `, ${pct(modelExitCap)} exit cap` : ""}
        </p>
      )}
      {grids.length ? (
        <>
          {stale.length > 0 && (
            <div className="warning">
              <p style={{ margin: 0 }}>
                <strong>The model&apos;s sensitivity table{stale.length > 1 ? "s don't" : " doesn't"} cover this deal.</strong>{" "}
                {basePrice != null && stale.some((g) => { const k = keysOf(g); return basePrice < Math.min(...k) || basePrice > Math.max(...k); })
                  ? <>Its price rows run {usdM(Math.min(...keysOf(stale[0])))}–{usdM(Math.max(...keysOf(stale[0])))}, but the purchase price is {usdM(basePrice)}. </>
                  : <>Its exit-cap columns don&apos;t include {modelExitCap != null ? pct(modelExitCap) : "the base exit cap"}. </>}
                The rows are most likely typed-in numbers left from the template or another deal. In the workbook, make the
                data table&apos;s price rows formulas off the purchase price, recalculate (F9), save and upload again.
              </p>
            </div>
          )}
          {grids.filter(covers).map((g, i) => <ModelGrid key={i} grid={g} basePrice={basePrice} baseCap={modelExitCap} />)}
          {stale.length > 0 && (
            <details>
              <summary className="hint">Show the out-of-range table{stale.length > 1 ? "s" : ""} anyway</summary>
              {stale.map((g, i) => <ModelGrid key={i} grid={g} basePrice={basePrice} baseCap={modelExitCap} />)}
            </details>
          )}
          <p className="hint">From the latest model upload, exactly as the workbook last calculated them. The base case (price and exit cap) is outlined.</p>
          {model?.warnings?.length && stale.length < grids.length ? <div className="warning"><ul>{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div> : null}
        </>
      ) : (
        <p className="hint">No model sensitivity tables yet. They appear here after the next model upload (standard acquisition model).</p>
      )}

      <p className="label" style={{ margin: "16px 0 4px" }}>Comp screen: exit value by market rent × exit cap</p>
      {rows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="summary-table">
            <thead>
              <tr>
                <th>Rent today ({ios ? "per year, at comp $/AC/mo" : "per year, at comp $/SF"})</th>
                {caps.map((c) => <th key={c} style={Math.abs(c - centre) < 1e-6 ? { background: "var(--accent-soft, #E8F0FA)" } : undefined}>{pct(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label} · {usdM(r.rent)}</th>
                  {caps.map((c) => {
                    const v = value(r.rent!, c);
                    const vs = cost ? v / cost - 1 : null;
                    return (
                      <td key={c} style={r.label === "Comp mid" && Math.abs(c - centre) < 1e-6 ? { fontWeight: 700, outline: "2px solid #0E5AA7" } : undefined}>
                        {usdM(v)}
                        {vs != null && <span className={vs < 0 ? "overdue" : "muted"}> {vs >= 0 ? "+" : ""}{(vs * 100).toFixed(0)}%</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Rent grown {pct(uw.lease.escalation, 1)}/yr for {hold} years{holdYears ? " (model hold)" : " (4 years; no model hold)"}, divided by the exit cap,
            less {Math.round(SALE_COST_PCT * 100)}% selling costs. Centred on {exitCap ? "the deal's exit cap" : "6.50% (set an exit cap above)"}.
            {cost ? " The % is against the all-in cost." : ""} A screen, not the model.
          </p>
        </div>
      ) : (
        <p className="hint">Not enough lease comps near this site for a rent band.</p>
      )}
    </section>
  );
}
