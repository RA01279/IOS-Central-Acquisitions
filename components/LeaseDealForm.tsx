"use client";
// components/LeaseDealForm.tsx
//
// Leasing intake. Deliberately lighter than the acquisitions DealForm: no MLA
// / underwriting section, since a leasing deal isn't underwritten off an MLA
// tab. Posts to the same /api/deals endpoint with dealType: "lease", so it
// flows through the one createDeal() entry point.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LeaseDealForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      dealType: "lease",
      tenantName: form.get("tenantName") || undefined,
      landlordRepName: form.get("landlordRepName") || undefined,
      tenantRepName: form.get("tenantRepName") || undefined,
      address: form.get("address"),
      market: form.get("market") || undefined,
      submarket: form.get("submarket") || undefined,
      assetType: form.get("assetType"),
      lotSf: form.get("lotSf") ? Number(form.get("lotSf")) : undefined,
      buildingSf: form.get("buildingSf") ? Number(form.get("buildingSf")) : undefined,
    };

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create lease deal");
      }
      const { deal } = await res.json();
      router.push(`/leasing/${deal.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="deal-form">
      <label>
        Tenant (prospect)
        <input name="tenantName" placeholder="Company or person — created as a contact automatically" />
      </label>

      <div className="grid-2">
        <label>
          Landlord rep
          <input name="landlordRepName" placeholder="Broker repping us / the landlord" />
        </label>
        <label>
          Tenant rep
          <input name="tenantRepName" placeholder="Broker repping the tenant" />
        </label>
      </div>

      <label>
        Property address
        <input name="address" required />
      </label>

      <div className="grid-2">
        <label>
          Market
          <input name="market" />
        </label>
        <label>
          Submarket
          <input name="submarket" />
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
          Lot SF
          <input name="lotSf" type="number" />
        </label>
        <label>
          Building SF
          <input name="buildingSf" type="number" />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create lease deal"}
      </button>
    </form>
  );
}
