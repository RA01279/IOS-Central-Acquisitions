// app/contacts/brokers/page.tsx
//
// Broker scorecard: who sends us deals, how far those deals get, who's new and
// who we haven't spoken to lately. Brokers arrive on their own -- every broker
// on a new deal (lib/deals.ts) and every broker an LOI is addressed to
// (app/api/deals/[id]/loi) is saved to Contacts and linked -- so this page is
// a read of the contact book, not a list anyone maintains.
//
// Layout: four summary tiles (each one a filter), the brokers added in the
// last 30 days, then one filterable, sortable table showing the top 50 until asked.

import Link from "next/link";
import Nav from "@/components/Nav";
import { loadBrokerScorecard } from "@/lib/broker-scorecard-db";
import type { BrokerRow } from "@/lib/broker-scorecard";
import { ctToday } from "@/lib/summary";
import { getServiceClient } from "@/lib/supabase";
import { guessFirm } from "@/lib/firm-guess";
import BrokerFirmFixer, { type FirmlessBroker } from "@/components/BrokerFirmFixer";
import { fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brokers" };

const NEW_DAYS = 30;
const QUIET_DAYS = 60;
const PAGE = 50;

const rate = (r: BrokerRow) => (r.deals ? r.offered / r.deals : 0);

function daysSince(iso: string | null, today: string) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(iso)) / 86400000));
}
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

// Column sorts. "rank" is the scorecard's own order: closed, then PSA, offered, deals.
const SORTS: Record<string, (a: BrokerRow, b: BrokerRow) => number> = {
  rank: () => 0,
  name: (a, b) => a.name.localeCompare(b.name),
  deals: (a, b) => b.deals - a.deals,
  offered: (a, b) => rate(b) - rate(a) || b.deals - a.deals,
  lois: (a, b) => b.lois - a.lois || b.deals - a.deals,
  psa: (a, b) => b.psa - a.psa || b.deals - a.deals,
  closed: (a, b) => b.closed - a.closed || b.psa - a.psa,
  volume: (a, b) => b.volume - a.volume || b.deals - a.deals,
  touch: (a, b) => (a.lastTouch ?? "").localeCompare(b.lastTouch ?? ""),
  added: (a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""),
};

type Show = "all" | "working" | "new" | "quiet";

export default async function BrokerScorecardPage(props: {
  searchParams: Promise<{ view?: string; sort?: string; show?: string; q?: string; market?: string; all?: string }>;
}) {
  const sp = await props.searchParams;
  const view = sp.view === "firms" ? "firms" : "people";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "rank";
  const show: Show = (["working", "new", "quiet"] as const).find((s) => s === sp.show) ?? "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const market = (sp.market ?? "").trim();
  const today = ctToday();
  const card = await loadBrokerScorecard();

  const isNew = (r: BrokerRow) => { const d = daysSince(r.addedAt, today); return d != null && d <= NEW_DAYS; };
  // Going quiet: someone who has sent us real business (2+ deals, or any
  // offer) and we haven't heard from in two months.
  const isQuiet = (r: BrokerRow) => { const d = daysSince(r.lastTouch, today); return (r.deals >= 2 || r.offered > 0) && (d == null || d > QUIET_DAYS); };
  const FILTERS: Record<Show, (r: BrokerRow) => boolean> = {
    all: () => true,
    working: (r) => r.active > 0,
    new: isNew,
    quiet: isQuiet,
  };

  const base = view === "firms" ? card.firms : card.people;
  const counts: Record<Show, number> = {
    all: base.length,
    working: base.filter(FILTERS.working).length,
    new: base.filter(isNew).length,
    quiet: base.filter(isQuiet).length,
  };
  const markets = [...new Set(base.flatMap((r) => r.markets.map((m) => m.name)))].sort((a, b) => a.localeCompare(b));

  const needle = q.toLowerCase();
  const rows = base
    .filter(FILTERS[show])
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.firm ?? "").toLowerCase().includes(needle))
    .filter((r) => !market || r.markets.some((m) => m.name.toLowerCase() === market.toLowerCase()));
  if (sort !== "rank") rows.sort(SORTS[sort]);
  const showAll = sp.all === "1" || rows.length <= PAGE + 10;
  const visible = showAll ? rows : rows.slice(0, PAGE);

  // Brokers added lately, newest first, each with a deal they're on.
  const fresh = card.people.filter(isNew).sort(SORTS.added).slice(0, 8);
  const db = getServiceClient();
  const firmless = card.people.filter((p) => !p.firmId);
  const freshDealIds = [...new Set(fresh.map((p) => p.dealIds[0]).filter(Boolean))];
  const [{ data: companyRows }, { data: firmlessRows }, { data: freshDeals }] = await Promise.all([
    db.from("companies").select("id, name, company_type").order("name"),
    firmless.length ? db.from("contacts").select("id, name, email").in("id", firmless.map((p) => p.key)) : Promise.resolve({ data: [] as any[] }),
    freshDealIds.length ? db.from("deals").select("id, properties(address, city)").in("id", freshDealIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const dealLabel = new Map<string, string>(
    (freshDeals ?? []).map((d: any) => [d.id, [d.properties?.address, d.properties?.city].filter(Boolean).join(", ") || "a deal"])
  );
  const companies = (companyRows ?? []).sort((a: any, b: any) => (a.company_type === "broker" ? 0 : 1) - (b.company_type === "broker" ? 0 : 1) || a.name.localeCompare(b.name));
  const toFix: FirmlessBroker[] = (firmlessRows ?? [])
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      email: c.email ?? null,
      deals: firmless.find((p) => p.key === c.id)?.deals ?? 0,
      guess: guessFirm({ name: c.name, email: c.email }, companies),
    }))
    .sort((a: FirmlessBroker, b: FirmlessBroker) => Number(!!b.guess) - Number(!!a.guess) || b.deals - a.deals);

  const href = (patch: Record<string, string | null>) => {
    const cur: Record<string, string> = { view, sort, show, q, market };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...patch })) {
      if (!v || (k === "view" && v === "people") || (k === "sort" && v === "rank") || (k === "show" && v === "all")) continue;
      p.set(k, v);
    }
    const qs = p.toString();
    return `/contacts/brokers${qs ? `?${qs}` : ""}`;
  };
  // A sortable column header: click to sort by it, click again for the default order.
  const th = (key: string, label: string, title?: string, num = true) => (
    <th title={title} className={num ? "num" : undefined}>
      <Link href={href({ sort: sort === key ? "rank" : key, all: null })} className={sort === key ? "sort-on" : undefined}>
        {label}{sort === key ? " ▾" : ""}
      </Link>
    </th>
  );
  const noun = view === "firms" ? "firms" : "brokers";
  const TABS: { key: Show; label: string }[] = [
    { key: "all", label: "All" },
    { key: "working", label: "Working a deal" },
    { key: "new", label: `New (${NEW_DAYS}d)` },
    { key: "quiet", label: "Going quiet" },
  ];

  return (
    <>
      <Nav active="brokers" />
      <main className="wide brokers-page">
        <div className="page-header">
          <div>
            <p className="crumbs"><Link href="/contacts">Contacts</Link> · Brokers</p>
            <h1>Brokers</h1>
            <p className="hint" style={{ margin: 0 }}>
              Everyone who&apos;s sent us a deal or been sent an LOI. New deals and LOIs add their brokers here automatically.
            </p>
          </div>
          <div className="stage-actions" style={{ margin: 0 }}>
            <Link href={href({ view: "people", all: null })} className={view === "people" ? "tchip on" : "tchip"}>People</Link>
            <Link href={href({ view: "firms", all: null })} className={view === "firms" ? "tchip on" : "tchip"}>Firms</Link>
          </div>
        </div>

        <div className="stat-grid">
          <Link href={href({ show: "all", all: null })} className="stat-tile">
            <span className="stat-value">{counts.all}</span>
            <span className="stat-label">{view === "firms" ? `Firms · ${card.people.length} brokers` : `Brokers · ${card.firms.length} firms`}</span>
          </Link>
          <Link href={href({ show: "new", sort: "added", all: null })} className="stat-tile">
            <span className="stat-value">{counts.new}</span>
            <span className="stat-label">New in the last {NEW_DAYS} days</span>
          </Link>
          <Link href={href({ show: "working", all: null })} className="stat-tile">
            <span className="stat-value">{counts.working}</span>
            <span className="stat-label">Working a live deal with us</span>
          </Link>
          <Link href={href({ show: "quiet", sort: "touch", all: null })} className="stat-tile">
            <span className={counts.quiet ? "stat-value stat-bad" : "stat-value"}>{counts.quiet}</span>
            <span className="stat-label">Going quiet: no touch in {QUIET_DAYS}+ days</span>
          </Link>
        </div>

        {view === "people" && fresh.length > 0 && show === "all" && !q && !market ? (
          <section className="panel">
            <div className="card-head">
              <h2 style={{ margin: 0 }}>Recently added</h2>
              {counts.new > fresh.length ? <Link href={href({ show: "new", sort: "added" })} className="panel-link">See all {counts.new}</Link> : null}
            </div>
            <div className="broker-fresh">
              {fresh.map((p) => {
                const dealId = p.dealIds[0];
                return (
                  <div key={p.key} className="broker-fresh-card">
                    <Link href={`/contacts/${p.key}`} className="broker-name">{p.name}</Link>
                    <span className="broker-sub">{p.firm ?? "No firm yet"}</span>
                    <span className="broker-sub">
                      Added {p.addedAt ? shortDate(p.addedAt) : "recently"}
                      {dealId ? <> · <Link href={`/deals/${dealId}`}>{dealLabel.get(dealId) ?? "deal"}</Link></> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <BrokerFirmFixer brokers={toFix} companies={companies.map((c: any) => ({ id: c.id, name: c.name }))} />

        <section className="panel">
          <div className="broker-toolbar">
            <div className="broker-tabs">
              {TABS.map((t) => (
                <Link key={t.key} href={href({ show: t.key, all: null })} className={show === t.key ? "tchip on" : "tchip"}>
                  {t.label} <span className="tchip-count">{counts[t.key]}</span>
                </Link>
              ))}
            </div>
            <form method="get" action="/contacts/brokers" className="broker-search">
              {view !== "people" ? <input type="hidden" name="view" value={view} /> : null}
              {show !== "all" ? <input type="hidden" name="show" value={show} /> : null}
              {sort !== "rank" ? <input type="hidden" name="sort" value={sort} /> : null}
              <input type="search" name="q" defaultValue={q} placeholder={view === "firms" ? "Search firms" : "Search name or firm"} aria-label="Search" />
              <select name="market" defaultValue={market} aria-label="Market">
                <option value="">All markets</option>
                {markets.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button type="submit" className="secondary">Filter</button>
              {q || market ? <Link href={href({ q: null, market: null, all: null })} className="muted">Clear</Link> : null}
            </form>
          </div>

          {rows.length === 0 ? (
            <p className="hint">
              {base.length === 0
                ? "No brokers yet. Add a deal with its broker, or send an LOI through a broker, and they'll show up here."
                : `No ${noun} match this filter.`}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="summary-table broker-table">
                <thead>
                  <tr>
                    {th("name", view === "firms" ? "Firm" : "Broker", undefined, false)}
                    {th("deals", "Deals", "Deals sent or represented; live ones underneath")}
                    {th("offered", "Offered", "Deals we offered on, and that share of their deals")}
                    {th("lois", "LOI", "Deals we sent an LOI on")}
                    {th("psa", "PSA", "Reached Moving to PSA or later")}
                    {th("closed", "Closed")}
                    {th("volume", "Volume", "Total asking price of their deals that had one")}
                    {th("touch", "Last touch", "Latest call, email, meeting or deal activity", false)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const d = daysSince(r.lastTouch, today);
                    const pct = Math.round(rate(r) * 100);
                    const where = r.markets.slice(0, 3).map((m) => m.name).join(", ") + (r.markets.length > 3 ? ` +${r.markets.length - 3}` : "");
                    return (
                      <tr key={r.key}>
                        <td>
                          <div className="broker-name-line">
                            <Link href={r.kind === "firm" ? `/companies/${r.key}` : `/contacts/${r.key}`} className="broker-name">{r.name}</Link>
                            {isNew(r) ? <span className="badge2 brand">New</span> : null}
                          </div>
                          <div className="broker-sub">
                            {r.kind === "person" ? (r.firmId ? <Link href={`/companies/${r.firmId}`}>{r.firm}</Link> : <span>No firm</span>) : null}
                            {r.kind === "person" && where ? " · " : null}
                            {where ? <span title={r.markets.map((m) => `${m.name} (${m.deals})`).join(", ")}>{where}</span> : null}
                            {r.comps ? <span> · {r.comps} comp{r.comps === 1 ? "" : "s"}</span> : null}
                          </div>
                        </td>
                        <td className="num">
                          {r.deals}
                          {r.active ? <div className="broker-sub">{r.active} live</div> : null}
                        </td>
                        <td className="num">
                          {r.offered ? (
                            <>
                              {r.offered} <span className="muted">· {pct}%</span>
                              <div className="rate-track" aria-hidden><div className="rate-fill" style={{ width: `${pct}%` }} /></div>
                            </>
                          ) : "—"}
                        </td>
                        <td className="num">{r.lois || "—"}</td>
                        <td className="num">{r.psa || "—"}</td>
                        <td className="num">{r.closed ? <strong>{r.closed}</strong> : "—"}</td>
                        <td className="num" title={r.priced < r.deals ? `${r.priced} of ${r.deals} deals had an asking price` : undefined}>
                          {r.volume ? fmtMoney(r.volume) : "—"}
                        </td>
                        <td>
                          {d == null ? "—" : <span className={d > QUIET_DAYS ? "overdue" : d > 30 ? "muted" : undefined}>{d === 0 ? "Today" : `${d}d ago`}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!showAll ? (
            <p style={{ textAlign: "center", margin: "12px 0 0" }}>
              <Link href={href({ all: "1" })} className="tchip">Show all {rows.length} {noun}</Link>
            </p>
          ) : null}
          <details className="hint" style={{ marginTop: 12 }}>
            <summary>How these are counted</summary>
            A deal counts once per broker, and a firm counts every deal any of its people worked. Brokers come from the seller
            and buyer brokers linked to a deal, the firm credited at intake, and whoever an LOI is addressed to. Last touch
            is the latest logged call, email or meeting, or activity on one of their deals. Comps are matched on the firm name
            in each comp&apos;s source. Volume adds up asking prices where a deal has one (hover to see how many did).
          </details>
        </section>
      </main>
    </>
  );
}
