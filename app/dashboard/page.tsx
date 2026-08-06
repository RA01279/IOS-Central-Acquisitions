import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import CardDeleteButton from "@/components/CardDeleteButton";
import AutoRefresh from "@/components/AutoRefresh";
import TruncatedList from "@/components/TruncatedList";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEALS_PER_STAGE = 5;

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}
function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}

// A thin, directly-labeled magnitude bar. Single hue -- the count is the
// label; no tooltip or legend needed.
function CountBar({ label, count, max, href }: { label: string; count: number; max: number; href: string }) {
  const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 4 : 0) : 0;
  return (
    <div className="bar-row">
      <Link href={href} className="bar-label">
        {label}
      </Link>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-count">{count}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = getServiceClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [dealsRes, tasksRes, activitiesRes, offersRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, deal_type, stage, created_at, updated_at, death_stage, death_reason, disposition, pursuit_score, follow_up_on, properties(address, market), deal_events(created_at)"
      ),
    supabase.from("tasks").select("id, due_date").eq("status", "open"),
    supabase.from("activities").select("activity_type").gte("occurred_at", thirtyDaysAgo),
    supabase
      .from("offers")
      .select("id, price, offered_at, created_by, deals(id, deal_type, properties(address, lot_sf))")
      .order("offered_at", { ascending: false })
      .limit(10),
  ]);

  const deals = dealsRes.data ?? [];
  const openTasks = tasksRes.data ?? [];
  const recentActivities = activitiesRes.data ?? [];
  const recentOffers = offersRes.data ?? [];

  const active = deals.filter((d: any) => d.stage !== "archived");
  const archived = deals.filter((d: any) => d.stage === "archived");
  const acq = active.filter((d: any) => d.deal_type === "acquisition");
  const lease = active.filter((d: any) => d.deal_type === "lease");

  const acqByStage = ACQUISITION_STAGES.map((s) => ({
    stage: s,
    deals: acq.filter((d: any) => d.stage === s),
  }));
  const leaseByStage = LEASE_STAGES.map((s) => ({
    stage: s,
    deals: lease.filter((d: any) => d.stage === s),
  }));
  const maxAcq = Math.max(1, ...acqByStage.map((r) => r.deals.length));
  const maxLease = Math.max(1, ...leaseByStage.map((r) => r.deals.length));

  // Stale = no event logged in STALE_DAYS (falls back to created_at when a
  // deal has no events at all).
  const stale = active
    .map((d: any) => {
      const lastEvent = (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop();
      const lastTouch = lastEvent ?? d.created_at;
      return { ...d, staleDays: daysAgo(lastTouch) };
    })
    .filter((d: any) => d.staleDays >= STALE_DAYS)
    .sort((a: any, b: any) => b.staleDays - a.staleDays);

  const overdueTasks = openTasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );

  // Targets: archived acquisitions with a follow-up date that has arrived.
  // 0-star ("never a target") deals are excluded.
  const targetsDue = archived
    .filter(
      (d: any) =>
        d.deal_type === "acquisition" &&
        d.follow_up_on &&
        d.follow_up_on <= today &&
        d.pursuit_score !== 0
    )
    .sort((a: any, b: any) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
  const scoredTargets = archived.filter(
    (d: any) => d.deal_type === "acquisition" && (d.pursuit_score || d.disposition || d.follow_up_on)
  );

  // Win/loss from real decisions only -- the imported historical rows
  // (blank status in the old tracker) say nothing about where deals die.
  const realDeaths = archived.filter(
    (d: any) => !(d.death_reason ?? "").startsWith("Imported: historical")
  );
  const deathCounts: Record<string, number> = {};
  for (const d of realDeaths as any[]) {
    const key = d.death_stage ?? "unknown";
    deathCounts[key] = (deathCounts[key] ?? 0) + 1;
  }
  const deaths = Object.entries(deathCounts).sort((a, b) => b[1] - a[1]);

  const activityCounts: Record<string, number> = {};
  for (const a of recentActivities as any[]) {
    activityCounts[a.activity_type] = (activityCounts[a.activity_type] ?? 0) + 1;
  }

  function pipelinePanel(
    title: string,
    boardHref: string,
    rows: { stage: string; deals: any[] }[],
    max: number,
    dealHref: (d: any) => string
  ) {
    return (
      <section className="panel">
        <h2>
          {title}{" "}
          <Link href={boardHref} className="muted panel-link">
            board →
          </Link>
        </h2>
        {rows.map((r) => (
          <div key={r.stage}>
            <CountBar
              label={STAGE_LABELS[r.stage] ?? r.stage}
              count={r.deals.length}
              max={max}
              href={boardHref}
            />
            {r.deals.length > 0 && (
              <div className="bar-deals">
                {r.deals.slice(0, MAX_DEALS_PER_STAGE).map((d: any) => (
                  <Link key={d.id} href={dealHref(d)}>
                    {d.properties?.address ?? "Untitled deal"}
                  </Link>
                ))}
                {r.deals.length > MAX_DEALS_PER_STAGE && (
                  <Link href={boardHref} className="bar-more">
                    +{r.deals.length - MAX_DEALS_PER_STAGE} more →
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    );
  }

  return (
    <>
      <Nav active="dashboard" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Data as of{" "}
              {new Date().toLocaleTimeString("en-US", {
                timeZone: "America/Chicago",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              CT · refreshes automatically when you return to this tab
            </p>
          </div>
        </div>

        <div className="stat-grid">
          <Link href="/deals" className="stat-tile">
            <span className="stat-value">{acq.length}</span>
            <span className="stat-label">Active acquisitions</span>
          </Link>
          <Link href="/leasing" className="stat-tile">
            <span className="stat-value">{lease.length}</span>
            <span className="stat-label">Active lease deals</span>
          </Link>
          <Link href="/tasks" className="stat-tile">
            <span className={overdueTasks.length > 0 ? "stat-value stat-bad" : "stat-value"}>
              {openTasks.length}
            </span>
            <span className="stat-label">
              Open follow-ups{overdueTasks.length > 0 ? ` · ${overdueTasks.length} overdue` : ""}
            </span>
          </Link>
          <Link href="/targets" className="stat-tile">
            <span className={targetsDue.length > 0 ? "stat-value stat-bad" : "stat-value"}>
              {targetsDue.length}
            </span>
            <span className="stat-label">Targets due for follow-up</span>
          </Link>
        </div>

        <div className="dash-cols">
          {pipelinePanel("Acquisitions pipeline", "/deals", acqByStage, maxAcq, (d) => `/deals/${d.id}`)}
          {pipelinePanel("Leasing pipeline", "/leasing", leaseByStage, maxLease, (d) => `/leasing/${d.id}`)}
        </div>

        <section className="panel">
          <h2>Needs attention — no touch in {STALE_DAYS}+ days</h2>
          {stale.length === 0 ? (
            <p className="muted">Nothing stale. Every active deal has been touched recently.</p>
          ) : (
            <TruncatedList
              items={stale.map((d: any) => (
                <li key={d.id}>
                  <span className="doc-type">{d.deal_type === "lease" ? "LEASE" : "ACQ"}</span>
                  <Link href={d.deal_type === "lease" ? `/leasing/${d.id}` : `/deals/${d.id}`}>
                    {d.properties?.address ?? "Untitled deal"}
                  </Link>
                  <span className="muted">
                    {" "}
                    · {STAGE_LABELS[d.stage] ?? d.stage} ·{" "}
                    <span className="overdue">{d.staleDays} days</span> since last touch
                  </span>
                </li>
              ))}
            />
          )}
        </section>

        <div className="dash-cols">
          <section className="panel">
            <h2>
              Recent offers{" "}
              <Link href="/deals" className="muted panel-link">
                board →
              </Link>
            </h2>
            {recentOffers.length === 0 ? (
              <p className="muted">No offers logged yet. Log them from any deal page.</p>
            ) : (
              <ul className="doc-list">
                {recentOffers.map((o: any) => {
                  const lotSf = o.deals?.properties?.lot_sf;
                  const psf = o.price && lotSf ? o.price / lotSf : null;
                  return (
                    <li key={o.id}>
                      <strong>{fmtUsd(o.price)}</strong>
                      {psf !== null && <span className="muted"> · ${psf.toFixed(2)}/SF land</span>}
                      {" — "}
                      {o.deals ? (
                        <Link href={`/deals/${o.deals.id}`}>
                          {o.deals.properties?.address ?? "deal"}
                        </Link>
                      ) : (
                        <span className="muted">(deleted deal)</span>
                      )}
                      {o.offered_at && <span className="muted"> · {o.offered_at}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>
              Targets{" "}
              <Link href="/targets" className="muted panel-link">
                all targets →
              </Link>
            </h2>
            {targetsDue.length === 0 ? (
              <p className="muted">
                No follow-ups due. {scoredTargets.length} scored target
                {scoredTargets.length === 1 ? "" : "s"} in the repository.
              </p>
            ) : (
              <ul className="doc-list">
                {targetsDue.slice(0, 10).map((d: any) => (
                  <li key={d.id}>
                    {d.pursuit_score && (
                      <span className="target-stars">
                        {"★".repeat(d.pursuit_score)}
                        {"☆".repeat(5 - d.pursuit_score)}
                      </span>
                    )}
                    <Link href={`/deals/${d.id}`}>{d.properties?.address ?? "Untitled"}</Link>
                    <span className="muted">
                      {" "}
                      · follow up <span className="overdue">{d.follow_up_on}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="dash-cols">
          <section className="panel">
            <h2>Where deals die</h2>
            {deaths.length === 0 ? (
              <p className="muted">No decided deals archived yet.</p>
            ) : (
              <>
                {deaths.map(([stage, count]) => (
                  <div className="bar-row" key={stage}>
                    <span className="bar-label">{STAGE_LABELS[stage] ?? stage}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill bar-fill-muted"
                        style={{ width: `${(count / Math.max(1, realDeaths.length)) * 100}%` }}
                      />
                    </div>
                    <span className="bar-count">{count}</span>
                  </div>
                ))}
                <p className="hint" style={{ marginTop: 10 }}>
                  {realDeaths.length} decided deals ({archived.length - realDeaths.length} imported
                  historical rows excluded) — full list in the Archive below.
                </p>
              </>
            )}
          </section>

          <section className="panel">
            <h2>Activity, last 30 days</h2>
            {recentActivities.length === 0 ? (
              <p className="muted">
                No touchpoints logged yet. Log calls, emails, and tours from any contact or deal page.
              </p>
            ) : (
              <>
                {Object.entries(activityCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div className="bar-row" key={type}>
                      <span className="bar-label" style={{ textTransform: "capitalize" }}>
                        {type}
                      </span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${(count / recentActivities.length) * 100}%` }}
                        />
                      </div>
                      <span className="bar-count">{count}</span>
                    </div>
                  ))}
                <p className="hint" style={{ marginTop: 10 }}>
                  {recentActivities.length} touchpoints logged across the team.
                </p>
              </>
            )}
          </section>
        </div>

        <section className="panel">
          <h2>Archive</h2>
          {archived.length === 0 ? (
            <p className="muted">No archived deals. Deals archived from either board land here.</p>
          ) : (
            <TruncatedList
              items={[...(archived as any[])]
                .sort(
                  (a, b) =>
                    new Date(b.updated_at ?? b.created_at).getTime() -
                    new Date(a.updated_at ?? a.created_at).getTime()
                )
                .map((d: any) => (
                  <li key={d.id} className="archive-row">
                    <span className="doc-type">{d.deal_type === "lease" ? "LEASE" : "ACQ"}</span>
                    <Link href={d.deal_type === "lease" ? `/leasing/${d.id}` : `/deals/${d.id}`}>
                      {d.properties?.address ?? "Untitled deal"}
                    </Link>
                    <span className="muted">
                      {" "}
                      · died at {STAGE_LABELS[d.death_stage] ?? d.death_stage ?? "?"}
                      {d.death_reason ? ` — ${d.death_reason.slice(0, 80)}` : ""}
                    </span>
                    <CardDeleteButton dealId={d.id} />
                  </li>
                ))}
            />
          )}
        </section>
      </main>
    </>
  );
}
