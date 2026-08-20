"use client";
// components/DealEditForm.tsx
//
// Edit the property + deal facts on any deal page. Everything the intake
// form captures is editable after the fact.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DealEditForm({
  dealId,
  property,
  assetClass,
  marketingStatus,
  acquisitionType,
  ddEndOn,
  closingOn,
  contractPrice,
  closedPrice,
}: {
  dealId: string;
  assetClass: string | null;
  ddEndOn: string | null;
  closingOn: string | null;
  contractPrice: number | null;
  closedPrice: number | null;
  property: {
    address: string | null;
    city: string | null;
    market: string | null;
    submarket: string | null;
    asset_type: string | null;
    lot_sf: number | null;
    building_sf: number | null;
    occupancy_status: string | null;
    walt_years: number | null;
    tenancy: string | null;
  };
  marketingStatus: string | null;
  acquisitionType: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [occupancy, setOccupancy] = useState(property.occupancy_status ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_details",
          address: form.get("address"),
          city: form.get("city"),
          market: form.get("market"),
          submarket: form.get("submarket"),
          assetType: form.get("assetType"),
          assetClass: form.get("assetClass"),
          acres: form.get("acres"),
          buildingSf: form.get("buildingSf"),
          occupancyStatus: form.get("occupancyStatus"),
          waltYears: form.get("waltYears"),
          tenancy: form.get("tenancy"),
          marketingStatus: form.get("marketingStatus"),
          acquisitionType: form.get("acquisitionType"),
          ddEndOn: form.get("ddEndOn"),
          closingOn: form.get("closingOn"),
          contractPrice: form.get("contractPrice"),
          closedPrice: form.get("closedPrice"),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Edit details
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <label>
        Property address *
        <input name="address" defaultValue={property.address ?? ""} required />
      </label>
      <div className="grid-2">
        <label>
          City
          <input name="city" defaultValue={property.city ?? ""} />
        </label>
        <label>
          Market
          <input name="market" defaultValue={property.market ?? ""} />
        </label>
        <label>
          Submarket
          <input name="submarket" defaultValue={property.submarket ?? ""} />
        </label>
        <label>
          Pipeline
          <select name="assetClass" defaultValue={assetClass ?? "ios"}>
            <option value="ios">IOS</option>
            <option value="industrial">Industrial</option>
          </select>
        </label>
        <label>
          Asset type
          <select name="assetType" defaultValue={property.asset_type ?? "ios"}>
            <option value="ios">IOS</option>
            <option value="industrial">Industrial</option>
            <option value="flex">Flex</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Acres
          <input
            name="acres"
            type="number"
            step="0.01"
            defaultValue={property.lot_sf ? (property.lot_sf / 43560).toFixed(2) : ""}
          />
        </label>
        <label>
          Building SF
          <input name="buildingSf" type="number" defaultValue={property.building_sf ?? ""} />
        </label>
        <label>
          Current occupancy
          <select
            name="occupancyStatus"
            value={occupancy}
            onChange={(e) => setOccupancy(e.target.value)}
          >
            <option value="">—</option>
            <option value="vacant">Vacant</option>
            <option value="occupied">Occupied</option>
          </select>
        </label>
        {occupancy === "occupied" ? (
          <label>
            WALT (years)
            <input
              name="waltYears"
              type="number"
              step="0.1"
              defaultValue={property.walt_years ?? ""}
            />
          </label>
        ) : (
          <span />
        )}
        <label>
          Tenancy
          <select name="tenancy" defaultValue={property.tenancy ?? ""}>
            <option value="">—</option>
            <option value="single_tenant">Single-tenant</option>
            <option value="multi_tenant">Multi-tenant</option>
          </select>
        </label>
        <label>
          Source
          <select name="marketingStatus" defaultValue={marketingStatus ?? ""}>
            <option value="">—</option>
            <option value="off_market">Off-Market</option>
            <option value="marketed">Marketed</option>
          </select>
        </label>
        <label>
          Acquisition type
          <select name="acquisitionType" defaultValue={acquisitionType ?? ""}>
            <option value="">—</option>
            <option value="standard">Standard</option>
            <option value="slb">Sale-leaseback (SLB)</option>
            <option value="unsolicited">Unsolicited</option>
          </select>
        </label>
        <label>
          DD expires
          <input name="ddEndOn" type="date" defaultValue={ddEndOn ?? ""} />
        </label>
        <label>
          Target closing
          <input name="closingOn" type="date" defaultValue={closingOn ?? ""} />
        </label>
        <label>
          Contract price ($)
          <input
            name="contractPrice"
            type="number"
            step="1000"
            defaultValue={contractPrice ?? ""}
            placeholder="agreed PSA price"
          />
        </label>
        <label>
          Final closing price ($)
          <input
            name="closedPrice"
            type="number"
            step="1000"
            defaultValue={closedPrice ?? ""}
            placeholder="what it actually closed at"
          />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
