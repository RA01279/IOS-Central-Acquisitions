"use client";
// components/CompEditor.tsx
//
// Edit one saved comp. Collapsed to a row until opened, because the repository
// is mostly read and occasionally corrected -- and a page of always-open forms
// with forty fields each is unreadable.
//
// Only the fields shown get submitted, and the PATCH route only writes keys
// present in the body, so the lease editor can't blank a sale comp's columns.

import { useState } from "react";
import { useRouter } from "next/navigation";

const SQFT_PER_ACRE = 43560;

export interface CompRow {
  id: string;
  comp_type: "lease" | "sale";
  address: string;
  city: string | null;
  market: string | null;
  submarket: string | null;
  asset_class: string | null;
  building_sf: number | null;
  lot_sf: number | null;
  coverage_pct: number | null;
  year_built: number | null;
  clear_height_ft: number | null;
  office_sf: number | null;
  dock_high_doors: number | null;
  grade_level_doors: number | null;
  power_amps: number | null;
  occupancy_status: string | null;
  tenancy: string | null;
  yard_acres: number | null;
  surface_type: string | null;
  fenced: boolean | null;
  trailer_stalls: number | null;
  zoning: string | null;
  outdoor_storage_permitted: boolean | null;
  rent: number | null;
  rent_basis: string | null;
  lease_type: string | null;
  date_commenced: string | null;
  lease_expires_on: string | null;
  lease_term_months: number | null;
  tenant_name: string | null;
  landlord_name: string | null;
  escalations_pct: number | null;
  free_rent_months: number | null;
  ti_psf: number | null;
  renewal_options: string | null;
  listing_broker: string | null;
  tenant_rep_broker: string | null;
  sale_price: number | null;
  closed_on: string | null;
  cap_rate: number | null;
  noi: number | null;
  buyer: string | null;
  seller: string | null;
  sale_broker: string | null;
  occupancy_at_sale: number | null;
  notes: string | null;
  date_precision: string | null;
  geocode_precision: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

const SURFACES = [
  ["", "—"],
  ["concrete", "Concrete"],
  ["asphalt", "Asphalt"],
  ["crushed_stone", "Crushed stone"],
  ["gravel", "Gravel"],
  ["dirt", "Dirt"],
  ["mixed", "Mixed"],
  ["unimproved", "Unimproved"],
];
const RENT_BASES = [
  ["per_acre_monthly", "$ / acre / month"],
  ["per_sf_land_monthly", "$ / SF land / month"],
  ["per_sf_bldg_monthly", "$ / SF building / month"],
  ["per_sf_bldg_annual", "$ / SF building / year"],
  ["total_monthly", "Total $ / month"],
];
const LEASE_TYPES = [
  ["", "—"],
  ["nnn", "NNN"],
  ["gross", "Gross"],
  ["modified_gross", "Modified gross"],
  ["industrial_gross", "Industrial gross"],
  ["absolute_net", "Absolute net"],
  ["other", "Other"],
];

/** null/undefined -> "" so React keeps the input controlled. */
function v(x: unknown): string {
  return x === null || x === undefined ? "" : String(x);
}
/** Fractions are stored 0-1 and edited as percentages. */
function asPct(x: number | null): string {
  return x === null || x === undefined ? "" : String(Number((x * 100).toFixed(4)));
}
function triState(x: boolean | null): string {
  return x === null || x === undefined ? "" : x ? "true" : "false";
}

export default function CompEditor({ comp }: { comp: CompRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(() => ({
    address: v(comp.address),
    city: v(comp.city),
    market: v(comp.market),
    submarket: v(comp.submarket),
    assetClass: v(comp.asset_class),
    buildingSf: v(comp.building_sf),
    acres: comp.lot_sf ? String(Number((comp.lot_sf / SQFT_PER_ACRE).toFixed(3))) : "",
    yardAcres: v(comp.yard_acres),
    coveragePct: asPct(comp.coverage_pct),
    yearBuilt: v(comp.year_built),
    clearHeightFt: v(comp.clear_height_ft),
    officeSf: v(comp.office_sf),
    dockHighDoors: v(comp.dock_high_doors),
    gradeLevelDoors: v(comp.grade_level_doors),
    powerAmps: v(comp.power_amps),
    surfaceType: v(comp.surface_type),
    fenced: triState(comp.fenced),
    trailerStalls: v(comp.trailer_stalls),
    zoning: v(comp.zoning),
    outdoorStoragePermitted: triState(comp.outdoor_storage_permitted),
    occupancyStatus: v(comp.occupancy_status),
    tenancy: v(comp.tenancy),
    rent: v(comp.rent),
    rentBasis: v(comp.rent_basis) || "per_sf_bldg_monthly",
    leaseType: v(comp.lease_type),
    dateCommenced: v(comp.date_commenced),
    leaseExpiresOn: v(comp.lease_expires_on),
    leaseTermMonths: v(comp.lease_term_months),
    tenantName: v(comp.tenant_name),
    landlordName: v(comp.landlord_name),
    escalationsPct: v(comp.escalations_pct),
    freeRentMonths: v(comp.free_rent_months),
    tiPsf: v(comp.ti_psf),
    renewalOptions: v(comp.renewal_options),
    listingBroker: v(comp.listing_broker),
    tenantRepBroker: v(comp.tenant_rep_broker),
    salePrice: v(comp.sale_price),
    closedOn: v(comp.closed_on),
    capRate: asPct(comp.cap_rate),
    noi: v(comp.noi),
    buyer: v(comp.buyer),
    seller: v(comp.seller),
    saleBroker: v(comp.sale_broker),
    occupancyAtSale: asPct(comp.occupancy_at_sale),
    notes: v(comp.notes),
  }));

  const isLease = comp.comp_type === "lease";
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const Field = ({ label, k, type = "text", width }: { label: string; k: string; type?: string; width?: number }) => (
    <label>
      {label}
      <input type={type} value={form[k] ?? ""} onChange={set(k)} style={width ? { width } : undefined} />
    </label>
  );
  const Choice = ({ label, k, options }: { label: string; k: string; options: string[][] }) => (
    <label>
      {label}
      <select value={form[k] ?? ""} onChange={set(k)}>
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const YesNo = ({ label, k }: { label: string; k: string }) => (
    <Choice label={label} k={k} options={[["", "—"], ["true", "Yes"], ["false", "No"]]} />
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Only the fields this comp type shows, so the other type's columns are
      // left untouched rather than nulled.
      const shared = [
        "address", "city", "market", "submarket", "assetClass", "buildingSf", "acres",
        "yardAcres", "coveragePct", "yearBuilt", "clearHeightFt", "officeSf",
        "dockHighDoors", "gradeLevelDoors", "powerAmps", "surfaceType", "fenced",
        "trailerStalls", "zoning", "outdoorStoragePermitted", "occupancyStatus",
        "tenancy", "notes",
      ];
      const leaseOnly = [
        "rent", "rentBasis", "leaseType", "dateCommenced", "leaseExpiresOn",
        "leaseTermMonths", "tenantName", "landlordName", "escalationsPct",
        "freeRentMonths", "tiPsf", "renewalOptions", "listingBroker", "tenantRepBroker",
      ];
      const saleOnly = ["salePrice", "closedOn", "capRate", "noi", "buyer", "seller", "saleBroker", "occupancyAtSale"];
      const keys = [...shared, ...(isLease ? leaseOnly : saleOnly)];
      const payload = Object.fromEntries(keys.map((k) => [k, form[k] ?? ""]));

      const res = await fetch(`/api/comps/${comp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the comp at ${comp.address}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/comps/${comp.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  const trigger = (
    <button
      type="button"
      className="secondary"
      style={{ padding: "2px 8px", fontSize: 12 }}
      onClick={() => setOpen(true)}
    >
      Edit
    </button>
  );
  if (!open) return trigger;

  // An overlay rather than an inline expansion: this form has forty fields and
  // the trigger lives in a table cell a few characters wide. Expanding in place
  // would either wreck the table's column widths or need the parent to manage
  // a second colSpan row, which puts this component's open state somewhere
  // else. The overlay keeps the table intact and gives the form room.
  return (
    <>
      {trigger}
      <div
        className="comp-modal-backdrop"
        onClick={(e) => {
          // Backdrop only -- a click inside the form must not discard edits.
          if (e.target === e.currentTarget && !busy) setOpen(false);
        }}
      >
        <div className="comp-modal inline-add-form" onClick={(e) => e.stopPropagation()}>
      <h2 style={{ marginBottom: 8 }}>
        {isLease ? "Lease" : "Sale"} comp — {comp.address}
      </h2>

      <p className="hint">Location</p>
      <div className="grid-2">
        <Field label="Address *" k="address" />
        <Field label="City" k="city" />
        <Field label="Market" k="market" />
        <Field label="Submarket" k="submarket" />
        <Choice label="Asset class" k="assetClass" options={[["", "—"], ["ios", "IOS"], ["industrial", "Industrial"]]} />
        <Field label="Zoning" k="zoning" />
      </div>

      <p className="hint">Site &amp; improvements</p>
      <div className="grid-2">
        <Field label="Building SF" k="buildingSf" />
        <Field label="Site acres" k="acres" />
        <Field label="Usable yard acres" k="yardAcres" />
        <Field label="Coverage %" k="coveragePct" />
        <Field label="Year built" k="yearBuilt" />
        <Field label="Clear height (ft)" k="clearHeightFt" />
        <Field label="Office SF" k="officeSf" />
        <Field label="Trailer stalls" k="trailerStalls" />
        <Field label="Dock-high doors" k="dockHighDoors" />
        <Field label="Grade-level doors" k="gradeLevelDoors" />
        <Field label="Power (amps)" k="powerAmps" />
        <Choice label="Yard surface" k="surfaceType" options={SURFACES} />
        <YesNo label="Fenced" k="fenced" />
        <YesNo label="Outdoor storage permitted" k="outdoorStoragePermitted" />
        <Choice
          label="Occupancy"
          k="occupancyStatus"
          options={[["", "—"], ["vacant", "Vacant"], ["occupied", "Occupied"]]}
        />
        <Choice
          label="Tenancy"
          k="tenancy"
          options={[["", "—"], ["single_tenant", "Single-tenant"], ["multi_tenant", "Multi-tenant"]]}
        />
      </div>

      {isLease ? (
        <>
          <p className="hint">Lease terms</p>
          <div className="grid-2">
            <Field label="Rent *" k="rent" />
            <Choice label="Rent basis *" k="rentBasis" options={RENT_BASES} />
            <Choice label="Lease type" k="leaseType" options={LEASE_TYPES} />
            <Field label="Commenced *" k="dateCommenced" type="date" />
            <Field label="Expires" k="leaseExpiresOn" type="date" />
            <Field label="Term (months)" k="leaseTermMonths" />
            <Field label="Tenant" k="tenantName" />
            <Field label="Landlord" k="landlordName" />
            <Field label="Escalations (% / yr)" k="escalationsPct" />
            <Field label="Free rent (months)" k="freeRentMonths" />
            <Field label="TI ($/SF)" k="tiPsf" />
            <Field label="Renewal options" k="renewalOptions" />
            <Field label="Listing broker" k="listingBroker" />
            <Field label="Tenant rep broker" k="tenantRepBroker" />
          </div>
        </>
      ) : (
        <>
          <p className="hint">Sale terms</p>
          <div className="grid-2">
            <Field label="Sale price *" k="salePrice" />
            <Field label="Closed *" k="closedOn" type="date" />
            <Field label="Cap rate (%)" k="capRate" />
            <Field label="NOI" k="noi" />
            <Field label="Buyer" k="buyer" />
            <Field label="Seller" k="seller" />
            <Field label="Broker" k="saleBroker" />
            <Field label="Occupancy at sale (%)" k="occupancyAtSale" />
          </div>
        </>
      )}

      <label>
        Notes
        <input value={form.notes ?? ""} onChange={set("notes")} />
      </label>

      {error && <p className="error">{error}</p>}
      {comp.updated_at && (
        <p className="hint">
          Last edited {new Date(comp.updated_at).toLocaleString()}
          {comp.updated_by ? ` by ${comp.updated_by}` : ""}
        </p>
      )}

      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="danger-btn" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
          Changing the address, city or market re-resolves the coordinates, so a corrected address
          starts distance-matching from the right place.
        </p>
        </div>
      </div>
    </>
  );
}
