"use client";
// components/MarketReportDelete.tsx -- remove a market report (its statistics and PDF go with it).

import { useRouter } from "next/navigation";

export default function MarketReportDelete({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      title="Remove this report"
      onClick={async () => {
        if (!confirm(`Remove ${label}? Its statistics and PDF are deleted too.`)) return;
        const res = await fetch("/api/market-reports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
        router.refresh();
      }}
    >
      ×
    </button>
  );
}
