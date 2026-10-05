// Notes & History tab: one timeline of notes, site visits (with photos) and
// stage history, filterable by ?filter=visits|stage. Follow-ups and documents
// sit alongside.

import { Camera, MessageSquare, GitCommitHorizontal, Phone, Mail, Users, MapPin } from "lucide-react";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { listActivitiesForDeal, listOpenTasksForDeal } from "@/lib/crm";
import { STAGE_LABELS } from "@/lib/deals";
import { getDeal } from "@/lib/deal-workspace";
import NoteComposer from "@/components/NoteComposer";
import TaskAddForm from "@/components/TaskAddForm";
import TaskDoneButton from "@/components/TaskDoneButton";

export const metadata = { title: "Notes & History" };

const ACTIVITY_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  tour: "Tour",
  note: "Note",
  site_visit: "Site visit",
  other: "Other",
};
const ACTIVITY_ICONS: Record<string, any> = { call: Phone, email: Mail, meeting: Users, tour: MapPin, site_visit: Camera };

// System events worth a line in the human timeline, with plain-English labels.
const EVENT_LABELS: Record<string, (e: any) => string> = {
  deal_created: () => "Deal created",
  advanced_to_uw: () => `Moved to ${STAGE_LABELS.uw}`,
  marked_offered: () => `Moved to ${STAGE_LABELS.offered}`,
  confirmed_psa: () => `Moved to ${STAGE_LABELS.moving_to_psa}`,
  entered_due_diligence: () => `Moved to ${STAGE_LABELS.due_diligence}`,
  marked_closed: () => "Closed",
  stage_corrected: (e) => `Stage corrected${e.detail?.to ? ` to ${STAGE_LABELS[e.detail.to] ?? e.detail.to}` : ""}`,
  archived: (e) => `Archived${e.detail?.reason ? `: ${e.detail.reason}` : ""}`,
  restored: () => "Restored from archive",
  ic_deck_exported: () => "IC deck exported",
  offer_logged: () => "Offer logged",
};

type Item = { at: string; kind: "visit" | "note" | "stage"; title: string; who: string; body?: string; photos?: string[]; type?: string };

export default async function NotesPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string; new?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const [deal, activities, tasks, user] = await Promise.all([
    getDeal(id),
    listActivitiesForDeal(id),
    listOpenTasksForDeal(id),
    getCurrentUser(),
  ]);
  const filter = ["visits", "stage"].includes(sp.filter ?? "") ? sp.filter! : "all";

  // Signed, short-lived links for site-visit photos.
  const paths = (activities as any[]).flatMap((a) => a.photo_paths ?? []);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await getServiceClient().storage.from("documents").createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
  }

  const items: Item[] = [
    ...(activities as any[]).map((a) => ({
      at: a.occurred_at,
      kind: (a.activity_type === "site_visit" ? "visit" : "note") as Item["kind"],
      type: a.activity_type,
      title: `${ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}${a.subject && a.subject !== "Site visit" ? `: ${a.subject}` : ""}`,
      who: a.created_by,
      body: a.body ?? undefined,
      photos: (a.photo_paths ?? []).map((p: string) => signed.get(p)).filter(Boolean),
    })),
    ...((deal.deal_events ?? []) as any[])
      .filter((e) => EVENT_LABELS[e.event_type])
      .map((e) => ({ at: e.created_at, kind: "stage" as const, title: EVENT_LABELS[e.event_type](e), who: e.actor })),
  ]
    .filter((i) => filter === "all" || (filter === "visits" ? i.kind === "visit" : i.kind === "stage"))
    .sort((a, b) => b.at.localeCompare(a.at));

  const tab = (f: string, label: string) => (
    <a href={`/deals/${id}/notes${f === "all" ? "" : `?filter=${f}`}`} className={filter === f ? "tchip on" : "tchip"}>
      {label}
    </a>
  );

  return (
    <div className="ws-body">
      <NoteComposer dealId={id} initialType={sp.new} startOpen={!!sp.new} />
      <div className="sum-split">
        <div className="card">
          <div className="card-head">
            <span className="overline">Timeline</span>
            <span style={{ display: "flex", gap: 6 }}>
              {tab("all", "All")}
              {tab("visits", "Site visits")}
              {tab("stage", "Stage history")}
            </span>
          </div>
          {items.length ? (
            <ul className="timeline">
              {items.map((i, n) => {
                const Icon = i.kind === "stage" ? GitCommitHorizontal : ACTIVITY_ICONS[i.type ?? ""] ?? MessageSquare;
                return (
                  <li key={n} className="tl-item">
                    <span className={i.kind === "stage" ? "tl-ico stage" : "tl-ico"}>
                      <Icon size={16} color={i.kind === "stage" ? "#6B7A88" : "#0E5AA7"} strokeWidth={1.75} />
                    </span>
                    <div>
                      <div className="tl-head">{i.title}</div>
                      <div className="tl-meta">
                        {new Date(i.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · {i.who}
                      </div>
                      {i.body && <div className="tl-body">{i.body}</div>}
                      {!!i.photos?.length && (
                        <div className="photo-row">
                          {i.photos.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer">
                              <img src={u} alt="Site visit photo" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint" style={{ margin: 0 }}>Nothing here yet.</p>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <span className="overline">Follow-ups</span>
            {(tasks as any[]).length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>No open follow-ups on this deal.</p>
            ) : (
              <ul className="doc-list">
                {(tasks as any[]).map((t) => (
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
            <TaskAddForm dealId={id} defaultAssignee={user?.email} />
          </div>
          <div className="card">
            <span className="overline">Documents</span>
            {deal.documents?.length ? (
              <ul className="doc-list">
                {deal.documents.map((d: any) => (
                  <li key={d.id}>
                    <span className="doc-type">{d.doc_type.toUpperCase()}</span> {d.storage_path.split("/").pop()}
                    <span className="muted"> · {d.uploaded_by}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint" style={{ margin: 0 }}>No documents yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
