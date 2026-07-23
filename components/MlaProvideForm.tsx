"use client";
// components/MlaProvideForm.tsx
//
// Shown when a deal's mla_status is "requested" -- whoever gets the
// market lead's reply keys the numbers in here. Fields match the real
// "MLA - Base Case" tab from the underwriting model, not a guess.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MlaProvideForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const num = (key: string) => (form.get(key) ? Number(form.get(key)) : undefined);

    const payload = {
      action: "provide_mla",
      marketBaseRent: num("marketBaseRent"),
      termYears: num("termYears"),
      termMonths: num("termMonths"),
      renewalProbability: num("renewalProbability"),
      monthsVacant: num("monthsVacant"),
      freeRentMonths: num("freeRentMonths"),
      tiNew: num("tiNew"),
      tiRenew: num("tiRenew"),
      lcNewPct: num("lcNewPct"),
      lcRenewPct: num("lcRenewPct"),
      recoveryType: form.get("recoveryType") || undefined,
    };

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save MLA");
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mla-form">
      <p className="hint">Market lead replied — enter the assumptions below.</p>
      <div className="grid-2">
        <label>
          Market base rent ($/SF/mo)
          <input name="marketBaseRent" type="number" step="0.01" />
        </label>
        <label>
          Recovery type
          <input name="recoveryType" placeholder="e.g. Continue Prior" />
        </label>
        <label>
          Term (years)
          <input name="termYears" type="number" step="0.1" />
        </label>
        <label>
          Term (months, if partial)
          <input name="termMonths" type="number" />
        </label>
        <label>
          Renewal probability (0–1)
          <input name="renewalProbability" type="number" step="0.01" min="0" max="1" />
        </label>
        <label>
          Months vacant (blended)
          <input name="monthsVacant" type="number" step="0.1" />
        </label>
        <label>
          Free rent (months, blended)
          <input name="freeRentMonths" type="number" step="0.1" />
        </label>
        <label>
          TI — new ($)
          <input name="tiNew" type="number" />
        </label>
        <label>
          TI — renew ($)
          <input name="tiRenew" type="number" />
        </label>
        <label>
          LC — new (%)
          <input name="lcNewPct" type="number" step="0.001" />
        </label>
        <label>
          LC — renew (%)
          <input name="lcRenewPct" type="number" step="0.001" />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save MLA"}
      </button>
    </form>
  );
}
