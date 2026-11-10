"use client";
// components/CompRadiusExport.tsx
//
// On the Comps page: an address, a radius and lease / sale / both -> an Excel
// file of the confirmed comps in that circle, nearest first, each with a
// Google Maps aerial link (app/api/comps/radius-export). Says how many it
// found, or why the address couldn't be placed, without leaving the page.

import { useState } from "react";
import { RADIUS_CHOICES, type RadiusClass, type RadiusType } from "@/lib/comps/radius";

export default function CompRadiusExport() {
  const [address, setAddress] = useState("");
  const [miles, setMiles] = useState("5");
  const [type, setType] = useState<RadiusType>("both");
  const [assetClass, setAssetClass] = useState<RadiusClass>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ address, miles, type, class: assetClass });
      const res = await fetch(`/api/comps/radius-export?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const leases = Number(res.headers.get("X-Lease-Count") ?? 0);
      const sales = Number(res.headers.get("X-Sale-Count") ?? 0);
      const matched = decodeURIComponent(res.headers.get("X-Matched-Address") ?? "") || address;
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "comps.xlsx";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const parts = [type !== "sale" ? `${leases} lease` : null, type !== "lease" ? `${sales} sale` : null].filter(Boolean).join(" and ");
      const approx = res.headers.get("X-Matched-Approximate") === "1" ? " (Google could only place it approximately, so distances are from that point)" : "";
      const merged = Number(res.headers.get("X-Merged") ?? 0);
      const dupes = merged ? ` ${merged} duplicate record${merged === 1 ? " was" : "s were"} merged.` : "";
      setResult(`${parts} comp${leases + sales === 1 ? "" : "s"} within ${miles} mi of ${matched}${approx}.${dupes} Downloaded ${name}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" id="radius-export">
      <h2>Comps near an address</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Export the confirmed comps within a radius to Excel, nearest first, each with a Google Maps aerial link.
      </p>
      <form onSubmit={run} className="radius-form">
        <label className="radius-address">
          Address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 1234 Main St, Houston, TX" required maxLength={300} />
        </label>
        <label>
          Within
          <select value={miles} onChange={(e) => setMiles(e.target.value)}>
            {RADIUS_CHOICES.map((m) => <option key={m} value={m}>{m} mile{m === 1 ? "" : "s"}</option>)}
          </select>
        </label>
        <label>
          Comps
          <select value={type} onChange={(e) => setType(e.target.value as RadiusType)}>
            <option value="both">Lease and sale</option>
            <option value="lease">Lease only</option>
            <option value="sale">Sale only</option>
          </select>
        </label>
        <label>
          Class
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as RadiusClass)}>
            <option value="all">IOS and industrial</option>
            <option value="ios">IOS</option>
            <option value="industrial">Industrial</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !address.trim()}>{busy ? "Finding comps…" : "Export to Excel"}</button>
      </form>
      {error ? <p className="error" style={{ marginBottom: 0 }}>{error}</p> : null}
      {result ? <p className="hint" role="status" style={{ marginBottom: 0 }}>{result}</p> : null}
    </section>
  );
}
