import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactWithRelations, listCompanies, ROLE_LABELS } from "@/lib/crm";
import ContactEditForm from "@/components/ContactEditForm";
import { STAGE_LABELS } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import TaskAddForm from "@/components/TaskAddForm";
import TaskDoneButton from "@/components/TaskDoneButton";
import ActivityLogForm from "@/components/ActivityLogForm";
import BackButton from "@/components/BackButton";
import TruncatedList from "@/components/TruncatedList";
import { loadBrokerScorecard } from "@/lib/broker-scorecard-db";
import { fmtAcres, fmtMoney, fmtShortDate } from "@/lib/format";
import { BarRows, Columns, SERIES, SERIES_SOFT, Stat } from "@/components/charts";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const ACTIVITY_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  tour: "Tour",
  note: "Note",
  other: "Other",
};

export default async function ContactDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  let data;
  try {
    data = await getContactWithRelations(params.id);
  } catch {
    return notFound();
  }
  const { contact, deals, activities, tasks } = data;
  if (!contact) return notFound();

  const [user, companies, scorecard] = await Promise.all([getCurrentUser(), listCompanies(), loadBrokerScorecard()]);
  const asBroker = scorecard.people.find((p) => p.key === contact.id) ?? null;
  const openTasks = tasks.filter((t: any) => t.status === "open");
  // Logged calls, emails and meetings per month, the last twelve months.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthsBack = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${thisMonth}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    return d.toISOString().slice(0, 7);
  });
  const activityCols = monthsBack.map((ym) => {
    const n = activities.filter((a: any) => String(a.occurred_at ?? "").slice(0, 7) === ym).length;
    const label = new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
    return { key: ym, label, muted: n === 0, title: `${label}: ${n} logged`, segments: [{ value: n, color: SERIES[0] }] };
  });

  return (
    <>
      <Nav active="contacts" />
      <main className="deal-detail">
        <BackButton />

        <div className="deal-header">
          <div>
            <h1>{contact.name}</h1>
            <p className="muted">
              {[contact.title, contact.companies?.name].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        <section className="panel">
          <h2>Details</h2>
          <div className="metrics-grid">
            <div>
              <span className="label">Email</span>
              <span className="value">{contact.email ?? "—"}</span>
            </div>
            <div>
              <span className="label">Phone</span>
              <span className="value">{contact.phone ?? "—"}</span>
            </div>
            <div>
              <span className="label">Company</span>
              <span className="value">
                {contact.companies ? (
                  <Link href={`/companies/${contact.companies.id}`}>{contact.companies.name}</Link>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div>
              <span className="label">Address</span>
              <span className="value">{contact.address ?? "—"}</span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <ContactEditForm
              contact={contact}
              companies={companies.map((c: any) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </section>

        {asBroker ? (
          <section className="panel">
            <div className="card-head">
              <h2 style={{ margin: 0 }}>Track record as a broker</h2>
              <Link href="/contacts/brokers" className="panel-link">Broker scorecard</Link>
            </div>
            <div className="stat-grid-auto" style={{ marginTop: 12 }}>
              <Stat label="Deals sent or represented" value={asBroker.deals} sub={asBroker.active ? `${asBroker.active} live` : undefined} />
              <Stat label="We offered on" value={asBroker.offered} sub={asBroker.deals ? `${Math.round((asBroker.offered / asBroker.deals) * 100)}% of their deals` : undefined} />
              <Stat label="Closed" value={asBroker.closed} sub={asBroker.psa ? `${asBroker.psa} reached PSA` : undefined} />
              <Stat label="Asking volume" value={asBroker.volume ? fmtMoney(asBroker.volume) : "—"} sub={asBroker.acres ? `${asBroker.acres.toFixed(1)} ac of land` : undefined} />
              {asBroker.comps ? <Stat label={`Comps from ${asBroker.firm ?? "their firm"}`} value={asBroker.comps} /> : null}
            </div>
            <div className="two-col">
              <div>
                <h3 className="report-sub" style={{ marginTop: 4 }}>How far their deals got</h3>
                <BarRows
                  labelWidth={90}
                  max={Math.max(1, asBroker.deals)}
                  rows={[
                    { key: "deals", label: "Deals", n: asBroker.deals },
                    { key: "offered", label: "Offered", n: asBroker.offered },
                    { key: "loi", label: "LOI", n: asBroker.lois },
                    { key: "psa", label: "PSA", n: asBroker.psa },
                    { key: "closed", label: "Closed", n: asBroker.closed },
                  ].map((s, i) => ({ key: s.key, label: s.label, segments: [{ value: s.n, color: i === 0 ? SERIES_SOFT : SERIES[0] }], value: s.n }))}
                />
                <p className="hint" style={{ marginBottom: 0 }}>
                  {asBroker.ios || asBroker.industrial ? `${asBroker.ios} IOS · ${asBroker.industrial} industrial` : null}
                  {(asBroker.ios || asBroker.industrial) && (asBroker.offMarket || asBroker.marketed) ? " · " : null}
                  {asBroker.offMarket || asBroker.marketed ? `${asBroker.offMarket} off-market · ${asBroker.marketed} marketed` : null}
                </p>
              </div>
              <div>
                <h3 className="report-sub" style={{ marginTop: 4 }}>Markets</h3>
                {asBroker.markets.length ? (
                  <BarRows labelWidth={110} rows={asBroker.markets.slice(0, 6).map((m) => ({ key: m.name, label: m.name, segments: [{ value: m.deals, color: SERIES_SOFT }], value: m.deals }))} />
                ) : <p className="hint">No markets recorded on their deals.</p>}
              </div>
            </div>
          </section>
        ) : null}

        {activityCols.some((c) => c.segments[0].value > 0) ? (
          <section className="panel">
            <h2>Touches over the last 12 months</h2>
            <Columns cols={activityCols} height={90} />
          </section>
        ) : null}

        <section className="panel">
          <h2>Deals</h2>
          {deals.length === 0 ? (
            <p className="muted">Not linked to any deals yet.</p>
          ) : (
            <TruncatedList
              items={deals
                .filter((d: any) => d.deals)
                // Newest first: what they've sent us lately is what matters.
                .sort((a: any, b: any) => String(b.deals.created_at ?? "").localeCompare(String(a.deals.created_at ?? "")))
                .map((d: any, i: number) => {
                  const deal = d.deals;
                  // Legacy lease deals have no page any more, so they're shown
                  // as plain text rather than a link into a 404.
                  const isLease = deal.deal_type === "lease";
                  return (
                    <li key={`${deal.id}-${d.role}-${i}`}>
                      <span className="doc-type">{ROLE_LABELS[d.role] ?? d.role}</span>
                      {isLease ? (
                        <span>{deal.properties?.address ?? "Untitled deal"}</span>
                      ) : (
                        <Link href={`/deals/${deal.id}`}>
                          {deal.properties?.address ?? "Untitled deal"}
                        </Link>
                      )}
                      <span className="muted">
                        {" "}
                        · {isLease ? "Leasing (retired)" : "Acquisition"} ·{" "}
                        {STAGE_LABELS[deal.stage] ?? deal.stage}
                        {deal.properties?.market ? ` · ${deal.properties.market}` : ""}
                        {deal.asset_class ? ` · ${deal.asset_class === "ios" ? "IOS" : "Industrial"}` : ""}
                        {deal.asking_price ? ` · ${fmtMoney(Number(deal.asking_price))}` : ""}
                        {deal.properties?.lot_sf ? ` · ${fmtAcres(deal.properties.lot_sf)}` : ""}
                        {deal.marketing_status ? ` · ${deal.marketing_status === "off_market" ? "Off-market" : "Marketed"}` : ""}
                        {deal.created_at ? ` · added ${fmtShortDate(deal.created_at)}` : ""}
                      </span>
                    </li>
                  );
                })}
            />
          )}
        </section>

        <section className="panel">
          <h2>Open follow-ups</h2>
          {openTasks.length === 0 ? (
            <p className="muted">No open tasks for this contact.</p>
          ) : (
            <ul className="doc-list">
              {openTasks.map((t: any) => (
                <li key={t.id} className="task-row">
                  <TaskDoneButton taskId={t.id} />
                  <span>
                    {t.title}
                    {t.due_date && <span className="muted"> · due {t.due_date}</span>}
                    {t.assigned_to && <span className="muted"> · {t.assigned_to}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 12 }}>
            <TaskAddForm contactId={contact.id} defaultAssignee={user?.email} />
          </div>
        </section>

        <section className="panel">
          <h2>Activity history</h2>
          {activities.length === 0 ? (
            <p className="muted">No activity logged yet.</p>
          ) : (
            <TruncatedList
              className="event-list"
              items={activities.map((a: any) => (
                <li key={a.id}>
                  <span className="doc-type">{ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}</span>{" "}
                  {a.subject ?? ""}
                  <span className="muted">
                    {" "}
                    · {new Date(a.occurred_at).toLocaleString()} · {a.created_by}
                  </span>
                  {a.body && <div className="muted">{a.body}</div>}
                </li>
              ))}
            />
          )}
          <div style={{ marginTop: 12 }}>
            <ActivityLogForm contactId={contact.id} />
          </div>
        </section>
      </main>
    </>
  );
}
