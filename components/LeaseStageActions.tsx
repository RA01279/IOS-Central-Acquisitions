"use client";
// components/LeaseStageActions.tsx
//
// Leasing pipeline controls: advance to the next stage, or archive with a
// reason. Mirrors StageActions (acquisitions) but drives the leasing flow
// (prospect -> tour -> proposal -> negotiation -> executed) via the
// set_lease_stage action. No PSA-style role gate -- a signed lease is
// confirmed by document, not by an allowlist.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LeaseStageActions({
  dealId,
  stage,
  nextStage,
  nextStageLabel,
  prevStage,
  prevStageLabel,
}: {
  dealId: string;
  stage: string;
  nextStage: string | null;
  nextStageLabel: string | null;
  prevStage?: string | null;
  prevStageLabel?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  async function moveTo(toStage: string | null, busyKey: string) {
    if (!toStage) return;
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_lease_stage", toStage }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Action failed");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive() {
    setBusy("archive");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", stage, reason: archiveReason }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Archive failed");
      // Hard navigation: bypasses the client router cache so the board
      // re-renders fresh and the archived deal is gone immediately.
      window.location.assign("/leasing");
    } catch (err: any) {
      setError(err.message);
      setBusy(null);
    }
  }

  return (
    <div className="stage-actions">
      {nextStage && (
        <button onClick={() => moveTo(nextStage, "advance")} disabled={busy !== null}>
          {busy === "advance" ? "Advancing…" : `Advance to ${nextStageLabel}`}
        </button>
      )}

      {prevStage && stage !== "archived" && (
        <button
          className="secondary"
          onClick={() => moveTo(prevStage, "back")}
          disabled={busy !== null}
          title="Correct an accidental advance"
        >
          {busy === "back" ? "Moving…" : `‹ Back to ${prevStageLabel}`}
        </button>
      )}

      {stage !== "archived" && (
        <>
          {!showArchive ? (
            <button className="secondary" onClick={() => setShowArchive(true)}>
              Archive
            </button>
          ) : (
            <div className="archive-panel">
              <input
                placeholder="Reason (short)"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
              />
              <button onClick={handleArchive} disabled={busy !== null}>
                {busy === "archive" ? "Archiving…" : "Confirm archive"}
              </button>
              <button className="secondary" onClick={() => setShowArchive(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
