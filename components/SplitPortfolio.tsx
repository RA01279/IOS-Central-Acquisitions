"use client";
// components/SplitPortfolio.tsx
//
// "Split into portfolio" on a deal entered as several sites. Proposes the
// sites from the address (lib/split-sites.ts), checks each with Google, then
// creates the portfolio: this deal becomes the first site and keeps its
// history; the others become new deals in the package.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { portfolioName, splitSites } from "@/lib/split-sites";

type Site = {
  address: string;
  city: string;
  acres: string;
  buildingSf: string;
  check: { state: "idle" | "checking" | "ok" | "bad"; lat?: number; lng?: number; precision?: string; matched?: string; note?: string };
};

export default function SplitPortfolio({ dealId, address, city, ios }: { dealId: string; address: string; city: string | null; ios: boolean }) {
  const router = useRouter();
  const proposed = splitSites(address);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(portfolioName(address, proposed));
  const [sites, setSites] = useState<Site[]>(() =>
    (proposed.length ? proposed : ["", ""]).map((a) => ({ address: a, city: city ?? "", acres: "", buildingSf: "", check: { state: "idle" } }))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ portfolioId: string; created: { id: string; address: string }[]; skipped: { address: string; reason: string }[] } | null>(null);

  const set = (i: number, patch: Partial<Site>) => setSites((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch, check: "address" in patch || "city" in patch ? { state: "idle" } : patch.check ?? s.check } : s)));

  async function checkAll() {
    setBusy("Checking locations with Google…");
    setError(null);
    const next = [...sites];
    for (let i = 0; i < next.length; i++) {
      const s = next[i];
      if (!s.address.trim()) { next[i] = { ...s, check: { state: "bad", note: "enter an address" } }; continue; }
      if (s.check.state === "ok") continue;
      try {
        const res = await fetch("/api/locations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: s.address, city: s.city }) });
        const b = await res.json().catch(() => ({}));
        next[i] = b.location
          ? { ...s, check: { state: "ok", lat: b.location.latitude, lng: b.location.longitude, precision: b.location.geocode_precision, matched: b.matchedAddress } }
          : { ...s, check: { state: "bad", note: b.message ?? b.error ?? "Google couldn't verify it; correct the address" } };
      } catch {
        next[i] = { ...s, check: { state: "bad", note: "couldn't reach Google" } };
      }
      setSites([...next]);
    }
    setBusy(null);
  }

  async function split() {
    setBusy("Creating the portfolio…");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sites: sites.map((s) => ({ address: s.address, city: s.city, latitude: s.check.lat, longitude: s.check.lng, geocodePrecision: s.check.precision, acres: s.acres || null, buildingSf: s.buildingSf || null })),
        }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? "Split failed");
      setResult(b);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <p className="hint" style={{ marginTop: 8 }}>
        This deal lists more than one site.{" "}
        <button type="button" className="link-caps" onClick={() => setOpen(true)}>Split into portfolio</button>
      </p>
    );
  }

  if (result) {
    return (
      <div className="inline-add-form" style={{ width: "100%" }}>
        <p style={{ margin: 0 }}>
          <strong>{name}</strong> created: this deal is now {sites[0].address}, plus {result.created.length} new site deal{result.created.length === 1 ? "" : "s"}.{" "}
          <a href={`/deals/portfolios/${result.portfolioId}`}>Open the portfolio →</a>
        </p>
        {result.skipped.length > 0 && <p className="error">Not created: {result.skipped.map((s) => `${s.address} (${s.reason})`).join("; ")}</p>}
      </div>
    );
  }

  const allOk = sites.length >= 2 && sites.every((s) => s.check.state === "ok");
  return (
    <div className="inline-add-form" style={{ width: "100%" }}>
      <p className="hint" style={{ marginTop: 0 }}>
        One deal per site. <strong>This deal becomes the first site</strong> and keeps its stage, offers, model and history; the others
        are created as new deals (Prospect) in the same pipeline, with the same owner and broker contacts. Fix the list, check the
        locations, then split.
      </p>
      <label>Portfolio name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div style={{ overflowX: "auto" }}>
        <table className="summary-table">
          <thead><tr><th>#</th><th>Street address</th><th>City</th><th>{ios ? "Acres" : "Bldg SF"}</th><th>Location</th><th></th></tr></thead>
          <tbody>
            {sites.map((s, i) => (
              <tr key={i}>
                <td>{i === 0 ? "1 (this deal)" : i + 1}</td>
                <td><input value={s.address} onChange={(e) => set(i, { address: e.target.value })} style={{ minWidth: 220 }} /></td>
                <td><input value={s.city} onChange={(e) => set(i, { city: e.target.value })} style={{ width: 120 }} /></td>
                <td>
                  {ios
                    ? <input value={s.acres} onChange={(e) => setSites((ss) => ss.map((x, j) => (j === i ? { ...x, acres: e.target.value } : x)))} placeholder="optional" style={{ width: 80 }} />
                    : <input value={s.buildingSf} onChange={(e) => setSites((ss) => ss.map((x, j) => (j === i ? { ...x, buildingSf: e.target.value } : x)))} placeholder="optional" style={{ width: 90 }} />}
                </td>
                <td>
                  {s.check.state === "ok" ? <span>✓ <span className="muted">{s.check.matched}</span></span>
                    : s.check.state === "bad" ? <span className="error">{s.check.note}</span>
                    : <span className="muted">not checked</span>}
                </td>
                <td>{sites.length > 2 && <button type="button" className="secondary" title="Remove site" onClick={() => setSites((ss) => ss.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="button" className="secondary" onClick={() => setSites((ss) => [...ss, { address: "", city: city ?? "", acres: "", buildingSf: "", check: { state: "idle" } }])}>+ Add site</button>
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => void checkAll()}>Check locations</button>
        <button type="button" disabled={busy !== null || !allOk || !name.trim()} onClick={() => void split()}>Split into {sites.length} sites</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
        {busy && <span className="hint">{busy}</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
