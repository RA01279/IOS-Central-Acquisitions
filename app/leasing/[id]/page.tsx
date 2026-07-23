import { getServiceClient } from "@/lib/supabase";
import { nextLeaseStage, STAGE_LABELS } from "@/lib/deals";
import { getDealContacts } from "@/lib/crm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";
import LeaseStageActions from "@/components/LeaseStageActions";

const ROLE_LABELS: Record<string, string> = {
  tenant: "Tenant",
  landlord: "Landlord",
  tenant_broker: "Tenant broker",
  listing_broker: "Listing broker",
  seller: "Seller",
  buyer: "Buyer",
  seller_broker: "Seller broker",
  buyer_broker: "Buyer broker",
  other: "Other",
};

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

  const contacts = await getDealContacts(deal.id);

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

        <section className="panel">
          <h2>Contacts</h2>
          {contacts.length === 0 ? (
            <p className="muted">
              No contacts linked yet. Add the tenant and brokers from the{" "}
              <Link href="/contacts">Contacts</Link> section.
            </p>
          ) : (
            <ul className="doc-list">
              {contacts.map((c: any) => (
                <li key={c.id}>
                  <span className="doc-type">{ROLE_LABELS[c.role] ?? c.role}</span>
                  <Link href={`/contacts/${c.contacts?.id}`}>{c.contacts?.name}</Link>
                  {c.contacts?.companies?.name ? (
                    <span className="muted"> · {c.contacts.companies.name}</span>
                  ) : null}
                  {c.contacts?.email ? <span className="muted"> · {c.contacts.email}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

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
