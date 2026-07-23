"use client";
// components/StageActions.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StageActions({
  dealId,
  stage,
  canConfirmPsa,
}: {
  dealId: string;
  stage: string;
  canConfirmPsa: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  async function callAction(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Action failed");
      }
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
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Archive failed");
      }
      // Hard navigation: bypasses the client router cache so the board
      // re-renders fresh and the archived deal is gone immediately.
      window.location.assign("/deals");
    } catch (err: any) {
      setError(err.message);
      setBusy(null);
    }
  }

  return (
    <div className="stage-actions">
      {stage === "prospect" && (
        <p className="hint" style={{ margin: 0 }}>
          Upload an underwriting model below to move this deal into UW.
        </p>
      )}

      {(stage === "uw" || stage === "uw_v1") && (
        <button onClick={() => callAction("mark_offered")} disabled={busy !== null}>
          {busy === "mark_offered" ? "Marking…" : "Mark Offered"}
        </button>
      )}

      {stage === "offered" && (
        <button
          onClick={() => callAction("confirm_psa")}
          disabled={busy !== null || !canConfirmPsa}
          title={canConfirmPsa ? "" : "Only Rhett/John can confirm this"}
        >
          {busy === "confirm_psa" ? "Confirming…" : "Confirm Moving to PSA"}
        </button>
      )}

      {stage === "moving_to_psa" && (
        <button onClick={() => callAction("move_to_due_diligence")} disabled={busy !== null}>
          {busy === "move_to_due_diligence" ? "Moving…" : "PSA executed → Due Diligence"}
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
