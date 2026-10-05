"use client";
// components/NextDates.tsx
//
// "Next dates" on the deal summary: LOI response, IC presentation, Phase I,
// plus the DD and closing dates the stage moves already record and any open
// follow-ups with a due date. Within a week turns amber, past due turns red.
// Edit sets the three dates that have no other home in the app.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { daysUntil, fmtShortDate } from "@/lib/format";

export interface DateRow {
  label: string;
  date: string | null;
  /** Shown when there's no date ("Pending", "Not set"). */
  empty?: string;
  /** Something that already happened (Phase I ordered): never "late". */
  event?: boolean;
}

export default function NextDates({
  dealId,
  today,
  rows,
  editable,
}: {
  dealId: string;
  today: string;
  rows: DateRow[];
  editable: { icOn: string | null; loiResponseDueOn: string | null; phase1OrderedOn: string | null };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_milestones",
          loiResponseDueOn: f.get("loi") || null,
          icOn: f.get("ic") || null,
          phase1OrderedOn: f.get("p1") || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...rows].sort((a, b) => (a.event ? "9998" : a.date ?? "9999").localeCompare(b.event ? "9998" : b.date ?? "9999"));

  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="card-head">
        <span className="overline">Next dates</span>
        <button type="button" className="link-caps" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {editing ? (
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <label>
            LOI response due
            <input type="date" name="loi" defaultValue={editable.loiResponseDueOn ?? ""} />
          </label>
          <label>
            IC presentation
            <input type="date" name="ic" defaultValue={editable.icOn ?? ""} />
          </label>
          <label>
            Phase I ordered
            <input type="date" name="p1" defaultValue={editable.phase1OrderedOn ?? ""} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save dates"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      ) : sorted.length ? (
        sorted.map((r) => {
          const d = r.date && !r.event ? daysUntil(r.date, today) : null;
          const color = r.event && r.date ? "#0A2540" : d == null ? "#6B7A88" : d < 0 ? "#C0392B" : d <= 7 ? "#C9862B" : "#0A2540";
          return (
            <div key={r.label} className="dates-row">
              <span>{r.label}</span>
              <span className="mono" style={{ color }}>
                {r.date ? `${fmtShortDate(r.date)}${d != null && d >= 0 && d <= 7 ? ` · ${d}d` : d != null && d < 0 ? ` · ${-d}d late` : ""}` : r.empty ?? "Not set"}
              </span>
            </div>
          );
        })
      ) : (
        <p className="hint" style={{ margin: 0 }}>Nothing scheduled.</p>
      )}
    </div>
  );
}
