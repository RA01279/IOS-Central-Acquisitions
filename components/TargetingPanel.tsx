"use client";
// components/TargetingPanel.tsx
//
// Scoring for archived deals -- the target repository. Why the deal is
// parked, how badly we want it (1-5), and when to re-approach the owner.
// Shows on archived acquisition deal pages; results drive /targets.

import { useState } from "react";
import { useRouter } from "next/navigation";

const DISPOSITIONS = [
  { value: "", label: "—" },
  { value: "not_selling", label: "Not selling (yet)" },
  { value: "lost", label: "Lost to another buyer" },
  { value: "passed", label: "We passed" },
  { value: "other", label: "Other" },
];

const SCORES = [
  { value: "", label: "—" },
  { value: "5", label: "5 — Must have (white whale)" },
  { value: "4", label: "4 — Want it" },
  { value: "3", label: "3 — Would take it" },
  { value: "2", label: "2 — Marginal" },
  { value: "1", label: "1 — Only at a steal" },
];

export default function TargetingPanel({
  dealId,
  disposition,
  pursuitScore,
  followUpOn,
}: {
  dealId: string;
  disposition: string | null;
  pursuitScore: number | null;
  followUpOn: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_targeting",
          disposition: form.get("disposition") || null,
          pursuitScore: form.get("pursuitScore") ? Number(form.get("pursuitScore")) : null,
          followUpOn: form.get("followUpOn") || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Target scoring</h2>
      <p className="hint">
        Score this parked deal so it shows on the <a href="/targets">Targets</a> list — and set a
        date to re-approach the owner.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          <label>
            Why it's parked
            <select name="disposition" defaultValue={disposition ?? ""}>
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            How badly we want it
            <select name="pursuitScore" defaultValue={pursuitScore?.toString() ?? ""}>
              {SCORES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Follow up on
            <input name="followUpOn" type="date" defaultValue={followUpOn ?? ""} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="stage-actions" style={{ marginBottom: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save scoring"}
          </button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </form>
    </section>
  );
}
