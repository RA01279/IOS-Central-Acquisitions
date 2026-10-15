// What the comps say to assume in the model: lease-up rent and exit value.
// The Excel model stays the driver; these are figures to type into it, with
// their evidence beside them.

import { SALE_COST_PCT, type Band, type CompUnderwriting, type Totals } from "@/lib/comps/underwriting";

const usd = (v: number | null) => (v === null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const usd2 = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);
const range = (t: Totals | null, f: (v: number | null) => string) =>
  !t || t.mid === null ? "—" : t.low !== null && t.high !== null ? `${f(t.mid)} (${f(t.low)}–${f(t.high)})` : f(t.mid);

function Rate({ label, unit, b, f }: { label: string; unit: string; b: Band; f: (v: number | null) => string }) {
  return (
    <tr>
      <td>{label}</td>
      <td><strong>{b.mid === null ? "—" : `${f(b.mid)}${unit}`}</strong></td>
      <td>{b.low !== null && b.high !== null ? `${f(b.low)}–${f(b.high)}${unit}` : "—"}</td>
      <td className="muted">{b.source}{b.caveats.length ? `. ${b.caveats.join(" ")}` : ""}</td>
    </tr>
  );
}

export default function CompUnderwritingPanel({ uw, ios, modelHoldYears }: { uw: CompUnderwriting; ios: boolean; modelHoldYears: number | null }) {
  const { lease, sale } = uw;
  const modelHold = modelHoldYears ? Math.round(modelHoldYears * 12) : null;
  return (
    <section className="panel">
      <h2>Comp-based assumptions</h2>
      <p className="hint">
        What the comps support, to check or type into the model. The middle figure is the comps&apos; central
        value; the range is their middle half.
      </p>

      <h3>Lease-up</h3>
      <table className="summary-table">
        <thead><tr><th>Rent</th><th>Estimate</th><th>Range</th><th>Basis</th></tr></thead>
        <tbody>
          <Rate label="Per lot acre" unit="/AC/mo" b={lease.perAcreMonthly} f={usd} />
          <Rate label="Per building SF" unit="/SF/yr" b={lease.perSfAnnual} f={usd2} />
        </tbody>
      </table>
      <div className="metrics-grid">
        <Metric label="Whole site, per-acre rate" value={lease.monthlyByAcre ? `${range(lease.monthlyByAcre, usd)}/mo` : "Lot size missing"} />
        <Metric label="Whole building, per-SF rate" value={lease.annualBySf ? `${range(lease.annualBySf, usd)}/yr` : "Building SF missing"} />
        <Metric label="Lease term" value={lease.termMonths === null ? "Not stated" : `${Math.round(lease.termMonths)} mo (${lease.termCount} comps)`} />
        <Metric label="Free rent" value={lease.freeRentMonths === null ? "Not stated" : `${lease.freeRentMonths.toFixed(1)} mo (${lease.freeCount} comps)`} />
      </div>
      {!ios && <p className="hint">Per-acre rents on an industrial deal are shown for reference; industrial trades per building SF.</p>}

      <h3>Exit value</h3>
      <table className="summary-table">
        <thead><tr><th>Today</th><th>Estimate</th><th>Range</th><th>Basis</th></tr></thead>
        <tbody>
          <Rate label="Per lot acre" unit="/AC" b={sale.perAcre} f={usd} />
          <Rate label="Per building SF" unit="/SF" b={sale.perSf} f={usd2} />
        </tbody>
      </table>
      <p className="hint">
        Growth applied: per acre {sale.growthAcre.note}; per SF {sale.growthSf.note}.
      </p>
      <table className="summary-table">
        <thead><tr><th>Hold</th><th>Per acre</th><th>Net proceeds at per-acre rate</th><th>Per SF</th><th>Net proceeds at per-SF rate</th></tr></thead>
        <tbody>
          {sale.exits.map((e) => (
            <tr key={e.months} style={modelHold === e.months ? { fontWeight: 600 } : undefined}>
              <td>{e.months} mo{modelHold === e.months ? " (model's hold)" : ""}</td>
              <td>{range(e.perAcre, usd)}</td>
              <td>{e.byAcre ? range(e.byAcre, usd) : "Lot size missing"}</td>
              <td>{range(e.perSf, usd2)}</td>
              <td>{e.bySf ? range(e.bySf, usd) : "Building SF missing"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Per-acre and per-SF figures are gross sale prices; net proceeds are after {(SALE_COST_PCT * 100).toFixed(0)}% selling
        costs. Sale comps carry no cap rates yet, so this is a price per acre and per SF, not an income value.
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}
