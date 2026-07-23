import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
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

  const [dealsRes, tasksRes, activitiesRes] = await Promise.all([
    supabase
      .from("deals")
      .select("id, deal_type, stage, created_at, death_stage, death_reason, updated_at, properties(address, market), deal_events(created_at)"),
    supabase.from("tasks").select("id, due_date").eq("status", "open"),
    supabase.from("activities").select("activity_type").gte("occurred_at", thirtyDaysAgo),
  ]);

  const deals = dealsRes.data ?? [];
  const openTasks = tasksRes.data ?? [];
  const recentActivities = activitiesRes.data ?? [];

  const active = deals.filter((d: any) => d.stage !== "archived");
  const archived = deals.filter((d: any) => d.stage === "archived");
  const acq = active.filter((d: any) => d.deal_type === "acquisition");
  const lease = active.filter((d: any) => d.deal_type === "lease");

  const acqByStage = ACQUISITION_STAGES.map((s) => ({
    stage: s,
    count: acq.filter((d: any) => d.stage === s).length,
  }));
  const leaseByStage = LEASE_STAGES.map((s) => ({
    stage: s,
    count: lease.filter((d: any) => d.stage === s).length,
  }));
  const maxAcq = Math.max(1, ...acqByStage.map((r) => r.count));
  const maxLease = Math.max(1, ...leaseByStage.map((r) => r.count));

  // Stale = no event logged in STALE_DAYS (falls back to created_at when a
  // deal has no events at all).
  const stale = active
    .map((d: any) => {
      const lastEvent = (d.deal_events ?? [])
        .map((e: any) => e.created_at)
        .sort()
        .pop();
      const lastTouch = lastEvent ?? d.created_at;
      return { ...d, lastTouch, staleDays: daysAgo(lastTouch) };
    })
    .filter((d: any) => d.staleDays >= STALE_DAYS)
    .sort((a: any, b: any) => b.staleDays - a.staleDays);

  const overdueTasks = openTasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );

  // Win/loss: where archived deals died.
  const deathCounts: Record<string, number> = {};
  for (const d of archived as any[]) {
    const key = d.death_stage ?? "unknown";
    deathCounts[key] = (deathCounts[key] ?? 0) + 1;
  }
  const deaths = Object.entries(deathCounts).sort((a, b) => b[1] - a[1]);
  const recentArchived = [...(archived as any[])]
    .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
    .slice(0, 5);

  const activityCounts: Record<string, number> = {};
  for (const a of recentActivities as any[]) {
    activityCounts[a.activity_type] = (activityCounts[a.activity_type] ?? 0) + 1;
  }

  return (
    <>
      <Nav active="dashboard" />
      <main>
        <div className="page-header">
          <h1>Dashboard</h1>
        </div>

        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-value">{acq.length}</span>
            <span className="stat-label">Active acquisitions</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{lease.length}</span>
            <span className="stat-label">Active lease deals</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{openTasks.length}</span>
            <span className="stat-label">Open follow-ups</span>
          </div>
          <div className="stat-tile">
            <span className={overdueTasks.length > 0 ? "stat-value stat-bad" : "stat-value"}>
              {overdueTasks.length}
            </span>
            <span className="stat-label">Overdue follow-ups</span>
          </div>
        </div>

        <div className="dash-cols">
          <section className="panel">
            <h2>
              Acquisitions pipeline <Link href="/deals" className="muted panel-link">board →</Link>
            </h2>
            {acqByStage.map((r) => (
              <CountBar
                key={r.stage}
                label={STAGE_LABELS[r.stage] ?? r.stage}
                count={r.count}
                max={maxAcq}
                href="/deals"
              />
            ))}
          </section>

          <section className="panel">
            <h2>
              Leasing pipeline <Link href="/leasing" className="muted panel-link">board →</Link>
            </h2>
            {leaseByStage.map((r) => (
              <CountBar
                key={r.stage}
                label={STAGE_LABELS[r.stage] ?? r.stage}
                count={r.count}
                max={maxLease}
                href="/leasing"
              />
            ))}
          </section>
        </div>

        <section className="panel">
          <h2>Needs attention — no touch in {STALE_DAYS}+ days</h2>
          {stale.length === 0 ? (
            <p className="muted">Nothing stale. Every active deal has been touched recently.</p>
          ) : (
            <ul className="doc-list">
              {stale.map((d: any) => (
                <li key={d.id}>
                  <span className="doc-type">{d.deal_type === "lease" ? "LEASE" : "ACQ"}</span>
                  <Link href={d.deal_type === "lease" ? `/leasing/${d.id}` : `/deals/${d.id}`}>
                    {d.properties?.address ?? "Untitled deal"}
                  </Link>
                  <span className="muted">
                    {" "}
                    · {STAGE_LABELS[d.stage] ?? d.stage} · <span className="overdue">{d.staleDays} days</span> since last touch
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dash-cols">
          <section className="panel">
            <h2>Where deals die</h2>
            {deaths.length === 0 ? (
              <p className="muted">No archived deals yet.</p>
            ) : (
              <>
                {deaths.map(([stage, count]) => (
                  <div className="bar-row" key={stage}>
                    <span className="bar-label">{STAGE_LABELS[stage] ?? stage}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill bar-fill-muted"
                        style={{ width: `${(count / Math.max(1, archived.length)) * 100}%` }}
                      />
                    </div>
                    <span className="bar-count">{count}</span>
                  </div>
                ))}
                <p className="hint" style={{ marginTop: 10 }}>
                  {archived.length} archived total. Recent: {recentArchived.map((d: any) => (
                    <span key={d.id} className="muted">
                      {d.properties?.address ?? "?"}{d.death_reason ? ` (${d.death_reason})` : ""}.{" "}
                    </span>
                  ))}
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
                      <span className="bar-label" style={{ textTransform: "capitalize" }}>{type}</span>
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
      </main>
    </>
  );
}
