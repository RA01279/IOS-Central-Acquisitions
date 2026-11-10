// components/OutreachPanel.tsx
//
// On an Outreach-stage deal's Summary: where owner outreach stands, the next
// follow-up, the log-a-touch form (components/TouchForm) and recent touches.
// Server component; the same data the Outreach page shows for this deal.

import { getServiceClient } from "@/lib/supabase";
import TouchForm from "./TouchForm";
import OutreachMoves from "./OutreachMoves";
import { OUTCOME_LABELS, STATUS_LABELS, STATUS_TONE, TOUCH_LABELS, outreachStatus } from "@/lib/outreach";
import { ctToday } from "@/lib/summary";

const short = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const ctDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export default async function OutreachPanel({ dealId }: { dealId: string }) {
  const db = getServiceClient();
  const today = ctToday();
  const [{ data: touches }, { data: task }] = await Promise.all([
    db.from("activities").select("id, activity_type, outcome, occurred_at, body, created_by").eq("deal_id", dealId).neq("activity_type", "note").order("occurred_at", { ascending: false }).limit(50),
    db.from("tasks").select("due_date, assigned_to").eq("deal_id", dealId).eq("kind", "outreach").eq("status", "open").order("due_date").limit(1).maybeSingle(),
  ]);
  const list = touches ?? [];
  const status = outreachStatus(list as any);
  const nextOn: string | null = task?.due_date ?? null;
  const late = nextOn ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${nextOn}T12:00:00Z`)) / 86400000) : null;

  return (
    <section className="panel" id="outreach">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Owner outreach</h2>
        <a href="/outreach" className="panel-link">All outreach</a>
      </div>
      <p style={{ margin: "10px 0 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span className={`badge2 ${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>
        <span className="muted">{list.length ? `${list.length} touch${list.length === 1 ? "" : "es"}` : "No touches yet"}</span>
        <span className="muted">·</span>
        {nextOn ? (
          <span>
            Next touch <strong className={late != null && late > 0 ? "overdue" : undefined}>{short(nextOn)}</strong>
            {late != null && late > 0 ? <span className="overdue"> ({late}d overdue)</span> : null}
            {task?.assigned_to ? <span className="muted"> · {String(task.assigned_to).split("@")[0]}</span> : null}
          </span>
        ) : <span className="muted">No follow-up set</span>}
      </p>
      <div style={{ marginBottom: 14 }}>
        <OutreachMoves dealId={dealId} today={today} emphasis={status === "interested" || status === "talking"} defaultFollowUp={nextOn} />
      </div>
      <div className="outreach-detail" style={{ padding: 0 }}>
        <TouchForm dealId={dealId} today={today} />
        {list.length ? (
          <div className="outreach-history">
            <h3 className="report-sub" style={{ marginTop: 0 }}>History</h3>
            <ul>
              {list.slice(0, 10).map((t: any) => (
                <li key={t.id}>
                  <span className="muted">{short(ctDate(t.occurred_at))}</span>{" "}
                  <strong>{TOUCH_LABELS[t.activity_type] ?? t.activity_type}</strong>
                  {t.outcome ? ` · ${OUTCOME_LABELS[t.outcome] ?? t.outcome}` : ""}
                  <span className="muted"> · {String(t.created_by ?? "").split("@")[0]}</span>
                  {t.body ? <div className="muted">{t.body}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
