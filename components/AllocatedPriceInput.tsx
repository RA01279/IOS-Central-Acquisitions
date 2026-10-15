"use client";
// components/AllocatedPriceInput.tsx
//
// A portfolio site's allocated price, edited in place on the portfolio page.
// Saves on Enter or when the box loses focus, re-scores the site's Basis
// flag, and refreshes the page so the totals follow.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AllocatedPriceInput({ dealId, price }: { dealId: string; price: number | null }) {
  const router = useRouter();
  const initial = price != null ? Math.round(price).toLocaleString("en-US") : "";
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function save() {
    if (value.trim() === initial) return;
    setState("saving");
    setMsg("");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_milestones", askingPrice: value.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setState("saved");
      // The Basis flag compares price per acre with the comps; keep it current.
      void fetch(`/api/deals/${dealId}/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      }).catch(() => {});
      router.refresh();
    } catch (e: any) {
      setState("error");
      setMsg(e.message);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        aria-label="Allocated price"
        value={value}
        inputMode="numeric"
        placeholder="$ price"
        disabled={state === "saving"}
        style={{ width: 120 }}
        onChange={(e) => { setValue(e.target.value); setState("idle"); }}
        onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      />
      {state === "saving" && <span className="muted">…</span>}
      {state === "saved" && <span className="muted">✓</span>}
      {state === "error" && <span className="error" title={msg}>!</span>}
    </span>
  );
}
