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
}: {
  dealId: string;
  stage: string;
  nextStage: string | null;
  nextStageLabel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  async function advance() {
    if (!nextStage) return;
    setBusy("advance");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_lease_stage", toStage: nextStage }),
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
      router.push("/leasing");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(null);
    }
  }

  return (
    <div className="stage-actions">
      {nextStage && (
        <button onClick={advance} disabled={busy !== null}>
          {busy === "advance" ? "Advancing…" : `Advance to ${nextStageLabel}`}
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
