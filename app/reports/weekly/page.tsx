// app/reports/weekly/page.tsx
//
// Weekly pipeline report for leadership. One click to Excel (download) or
// PDF (the print dialog; the page is laid out to print cleanly).
//
// Reads top to bottom: headline numbers, the open pipeline by stage and the
// week day by day (charts), what's coming up, then this week's offers, moves,
// losses, team load, and the active investment decisions as cards.

import Link from "next/link";
import Nav from "@/components/Nav";
import PrintButton from "@/components/PrintButton";
import { BarRows, Columns, Legend, SERIES, SERIES_SOFT, Stat } from "@/components/charts";
import { buildWeeklyReport } from "@/lib/weekly-report";
import { STAGE_LABELS } from "@/lib/deals";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly report" };

const usd = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v > 0 ? `$${Math.round(v / 1e3).toLocaleString()}K` : "$0";
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Upcoming-date badges: the tone says how much is riding on the date.
const DATE_TONE: Record<string, string> = { "DD expires": "warning", Closing: "success", IC: "brand", "Call for offers": "brand" };
const FIRST = 8;
const STAGE_RANK = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"];
const statusLabel = (s: string | null) => (s ? STAGE_LABELS[s] ?? s : "—");
const actor = (a: string) => (a && a !== "system" ? ` · ${a}` : "");
const OFFER_TONE: Record<string, string> = { Accepted: "success", Countered: "warning", Rejected: "danger", Declined: "danger" };

export default async function WeeklyReportPage() {
  const r = await buildWeeklyReport();
  const newDeals = r.moves.filter((m) => m.what === "New deal");
  const stageMoves = r.moves.filter((m) => m.what !== "New deal");
  const offerTotal = r.offers.reduce((t, o) => t + (o.price ?? 0), 0);
  const [ios, ind] = r.snapshot;

  // The week, one column per day: new deals, stage moves and offers.
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.weekStart, i));
  const weekCols = days.map((d) => {
    const n = newDeals.filter((m) => m.date === d).length;
    const s = stageMoves.filter((m) => m.date === d).length;
    const o = r.offers.filter((x) => x.date === d).length;
    return {
      key: d,
      label: weekday(d),
      sub: day(d),
      title: `${day(d)}: ${plural(n, "new deal")}, ${plural(s, "stage move")}, ${plural(o, "offer")}`,
      muted: n + s + o === 0,
      segments: [
        { value: n, color: SERIES[0], title: plural(n, "new deal") },
        { value: s, color: SERIES[1], title: plural(s, "stage move") },
        { value: o, color: SERIES[2], title: plural(o, "offer") },
      ],
    };
  });

  // Upcoming dates grouped by day.
  const upcomingByDay = [...new Set(r.upcoming.map((u) => u.date))].map((d) => ({ date: d, items: r.upcoming.filter((u) => u.date === d) }));

  // Where this week's stage moves went.
  const moveName = (m: { what: string; detail: string | null }) => m.what + (m.detail ? ` ${m.detail}` : "");
  const movedTo = [...new Set(stageMoves.map(moveName))]
    .map((w) => ({ what: w, n: stageMoves.filter((m) => moveName(m) === w).length }))
    .sort((a, b) => b.n - a.n);

  // Decisions, most advanced first: the top few as cards, the rest as a table.
  const rank = (st: string | null) => { const i = STAGE_RANK.indexOf(st ?? ""); return i < 0 ? 2.5 : i; };
  const decisions = [...r.decisions].sort((a, b) => rank(b.status) - rank(a.status) || (b.latestBid ?? b.askingPrice ?? 0) - (a.latestBid ?? a.askingPrice ?? 0));
  const featured = decisions.slice(0, 6);
  const rest = decisions.slice(6);

  // Where this week's losses died.
  const lossStages = [...new Set(r.losses.map((l) => l.stage))]
    .map((s) => ({ stage: s, n: r.losses.filter((l) => l.stage === s).length }))
    .sort((a, b) => b.n - a.n);

  return (
    <>
      <Nav active="report" />
      <main className="wide report-page">
        <style>{`@media print { .no-print, .hs, .hm-top, .hm-tabs { display: none !important; } body:has(.hs) { padding: 0 !important; } main.report-page { margin: 0 !important; padding: 0 !important; max-width: none !important; } .report-page section { break-inside: avoid; } .report-page details { display: block; } .report-page details > *:not(summary) { display: block; } body { background: #fff !important; } }`}</style>
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

        <div className="stat-grid-auto">
          {r.snapshot.map((c) => (
            <Stat key={c.assetClass} label={`${c.label} open`} value={c.total.count} sub={usd(c.total.value)} />
          ))}
          <Stat label="New deals this week" value={newDeals.length} sub={plural(stageMoves.length, "stage move")} />
          <Stat label="Offers this week" value={r.offers.length} sub={usd(offerTotal)} />
          <Stat label="Lost this week" value={r.losses.length} bad={r.losses.length > 0} />
          <Stat label="Closed MTD" value={r.closed.mtd.count} sub={usd(r.closed.mtd.value)} />
          <Stat label="Closed YTD" value={r.closed.ytd.count} sub={usd(r.closed.ytd.value)} />
        </div>

        <div className="two-col">
          <section className="panel">
            <h2>Open pipeline by stage</h2>
            <Legend items={[{ label: ios.label, color: SERIES[0] }, { label: ind.label, color: SERIES[1] }]} />
            <BarRows
              labelWidth={120}
              rows={ios.stages.map((s, i) => {
                const n = ind.stages[i];
                const count = s.count + n.count;
                return {
                  key: s.stage,
                  label: s.label,
                  title: `${s.label}: ${ios.label} ${s.count} (${usd(s.value)}), ${ind.label} ${n.count} (${usd(n.value)})`,
                  segments: [
                    { value: s.count, color: SERIES[0], title: `${ios.label}: ${s.count}` },
                    { value: n.count, color: SERIES[1], title: `${ind.label}: ${n.count}` },
                  ],
                  value: count ? <>{count} <span className="muted">· {usd(s.value + n.value)}</span></> : <span className="muted">0</span>,
                };
              })}
            />
            <details className="hint" style={{ marginTop: 12 }}>
              <summary>As a table</summary>
              <table className="summary-table">
                <thead>
                  <tr><th></th>{ios.stages.map((s) => <th key={s.stage}>{s.label}</th>)}<th>Total</th></tr>
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
              Value is the closing, contract or latest offer price, whichever is most advanced.
            </details>
          </section>

          <section className="panel">
            <h2>The week, day by day</h2>
            <Legend items={[{ label: "New deals", color: SERIES[0] }, { label: "Stage moves", color: SERIES[1] }, { label: "Offers", color: SERIES[2] }]} />
            <Columns cols={weekCols} />
          </section>
        </div>

        <section className="panel">
          <h2>Next 14 days ({r.upcoming.length})</h2>
          {upcomingByDay.length ? (
            <div className="agenda">
              {upcomingByDay.map((g) => (
                <div key={g.date} className="agenda-day">
                  <div className="agenda-date">
                    <span className="agenda-dow">{weekday(g.date)}</span>
                    <span className="agenda-dom">{day(g.date)}</span>
                  </div>
                  <ul className="agenda-items">
                    {g.items.map((u, i) => (
                      <li key={i}>
                        <span className={`badge2 ${DATE_TONE[u.what] ?? "neutral"}`}>{u.what}</span>
                        <Link href={`/deals/${u.id}`}>{u.address}</Link>
                        <span className="muted"> · {u.assetClass}{u.owner ? ` · ${u.owner}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : <p className="hint">No DD expiries, closings, IC dates or diligence deadlines in the next two weeks.</p>}
        </section>

        <div className="two-col">
          <section className="panel">
            <h2>Offers this week ({r.offers.length}{r.offers.length ? ` · ${usd(offerTotal)}` : ""})</h2>
            {r.offers.length ? (
              <ul className="feed">
                {r.offers.slice(0, FIRST).map((o, i) => (
                  <li key={i}>
                    <span className="feed-figure">{usd(o.price)}</span>
                    <span className="feed-main">
                      <Link href={`/deals/${o.id}`}>{o.address}</Link>
                      <span className="muted"> · {day(o.date)}{o.counter ? ` · countered at ${usd(o.counter)}` : ""}</span>
                    </span>
                    <span className={`badge2 ${OFFER_TONE[o.status] ?? "neutral"}`}>{o.status}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">No offers this week.</p>}
            {r.offers.length > FIRST ? (
              <details className="more">
                <summary>Show {r.offers.length - FIRST} more</summary>
                <ul className="feed">
                  {r.offers.slice(FIRST).map((o, i) => (
                    <li key={i}>
                      <span className="feed-figure">{usd(o.price)}</span>
                      <span className="feed-main"><Link href={`/deals/${o.id}`}>{o.address}</Link><span className="muted"> · {day(o.date)}{o.counter ? ` · countered at ${usd(o.counter)}` : ""}</span></span>
                      <span className={`badge2 ${OFFER_TONE[o.status] ?? "neutral"}`}>{o.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
          <section className="panel">
            <h2>New deals &amp; stage moves ({r.moves.length})</h2>
            {movedTo.length ? (
              <BarRows labelWidth={150} rows={movedTo.map((m) => ({ key: m.what, label: m.what, segments: [{ value: m.n, color: SERIES[1] }], value: m.n }))} />
            ) : null}
            {newDeals.length ? (
              <p className="hint" style={{ margin: "10px 0" }}>
                {plural(newDeals.length, "new deal")} added: {newDeals.filter((m) => m.assetClass === "IOS").length} IOS, {newDeals.filter((m) => m.assetClass !== "IOS").length} industrial.
              </p>
            ) : null}
            {r.moves.length ? (
              <details className="more">
                <summary>Every move ({r.moves.length})</summary>
              <ul className="feed">
                {r.moves.map((m, i) => (
                  <li key={i}>
                    <span className={m.what === "New deal" ? "badge2 brand" : "badge2 neutral"}>{m.what === "New deal" ? "New" : "Moved"}</span>
                    <span className="feed-main">
                      <Link href={`/deals/${m.id}`}>{m.address}</Link>
                      <span className="muted"> · {m.what === "New deal" ? m.assetClass : `${m.what}${m.detail ? ` ${m.detail}` : ""}`}</span>
                    </span>
                    <span className="muted feed-meta">{day(m.date)}{actor(m.actor)}</span>
                  </li>
                ))}
              </ul>
              </details>
            ) : <p className="hint">Nothing moved this week.</p>}
          </section>
        </div>

        <div className="two-col">
          <section className="panel">
            <h2>Losses ({r.losses.length})</h2>
            {r.losses.length ? (
              <>
                <BarRows
                  labelWidth={120}
                  rows={lossStages.map((s) => ({ key: s.stage, label: `Died at ${s.stage}`, segments: [{ value: s.n, color: "var(--n400)" }], value: s.n }))}
                />
                <details className="more">
                <summary>Every loss and why ({r.losses.length})</summary>
                <ul className="feed">
                  {r.losses.map((l, i) => (
                    <li key={i}>
                      <span className="feed-main">
                        <Link href={`/deals/${l.id}`}>{l.address}</Link>
                        <span className="muted"> · {l.reason ?? "No reason given"}</span>
                      </span>
                      <span className="muted feed-meta">{day(l.date)}</span>
                    </li>
                  ))}
                </ul>
                </details>
              </>
            ) : <p className="hint">No deals archived this week.</p>}
          </section>
          <section className="panel">
            <h2>Team load</h2>
            <Legend items={[{ label: "In contract", color: SERIES[0] }, { label: "Other open deals", color: SERIES_SOFT }]} />
            <BarRows
              labelWidth={120}
              rows={r.owners.map((o) => ({
                key: o.owner,
                label: o.owner,
                title: `${o.owner}: ${o.active} open (${o.inContract} in contract), ${usd(o.value)}, ${plural(o.due, "date")} in the next 14 days`,
                segments: [
                  { value: o.inContract, color: SERIES[0], title: `${o.inContract} in contract` },
                  { value: o.active - o.inContract, color: SERIES_SOFT, title: `${o.active - o.inContract} other open` },
                ],
                value: <>{o.active} <span className="muted">· {usd(o.value)}{o.due ? ` · ${plural(o.due, "date")}` : ""}</span></>,
              }))}
            />
          </section>
        </div>

        <section className="panel">
          <h2>Active investment decisions ({r.decisions.length})</h2>
          <p className="hint">Unknown fields need review; returns are from the named source, not approval. Open a card for the full reconciliation.</p>
          <h3 className="report-sub">Furthest along</h3>
          <div className="decision-grid">
            {featured.map((d) => {
              const irr = d.modelIrr ?? d.screeningIrr;
              return (
                <article key={d.id} className="decision-card">
                  <header>
                    <Link href={`/deals/${d.id}/financials`} className="decision-title">{d.address}</Link>
                    <span className="decision-tags">
                      {d.conflicts ? <span className="badge2 warning" title={d.conflicts}>Review</span> : null}
                      <span className="badge2 neutral">{statusLabel(d.status)}</span>
                    </span>
                  </header>
                  <dl className="decision-figures">
                    <div><dt>Ask</dt><dd>{usd(d.askingPrice)}</dd></div>
                    <div><dt>Model</dt><dd>{usd(d.modelPrice)}</dd></div>
                    <div><dt>Our bid</dt><dd>{usd(d.latestBid)}</dd></div>
                    <div><dt>{d.modelIrr != null ? "IRR" : "Screen IRR"}</dt><dd>{irr == null ? "—" : `${(irr * 100).toFixed(1)}%`}</dd></div>
                  </dl>
                  <p className="decision-next"><strong>Next:</strong> {d.nextAction ?? "Action unknown"}<span className="muted"> · {d.owner ?? "Unassigned"}</span></p>
                  <details>
                    <summary>Details</summary>
                    {d.conflicts ? <p className="decision-flag">⚠ {d.conflicts}</p> : null}
                    <p>Pursuit: {d.rationale ?? "Unknown"} · Vehicle / partner: {d.vehicle ?? "Unknown"} · Follow-up {d.followUpOn ?? "Unassigned"} · CFO {d.deadline ?? "Unknown"}</p>
                    <p>Ask {usd(d.askingPrice)} ({d.askingDate ?? "date unknown"}; {d.askingSource ?? "source unknown"}); model {usd(d.modelPrice)} ({d.returnSource}); bid {usd(d.latestBid)} ({d.bidDate ?? "date unknown"}).</p>
                    <p>{d.income}. Workbook IRR {d.modelIrr == null ? "withheld / unknown" : `${(d.modelIrr * 100).toFixed(2)}%`}; screening IRR {d.screeningIrr == null ? "unknown" : `${(d.screeningIrr * 100).toFixed(2)}%`} ({d.screenDate ?? "no saved run"}).</p>
                    <p>{d.bridge}</p>
                    <p>{d.assumptions}</p>
                    <p>Downside: {d.downside ?? "Not recorded"}. Comp evidence: {d.compReview}.</p>
                  </details>
                </article>
              );
            })}
          </div>
          {rest.length ? (
            <details className="more">
              <summary>The other {rest.length}</summary>
              <div style={{ overflowX: "auto" }}>
                <table className="summary-table log-table">
                  <thead><tr><th>Deal</th><th>Status</th><th className="num">Ask</th><th className="num">Our bid</th><th className="num">IRR</th><th>Next</th></tr></thead>
                  <tbody>
                    {rest.map((d) => {
                      const irr = d.modelIrr ?? d.screeningIrr;
                      return (
                        <tr key={d.id}>
                          <td><Link href={`/deals/${d.id}/financials`}>{d.address}</Link>{d.conflicts ? <> <span className="badge2 warning" title={d.conflicts}>Review</span></> : null}</td>
                          <td>{statusLabel(d.status)}</td>
                          <td className="num">{usd(d.askingPrice)}</td>
                          <td className="num">{usd(d.latestBid)}</td>
                          <td className="num">{irr == null ? "—" : `${(irr * 100).toFixed(1)}%`}</td>
                          <td className="muted">{d.nextAction ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        <p className="hint">Generated {new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT from Hopper.</p>
      </main>
    </>
  );
}
