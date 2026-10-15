"use client";
// components/ExitCapForm.tsx
//
// The exit cap the comp-based income value divides by. Blank falls back to
// the uploaded model's exit cap.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ExitCapForm({ dealId, exitCap, modelExitCap }: {
  dealId: string;
  /** Saved for this deal, as a fraction. */
  exitCap: number | null;
  /** From the latest uploaded model, as a fraction. */
  modelExitCap: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("cap");
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_milestones", exitCapPct: value }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setMsg("Saved.");
      router.refresh();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ marginBottom: 0 }}>
        Exit cap (%)
        <input
          name="cap"
          inputMode="decimal"
          defaultValue={exitCap !== null ? +(exitCap * 100).toFixed(3) : ""}
          placeholder={modelExitCap !== null ? `${+(modelExitCap * 100).toFixed(2)} (model)` : "e.g. 6.5"}
          style={{ width: 140 }}
        />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save exit cap"}</button>
      <span className="hint" style={{ margin: 0 }}>
        {msg || (exitCap !== null ? "Set for this deal. Clear it to use the model's." : modelExitCap !== null ? "Using the model's exit cap." : "No exit cap yet.")}
      </span>
    </form>
  );
}
