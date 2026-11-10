"use client";
// components/TouchForm.tsx
//
// Log one owner-outreach touch (call, email, letter...), what came of it, and
// when to follow up -- a quick-pick date or none. Saving replaces the deal's
// follow-up reminder (app/api/deals/[id]/outreach). Used on the Outreach page
// and on an off-market deal's Summary.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FOLLOW_UPS, OUTCOMES, OUTCOME_LABELS, TOUCH_LABELS, TOUCH_TYPES, addDays, type Outcome, type TouchType } from "@/lib/outreach";

// The follow-up a given outcome usually calls for, preselected (one click to change).
const SUGGESTED_DAYS: Partial<Record<Outcome, number | null>> = {
  no_answer: 3, left_message: 7, spoke: 14, interested: 3, not_now: 91, not_selling: 182, wrong_contact: null,
};

export default function TouchForm({ dealId, today, onDone }: { dealId: string; today: string; onDone?: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<TouchType>("call");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [nextOn, setNextOn] = useState<string>(addDays(today, 7));
  const [picked, setPicked] = useState<number | "custom" | "none">(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(days: number | "none") {
    setPicked(days);
    setNextOn(days === "none" ? "" : addDays(today, days));
  }
  function chooseOutcome(o: Outcome | "") {
    setOutcome(o);
    const d = o ? SUGGESTED_DAYS[o] : undefined;
    if (d === null) pick("none");
    else if (typeof d === "number") pick(d);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, outcome: outcome || null, note, occurredOn, nextOn: picked === "none" ? null : nextOn || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setNote("");
      setOutcome("");
      onDone?.();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="touch-form" onSubmit={save}>
      <div className="touch-row">
        <span className="touch-label">How</span>
        <div className="touch-chips">
          {TOUCH_TYPES.map((t) => (
            <button key={t} type="button" className={type === t ? "chip chip-active" : "chip"} onClick={() => setType(t)}>{TOUCH_LABELS[t]}</button>
          ))}
        </div>
      </div>
      <div className="touch-row">
        <span className="touch-label">Result</span>
        <div className="touch-chips">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className={outcome === o ? "chip chip-active" : "chip"} onClick={() => chooseOutcome(outcome === o ? "" : o)}>{OUTCOME_LABELS[o]}</button>
          ))}
        </div>
      </div>
      <div className="touch-row">
        <span className="touch-label">Notes</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was said, who you spoke to, anything to remember next time" maxLength={4000} />
      </div>
      <div className="touch-row">
        <span className="touch-label">Next touch</span>
        <div className="touch-chips">
          {FOLLOW_UPS.map((f) => (
            <button key={f.days} type="button" className={picked === f.days ? "chip chip-active" : "chip"} onClick={() => pick(f.days)}>{f.label}</button>
          ))}
          <input
            type="date"
            aria-label="Follow-up date"
            min={today}
            value={picked === "none" ? "" : nextOn}
            onChange={(e) => { setNextOn(e.target.value); setPicked("custom"); }}
            className={picked === "custom" ? "touch-date on" : "touch-date"}
          />
          <button type="button" className={picked === "none" ? "chip chip-active" : "chip"} onClick={() => pick("none")}>No follow-up</button>
        </div>
      </div>
      <div className="touch-actions">
        <label className="touch-when">
          Touch date
          <input type="date" max={today} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value || today)} />
        </label>
        <span style={{ flex: 1 }} />
        {error ? <span className="error" style={{ margin: 0 }}>{error}</span> : null}
        <button type="submit" disabled={busy}>{busy ? "Saving…" : picked === "none" ? "Log touch" : "Log touch & set reminder"}</button>
      </div>
    </form>
  );
}
