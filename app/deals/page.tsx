import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";

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
        <h1>Acquisitions pipeline</h1>
        <Link href="/deals/new">+ New deal</Link>
      </div>

      {/* TODO(claude-code): replace with a proper board/kanban layout --
          this is a plain list-by-stage placeholder to get something
          on screen quickly. */}
      <div className="pipeline-columns">
        {STAGES.map((stage) => (
          <section key={stage} className="pipeline-column">
            <h2>{STAGE_LABELS[stage]}</h2>
            <ul>
              {byStage[stage].map((deal: any) => (
                <li key={deal.id}>
                  <Link href={`/deals/${deal.id}`}>
                    {deal.properties?.address ?? "Untitled deal"}
                  </Link>
                  {deal.mla_status === "requested" && <span className="badge">awaiting MLA</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
