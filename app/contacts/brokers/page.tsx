// app/contacts/brokers/page.tsx
//
// Broker scorecard: who sends us deals, how far those deals get, who supplies
// comps, and who we haven't spoken to lately. People and firms, sortable.

import Link from "next/link";
import Nav from "@/components/Nav";
import { loadBrokerScorecard } from "@/lib/broker-scorecard-db";
import type { BrokerRow } from "@/lib/broker-scorecard";
import { ctToday } from "@/lib/summary";
import { getServiceClient } from "@/lib/supabase";
import { guessFirm } from "@/lib/firm-guess";
import BrokerFirmFixer, { type FirmlessBroker } from "@/components/BrokerFirmFixer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broker scorecard" };

const SORTS: Record<string, { label: string; by: (a: BrokerRow, b: BrokerRow) => number }> = {
  rank: { label: "Best results", by: () => 0 },
  deals: { label: "Most deals", by: (a, b) => b.deals - a.deals },
  hit: { label: "Offer rate", by: (a, b) => rate(b) - rate(a) || b.deals - a.deals },
  comps: { label: "Most comps", by: (a, b) => b.comps - a.comps },
  quiet: { label: "Longest since contact", by: (a, b) => (a.lastTouch ?? "").localeCompare(b.lastTouch ?? "") },
};
const rate = (r: BrokerRow) => (r.deals ? r.offered / r.deals : 0);

function daysSince(iso: string | null, today: string) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(iso)) / 86400000));
}

export default async function BrokerScorecardPage(props: { searchParams: Promise<{ view?: string; sort?: string }> }) {
  const sp = await props.searchParams;
  const view = sp.view === "firms" ? "firms" : "people";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "rank";
  const today = ctToday();
  const card = await loadBrokerScorecard();
  // Brokers with no firm, with a suggested one, for the review list.
  const firmless = card.people.filter((p) => !p.firmId);
  const db = getServiceClient();
  const [{ data: companyRows }, { data: firmlessRows }] = await Promise.all([
    db.from("companies").select("id, name, company_type").order("name"),
    firmless.length ? db.from("contacts").select("id, name, email").in("id", firmless.map((p) => p.key)) : Promise.resolve({ data: [] as any[] }),
  ]);
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
  const rows = [...(view === "firms" ? card.firms : card.people)];
  if (sort !== "rank") rows.sort(SORTS[sort].by);
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(view !== "people" ? { view } : {}), ...(sort !== "rank" ? { sort } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if ((k === "view" && v === "people") || (k === "sort" && v === "rank")) p.delete(k);
    const qs = p.toString();
    return `/contacts/brokers${qs ? `?${qs}` : ""}`;
  };
  const totals = rows.reduce((t, r) => ({ deals: t.deals + r.deals, closed: t.closed + r.closed }), { deals: 0, closed: 0 });

  return (
    <>
      <Nav active="brokers" />
      <main className="wide">
        <div className="page-header">
          <div>
            <p className="crumbs"><Link href="/contacts">Contacts</Link> · Brokers</p>
            <h1>Broker scorecard</h1>
            <p className="hint" style={{ margin: 0 }}>
              Deals a broker brought or represented (linked as seller or buyer broker, or credited at intake), how far they
              got, comps their firm supplied, and the last time we were in touch.
            </p>
          </div>
        </div>

        <div className="stage-actions">
          <Link href={href({ view: "people" })} className={view === "people" ? "tchip on" : "tchip"}>People ({card.people.length})</Link>
          <Link href={href({ view: "firms" })} className={view === "firms" ? "tchip on" : "tchip"}>Firms ({card.firms.length})</Link>
          <span style={{ flex: 1 }} />
          <span className="muted">Sort:</span>
          {Object.entries(SORTS).map(([k, s]) => (
            <Link key={k} href={href({ sort: k })} className={sort === k ? "tchip on" : "tchip"}>{s.label}</Link>
          ))}
        </div>

        <BrokerFirmFixer brokers={toFix} companies={companies.map((c: any) => ({ id: c.id, name: c.name }))} />

        <section className="panel">
          {rows.length === 0 ? (
            <p className="hint">
              No brokers yet. Link a contact to a deal as seller or buyer broker from the deal&apos;s Summary tab.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>{view === "firms" ? "Firm" : "Broker"}</th>
                    <th title="Deals sent or represented">Deals</th>
                    <th>Active</th>
                    <th title="Deals we offered on">Offered</th>
                    <th title="Offered ÷ deals">Offer rate</th>
                    <th title="Deals we sent an LOI on">LOI</th>
                    <th title="Reached Moving to PSA or later">PSA</th>
                    <th>Closed</th>
                    <th title="Comps whose source names this firm">Comps</th>
                    <th>Last touch</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = daysSince(r.lastTouch, today);
                    return (
                      <tr key={r.key}>
                        <td>
                          <Link href={r.kind === "firm" ? `/companies/${r.key}` : `/contacts/${r.key}`}>{r.name}</Link>
                          {r.kind === "person" && r.firm && r.firmId ? (
                            <> <span className="muted">· <Link href={`/companies/${r.firmId}`}>{r.firm}</Link></span></>
                          ) : null}
                        </td>
                        <td>{r.deals}</td>
                        <td>{r.active || "—"}</td>
                        <td>{r.offered || "—"}</td>
                        <td>{r.deals ? `${Math.round(rate(r) * 100)}%` : "—"}</td>
                        <td>{r.lois || "—"}</td>
                        <td>{r.psa || "—"}</td>
                        <td>{r.closed ? <strong>{r.closed}</strong> : "—"}</td>
                        <td>{r.comps || "—"}</td>
                        <td>
                          {d == null ? "—" : <span className={d > 60 ? "overdue" : d > 30 ? "muted" : undefined}>{d === 0 ? "today" : `${d} days ago`}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            {totals.deals} deal links · {totals.closed} closed. A deal counts once per broker; a firm counts every deal any of its
            people worked. Last touch is the latest logged call, email or meeting, or activity on one of their deals; over 60
            days is highlighted. Comps are matched on the firm name in each comp&apos;s source.
          </p>
        </section>
      </main>
    </>
  );
}
