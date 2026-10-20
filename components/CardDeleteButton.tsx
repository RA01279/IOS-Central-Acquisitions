"use client";
// components/CardDeleteButton.tsx
//
// One-click permanent delete straight from a board card or archive row --
// no need to open the deal first. Native confirm() keeps it a single
// interaction; the full reload guarantees the list re-renders fresh.
//
// Given a portfolio instead of a deal, it deletes the whole package -- every
// site's deal and the portfolio -- under the same rules
// (/api/deal-portfolios/[id]); nothing goes if any site can't be deleted.

import { useState } from "react";

export default function CardDeleteButton({ dealId, portfolio }: { dealId?: string; portfolio?: { id: string; sites: number } }) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const question = portfolio
      ? `Permanently delete this portfolio and all ${portfolio.sites} of its deals, with their history? This cannot be undone.`
      : "Permanently delete this deal and all its history? This cannot be undone.";
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const url = portfolio ? `/api/deal-portfolios/${portfolio.id}` : `/api/deals/${dealId}`;
      const res = await fetch(url, { method: "DELETE" });
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
      title={portfolio ? "Delete the portfolio and its deals permanently" : "Delete permanently"}
    >
      {busy ? "…" : "×"}
    </button>
  );
}
