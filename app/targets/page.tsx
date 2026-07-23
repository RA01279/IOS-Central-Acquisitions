import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import TruncatedList from "@/components/TruncatedList";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const DISPOSITION_LABELS: Record<string, string> = {
  lost: "Lost",
  not_selling: "Not selling (yet)",
  passed: "We passed",
  other: "Other",
};

function stars(score: number | null) {
  if (!score) return null;
  return "★".repeat(score) + "☆".repeat(5 - score);
}

export default async function TargetsPage({
  searchParams,
}: {
  searchParams: { all?: string };
}) {
  const showAll = searchParams.all === "1";
  const supabase = getServiceClient();

  let query = supabase
    .from("deals")
    .select(
      "id, disposition, pursuit_score, follow_up_on, death_stage, death_reason, created_at, properties(address, city, market), offers(price, offered_at)"
    )
    .eq("deal_type", "acquisition")
    .eq("stage", "archived");
  if (!showAll) {
    query = query.or("disposition.not.is.null,pursuit_score.not.is.null,follow_up_on.not.is.null");
  }
  const { data: deals } = await query;

  const today = new Date().toISOString().slice(0, 10);
  const all = deals ?? [];

  const due = all
    .filter((d: any) => d.follow_up_on && d.follow_up_on <= today)
    .sort((a: any, b: any) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
  const dueIds = new Set(due.map((d: any) => d.id));
  const rest = all
    .filter((d: any) => !dueIds.has(d.id))
    .sort(
      (a: any, b: any) =>
        (b.pursuit_score ?? 0) - (a.pursuit_score ?? 0) ||
        (a.follow_up_on ?? "9999").localeCompare(b.follow_up_on ?? "9999")
    );

  function row(d: any) {
    const lastOffer = [...(d.offers ?? [])].sort((a: any, b: any) =>
      (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
    )[0];
    return (
      <li key={d.id} className="target-row">
        {d.pursuit_score ? <span className="target-stars">{stars(d.pursuit_score)}</span> : <span className="target-stars muted">unscored</span>}
        <Link href={`/deals/${d.id}`}>
          <strong>{d.properties?.address ?? "Untitled"}</strong>
        </Link>
        <span className="muted">
          {" "}
          · {[d.properties?.city, d.properties?.market].filter(Boolean).join(", ")}
          {d.disposition ? ` · ${DISPOSITION_LABELS[d.disposition] ?? d.disposition}` : ""}
          {d.follow_up_on ? ` · follow up ${d.follow_up_on}` : ""}
          {lastOffer?.price ? ` · last offer $${Math.round(lastOffer.price).toLocaleString()}` : ""}
          {d.death_stage ? ` · died at ${STAGE_LABELS[d.death_stage] ?? d.death_stage}` : ""}
        </span>
      </li>
    );
  }

  return (
    <>
      <Nav active="targets" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <div>
            <h1>Targets</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Deals we lost or that aren't for sale yet — scored, with follow-up dates.
            </p>
          </div>
          <div className="header-actions">
            {showAll ? (
              <Link href="/targets" className="button-link">
                Scored only
              </Link>
            ) : (
              <Link href="/targets?all=1" className="button-link">
                Show entire archive
              </Link>
            )}
          </div>
        </div>

        <section className="panel">
          <h2>Due for follow-up</h2>
          {due.length === 0 ? (
            <p className="muted">Nothing due. Set follow-up dates from any archived deal's Target scoring panel.</p>
          ) : (
            <TruncatedList items={due.map(row)} />
          )}
        </section>

        <section className="panel">
          <h2>{showAll ? "All archived acquisitions" : "Scored targets"}</h2>
          {rest.length === 0 ? (
            <p className="muted">
              No scored targets yet. Open a deal from the{" "}
              <Link href="/targets?all=1">archive</Link> and use its Target scoring panel.
            </p>
          ) : (
            <TruncatedList items={rest.map(row)} />
          )}
        </section>
      </main>
    </>
  );
}
