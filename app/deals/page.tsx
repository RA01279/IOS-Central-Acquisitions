import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import CardDeleteButton from "@/components/CardDeleteButton";

// Live, per-request, auth-gated data -- never statically prerender this at
// build time (doing so also fails the build when Supabase env isn't present).
export const dynamic = "force-dynamic";

const STAGES = ACQUISITION_STAGES;

export default async function DealsPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, stage, mla_status, created_at, properties(address, market)")
    .eq("deal_type", "acquisition")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });

  const byStage = STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <>
      <Nav active="acquisitions" />
      <main>
        <div className="page-header">
          <h1>Acquisitions</h1>
          <div className="header-actions">
            <Link href="/deals/new" className="button-link">
              + New deal
            </Link>
          </div>
        </div>

        <div className="pipeline-board pipeline-board-5">
        {STAGES.map((stage) => (
          <section key={stage} className="pipeline-column">
            <h2>
              {STAGE_LABELS[stage]}
              <span className="count">{byStage[stage].length}</span>
            </h2>
            <div className="pipeline-cards">
              {byStage[stage].map((deal: any) => (
                <div key={deal.id} className="pipeline-card-wrap">
                  <Link href={`/deals/${deal.id}`} className="pipeline-card">
                    <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
                    <span className="market muted">{deal.properties?.market ?? ""}</span>
                    {deal.mla_status === "requested" && (
                      <span className="badge">awaiting MLA</span>
                    )}
                  </Link>
                  <CardDeleteButton dealId={deal.id} />
                </div>
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
