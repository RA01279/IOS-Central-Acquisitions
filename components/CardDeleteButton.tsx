"use client";
// components/CardDeleteButton.tsx
//
// One-click permanent delete straight from a board card or archive row --
// no need to open the deal first. Native confirm() keeps it a single
// interaction; the full reload guarantees the list re-renders fresh.

import { useState } from "react";

export default function CardDeleteButton({ dealId }: { dealId: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Permanently delete this deal and all its history? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error ?? "Delete failed");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      window.alert("Delete failed");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="card-delete"
      onClick={handleClick}
      disabled={busy}
      title="Delete permanently"
    >
      {busy ? "…" : "×"}
    </button>
  );
}
