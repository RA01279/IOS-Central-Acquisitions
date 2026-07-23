import Link from "next/link";
import { listOpenTasks } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import TaskAddForm from "@/components/TaskAddForm";
import TaskDoneButton from "@/components/TaskDoneButton";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

function isOverdue(due: string | null) {
  if (!due) return false;
  return new Date(due + "T23:59:59") < new Date();
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { mine?: string };
}) {
  const user = await getCurrentUser();
  const mineOnly = searchParams.mine === "1";
  const tasks = await listOpenTasks(mineOnly ? user?.email : undefined);

  return (
    <>
      <Nav active="tasks" />
      <main>
        <div className="page-header">
          <h1>Follow-ups</h1>
          <div className="header-actions">
            <TaskAddForm defaultAssignee={user?.email} />
          </div>
        </div>

        <div className="stage-actions">
          <Link href="/tasks" className={!mineOnly ? "button-link" : "muted"}>
            All open
          </Link>
          <Link href="/tasks?mine=1" className={mineOnly ? "button-link" : "muted"}>
            Mine
          </Link>
        </div>

        <section className="panel">
          {tasks.length === 0 ? (
            <p className="muted">
              Nothing open{mineOnly ? " assigned to you" : ""}. Add follow-ups here, or from any
              contact or deal page.
            </p>
          ) : (
            <ul className="doc-list">
              {tasks.map((t: any) => {
                const overdue = isOverdue(t.due_date);
                const deal = t.deals;
                const dealHref = deal
                  ? deal.deal_type === "lease"
                    ? `/leasing/${deal.id}`
                    : `/deals/${deal.id}`
                  : null;
                return (
                  <li key={t.id} className="task-row">
                    <TaskDoneButton taskId={t.id} />
                    <span>
                      <strong>{t.title}</strong>
                      {t.due_date && (
                        <span className={overdue ? "overdue" : "muted"}>
                          {" "}
                          · due {t.due_date}
                          {overdue ? " (overdue)" : ""}
                        </span>
                      )}
                      {t.assigned_to && <span className="muted"> · {t.assigned_to}</span>}
                      {t.contacts?.name && t.contact_id && (
                        <span className="muted">
                          {" "}
                          · <Link href={`/contacts/${t.contact_id}`}>{t.contacts.name}</Link>
                        </span>
                      )}
                      {deal && dealHref && (
                        <span className="muted">
                          {" "}
                          · <Link href={dealHref}>{deal.properties?.address ?? "deal"}</Link>
                        </span>
                      )}
                      {t.notes && <div className="muted">{t.notes}</div>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
