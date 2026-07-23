import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function LeasingPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, stage, created_at, properties(address, market)")
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
                {byStage[stage].map((deal: any) => (
                  <Link key={deal.id} href={`/leasing/${deal.id}`} className="pipeline-card">
                    <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
                    <span className="market muted">{deal.properties?.market ?? ""}</span>
                  </Link>
                ))}
                {byStage[stage].length === 0 && <p className="empty">Nothing here</p>}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
