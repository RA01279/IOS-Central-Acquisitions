"use client";
// components/RentRollImport.tsx
//
// Fill an owned asset's rent roll from the property's rent roll workbook.
// The file is read by the same reader the comp intake uses for rent rolls
// (/api/comps/parse); each tenancy becomes a lease here after review. Nothing
// is saved until Save, and tenancies already on the asset are skipped.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { monthlyRent } from "@/lib/asset-performance";

type Row = {
  key: string;
  include: boolean;
  tenant: string;
  suite: string;
  leasedSf: number | null;
  leasedAcres: number | null;
  monthly: number | null;
  commencedOn: string;
  expiresOn: string;
  escalationPct: number | null;
  note: string | null;
};

export default function RentRollImport({
  assetId,
  address,
  city,
  existing,
}: {
  assetId: string;
  address: string;
  city: string | null;
  /** "tenant|suite", lower-cased, of leases already on the asset. */
  existing: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const have = new Set(existing);

  async function read(file: File) {
    setError(null);
    setDone(null);
    setRows(null);
    try {
      if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) throw new Error("Choose the rent roll as an .xlsx, .xlsm or .csv file.");
      setStep(`Reading ${file.name}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const res = await fetch("/api/comps/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: btoa(binary), fileName: file.name, address, city }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that workbook");
      const leases = (body.comps ?? []).filter((c: any) => c.compType === "lease" && (c.tenantName || c.suite));
      if (!leases.length) throw new Error("No tenancies found. The workbook needs a tenant or suite column with rents.");
      setRows(
        leases.map((c: any, i: number): Row => {
          const monthly = monthlyRent(c.rent, c.rentBasis, { buildingSf: c.buildingSf, acres: c.acres ?? c.yardAcres, lotSf: c.lotSf });
          const tenant = String(c.tenantName ?? "").trim() || `Suite ${c.suite}`;
          const suite = String(c.suite ?? "").trim();
          const dup = have.has(`${tenant.toLowerCase()}|${suite.toLowerCase()}`);
          const vacant = /\bvacant\b/i.test(tenant);
          return {
            key: String(i),
            include: !dup && !vacant,
            tenant,
            suite,
            leasedSf: c.buildingSf ?? null,
            leasedAcres: c.acres ?? c.yardAcres ?? null,
            monthly,
            // A start date backed into from a term is a guess; leave it blank.
            commencedOn: c.dateEstimated ? "" : c.dateCommenced ?? "",
            expiresOn: c.leaseExpiresOn ?? "",
            escalationPct: c.escalationsPct ?? null,
            note: dup ? "already on this asset" : vacant ? "vacant" : monthly == null && c.rent != null ? "rent needs a size to convert; check it" : null,
          };
        })
      );
      setWarnings(body.warnings ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  async function save() {
    if (!rows) return;
    const picked = rows.filter((r) => r.include);
    const failed: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i];
      setStep(`Saving ${i + 1} of ${picked.length}…`);
      const res = await fetch(`/api/assets/${assetId}/leases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: r.tenant,
          suite: r.suite || null,
          leasedSf: r.leasedSf,
          leasedAcres: r.leasedAcres,
          baseRentMonthly: r.monthly != null ? (Math.round(r.monthly * 100) / 100).toFixed(2) : null,
          commencedOn: r.commencedOn || null,
          expiresOn: r.expiresOn || null,
          // Comp escalations are fractions; the lease API takes a percent.
          escalationPct: r.escalationPct != null ? String(r.escalationPct >= 0.5 ? r.escalationPct : +(r.escalationPct * 100).toFixed(3)) : null,
        }),
      });
      if (!res.ok) failed.push(`${r.tenant}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
    }
    setStep(null);
    const ok = picked.length - failed.length;
    setDone(`${ok} lease${ok === 1 ? "" : "s"} added${failed.length ? `; ${failed.length} failed: ${failed.join("; ")}` : ""}.`);
    setRows(null);
    router.refresh();
  }

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const picked = rows?.filter((r) => r.include).length ?? 0;

  return (
    <div className="inline-add-form" style={{ width: "100%" }}>
      <label>
        Import rent roll (.xlsx, .xlsm or .csv)
        <input type="file" accept=".xlsx,.xlsm,.csv" disabled={step !== null}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
      </label>
      {step && <p className="hint">{step}</p>}
      {done && <p className="hint"><strong>Done:</strong> {done}</p>}
      {error && <p className="error">{error}</p>}
      {rows && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="summary-table">
              <thead><tr><th></th><th>Tenant</th><th>Suite</th><th>SF / AC</th><th>Rent / mo ($)</th><th>Start</th><th>Expires</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ opacity: r.include ? 1 : 0.5 }}>
                    <td><input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label={`Include ${r.tenant}`} /></td>
                    <td><input value={r.tenant} onChange={(e) => set(r.key, { tenant: e.target.value })} /></td>
                    <td>{r.suite || "—"}</td>
                    <td>{r.leasedSf ? `${Math.round(r.leasedSf).toLocaleString()} SF` : r.leasedAcres ? `${r.leasedAcres} AC` : "—"}</td>
                    <td>
                      <input value={r.monthly != null ? String(Math.round(r.monthly)) : ""} placeholder="—" style={{ width: 100 }}
                        onChange={(e) => { const v = e.target.value.replace(/[$,\s]/g, ""); set(r.key, { monthly: v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : r.monthly }); }} />
                    </td>
                    <td><input type="date" value={r.commencedOn} onChange={(e) => set(r.key, { commencedOn: e.target.value })} /></td>
                    <td><input type="date" value={r.expiresOn} onChange={(e) => set(r.key, { expiresOn: e.target.value })} /></td>
                    <td className="muted">{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && <div className="warning"><ul>{warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" disabled={step !== null || picked === 0} onClick={() => void save()}>
              Save {picked} lease{picked === 1 ? "" : "s"}
            </button>
            <button type="button" className="secondary" onClick={() => setRows(null)}>Cancel</button>
            <span className="hint">Rents are converted to $ per month from how the roll quotes them; check them before saving.</span>
          </div>
        </>
      )}
    </div>
  );
}
