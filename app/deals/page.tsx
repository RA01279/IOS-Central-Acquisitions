import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import SignOutButton from "@/components/SignOutButton";

const STAGES = ["uw", "uw_v1", "offered", "moving_to_psa"] as const;
const STAGE_LABELS: Record<string, string> = {
  uw: "UW",
  uw_v1: "UW v1",
  offered: "Offered",
  moving_to_psa: "Moving to PSA",
};

export default async function DealsPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, stage, mla_status, created_at, properties(address, market)")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });

  const byStage = STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <main>
      <div className="page-header">
        <h1>Hopper</h1>
        <div className="header-actions">
          <Link href="/deals/new" className="button-link">
            + New deal
          </Link>
          <SignOutButton />
        </div>
      </div>

      <div className="pipeline-board">
        {STAGES.map((stage) => (
          <section key={stage} className="pipeline-column">
            <h2>
              {STAGE_LABELS[stage]}
              <span className="count">{byStage[stage].length}</span>
            </h2>
            <div className="pipeline-cards">
              {byStage[stage].map((deal: any) => (
                <Link key={deal.id} href={`/deals/${deal.id}`} className="pipeline-card">
                  <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
                  <span className="market muted">{deal.properties?.market ?? ""}</span>
                  {deal.mla_status === "requested" && (
                    <span className="badge">awaiting MLA</span>
                  )}
                </Link>
              ))}
              {byStage[stage].length === 0 && <p className="empty">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
