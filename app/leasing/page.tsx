import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import CardDeleteButton from "@/components/CardDeleteButton";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function LeasingPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select(
      "id, stage, created_at, properties(address, market), deal_contacts(role, contacts(name, companies(name)))"
    )
    .eq("deal_type", "lease")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });

  // The tenant is the headline counterparty on a lease -- surface them on the
  // card. Prefer the contact's company name (the tenant firm); fall back to
  // the person.
  function tenantName(deal: any): string | null {
    const t = (deal.deal_contacts ?? []).find((dc: any) => dc.role === "tenant");
    if (!t?.contacts) return null;
    return t.contacts.companies?.name ?? t.contacts.name ?? null;
  }

  const byStage = LEASE_STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <>
      <Nav active="leasing" />
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
          {LEASE_STAGES.map((stage) => (
            <section key={stage} className="pipeline-column">
              <h2>
                {STAGE_LABELS[stage]}
                <span className="count">{byStage[stage].length}</span>
              </h2>
              <div className="pipeline-cards">
                {byStage[stage].map((deal: any) => {
                  const tenant = tenantName(deal);
                  return (
                    <div key={deal.id} className="pipeline-card-wrap">
                      <Link href={`/leasing/${deal.id}`} className="pipeline-card">
                        <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
                        {tenant ? (
                          <span className="tenant">{tenant}</span>
                        ) : (
                          <span className="muted tenant-missing">no tenant linked</span>
                        )}
                        <span className="market muted">{deal.properties?.market ?? ""}</span>
                      </Link>
                      <CardDeleteButton dealId={deal.id} />
                    </div>
                  );
                })}
                {byStage[stage].length === 0 && <p className="empty">Nothing here</p>}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
