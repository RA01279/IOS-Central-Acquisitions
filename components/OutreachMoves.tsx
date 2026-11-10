"use client";
// components/OutreachMoves.tsx
//
// The two ways out of Outreach, on the Outreach page and an Outreach deal's
// Summary:
//   * Move to pipeline -- the owner will entertain an offer: the deal becomes a
//     Prospect on the board (PATCH /api/deals/[id] move_to_pipeline).
//   * Park as target   -- not selling (yet): archived as a scored Target with a
//     follow-up date (POST /api/deals/[id]/archive). Restoring it later brings
//     it back to Outreach, where it died.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "@/lib/outreach";

export default function OutreachMoves({ dealId, today, emphasis = false, defaultFollowUp }: { dealId: string; today: string; emphasis?: boolean; defaultFollowUp?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parking, setParking] = useState(false);
  const [reason, setReason] = useState("Owner not selling right now");
  const [score, setScore] = useState("3");
  const [followUp, setFollowUp] = useState(defaultFollowUp && defaultFollowUp > today ? defaultFollowUp : addDays(today, 182));

  async function moveToPipeline() {
    setBusy("move");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move_to_pipeline" }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not move it");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function park(e: React.FormEvent) {
    e.preventDefault();
    setBusy("park");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", reason, disposition: "not_selling", pursuitScore: Number(score), followUpOn: score !== "0" && followUp ? followUp : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not park it");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="outreach-moves">
      {!parking ? (
        <div className="outreach-moves-row">
          <button type="button" onClick={moveToPipeline} disabled={busy !== null} className={emphasis ? undefined : "secondary"}>
            {busy === "move" ? "Moving…" : "Owner interested: move to pipeline"}
          </button>
          <button type="button" className="secondary" onClick={() => setParking(true)} disabled={busy !== null}>Park as target</button>
        </div>
      ) : (
        <form onSubmit={park} className="outreach-park">
          <label>Why
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} />
          </label>
          <label>Target score
            <select value={score} onChange={(e) => setScore(e.target.value)}>
              <option value="5">5 — Must have</option>
              <option value="4">4 — Want it</option>
              <option value="3">3 — Would take it</option>
              <option value="2">2 — Marginal</option>
              <option value="1">1 — Only at a steal</option>
              <option value="0">0 — Never a target</option>
            </select>
          </label>
          {score !== "0" ? (
            <label>Check back on
              <input type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </label>
          ) : null}
          <div className="outreach-moves-row">
            <button type="submit" disabled={busy !== null || !reason.trim()}>{busy === "park" ? "Parking…" : "Park on Targets"}</button>
            <button type="button" className="secondary" onClick={() => setParking(false)}>Cancel</button>
          </div>
        </form>
      )}
      {error ? <p className="error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
    </div>
  );
}
