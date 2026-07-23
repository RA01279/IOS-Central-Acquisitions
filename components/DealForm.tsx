"use client";
// components/DealForm.tsx
//
// The single intake point for v1.
// - Occupancy: vacant or occupied; if occupied, WALT (weighted average lease
//   term remaining, in years) opens inline.
// - MLA status drives which fields show:
//   - "provided": the full MLA - Base Case field set opens inline
//   - "requested": no extra fields -- notifies the market lead on submit
//   - "assumed": no extra fields -- analyst proceeds on their own judgment

import { useState } from "react";
import { useRouter } from "next/navigation";

type MlaChoice = "provided" | "requested" | "assumed";
type Occupancy = "vacant" | "occupied";

export default function DealForm() {
  const router = useRouter();
  const [mlaChoice, setMlaChoice] = useState<MlaChoice>("requested");
  const [occupancy, setOccupancy] = useState<Occupancy>("vacant");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const num = (key: string) => (form.get(key) ? Number(form.get(key)) : undefined);

    const mla =
      mlaChoice === "provided"
        ? {
            status: "provided" as const,
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
            recoveryType: (form.get("recoveryType") as string) || undefined,
          }
        : { status: mlaChoice };

    const payload = {
      address: form.get("address"),
      market: form.get("market"),
      city: (form.get("city") as string) || undefined,
      assetType: form.get("assetType"),
      acres: form.get("acres") ? Number(form.get("acres")) : undefined,
      buildingSf: form.get("buildingSf") ? Number(form.get("buildingSf")) : undefined,
      marketingStatus: (form.get("marketingStatus") as string) || undefined,
      acquisitionType: (form.get("acquisitionType") as string) || undefined,
      occupancyStatus: occupancy,
      // WALT only matters when occupied; send undefined otherwise.
      waltYears: occupancy === "occupied" ? num("waltYears") : undefined,
      tenancy: (form.get("tenancy") as string) || undefined,
      currentOwnerName: (form.get("currentOwnerName") as string) || undefined,
      buyerBrokerName: (form.get("buyerBrokerName") as string) || undefined,
      sellerBrokerName: (form.get("sellerBrokerName") as string) || undefined,
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

      <div className="grid-2">
        <label>
          City
          <input name="city" />
        </label>
        <label>
          Market
          <input name="market" />
        </label>
        <label>
          Current owner
          <input name="currentOwnerName" placeholder="Seller — created as a contact automatically" />
        </label>
        <label>
          Source
          <select name="marketingStatus" defaultValue="off_market">
            <option value="off_market">Off-Market</option>
            <option value="marketed">Marketed</option>
          </select>
        </label>
        <label>
          Acquisition type
          <select name="acquisitionType" defaultValue="standard">
            <option value="standard">Standard</option>
            <option value="slb">Sale-leaseback (SLB)</option>
            <option value="unsolicited">Unsolicited</option>
          </select>
        </label>
      </div>

      <div className="grid-2">
        <label>
          Buyer broker
          <input name="buyerBrokerName" placeholder="Broker repping us" />
        </label>
        <label>
          Sales broker
          <input name="sellerBrokerName" placeholder="Broker repping the seller" />
        </label>
      </div>

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
          Acres
          <input name="acres" type="number" step="0.01" placeholder="converts to lot SF" />
        </label>
        <label>
          Building SF
          <input name="buildingSf" type="number" />
        </label>
      </div>

      <div className="grid-2">
        <label>
          Current occupancy
          <select
            name="occupancyStatus"
            value={occupancy}
            onChange={(e) => setOccupancy(e.target.value as Occupancy)}
          >
            <option value="vacant">Vacant</option>
            <option value="occupied">Occupied</option>
          </select>
        </label>
        <label>
          Tenancy
          <select name="tenancy" defaultValue="">
            <option value="">—</option>
            <option value="single_tenant">Single-tenant</option>
            <option value="multi_tenant">Multi-tenant</option>
          </select>
        </label>
        {occupancy === "occupied" && (
          <label>
            WALT (years)
            <input name="waltYears" type="number" step="0.1" min="0" />
          </label>
        )}
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
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create deal"}
      </button>
    </form>
  );
}
