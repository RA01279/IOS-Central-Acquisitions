// components/DealCrmPanels.tsx
//
// Server component: the CRM half of a deal page -- open follow-ups and the
// touchpoint log (calls/emails/tours/notes, distinct from the system event
// trail). Shared by acquisitions and leasing detail pages.

import { listActivitiesForDeal, listOpenTasksForDeal } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";
import TaskAddForm from "./TaskAddForm";
import TaskDoneButton from "./TaskDoneButton";
import ActivityLogForm from "./ActivityLogForm";

const ACTIVITY_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  tour: "Tour",
  note: "Note",
  other: "Other",
};

export default async function DealCrmPanels({ dealId }: { dealId: string }) {
  const [activities, tasks, user] = await Promise.all([
    listActivitiesForDeal(dealId),
    listOpenTasksForDeal(dealId),
    getCurrentUser(),
  ]);

  return (
    <>
      <section className="panel">
        <h2>Follow-ups</h2>
        {tasks.length === 0 ? (
          <p className="muted">No open follow-ups on this deal.</p>
        ) : (
          <ul className="doc-list">
            {tasks.map((t: any) => (
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
          <TaskAddForm dealId={dealId} defaultAssignee={user?.email} />
        </div>
      </section>

      <section className="panel">
        <h2>Notes &amp; touchpoints</h2>
        {activities.length === 0 ? (
          <p className="muted">Nothing logged yet -- calls, emails, and tours land here.</p>
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
          <ActivityLogForm dealId={dealId} />
        </div>
      </section>
    </>
  );
}
