// app/reports/weekly/page.tsx
//
// Weekly pipeline report for leadership. One click to Excel (download) or
// PDF (the print dialog; the page is laid out to print cleanly).

import Link from "next/link";
import Nav from "@/components/Nav";
import PrintButton from "@/components/PrintButton";
import { buildWeeklyReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly report" };

const usd = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v > 0 ? `$${Math.round(v / 1e3).toLocaleString()}K` : "$0";
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export default async function WeeklyReportPage() {
  const r = await buildWeeklyReport();
  const newDeals = r.moves.filter((m) => m.what === "New deal");
  const stageMoves = r.moves.filter((m) => m.what !== "New deal");

  return (
    <>
      <Nav active="report" />
      <main className="wide report-page">
        <style>{`@media print { .no-print, .hs, .hm-top, .hm-tabs { display: none !important; } body:has(.hs) { padding: 0 !important; } main.report-page { margin: 0 !important; padding: 0 !important; max-width: none !important; } .report-page section { break-inside: avoid; } body { background: #fff !important; } }`}</style>
        <div className="page-header">
          <div>
            <p className="crumbs no-print"><Link href="/dashboard">Dashboard</Link> · Weekly report</p>
            <h1>Weekly pipeline report</h1>
            <p className="hint" style={{ margin: 0 }}>
              Central Acquisitions · {day(r.weekStart)} – {day(r.today)}, {r.today.slice(0, 4)}
            </p>
          </div>
          <div className="header-actions no-print">
            <a href="/api/reports/weekly" className="button-link">Download Excel</a>
            <PrintButton />
          </div>
        </div>

        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 16 }}>
          {r.snapshot.map((c) => (
            <Kpi key={c.assetClass} label={`${c.label} open`} value={`${c.total.count}`} sub={usd(c.total.value)} />
          ))}
          <Kpi label="New this week" value={`${newDeals.length}`} sub={`${stageMoves.length} stage moves`} />
          <Kpi label="Offers this week" value={`${r.offers.length}`} sub={usd(r.offers.reduce((t, o) => t + (o.price ?? 0), 0))} />
          <Kpi label="Closed MTD" value={`${r.closed.mtd.count}`} sub={usd(r.closed.mtd.value)} />
          <Kpi label="Closed YTD" value={`${r.closed.ytd.count}`} sub={usd(r.closed.ytd.value)} />
        </div>

        <section className="panel">
          <h2>Pipeline by stage</h2>
          <table className="summary-table">
            <thead>
              <tr><th></th>{r.snapshot[0].stages.map((s) => <th key={s.stage}>{s.label}</th>)}<th>Total open</th></tr>
            </thead>
            <tbody>
              {r.snapshot.map((c) => (
                <tr key={c.assetClass}>
                  <th scope="row">{c.label}</th>
                  {c.stages.map((s) => <td key={s.stage}>{s.count}{s.value ? <span className="muted"> · {usd(s.value)}</span> : null}</td>)}
                  <td><strong>{c.total.count}</strong> <span className="muted">· {usd(c.total.value)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Value is the closing, contract or latest offer price, whichever is most advanced.</p>
        </section>

        <section className="panel">
          <h2>Next 14 days ({r.upcoming.length})</h2>
          {r.upcoming.length ? (
            <table className="summary-table">
              <thead><tr><th>Date</th><th>What</th><th>Deal</th><th>Owner</th></tr></thead>
              <tbody>
                {r.upcoming.map((u, i) => (
                  <tr key={i}><td>{day(u.date)}</td><td>{u.what}</td><td><Link href={`/deals/${u.id}`}>{u.address}</Link> <span className="muted">{u.assetClass}</span></td><td>{u.owner ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">No DD expiries, closings, IC dates or diligence deadlines in the next two weeks.</p>}
        </section>

        <div className="two-col">
          <section className="panel">
            <h2>Stage moves &amp; new deals ({r.moves.length})</h2>
            {r.moves.length ? (
              <table className="summary-table">
                <thead><tr><th>Date</th><th>Deal</th><th>Move</th><th>By</th></tr></thead>
                <tbody>
                  {r.moves.map((m, i) => (
                    <tr key={i}><td>{day(m.date)}</td><td><Link href={`/deals/${m.id}`}>{m.address}</Link></td><td>{m.what}{m.detail ? ` ${m.detail}` : ""}</td><td className="muted">{m.actor}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="hint">Nothing moved this week.</p>}
          </section>
          <section className="panel">
            <h2>Offers ({r.offers.length})</h2>
            {r.offers.length ? (
              <table className="summary-table">
                <thead><tr><th>Date</th><th>Deal</th><th>Price</th><th>Status</th></tr></thead>
                <tbody>
                  {r.offers.map((o, i) => (
                    <tr key={i}><td>{day(o.date)}</td><td><Link href={`/deals/${o.id}`}>{o.address}</Link></td><td>{usd(o.price)}</td><td>{o.status}{o.counter ? ` · counter ${usd(o.counter)}` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="hint">No offers this week.</p>}
          </section>
        </div>

        <div className="two-col">
          <section className="panel">
            <h2>Losses ({r.losses.length})</h2>
            {r.losses.length ? (
              <table className="summary-table">
                <thead><tr><th>Date</th><th>Deal</th><th>Died at</th><th>Reason</th></tr></thead>
                <tbody>
                  {r.losses.map((l, i) => (
                    <tr key={i}><td>{day(l.date)}</td><td><Link href={`/deals/${l.id}`}>{l.address}</Link></td><td>{l.stage}</td><td>{l.reason ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="hint">No deals archived this week.</p>}
          </section>
          <section className="panel">
            <h2>By owner</h2>
            <table className="summary-table">
              <thead><tr><th>Owner</th><th>Open</th><th>Value</th><th>In contract</th><th>Dates next 14d</th></tr></thead>
              <tbody>
                {r.owners.map((o) => (
                  <tr key={o.owner}><td>{o.owner}</td><td>{o.active}</td><td>{usd(o.value)}</td><td>{o.inContract || "—"}</td><td>{o.due || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <p className="hint">Generated {new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT from Hopper.</p>
      </main>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <span className="label">{label}</span>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {sub && <span className="hint" style={{ margin: 0 }}>{sub}</span>}
    </div>
  );
}
