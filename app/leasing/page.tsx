import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import CardDeleteButton from "@/components/CardDeleteButton";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const CARDS_SHOWN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const STAGE_EVENTS = new Set([
  "deal_created",
  "lease_stage_changed",
  "stage_corrected",
  "restored",
]);

function daysInStage(deal: any): number {
  const stamps = (deal.deal_events ?? [])
    .filter((e: any) => STAGE_EVENTS.has(e.event_type))
    .map((e: any) => e.created_at)
    .sort();
  const entered = stamps.pop() ?? deal.created_at;
  return Math.max(0, Math.floor((Date.now() - new Date(entered).getTime()) / DAY_MS));
}

// The tenant is the headline counterparty on a lease -- surface them on the
// card. Prefer the contact's company name (the tenant firm); fall back to
// the person.
function tenantName(deal: any): string | null {
  const t = (deal.deal_contacts ?? []).find((dc: any) => dc.role === "tenant");
  if (!t?.contacts) return null;
  return t.contacts.companies?.name ?? t.contacts.name ?? null;
}

function Card({ deal }: { deal: any }) {
  const tenant = tenantName(deal);
  const days = daysInStage(deal);
  return (
    <div className="pipeline-card-wrap">
      <Link href={`/leasing/${deal.id}`} className="pipeline-card">
        <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
        {tenant ? (
          <span className="tenant">{tenant}</span>
        ) : (
          <span className="muted tenant-missing">no tenant linked</span>
        )}
        <span className="market muted">{deal.properties?.market ?? ""}</span>
        <span className={days >= 14 ? "stage-age stage-age-old" : "stage-age"}>
          {days === 0 ? "today" : `${days}d in stage`}
        </span>
      </Link>
      <CardDeleteButton dealId={deal.id} />
    </div>
  );
}

export default async function LeasingPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select(
      "id, stage, created_at, properties(address, market), deal_contacts(role, contacts(name, companies(name))), deal_events(event_type, created_at)"
    )
    .eq("deal_type", "lease")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });

  const byStage = LEASE_STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <>
      <Nav active="leasing" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <h1>Leasing</h1>
          <div className="header-actions">
            <Link href="/leasing/new" className="button-link">
              + New lease deal
            </Link>
          </div>
        </div>

        <div className="pipeline-board pipeline-board-5">
          {LEASE_STAGES.map((stage) => {
            const cards = byStage[stage];
            const visible = cards.slice(0, CARDS_SHOWN);
            const hidden = cards.slice(CARDS_SHOWN);
            return (
              <section key={stage} className="pipeline-column">
                <h2>
                  {STAGE_LABELS[stage]}
                  <span className="count">{cards.length}</span>
                </h2>
                <div className="pipeline-cards">
                  {visible.map((deal: any) => (
                    <Card key={deal.id} deal={deal} />
                  ))}
                  {hidden.length > 0 && (
                    <details className="pipeline-more">
                      <summary>Show {hidden.length} more</summary>
                      <div className="pipeline-cards">
                        {hidden.map((deal: any) => (
                          <Card key={deal.id} deal={deal} />
                        ))}
                      </div>
                    </details>
                  )}
                  {cards.length === 0 && <p className="empty">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
