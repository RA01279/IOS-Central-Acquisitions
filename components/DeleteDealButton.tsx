"use client";
// components/DeleteDealButton.tsx
//
// Permanent delete, for cleaning up duplicate/test deals. Two-step confirm
// so a stray click can't destroy anything. Archiving is still the right
// move for real deals that die -- delete is for rows that should never
// have existed.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteDealButton({
  dealId,
  redirectTo,
}: {
  dealId: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      router.push(redirectTo);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="danger-zone">
      {!confirming ? (
        <button type="button" className="danger-link" onClick={() => setConfirming(true)}>
          Delete this deal (duplicate / entered in error)
        </button>
      ) : (
        <div className="stage-actions" style={{ marginBottom: 0 }}>
          <span className="error">Permanently delete this deal and its history? This cannot be undone.</span>
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete forever"}
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
