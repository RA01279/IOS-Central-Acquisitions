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
  project_name: string | null;
  suite: string | null;
  cam_psf_annual: number | null;
  date_estimated: boolean | null;
  city: string | null;
  state: string | null;
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

// These live at MODULE scope, deliberately. Defined inside the component's
// render body they were re-created on every keystroke, which makes React treat
// each render's <Field> as a different component type -- so it unmounted the
// old input and mounted a fresh DOM node, and the field lost focus after every
// single character. Stable identity here means stable DOM nodes.
function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const YES_NO = [
  ["", "—"],
  ["true", "Yes"],
  ["false", "No"],
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
    projectName: v(comp.project_name),
    suite: v(comp.suite),
    city: v(comp.city),
    state: v(comp.state),
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
    camPsfAnnual: v(comp.cam_psf_annual),
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
  // Functional update so a fast typist can't lose a character to a stale
  // closure over `form`.
  const setField = (k: string, value: string) => setForm((f) => ({ ...f, [k]: value }));

  // Thin wrappers over the module-scope components. These are plain functions
  // returning elements, NOT components -- so they add no component identity of
  // their own and can't reintroduce the remount bug.
  const field = (label: string, k: string, type = "text") => (
    <TextField label={label} value={form[k] ?? ""} onChange={(val) => setField(k, val)} type={type} />
  );
  const choice = (label: string, k: string, options: string[][]) => (
    <SelectField label={label} value={form[k] ?? ""} onChange={(val) => setField(k, val)} options={options} />
  );
  const yesNo = (label: string, k: string) => choice(label, k, YES_NO);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Only the fields this comp type shows, so the other type's columns are
      // left untouched rather than nulled.
      const shared = [
        "address", "projectName", "suite",
        "city", "state", "market", "submarket", "assetClass", "buildingSf", "acres",
        "yardAcres", "coveragePct", "yearBuilt", "clearHeightFt", "officeSf",
        "dockHighDoors", "gradeLevelDoors", "powerAmps", "surfaceType", "fenced",
        "trailerStalls", "zoning", "outdoorStoragePermitted", "occupancyStatus",
        "tenancy", "notes",
      ];
      const leaseOnly = [
        "rent", "rentBasis", "leaseType", "camPsfAnnual", "dateCommenced", "leaseExpiresOn",
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
        {field("Address *", "address")}
        {/* Two things share a street address for different reasons: separate
            buildings in one park, and separate tenancies in one building. Both
            are part of what makes a comp unique, so both are editable. */}
        {field("Project / building", "projectName")}
        {field("Suite", "suite")}
        {field("City", "city")}
        {/* Editable because geocoding restricts to it: correcting the state is
            how a comp that landed in the wrong one gets moved. Saving a change
            here re-runs the lookup. */}
        {field("State", "state")}
        {field("Market", "market")}
        {field("Submarket", "submarket")}
        {choice("Asset class", "assetClass", [["", "—"], ["ios", "IOS"], ["industrial", "Industrial"]])}
        {field("Zoning", "zoning")}
      </div>

      <p className="hint">Site &amp; improvements</p>
      <div className="grid-2">
        {field("Building SF", "buildingSf")}
        {field("Site acres", "acres")}
        {field("Usable yard acres", "yardAcres")}
        {field("Coverage %", "coveragePct")}
        {field("Year built", "yearBuilt")}
        {field("Clear height (ft)", "clearHeightFt")}
        {field("Office SF", "officeSf")}
        {field("Trailer stalls", "trailerStalls")}
        {field("Dock-high doors", "dockHighDoors")}
        {field("Grade-level doors", "gradeLevelDoors")}
        {field("Power (amps)", "powerAmps")}
        {choice("Yard surface", "surfaceType", SURFACES)}
        {yesNo("Fenced", "fenced")}
        {yesNo("Outdoor storage permitted", "outdoorStoragePermitted")}
        {choice("Occupancy", "occupancyStatus", [["", "—"], ["vacant", "Vacant"], ["occupied", "Occupied"]])}
        {choice("Tenancy", "tenancy", [
          ["", "—"],
          ["single_tenant", "Single-tenant"],
          ["multi_tenant", "Multi-tenant"],
        ])}
      </div>

      {isLease ? (
        <>
          <p className="hint">Lease terms</p>
          <div className="grid-2">
            {field("Rent *", "rent")}
            {choice("Rent basis *", "rentBasis", RENT_BASES)}
            {choice("Lease type", "leaseType", LEASE_TYPES)}
            {/* Without CAM, a rent-roll base rent reads cheaper than a
                broker's gross quote for no reason but what was reported. */}
            {field("CAM ($/SF/yr)", "camPsfAnnual")}
            {field("Commenced *", "dateCommenced", "date")}
            {field("Expires", "leaseExpiresOn", "date")}
            {field("Term (months)", "leaseTermMonths")}
            {field("Tenant", "tenantName")}
            {field("Landlord", "landlordName")}
            {field("Escalations (% / yr)", "escalationsPct")}
            {field("Free rent (months)", "freeRentMonths")}
            {field("TI ($/SF)", "tiPsf")}
            {field("Renewal options", "renewalOptions")}
            {field("Listing broker", "listingBroker")}
            {field("Tenant rep broker", "tenantRepBroker")}
          </div>
        </>
      ) : (
        <>
          <p className="hint">Sale terms</p>
          <div className="grid-2">
            {field("Sale price *", "salePrice")}
            {field("Closed *", "closedOn", "date")}
            {field("Cap rate (%)", "capRate")}
            {field("NOI", "noi")}
            {field("Buyer", "buyer")}
            {field("Seller", "seller")}
            {field("Broker", "saleBroker")}
            {field("Occupancy at sale (%)", "occupancyAtSale")}
          </div>
        </>
      )}

      {field("Notes", "notes")}

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
