import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { readAllCompPages } from "@/lib/comps/mapData";
import { marketView, monthsBefore, type MarketClass, type MarketComp, type MarketRow } from "@/lib/comps/market";
import type { CompType } from "@/lib/comps/match";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

type Params = { type?: string; class?: string; market?: string; basis?: string };

const MARKET_COLUMNS =
  "id, comp_type, status, address, market, submarket, asset_class, building_sf, lot_sf, yard_acres, rent, rent_basis, sale_price, date_commenced, closed_on, lease_term_months, free_rent_months, ti_psf, created_at";

function fmtRate(v: number | null, unit: string): string {
  if (v === null) return "—";
  // Per-acre and per-SF-of-land figures are in the thousands; per-SF ones in dollars and cents.
  return unit.includes("AC") ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
}

function fmtChange(v: number | null) {
  if (v === null) return <span className="muted">—</span>;
  const pct = Math.round(v * 1000) / 10;
  return <span className={pct < 0 ? "overdue" : undefined}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
}

/** Half-year medians as a small line. Gaps (too few comps) break the line rather than being bridged. */
function Trend({ values }: { values: (number | null)[] }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="muted">—</span>;
  const w = 96, h = 24, pad = 3;
  const lo = Math.min(...known), hi = Math.max(...known);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (values.length - 1);
  const y = (v: number) => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo));
  const segments: string[] = [];
  let d = "";
  values.forEach((v, i) => {
    if (v === null) { if (d) segments.push(d); d = ""; return; }
    d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (d) segments.push(d);
  return (
    <svg width={w} height={h} role="img" aria-label="Half-year median trend">
      {segments.map((s, i) => <path key={i} d={s} fill="none" stroke="currentColor" strokeWidth={1.5} />)}
      {values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={1.8} fill="currentColor" />)}
    </svg>
  );
}

export default async function MarketPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const compType: CompType = sp.type === "sale" ? "sale" : "lease";
  const assetClass: MarketClass = sp.class === "industrial" ? "industrial" : "ios";
  const market = sp.market?.trim() || null;
  const face = sp.basis === "face";

  const supabase = getServiceClient();
  const comps = await readAllCompPages<MarketComp & { created_at: string }>((from, to) =>
    supabase.from("comps").select(MARKET_COLUMNS).eq("status", "confirmed").order("id").range(from, to) as any
  );
  const { count: held } = await supabase.from("comps").select("id", { count: "exact", head: true }).eq("status", "draft");

  const today = new Date().toISOString().slice(0, 10);
  const view = marketView(comps, compType, assetClass, { today, face, market });
  const unit = view.unit;

  // Is the repository still being fed? A market read is only as current as the
  // last comp someone added.
  const lastAdded = comps.reduce<string | null>((m, c) => (!m || c.created_at > m ? c.created_at : m), null)?.slice(0, 10) ?? null;
  const addedLast90 = comps.filter((c) => c.created_at.slice(0, 10) > monthsBefore(today, 3)).length;

  const href = (over: Partial<Params>) => {
    const p = { type: compType, class: assetClass, market: market ?? undefined, basis: face ? "face" : undefined, ...over };
    const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
    return `/market?${q.toString()}`;
  };
  const chip = (label: string, active: boolean, to: string) => (
    <Link key={label} href={to} className={active ? "chip chip-active" : "chip"}>{label}</Link>
  );

  const o = view.overall;
  const rowCells = (r: MarketRow) => (
    <>
      <td>{fmtRate(r.current.median, unit)}</td>
      <td className="muted">
        {r.current.p25 === null ? "—" : `${fmtRate(r.current.p25, unit)} – ${fmtRate(r.current.p75, unit)}`}
      </td>
      <td>
        {r.current.count}
        {r.current.trimmed > 0 && <span className="muted" title="Dropped as far outside the rest (1.5 × IQR)"> (+{r.current.trimmed} trimmed)</span>}
      </td>
      <td>{fmtRate(r.prior.median, unit)}</td>
      <td>{fmtChange(r.change)}</td>
      <td><Trend values={r.trend} /></td>
      <td className="muted">{r.latest ?? "—"}</td>
    </>
  );

  return (
    <>
      <Nav active="market" />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Market{market ? `: ${market}` : ""}</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              What confirmed comps say each market is {compType === "lease" ? "renting" : "selling"} for now, against a year ago.
            </p>
          </div>
        </div>

        <div className="filter-chips">
          {chip("Leases", compType === "lease", href({ type: "lease" }))}
          {chip("Sales", compType === "sale", href({ type: "sale" }))}
          <span className="muted" style={{ margin: "0 6px" }}>·</span>
          {chip("IOS", assetClass === "ios", href({ class: "ios" }))}
          {chip("Industrial", assetClass === "industrial", href({ class: "industrial" }))}
          {compType === "lease" && (
            <>
              <span className="muted" style={{ margin: "0 6px" }}>·</span>
              {chip("Effective", !face, href({ basis: undefined }))}
              {chip("Face", face, href({ basis: "face" }))}
            </>
          )}
          {market && (
            <>
              <span className="muted" style={{ margin: "0 6px" }}>·</span>
              {chip("← All markets", false, href({ market: undefined }))}
            </>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-value">{fmtRate(o.current.median, unit)}</span>
            <span className="stat-label">Median {unit}, last 12 months{market ? "" : ", all markets"}</span>
            {o.change !== null && <span className="stat-delta">{fmtChange(o.change)} vs prior 12 months</span>}
          </div>
          <div className="stat-tile">
            <span className="stat-value">{o.current.count + o.current.trimmed}</span>
            <span className="stat-label">Comps in the last 12 months</span>
            <span className="stat-delta">{o.prior.count + o.prior.trimmed} in the 12 before</span>
          </div>
          <div className="stat-tile">
            <span className={addedLast90 ? "stat-value" : "stat-value stat-bad"}>{addedLast90}</span>
            <span className="stat-label">Comps added in the last 90 days</span>
            <span className={addedLast90 ? "stat-delta" : "stat-delta stat-delta-bad"}>Last added {lastAdded ?? "never"}</span>
          </div>
          <a className="stat-tile" href="/comps">
            <span className={held ? "stat-value stat-bad" : "stat-value"}>{held ?? 0}</span>
            <span className="stat-label">Held for review, not counted</span>
            {held ? <span className="stat-delta stat-delta-bad">review on Comps →</span> : null}
          </a>
        </div>

        {!addedLast90 && (
          <div className="warning">
            <strong>No comps have been added since {lastAdded}.</strong> These figures describe the market as of the
            comps on file; add new deals as they come in (paste a broker table or forward an email on the Comps page)
            to keep them current.
          </div>
        )}

        <section className="panel">
          <h2>{market ? `Submarkets of ${market}` : "By market"} · {unit}{compType === "lease" ? (face ? ", face" : ", effective") : ""}</h2>
          {view.rows.length === 0 ? (
            <p className="muted">No confirmed {assetClass === "ios" ? "IOS" : "industrial"} {compType} comps with a rate.</p>
          ) : (
            <div className="table-scroll">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>{market ? "Submarket" : "Market"}</th>
                    <th>Median, last 12 mo</th>
                    <th>Middle half</th>
                    <th>Comps</th>
                    <th>Prior 12 mo</th>
                    <th>Change</th>
                    <th title={view.halves.join(" → ")}>Trend, {view.halves[0]} – {view.halves[view.halves.length - 1]}</th>
                    <th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.label}>
                      <td>{market ? r.label : <Link href={href({ market: r.label })}>{r.label}</Link>}</td>
                      {rowCells(r)}
                    </tr>
                  ))}
                  <tr className="summary-total">
                    <td>{market ?? "All markets"}</td>
                    {rowCells(o)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            Medians need at least 3 comps; a dash means fewer. Comps far outside the rest of their group
            (beyond 1.5× the interquartile range) are left out of the figures and counted as trimmed.
            {compType === "lease" && !face && (
              <> Effective rent spreads stated free rent{assetClass === "industrial" ? " and TI" : ""} over the lease term;
                {" "}{o.withConcessions} of the last 12 months&apos; comps stated any, the rest are at face.</>
            )}
            {view.unclassified > 0 && <> {view.unclassified} {compType} comps have no asset class and appear in neither view.</>}
          </p>
        </section>
      </main>
    </>
  );
}
