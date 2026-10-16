"use client";
// components/DiligencePanel.tsx
//
// The PSA / due-diligence schedule on the Diligence tab: every deadline with
// its date (editable), a done date, notes, and the files that satisfy it.
// Generated from the PSA effective date and the LOI's DD / closing periods;
// DD expiry and closing are the deal's own dates, so editing them here moves
// the board and the morning brief too.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type MilestoneRow = {
  id: string;
  key: string | null;
  label: string;
  due_on: string | null;
  done_on: string | null;
  notes: string | null;
  docs: { id: string; name: string }[];
};

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Save failed");
  return out;
}

export default function DiligencePanel({
  dealId,
  today,
  psaEffectiveOn,
  ddDaysDefault,
  closingDaysDefault,
  milestones,
}: {
  dealId: string;
  today: string;
  psaEffectiveOn: string | null;
  ddDaysDefault: number;
  closingDaysDefault: number;
  milestones: MilestoneRow[];
}) {
  const router = useRouter();
  const [psa, setPsa] = useState(psaEffectiveOn ?? "");
  const [ddDays, setDdDays] = useState(String(ddDaysDefault));
  const [closingDays, setClosingDays] = useState(String(closingDaysDefault));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newDue, setNewDue] = useState("");
  const [showSchedule, setShowSchedule] = useState(!milestones.length);

  async function run(tag: string, fn: () => Promise<unknown>) {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  const patch = (m: MilestoneRow, body: Record<string, unknown>) =>
    run(m.id, () => send(`/api/deals/${dealId}/milestones`, "PATCH", { milestoneId: m.id, ...body }));

  const generate = (recalc: boolean) =>
    run("generate", async () => {
      if (recalc && !confirm("Move every open milestone to the recalculated date? Done items and ones you added stay as they are.")) return;
      await send(`/api/deals/${dealId}/milestones`, "POST", { action: "generate", psaEffectiveOn: psa, ddDays, closingDays, recalc });
      setShowSchedule(false);
    });

  const open = milestones.filter((m) => !m.done_on);
  const overdue = open.filter((m) => m.due_on && m.due_on < today).length;
  const next = open.find((m) => m.due_on && m.due_on >= today);

  return (
    <section className="panel">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>PSA &amp; due diligence</h2>
        {milestones.length > 0 && (
          <button type="button" className="secondary" onClick={() => setShowSchedule((v) => !v)}>
            {showSchedule ? "Hide schedule settings" : "Recalculate…"}
          </button>
        )}
      </div>
      {milestones.length > 0 && (
        <p className="hint">
          {milestones.length - open.length} of {milestones.length} done
          {overdue ? <> · <span className="overdue">{overdue} overdue</span></> : null}
          {next?.due_on ? ` · next: ${next.label}, ${shortDate(next.due_on)} (${daysBetween(today, next.due_on)} days)` : ""}
        </p>
      )}

      {showSchedule && (
        <div className="inline-add-form" style={{ width: "100%" }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {milestones.length
              ? "Recalculating moves the open milestones to dates counted from these numbers."
              : "Enter the PSA effective date to lay out the diligence schedule. DD length and closing period come from the LOI; change them to match the signed PSA."}
          </p>
          <div className="grid-2">
            <label>
              PSA effective date
              <input type="date" value={psa} onChange={(e) => setPsa(e.target.value)} />
            </label>
            <label>
              Due diligence (days)
              <input inputMode="numeric" value={ddDays} onChange={(e) => setDdDays(e.target.value)} />
            </label>
            <label>
              Closing (days after DD)
              <input inputMode="numeric" value={closingDays} onChange={(e) => setClosingDays(e.target.value)} />
            </label>
          </div>
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" disabled={!psa || busy !== null} onClick={() => generate(milestones.length > 0)}>
              {busy === "generate" ? "Saving…" : milestones.length ? "Recalculate dates" : "Create schedule"}
            </button>
          </div>
        </div>
      )}

      {milestones.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="summary-table">
            <thead>
              <tr><th>Milestone</th><th>Due</th><th></th><th>Done</th><th>Files</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const days = m.due_on ? daysBetween(today, m.due_on) : null;
                const late = !m.done_on && days != null && days < 0;
                const soon = !m.done_on && days != null && days >= 0 && days <= 7;
                return (
                  <tr key={m.id} style={{ opacity: m.done_on ? 0.6 : 1 }}>
                    <td>{m.label}</td>
                    <td>
                      <input
                        type="date"
                        defaultValue={m.due_on ?? ""}
                        disabled={busy === m.id}
                        onBlur={(e) => { if ((e.target.value || null) !== m.due_on) void patch(m, { dueOn: e.target.value || null }); }}
                      />
                    </td>
                    <td>
                      {m.done_on ? "" : late ? <span className="overdue">{-days!} days late</span> : soon ? <strong>{days === 0 ? "Today" : `${days} days`}</strong> : days != null ? <span className="muted">{days} days</span> : ""}
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={!!m.done_on}
                          disabled={busy === m.id}
                          onChange={(e) => void patch(m, { doneOn: e.target.checked ? today : null })}
                        />
                        {m.done_on ? <span className="muted">{shortDate(m.done_on)}</span> : null}
                      </label>
                    </td>
                    <td>
                      {m.docs.length
                        ? m.docs.map((d) => (
                            <div key={d.id}><a href={`/api/deals/${dealId}/vault?doc=${d.id}`}>{d.name}</a></div>
                          ))
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <input
                        defaultValue={m.notes ?? ""}
                        placeholder="Add a note"
                        style={{ minWidth: 160 }}
                        disabled={busy === m.id}
                        onBlur={(e) => { if (e.target.value.trim() !== (m.notes ?? "")) void patch(m, { notes: e.target.value }); }}
                      />
                    </td>
                    <td>
                      {m.key !== "dd_end" && m.key !== "closing" && (
                        <button
                          type="button"
                          className="secondary"
                          title="Remove this milestone"
                          disabled={busy !== null}
                          onClick={() => {
                            if (confirm(`Remove "${m.label}"?`)) void run(m.id, () => send(`/api/deals/${dealId}/milestones`, "DELETE", { milestoneId: m.id }));
                          }}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {milestones.length > 0 && (
        <form
          className="stage-actions"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run("add", async () => {
              await send(`/api/deals/${dealId}/milestones`, "POST", { action: "add", label: newLabel, dueOn: newDue || null });
              setNewLabel("");
              setNewDue("");
            });
          }}
        >
          <input placeholder="Add a milestone, e.g. Extension deposit" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ minWidth: 260 }} />
          <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
          <button type="submit" className="secondary" disabled={!newLabel.trim() || busy !== null}>
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
