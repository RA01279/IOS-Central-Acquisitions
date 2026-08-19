import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { assetClassOf, closedDate, ctToday, rangeStart } from "@/lib/summary";
import Nav from "@/components/Nav";
import CardDeleteButton from "@/components/CardDeleteButton";
import AutoRefresh from "@/components/AutoRefresh";
import TruncatedList from "@/components/TruncatedList";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 12;
// The funnel covers live pipeline only. 'closed' is a terminus that
// accumulates forever, so it's reported as a count, not a funnel step.
const FUNNEL_STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"] as const;

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}
function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}
// Bucket dates into trailing weeks, oldest first.
function weeklyCounts(dates: (string | null)[], weeks = WEEKS): number[] {
  const now = Date.now();
  const buckets = Array(weeks).fill(0);
  for (const d of dates) {
    if (!d) continue;
    const idx = Math.floor((now - new Date(d).getTime()) / (7 * DAY_MS));
    if (idx >= 0 && idx < weeks) buckets[weeks - 1 - idx]++;
  }
  return buckets;
}

// Horizontal funnel: one centered bar per stage, width proportional to count.
function Funnel({
  rows,
  boardHref,
}: {
  rows: { stage: string; count: number }[];
  boardHref: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="funnel">
      {rows.map((r, i) => {
        const pct = Math.max((r.count / max) * 100, r.count > 0 ? 14 : 5);
        return (
          <Link key={r.stage} href={boardHref} className="funnel-row" title={`${STAGE_LABELS[r.stage]}: ${r.count}`}>
            <span className="funnel-label">{STAGE_LABELS[r.stage] ?? r.stage}</span>
            <span className="funnel-track">
              <span
                className="funnel-bar"
                style={{ width: `${pct}%`, opacity: 0.45 + (i / Math.max(1, rows.length - 1)) * 0.55 }}
              >
                <span className="funnel-count">{r.count}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// 12-week bar chart, server-rendered SVG. Single hue, direct labels.
function WeeklyBars({ values, color = "var(--accent-2)" }: { values: number[]; color?: string }) {
  const W = 300;
  const H = 72;
  const max = Math.max(1, ...values);
  const bw = W / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="weekly-bars" role="img">
      {values.map((v, i) => {
        const h = (v / max) * (H - 20);
        const y = H - 4 - h;
        return (
          <g key={i}>
            <rect
              x={i * bw + 3}
              y={v > 0 ? y : H - 6}
              width={bw - 6}
              height={v > 0 ? h : 2}
              rx={3}
              fill={color}
              opacity={v > 0 ? 0.9 : 0.25}
            />
            {v > 0 && (
              <text x={i * bw + bw / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="var(--muted)">
                {v}
              </text>
            )}
          </g>
        );
      })}
      <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="var(--border)" strokeWidth="1" />
    </svg>
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
        "id, stage, asset_class, created_at, updated_at, closed_on, death_stage, death_reason, disposition, pursuit_score, follow_up_on, properties(address, market), deal_events(event_type, created_at)"
      )
      .eq("deal_type", "acquisition"),
    supabase.from("tasks").select("id, due_date").eq("status", "open"),
    supabase.from("activities").select("activity_type").gte("occurred_at", thirtyDaysAgo),
    supabase
      .from("offers")
      .select("id, price, offered_at, created_at, source, deals(id, deal_type, properties(address, lot_sf))")
      .order("offered_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  const deals = dealsRes.data ?? [];
  const openTasks = tasksRes.data ?? [];
  const recentActivities = activitiesRes.data ?? [];
  const allOffers = (offersRes.data ?? []).filter(
    (o: any) => !o.deals || o.deals.deal_type !== "lease"
  );

  const archived = deals.filter((d: any) => d.stage === "archived");
  const closed = deals.filter((d: any) => d.stage === "closed");
  // Live pipeline: neither dead (archived) nor done (closed).
  const acq = deals.filter((d: any) => d.stage !== "archived" && d.stage !== "closed");

  // One funnel per pipeline -- IOS and Industrial are run as separate books, so
  // a single blended funnel hid which one was actually moving.
  const funnelFor = (assetClass: string) =>
    FUNNEL_STAGES.map((s) => ({
      stage: s,
      count: acq.filter((d: any) => d.stage === s && assetClassOf(d) === assetClass).length,
    }));

  const ytdStart = rangeStart("ytd", ctToday());
  const closedYtd = closed.filter((d: any) => closedDate(d) >= ytdStart);

  // Weekly velocity (all deals entered, incl. since-archived ones).
  const intakeWeekly = weeklyCounts(deals.map((d: any) => d.created_at));
  const offersWeekly = weeklyCounts(allOffers.map((o: any) => o.offered_at));
  const newThisWeek = deals.filter((d: any) => daysAgo(d.created_at) < 7).length;
  const offersThisWeek = allOffers.filter(
    (o: any) => o.offered_at && daysAgo(o.offered_at) < 7
  ).length;
  const offers30d = allOffers.filter((o: any) => o.offered_at && daysAgo(o.offered_at) < 30);
  const offers30dTotal = offers30d.reduce((s: number, o: any) => s + (o.price ?? 0), 0);

  const stale = acq
    .map((d: any) => {
      const lastEvent = (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop();
      return { ...d, staleDays: daysAgo(lastEvent ?? d.created_at) };
    })
    .filter((d: any) => d.staleDays >= STALE_DAYS)
    .sort((a: any, b: any) => b.staleDays - a.staleDays);

  const overdueTasks = openTasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );

  const targetsDue = archived
    .filter((d: any) => d.follow_up_on && d.follow_up_on <= today && d.pursuit_score !== 0)
    .sort((a: any, b: any) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));

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

  const recentOffers = allOffers.slice(0, 8);

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
            <span className="stat-label">Active pipeline</span>
            <span className="stat-delta">
              {newThisWeek > 0 ? `+${newThisWeek} this week · ` : ""}
              {closedYtd.length} closed YTD
            </span>
          </Link>
          <Link href="/offers" className="stat-tile">
            <span className="stat-value">{offersThisWeek}</span>
            <span className="stat-label">Offers this week</span>
            <span className="stat-delta">
              {offers30d.length} in 30d · {fmtUsd(offers30dTotal)}
            </span>
          </Link>
          <Link href="/tasks" className="stat-tile">
            <span className={overdueTasks.length > 0 ? "stat-value stat-bad" : "stat-value"}>
              {openTasks.length}
            </span>
            <span className="stat-label">Open follow-ups</span>
            {overdueTasks.length > 0 && (
              <span className="stat-delta stat-delta-bad">{overdueTasks.length} overdue</span>
            )}
          </Link>
          <Link href="/targets" className="stat-tile">
            <span className={targetsDue.length > 0 ? "stat-value stat-bad" : "stat-value"}>
              {targetsDue.length}
            </span>
            <span className="stat-label">Targets due for follow-up</span>
          </Link>
        </div>

        <div className="dash-cols">
          {ASSET_CLASSES.map((ac) => {
            const rows = funnelFor(ac);
            const total = rows.reduce((s, r) => s + r.count, 0);
            return (
              <section className="panel" key={ac}>
                <h2>
                  {ASSET_CLASS_LABELS[ac]} funnel{" "}
                  <Link href={`/deals?asset=${ac}`} className="muted panel-link">
                    board →
                  </Link>
                </h2>
                {total === 0 ? (
                  <p className="muted">No active {ASSET_CLASS_LABELS[ac]} deals.</p>
                ) : (
                  <Funnel rows={rows} boardHref={`/deals?asset=${ac}`} />
                )}
              </section>
            );
          })}
        </div>

        <div className="dash-cols">
          <section className="panel">
            <h2>Deal intake · last {WEEKS} weeks</h2>
            <WeeklyBars values={intakeWeekly} />
            <p className="hint">New acquisition deals entered per week.</p>
          </section>
          <section className="panel">
            <h2>Offers made · last {WEEKS} weeks</h2>
            <WeeklyBars values={offersWeekly} color="var(--accent)" />
            <p className="hint">
              Offers logged per week · {fmtUsd(offers30dTotal)} offered in the last 30 days.
            </p>
          </section>
        </div>

        <section className="panel">
          <h2>Needs attention — no touch in {STALE_DAYS}+ days</h2>
          {stale.length === 0 ? (
            <p className="muted">Nothing stale. Every active deal has been touched recently.</p>
          ) : (
            <TruncatedList
              items={stale.map((d: any) => (
                <li key={d.id}>
                  <span className="doc-type">{ASSET_CLASS_LABELS[assetClassOf(d)]}</span>
                  <Link href={`/deals/${d.id}`}>{d.properties?.address ?? "Untitled deal"}</Link>
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
              Targets due{" "}
              <Link href="/targets" className="muted panel-link">
                all targets →
              </Link>
            </h2>
            {targetsDue.length === 0 ? (
              <p className="muted">No follow-ups due.</p>
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

          <section className="panel">
            <h2>
              Recent offers{" "}
              <Link href="/offers" className="muted panel-link">
                full log →
              </Link>
            </h2>
            {recentOffers.length === 0 ? (
              <p className="muted">No offers logged yet.</p>
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
                      {o.source === "loi" && (
                        <span className="doc-type" style={{ marginLeft: 6 }}>
                          LOI
                        </span>
                      )}
                    </li>
                  );
                })}
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
                  historical rows excluded).
                </p>
              </>
            )}
          </section>

          <section className="panel">
            <h2>Activity, last 30 days</h2>
            {recentActivities.length === 0 ? (
              <p className="muted">No touchpoints logged yet.</p>
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
            <p className="muted">No archived deals.</p>
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
                    <span className="doc-type">{ASSET_CLASS_LABELS[assetClassOf(d)]}</span>
                    <Link href={`/deals/${d.id}`}>
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
