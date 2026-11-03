// What the comps say to assume in the model: lease-up rent and exit value.
// The Excel model stays the driver; these are figures to type into it, with
// their evidence beside them. The exit cap they divide by is set under Deal
// inputs on the same tab.

import { SALE_COST_PCT, type Band, type CompUnderwriting, type Totals } from "@/lib/comps/underwriting";

const usd = (v: number | null) => (v === null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const usd2 = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);

/** Central value on top, the comps' middle half underneath, small. */
function Range({ t, f, suffix = "" }: { t: Totals | null; f: (v: number | null) => string; suffix?: string }) {
  if (!t || t.mid === null) return <>—</>;
  return (
    <>
      {f(t.mid)}{suffix}
      {t.low !== null && t.high !== null && <span className="fin-sub-num">{f(t.low)}–{f(t.high)}</span>}
    </>
  );
}

function Rate({ label, unit, b, f }: { label: string; unit: string; b: Band; f: (v: number | null) => string }) {
  return (
    <tr>
      <td>{label}</td>
      <td><strong>{b.mid === null ? "—" : `${f(b.mid)}${unit}`}</strong></td>
      <td>{b.low !== null && b.high !== null ? `${f(b.low)}–${f(b.high)}` : "—"}</td>
      <td className="fin-basis">{b.source}{b.caveats.length ? `. ${b.caveats.join(" ")}` : ""}</td>
    </tr>
  );
}

export default function CompUnderwritingPanel({ uw, ios, modelHoldYears, evidenceNote }: {
  uw: CompUnderwriting; ios: boolean; modelHoldYears: number | null;
  /** Which comps fed the bands (the reviewed set), shown under the heading. */
  evidenceNote?: string;
}) {
  const { lease, sale } = uw;
  const modelHold = modelHoldYears ? Math.round(modelHoldYears * 12) : null;
  // No rent and no sale band at all: say why once instead of tables of dashes.
  if ([lease.perAcreMonthly, lease.perSfAnnual, sale.perAcre, sale.perSf].every((b) => b.mid === null)) {
    return (
      <section className="panel">
        <h2>Comp-based assumptions</h2>
        {evidenceNote && <p className="hint">{evidenceNote}</p>}
        <p className="muted" style={{ margin: 0 }}>Not enough comps near this site to suggest assumptions.</p>
        <p className="hint fin-note">Lease: {lease.perSfAnnual.source}. Sale: {sale.perSf.source}.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Comp-based assumptions</h2>
      {evidenceNote && <p className="hint">{evidenceNote}</p>}
      <p className="hint">
        What the comps support, to check or type into the model. The bold figure is the comps&apos; central
        value; the range is their middle half. Quotes retain their stated lease structures; gross and net rents are not
        normalized for owner expenses here. Review the source terms before using a band as a net-rent assumption.
      </p>

      <h3 className="fin-sub">Lease-up</h3>
      <div className="table-scroll">
        <table className="summary-table fin-table">
          <thead><tr><th>Rent</th><th>Estimate</th><th>Range</th><th className="fin-text">Basis</th></tr></thead>
          <tbody>
            <Rate label="Per lot acre" unit="/AC/mo" b={lease.perAcreMonthly} f={usd} />
            <Rate label="Per building SF" unit="/SF/yr" b={lease.perSfAnnual} f={usd2} />
          </tbody>
        </table>
      </div>
      <div className="fin-stats">
        <Stat label="Whole site, per-acre rate" value={lease.monthlyByAcre ? <Range t={lease.monthlyByAcre} f={usd} suffix="/mo" /> : "Insufficient rent or site area evidence"} />
        <Stat label="Whole building, per-SF rate" value={lease.annualBySf ? <Range t={lease.annualBySf} f={usd} suffix="/yr" /> : "Insufficient direct building-rent or area evidence"} />
        <Stat label="Lease term" value={lease.termMonths === null ? "Not stated" : `${Math.round(lease.termMonths)} mo`} sub={lease.termMonths === null ? undefined : `${lease.termCount} comps`} />
        <Stat label="Escalation" value={`${(lease.escalation * 100).toFixed(2)}%/yr`} sub={lease.escalationCount ? `${lease.escalationCount} comps` : "LOI default; no comps state one"} />
        <Stat label="Free rent" value={lease.freeRentMonths === null ? "Not stated" : `${lease.freeRentMonths.toFixed(1)} mo`} sub={lease.freeRentMonths === null ? undefined : `${lease.freeCount} comps`} />
      </div>
      {!ios && <p className="hint">Per-acre rents on an industrial deal are shown for reference; industrial trades per building SF.</p>}

      <h3 className="fin-sub">Exit value</h3>
      <div className="table-scroll">
        <table className="summary-table fin-table">
          <thead><tr><th>Today</th><th>Estimate</th><th>Range</th><th className="fin-text">Basis</th></tr></thead>
          <tbody>
            <Rate label="Per lot acre" unit="/AC" b={sale.perAcre} f={usd} />
            <Rate label="Per building SF" unit="/SF" b={sale.perSf} f={usd2} />
          </tbody>
        </table>
      </div>
      <p className="hint fin-note">
        Growth applied: per acre {sale.growthAcre.note}; per SF {sale.growthSf.note}.
      </p>
      <div className="table-scroll">
        <table className="summary-table fin-table fin-exits">
          <thead>
            <tr>
              <th rowSpan={2}>Hold</th>
              <th colSpan={2} className="fin-colgroup">Per lot acre</th>
              <th colSpan={2} className="fin-colgroup">Per building SF</th>
              <th className="fin-colgroup">Rent-only screen</th>
            </tr>
            <tr>
              <th>Price/AC</th>
              <th>Net proceeds</th>
              <th>Price/SF</th>
              <th>Net proceeds</th>
              <th>Net at {sale.exitCap === null ? "exit cap" : `${(sale.exitCap * 100).toFixed(2)}% cap`}</th>
            </tr>
          </thead>
          <tbody>
            {sale.exits.map((e) => (
              <tr key={e.months} className={modelHold === e.months ? "fin-base-row" : undefined}>
                <td>{e.months} mo{modelHold === e.months && <span className="fin-tag">model hold</span>}</td>
                <td><Range t={e.perAcre} f={usd} /></td>
                <td>{e.byAcre ? <Range t={e.byAcre} f={usd} /> : <span className="muted">Insufficient sale or lot-area evidence</span>}</td>
                <td><Range t={e.perSf} f={usd2} /></td>
                <td>{e.bySf ? <Range t={e.bySf} f={usd} /> : <span className="muted">Insufficient sale or building-area evidence</span>}</td>
                <td>{e.byIncome ? <Range t={e.byIncome} f={usd} /> : <span className="muted">{sale.exitCap === null ? "Set an exit cap" : "No market rent"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint fin-note">
        Price columns are gross sale prices; net proceeds are after {(SALE_COST_PCT * 100).toFixed(0)}% selling
        costs. The rent-only column is the comps&apos; market rent{ios ? " per acre over the lot" : " per SF over the building"}, escalated to the
        exit and capitalized as a rent-only comparison, divided by the exit cap. This assumes 100% rent collection and full expense recovery;
        vacancy, owner expenses, concessions, capital costs and debt payoff are not deducted. These figures are not verified NOI values or
        equity sale proceeds. Use the underwriting cash flows for investment returns.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
