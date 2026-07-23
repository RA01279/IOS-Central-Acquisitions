import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactWithRelations, ROLE_LABELS } from "@/lib/crm";
import { STAGE_LABELS } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import TaskAddForm from "@/components/TaskAddForm";
import TaskDoneButton from "@/components/TaskDoneButton";
import ActivityLogForm from "@/components/ActivityLogForm";
import BackButton from "@/components/BackButton";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const ACTIVITY_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  tour: "Tour",
  note: "Note",
  other: "Other",
};

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  let data;
  try {
    data = await getContactWithRelations(params.id);
  } catch {
    return notFound();
  }
  const { contact, deals, activities, tasks } = data;
  if (!contact) return notFound();

  const user = await getCurrentUser();
  const openTasks = tasks.filter((t: any) => t.status === "open");

  return (
    <>
      <Nav active="contacts" />
      <main className="deal-detail">
        <BackButton />

        <div className="deal-header">
          <div>
            <h1>{contact.name}</h1>
            <p className="muted">
              {[contact.title, contact.companies?.name].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        <section className="panel">
          <h2>Details</h2>
          <div className="metrics-grid">
            <div>
              <span className="label">Email</span>
              <span className="value">{contact.email ?? "—"}</span>
            </div>
            <div>
              <span className="label">Phone</span>
              <span className="value">{contact.phone ?? "—"}</span>
            </div>
            <div>
              <span className="label">Company</span>
              <span className="value">
                {contact.companies ? (
                  <Link href={`/companies/${contact.companies.id}`}>{contact.companies.name}</Link>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Deals</h2>
          {deals.length === 0 ? (
            <p className="muted">Not linked to any deals yet.</p>
          ) : (
            <ul className="doc-list">
              {deals.map((d: any, i: number) => {
                const deal = d.deals;
                if (!deal) return null;
                const href = deal.deal_type === "lease" ? `/leasing/${deal.id}` : `/deals/${deal.id}`;
                return (
                  <li key={`${deal.id}-${d.role}-${i}`}>
                    <span className="doc-type">{ROLE_LABELS[d.role] ?? d.role}</span>
                    <Link href={href}>{deal.properties?.address ?? "Untitled deal"}</Link>
                    <span className="muted">
                      {" "}
                      · {deal.deal_type === "lease" ? "Leasing" : "Acquisition"} ·{" "}
                      {STAGE_LABELS[deal.stage] ?? deal.stage}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Open follow-ups</h2>
          {openTasks.length === 0 ? (
            <p className="muted">No open tasks for this contact.</p>
          ) : (
            <ul className="doc-list">
              {openTasks.map((t: any) => (
                <li key={t.id} className="task-row">
                  <TaskDoneButton taskId={t.id} />
                  <span>
                    {t.title}
                    {t.due_date && <span className="muted"> · due {t.due_date}</span>}
                    {t.assigned_to && <span className="muted"> · {t.assigned_to}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 12 }}>
            <TaskAddForm contactId={contact.id} defaultAssignee={user?.email} />
          </div>
        </section>

        <section className="panel">
          <h2>Activity history</h2>
          {activities.length === 0 ? (
            <p className="muted">No activity logged yet.</p>
          ) : (
            <ul className="event-list">
              {activities.map((a: any) => (
                <li key={a.id}>
                  <span className="doc-type">{ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}</span>{" "}
                  {a.subject ?? ""}
                  <span className="muted">
                    {" "}
                    · {new Date(a.occurred_at).toLocaleString()} · {a.created_by}
                  </span>
                  {a.body && <div className="muted">{a.body}</div>}
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 12 }}>
            <ActivityLogForm contactId={contact.id} />
          </div>
        </section>
      </main>
    </>
  );
}
