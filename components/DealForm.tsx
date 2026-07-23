"use client";
// components/DealForm.tsx
//
// The single intake point for v1. MLA status drives which fields show:
// - "provided": asking rent / opex fields open inline
// - "requested": no extra fields -- notifies the market lead on submit
// - "assumed": no extra fields -- analyst proceeds on their own judgment

import { useState } from "react";
import { useRouter } from "next/navigation";

type MlaChoice = "provided" | "requested" | "assumed";

export default function DealForm() {
  const router = useRouter();
  const [mlaChoice, setMlaChoice] = useState<MlaChoice>("requested");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const mla =
      mlaChoice === "provided"
        ? {
            status: "provided" as const,
            askingRent: Number(form.get("askingRent")),
            opex: form.get("opex") ? Number(form.get("opex")) : undefined,
          }
        : { status: mlaChoice };

    const payload = {
      address: form.get("address"),
      market: form.get("market"),
      assetType: form.get("assetType"),
      lotSf: form.get("lotSf") ? Number(form.get("lotSf")) : undefined,
      buildingSf: form.get("buildingSf") ? Number(form.get("buildingSf")) : undefined,
      sourceBrokerId: form.get("sourceBrokerId") || undefined,
      mla,
    };

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create deal");
      }
      const { deal } = await res.json();
      router.push(`/deals/${deal.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="deal-form">
      <label>
        Property address
        <input name="address" required />
      </label>

      <label>
        Market
        <input name="market" />
      </label>

      <label>
        Asset type
        <select name="assetType" defaultValue="ios">
          <option value="ios">IOS</option>
          <option value="industrial">Industrial</option>
          <option value="flex">Flex</option>
          <option value="other">Other</option>
        </select>
      </label>

      <div className="grid-2">
        <label>
          Lot SF
          <input name="lotSf" type="number" />
        </label>
        <label>
          Building SF
          <input name="buildingSf" type="number" />
        </label>
      </div>

      <fieldset>
        <legend>MLA status</legend>
        {(["provided", "requested", "assumed"] as MlaChoice[]).map((choice) => (
          <label key={choice} className="radio-row">
            <input
              type="radio"
              name="mlaChoice"
              value={choice}
              checked={mlaChoice === choice}
              onChange={() => setMlaChoice(choice)}
            />
            {choice === "provided" && "Provided now"}
            {choice === "requested" && "Request from market lead"}
            {choice === "assumed" && "Use assumptions"}
          </label>
        ))}
      </fieldset>

      {mlaChoice === "provided" && (
        <div className="grid-2">
          <label>
            Asking rent
            <input name="askingRent" type="number" step="0.01" required />
          </label>
          <label>
            Opex
            <input name="opex" type="number" step="0.01" />
          </label>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create deal"}
      </button>
    </form>
  );
}
