"use client";
// components/RestoreDealButton.tsx
//
// Reopens an archived deal -- e.g. a "not selling" target whose owner is
// finally ready. Returns the deal to the stage it died at (server decides).

import { useState } from "react";

export default function RestoreDealButton({ dealId }: { dealId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Restore failed");
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <span style={{ marginLeft: 10 }}>
      <button type="button" className="secondary" onClick={restore} disabled={busy}>
        {busy ? "Reopening…" : "Reopen deal"}
      </button>
      {error && <span className="error"> {error}</span>}
    </span>
  );
}
