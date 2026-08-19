"use client";
// components/StageActions.tsx
//
// The forward/back moves available at each stage, plus archiving.
//
// Two transitions ask for dates rather than just firing, because those dates
// are what the morning brief warns on and the home screen counts:
//   * -> Due Diligence  asks for the DD expiry and target closing date
//   * -> Closed         asks for the actual closing date
// Both prefill (DD/closing from the deal, closing date from today) so the
// common case is one extra Enter, not a data-entry chore.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StageActions({
  dealId,
  stage,
  canConfirmPsa,
  prevStage,
  prevStageLabel,
  ddEndOn,
  closingOn,
}: {
  dealId: string;
  stage: string;
  canConfirmPsa: boolean;
  prevStage?: string | null;
  prevStageLabel?: string | null;
  ddEndOn?: string | null;
  closingOn?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [disposition, setDisposition] = useState("");
  const [pursuitScore, setPursuitScore] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");

  // -> Due Diligence
  const [showDd, setShowDd] = useState(false);
  const [ddEnd, setDdEnd] = useState(ddEndOn ?? "");
  const [closing, setClosing] = useState(closingOn ?? "");

  // -> Closed
  const [showClose, setShowClose] = useState(false);
  const [closedOn, setClosedOn] = useState(new Date().toISOString().slice(0, 10));

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
      setShowDd(false);
      setShowClose(false);
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
        body: JSON.stringify({
          action: "archive",
          stage,
          reason: archiveReason,
          disposition: disposition || undefined,
          pursuitScore: pursuitScore === "" ? undefined : Number(pursuitScore),
          followUpOn: pursuitScore !== "0" && followUpOn ? followUpOn : undefined,
        }),
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

      {stage === "moving_to_psa" &&
        (!showDd ? (
          <button onClick={() => setShowDd(true)} disabled={busy !== null}>
            PSA executed → Due Diligence
          </button>
        ) : (
          <div className="inline-add-form" style={{ width: "100%" }}>
            <p className="hint">
              These two dates drive the 7-day reminder in the morning brief. Leave either blank if
              it isn't set yet — you can fill it in later from Edit details.
            </p>
            <div className="grid-2">
              <label>
                DD expires
                <input type="date" value={ddEnd} onChange={(e) => setDdEnd(e.target.value)} />
              </label>
              <label>
                Target closing
                <input type="date" value={closing} onChange={(e) => setClosing(e.target.value)} />
              </label>
            </div>
            <div className="stage-actions" style={{ marginBottom: 0 }}>
              <button
                onClick={() =>
                  callAction("move_to_due_diligence", {
                    ddEndOn: ddEnd || null,
                    closingOn: closing || null,
                  })
                }
                disabled={busy !== null}
              >
                {busy === "move_to_due_diligence" ? "Moving…" : "Enter Due Diligence"}
              </button>
              <button type="button" className="secondary" onClick={() => setShowDd(false)}>
                Cancel
              </button>
            </div>
          </div>
        ))}

      {stage === "due_diligence" &&
        (!showClose ? (
          <button onClick={() => setShowClose(true)} disabled={busy !== null}>
            Closed →
          </button>
        ) : (
          <div className="inline-add-form" style={{ width: "100%" }}>
            <label>
              Closing date
              <input
                type="date"
                value={closedOn}
                onChange={(e) => setClosedOn(e.target.value)}
                required
              />
            </label>
            <div className="stage-actions" style={{ marginBottom: 0 }}>
              <button
                onClick={() => callAction("mark_closed", { closedOn })}
                disabled={busy !== null || !closedOn}
              >
                {busy === "mark_closed" ? "Closing…" : "Mark Closed"}
              </button>
              <button type="button" className="secondary" onClick={() => setShowClose(false)}>
                Cancel
              </button>
            </div>
          </div>
        ))}

      {prevStage && stage !== "archived" && (
        <button
          className="secondary"
          onClick={() => callAction("set_acq_stage", { toStage: prevStage })}
          disabled={busy !== null}
          title="Correct an accidental advance"
        >
          {busy === "set_acq_stage" ? "Moving…" : `‹ Back to ${prevStageLabel}`}
        </button>
      )}

      {stage !== "archived" && (
        <>
          {!showArchive ? (
            <button className="secondary" onClick={() => setShowArchive(true)}>
              Archive
            </button>
          ) : (
            <div className="inline-add-form" style={{ width: "100%" }}>
              <div className="grid-2">
                <label>
                  Reason
                  <input
                    placeholder="e.g. seller not ready, lost to another buyer"
                    value={archiveReason}
                    onChange={(e) => setArchiveReason(e.target.value)}
                  />
                </label>
                <label>
                  Why it's parked
                  <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                    <option value="">—</option>
                    <option value="not_selling">Not selling (yet)</option>
                    <option value="lost">Lost to another buyer</option>
                    <option value="passed">We passed</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Target score
                  <select value={pursuitScore} onChange={(e) => setPursuitScore(e.target.value)}>
                    <option value="">— unscored —</option>
                    <option value="5">5 — Must have (white whale)</option>
                    <option value="4">4 — Want it</option>
                    <option value="3">3 — Would take it</option>
                    <option value="2">2 — Marginal</option>
                    <option value="1">1 — Only at a steal</option>
                    <option value="0">0 — Never a target</option>
                  </select>
                </label>
                {pursuitScore !== "0" && (
                  <label>
                    Follow up on
                    <input
                      type="date"
                      value={followUpOn}
                      onChange={(e) => setFollowUpOn(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="stage-actions" style={{ marginBottom: 0 }}>
                <button onClick={handleArchive} disabled={busy !== null}>
                  {busy === "archive" ? "Archiving…" : "Confirm archive"}
                </button>
                <button className="secondary" onClick={() => setShowArchive(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
