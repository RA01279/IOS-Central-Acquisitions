"use client";
// components/OutreachQueue.tsx
//
// The Outreach page's work queue: deals in the Outreach stage, in tabs (due now, not
// contacted yet, upcoming, no next step, warm, not selling), each row showing
// the owner with click-to-call / email, where outreach stands, the last touch
// and the next one. "Log touch" opens the touch form and the history inline.

import { useMemo, useState } from "react";
import TouchForm from "./TouchForm";
import OutreachMoves from "./OutreachMoves";
import { OUTCOME_LABELS, STATUS_LABELS, STATUS_TONE, TOUCH_LABELS } from "@/lib/outreach";
import type { OutreachRow } from "@/lib/outreach-db";

type Tab = "due" | "new" | "upcoming" | "nonext" | "warm" | "dead" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "due", label: "Due now" },
  { key: "new", label: "Not contacted" },
  { key: "upcoming", label: "Upcoming" },
  { key: "nonext", label: "No next step" },
  { key: "warm", label: "Interested / talking" },
  { key: "dead", label: "Not selling" },
  { key: "all", label: "All" },
];

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const short = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const ctDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ago = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`);

export default function OutreachQueue({ rows, today, initialTab }: { rows: OutreachRow[]; today: string; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const match: Record<Tab, (r: OutreachRow) => boolean> = {
    due: (r) => !!r.nextOn && r.nextOn <= today && r.status !== "not_selling",
    new: (r) => r.status === "new",
    upcoming: (r) => !!r.nextOn && r.nextOn > today,
    nonext: (r) => r.status !== "new" && !r.nextOn && r.status !== "not_selling",
    warm: (r) => r.status === "interested" || r.status === "talking",
    dead: (r) => r.status === "not_selling",
    all: () => true,
  };
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter(match[t.key]).length])) as Record<Tab, number>, [rows, today]);
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter(match[tab])
    .filter((r) => !needle || [r.address, r.city, r.market, r.owner?.name].some((x) => (x ?? "").toLowerCase().includes(needle)))
    .sort((a, b) =>
      tab === "new" ? b.addedOn.localeCompare(a.addedOn)
      : (a.nextOn ?? "9999").localeCompare(b.nextOn ?? "9999") || (b.touches[0]?.occurred_at ?? "").localeCompare(a.touches[0]?.occurred_at ?? ""));

  return (
    <section className="panel" id="queue">
      <div className="broker-toolbar">
        <div className="broker-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? "tchip on" : "tchip"} onClick={() => { setTab(t.key); setOpen(null); }}>
              {t.label} <span className="tchip-count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <input type="search" className="outreach-search" placeholder="Search address, owner, market" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prospects" />
      </div>

      {shown.length === 0 ? (
        <p className="hint">
          {tab === "due" ? "Nothing due. Every prospect with a follow-up is scheduled ahead." : tab === "new" ? "Every prospect has been contacted at least once." : "No prospects here."}
        </p>
      ) : (
        <ul className="outreach-list">
          {shown.map((r) => {
            const last = r.touches[0];
            const late = r.nextOn ? days(r.nextOn, today) : null;
            return (
              <li key={r.dealId} className={open === r.dealId ? "outreach-item open" : "outreach-item"}>
                <div className="outreach-main">
                  <div className="outreach-where">
                    <a href={`/deals/${r.dealId}`} className="broker-name">{r.address}</a>
                    <span className="broker-sub">
                      {[r.city, r.market].filter(Boolean).join(" · ")}
                      {r.acres ? ` · ${r.acres.toFixed(r.acres >= 10 ? 0 : 1)} ac` : ""}
                      {r.stage !== "prospect" ? ` · ${r.stage === "uw" ? "In UW" : r.stage.replace(/_/g, " ")}` : ""}
                    </span>
                  </div>
                  <div className="outreach-owner">
                    <span className="outreach-owner-name">{r.owner ? <a href={`/contacts/${r.owner.id}`}>{r.owner.name}</a> : <span className="muted">Owner not on file</span>}</span>
                    <span className="broker-sub">
                      {r.owner?.phone ? <a href={`tel:${r.owner.phone.replace(/[^\d+]/g, "")}`}>{r.owner.phone}</a> : null}
                      {r.owner?.phone && r.owner?.email ? " · " : null}
                      {r.owner?.email ? <a href={`mailto:${r.owner.email}`}>{r.owner.email}</a> : null}
                      {r.owner && !r.owner.phone && !r.owner.email ? "No phone or email yet" : null}
                    </span>
                  </div>
                  <div className="outreach-status">
                    <span className={`badge2 ${STATUS_TONE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    <span className="broker-sub">
                      {r.touches.length ? `${r.touches.length} touch${r.touches.length === 1 ? "" : "es"}` : "No touches yet"}
                    </span>
                  </div>
                  <div className="outreach-last">
                    {last ? (
                      <>
                        <span>{TOUCH_LABELS[last.activity_type] ?? last.activity_type}{last.outcome ? ` · ${OUTCOME_LABELS[last.outcome] ?? last.outcome}` : ""}</span>
                        <span className="broker-sub">{ago(days(ctDate(last.occurred_at), today))}{last.created_by ? ` · ${last.created_by.split("@")[0]}` : ""}</span>
                      </>
                    ) : <span className="muted">Added {short(r.addedOn)}</span>}
                  </div>
                  <div className="outreach-next">
                    {r.nextOn ? (
                      <>
                        <span className={late != null && late > 0 ? "overdue" : late === 0 ? "outreach-today" : undefined}>
                          {late === 0 ? "Today" : short(r.nextOn)}
                        </span>
                        <span className="broker-sub">{late != null && late > 0 ? `${late}d overdue` : late != null && late < 0 ? `in ${-late}d` : "due"}</span>
                      </>
                    ) : <span className="muted">No follow-up</span>}
                  </div>
                  <button type="button" className={open === r.dealId ? "secondary" : undefined} onClick={() => setOpen(open === r.dealId ? null : r.dealId)}>
                    {open === r.dealId ? "Close" : "Log touch"}
                  </button>
                </div>
                {open === r.dealId ? (
                  <div className="outreach-detail">
                    <TouchForm dealId={r.dealId} today={today} onDone={() => setOpen(null)} />
                    <div className="outreach-history">
                      <OutreachMoves dealId={r.dealId} today={today} emphasis={r.status === "interested" || r.status === "talking"} defaultFollowUp={r.nextOn} />
                    {r.touches.length ? (
                      <div>
                        <h3 className="report-sub" style={{ marginTop: 0 }}>History</h3>
                        <ul>
                          {r.touches.slice(0, 8).map((t) => (
                            <li key={t.id}>
                              <span className="muted">{short(ctDate(t.occurred_at))}</span>{" "}
                              <strong>{TOUCH_LABELS[t.activity_type] ?? t.activity_type}</strong>
                              {t.outcome ? ` · ${OUTCOME_LABELS[t.outcome] ?? t.outcome}` : ""}
                              {t.body ? <div className="muted">{t.body}</div> : null}
                            </li>
                          ))}
                        </ul>
                        {r.touches.length > 8 ? <a href={`/deals/${r.dealId}`} className="muted">All {r.touches.length} on the deal</a> : null}
                      </div>
                    ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
