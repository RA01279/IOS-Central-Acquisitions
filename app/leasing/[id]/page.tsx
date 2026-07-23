import { getServiceClient } from "@/lib/supabase";
import { nextLeaseStage, STAGE_LABELS } from "@/lib/deals";
import { getDealContacts, listContacts, ROLE_LABELS, ROLES_BY_DEAL_TYPE } from "@/lib/crm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";
import LeaseStageActions from "@/components/LeaseStageActions";
import DealContactsPanel from "@/components/DealContactsPanel";
import DealCrmPanels from "@/components/DealCrmPanels";

export default async function LeaseDealDetailPage({ params }: { params: { id: string } }) {
  const supabase = getServiceClient();

  const { data: deal } = await supabase
    .from("deals")
    .select("*, properties(*), deal_events(*)")
    .eq("id", params.id)
    .single();

  if (!deal) return notFound();
  // Guard against an acquisition id being opened under /leasing.
  if (deal.deal_type !== "lease") redirect(`/deals/${deal.id}`);

  const [contacts, allContacts] = await Promise.all([getDealContacts(deal.id), listContacts()]);

  const next = nextLeaseStage(deal.stage);
  const eventsDesc = [...(deal.deal_events ?? [])].sort(
    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <>
      <Nav active="leasing" />
      <main className="deal-detail">
        <Link href="/leasing" className="back-link">
          ← Leasing
        </Link>

        <div className="deal-header">
          <div>
            <h1>{deal.properties?.address}</h1>
            <p className="muted">
              {deal.properties?.market ?? "—"} · {deal.properties?.asset_type?.toUpperCase()}
            </p>
          </div>
          <span className={`stage-badge stage-${deal.stage}`}>
            {STAGE_LABELS[deal.stage] ?? deal.stage}
          </span>
        </div>

        {deal.stage === "archived" && (
          <div className="archived-banner">
            Archived at <strong>{STAGE_LABELS[deal.death_stage] ?? deal.death_stage}</strong>
            {deal.death_reason ? ` — ${deal.death_reason}` : ""}
          </div>
        )}

        <LeaseStageActions
          dealId={deal.id}
          stage={deal.stage}
          nextStage={next}
          nextStageLabel={next ? STAGE_LABELS[next] : null}
        />

        <DealContactsPanel
          dealId={deal.id}
          links={contacts as any}
          contacts={allContacts.map((c: any) => ({ id: c.id, name: c.name }))}
          roleOptions={ROLES_BY_DEAL_TYPE.lease}
          roleLabels={ROLE_LABELS}
        />

        <DealCrmPanels dealId={deal.id} />

        <section className="panel">
          <h2>Activity</h2>
          {eventsDesc.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <ul className="event-list">
              {eventsDesc.map((e: any) => (
                <li key={e.id}>
                  <span className="muted">{new Date(e.created_at).toLocaleString()}</span> —{" "}
                  {e.event_type} ({e.actor})
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
