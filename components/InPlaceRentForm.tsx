"use client";
// components/InPlaceRentForm.tsx
//
// In-place rent, the input the Rent Upside flag needs. Stored in the basis it
// was quoted in (like comps), then converted for comparison. Saving re-runs
// the site checks so the flag and score update straight away.

import { useState } from "react";
import { useRouter } from "next/navigation";

const BASES = [
  { value: "per_acre_monthly", label: "$ / acre / month" },
  { value: "total_monthly", label: "$ / month, whole site" },
  { value: "per_sf_bldg_monthly", label: "$ / bldg SF / month" },
  { value: "per_sf_bldg_annual", label: "$ / bldg SF / year" },
  { value: "per_sf_land_monthly", label: "$ / land SF / month" },
];

export default function InPlaceRentForm({
  dealId,
  rent,
  basis,
  ios,
}: {
  dealId: string;
  rent: number | null;
  basis: string | null;
  ios: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_milestones", inPlaceRent: f.get("rent") || null, inPlaceRentBasis: f.get("basis") }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await fetch(`/api/deals/${dealId}/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      setMsg("Saved. Rent Upside re-scored.");
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
        In-place rent
        <input name="rent" defaultValue={rent ?? ""} placeholder={ios ? "e.g. 2,400" : "e.g. 0.42"} style={{ width: 140 }} />
      </label>
      <label style={{ marginBottom: 0 }}>
        Quoted as
        <select name="basis" defaultValue={basis ?? (ios ? "per_acre_monthly" : "per_sf_bldg_monthly")}>
          {BASES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save rent"}
      </button>
      {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
    </form>
  );
}
