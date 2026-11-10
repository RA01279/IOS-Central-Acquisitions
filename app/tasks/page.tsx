import Link from "next/link";
import { listOpenTasks } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import TaskAddForm from "@/components/TaskAddForm";
import TaskDoneButton from "@/components/TaskDoneButton";
import AutoRefresh from "@/components/AutoRefresh";
import TruncatedList from "@/components/TruncatedList";
import { BarRows, Columns, Legend, SERIES, SERIES_SOFT, Stat } from "@/components/charts";
import { ctToday } from "@/lib/summary";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

// Follow-ups: headline counts by when they're due (each a filter), the next
// two weeks and who's carrying what, then the tasks grouped by due bucket.

type When = "overdue" | "today" | "week" | "later" | "none";
const WHEN_LABELS: Record<When, string> = { overdue: "Overdue", today: "Due today", week: "Next 7 days", later: "Later", none: "No due date" };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const who = (email: string | null) => (email ? email.split("@")[0] : "Unassigned");

export default async function TasksPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ mine?: string; when?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const user = await getCurrentUser();
  const mineOnly = searchParams.mine === "1";
  const whenFilter = (Object.keys(WHEN_LABELS) as When[]).find((w) => w === searchParams.when) ?? null;
  const tasks = await listOpenTasks(mineOnly ? user?.email : undefined);
  const today = ctToday();
  const weekEnd = addDays(today, 7);

  const whenOf = (t: any): When =>
    !t.due_date ? "none" : t.due_date < today ? "overdue" : t.due_date === today ? "today" : t.due_date <= weekEnd ? "week" : "later";
  const groups = (Object.keys(WHEN_LABELS) as When[]).map((w) => ({ w, list: tasks.filter((t: any) => whenOf(t) === w) }));
  const count = (w: When) => groups.find((g) => g.w === w)!.list.length;

  // The next 14 days, one column per day.
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const dayCols = days.map((d) => {
    const n = tasks.filter((t: any) => t.due_date === d).length;
    return { key: d, label: i18nDow(d), sub: fmt(d, { month: "numeric", day: "numeric" }), muted: n === 0, title: `${fmt(d, { month: "short", day: "numeric" })}: ${n} due`, segments: [{ value: n, color: SERIES[0] }] };
  });

  // Who's carrying what: overdue vs still on time.
  const people = [...new Set(tasks.map((t: any) => t.assigned_to ?? null))]
    .map((a) => {
      const list = tasks.filter((t: any) => (t.assigned_to ?? null) === a);
      return { a, total: list.length, late: list.filter((t: any) => whenOf(t) === "overdue").length };
    })
    .sort((x, y) => y.total - x.total);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ mine: mineOnly ? "1" : null, when: whenFilter, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/tasks${s ? `?${s}` : ""}`;
  };
  const shown = groups.filter((g) => g.list.length && (!whenFilter || g.w === whenFilter));

  return (
    <>
      <Nav active="tasks" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <h1>Follow-ups</h1>
          <div className="header-actions">
            <TaskAddForm defaultAssignee={user?.email} />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-chips" style={{ margin: 0 }}>
            <Link href={href({ mine: null })} className={!mineOnly ? "chip chip-active" : "chip"}>All open</Link>
            <Link href={href({ mine: "1" })} className={mineOnly ? "chip chip-active" : "chip"}>Mine</Link>
          </div>
          {whenFilter ? <Link href={href({ when: null })} className="muted">Showing {WHEN_LABELS[whenFilter].toLowerCase()} · show all</Link> : null}
        </div>

        <div className="stat-grid-auto">
          <Stat label="Overdue" value={count("overdue")} bad={count("overdue") > 0} href={href({ when: "overdue" })} />
          <Stat label="Due today" value={count("today")} href={href({ when: "today" })} />
          <Stat label="Next 7 days" value={count("week")} href={href({ when: "week" })} />
          <Stat label="Later" value={count("later")} href={href({ when: "later" })} />
          <Stat label="No due date" value={count("none")} href={href({ when: "none" })} />
        </div>

        {tasks.length > 0 ? (
          <div className="two-col">
            <section className="panel">
              <h2>Due over the next two weeks</h2>
              <Columns cols={dayCols} height={110} />
            </section>
            <section className="panel">
              <h2>Who&apos;s carrying what</h2>
              <Legend items={[{ label: "Overdue", color: "var(--weak)" }, { label: "On time", color: SERIES_SOFT }]} />
              <BarRows
                labelWidth={120}
                rows={people.map((p) => ({
                  key: p.a ?? "none",
                  label: who(p.a),
                  title: `${who(p.a)}: ${p.total} open, ${p.late} overdue`,
                  segments: [
                    { value: p.late, color: "var(--weak)", title: `${p.late} overdue` },
                    { value: p.total - p.late, color: SERIES_SOFT, title: `${p.total - p.late} on time` },
                  ],
                  value: <>{p.total}{p.late ? <span className="overdue"> · {p.late} late</span> : null}</>,
                }))}
              />
            </section>
          </div>
        ) : null}

        {tasks.length === 0 ? (
          <section className="panel">
            <p className="muted">
              Nothing open{mineOnly ? " assigned to you" : ""}. Add follow-ups here, or from any contact or deal page.
            </p>
          </section>
        ) : shown.length === 0 ? (
          <section className="panel"><p className="muted">Nothing {WHEN_LABELS[whenFilter!].toLowerCase()}.</p></section>
        ) : (
          shown.map((g) => (
            <section key={g.w} className="panel">
              <h2>
                <span className={g.w === "overdue" ? "overdue" : undefined}>{WHEN_LABELS[g.w]}</span> <span className="count">{g.list.length}</span>
              </h2>
              <TruncatedList
                limit={whenFilter ? 200 : 12}
                items={g.list.map((t: any) => {
                  const deal = t.deals;
                  return (
                    <li key={t.id} className="task-row">
                      <TaskDoneButton taskId={t.id} />
                      <span>
                        <strong>{t.title}</strong>
                        {t.due_date && (
                          <span className={g.w === "overdue" ? "overdue" : "muted"}> · {fmt(t.due_date, { month: "short", day: "numeric" })}</span>
                        )}
                        {t.assigned_to && <span className="muted"> · {who(t.assigned_to)}</span>}
                        {t.contacts?.name && t.contact_id && (
                          <span className="muted"> · <Link href={`/contacts/${t.contact_id}`}>{t.contacts.name}</Link></span>
                        )}
                        {deal && (
                          <span className="muted"> · <Link href={`/deals/${deal.id}`}>{deal.properties?.address ?? "deal"}</Link></span>
                        )}
                        {t.notes && <div className="muted">{t.notes}</div>}
                      </span>
                    </li>
                  );
                })}
              />
            </section>
          ))
        )}
      </main>
    </>
  );
}

function i18nDow(iso: string) {
  return fmt(iso, { weekday: "narrow" });
}
