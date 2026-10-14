"use client";

// Draft comps waiting on a person: each with the reason it was held and a
// one-click decision. A draft is in the repository but out of every market
// figure until it's confirmed, so this queue has to be impossible to miss.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { REVIEW_FLAG_LABELS, type ReviewFlag } from "@/lib/comps/review";
import { rateSummary } from "@/lib/comps/rates";

export type ReviewRow = {
  id: string;
  comp_type: "lease" | "sale";
  address: string;
  city: string | null;
  market: string | null;
  date_commenced: string | null;
  closed_on: string | null;
  rent: number | null;
  rent_basis: string | null;
  sale_price: number | null;
  building_sf: number | null;
  lot_sf: number | null;
  yard_acres: number | null;
  tenant_name: string | null;
  buyer: string | null;
  review_flags: string[] | null;
  duplicate_of: string | null;
  source_ref: string | null;
};

export default function CompReviewQueue({ rows, originals }: { rows: ReviewRow[]; originals: Record<string, ReviewRow> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Confirm keeps the comp and counts it; Delete removes it for good.
  async function decide(id: string, action: "confirm" | "delete") {
    if (action === "delete" && !window.confirm("Delete this comp permanently?")) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/comps/${id}`, action === "delete"
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save the decision");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const duplicates = rows.filter((r) => r.duplicate_of && (r.review_flags ?? []).includes("possible_duplicate")).length;
  async function dedupe() {
    if (!window.confirm(`Delete all ${duplicates} duplicate comp${duplicates === 1 ? "" : "s"}? The originals they repeat are kept.`)) return;
    setBusy("all");
    setError(null);
    try {
      const res = await fetch("/api/comps/dedupe", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not delete the duplicates");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return null;
  const line = (c: ReviewRow) => {
    const date = c.comp_type === "sale" ? c.closed_on : c.date_commenced;
    const money = c.comp_type === "sale"
      ? c.sale_price != null ? `$${Math.round(c.sale_price).toLocaleString()}` : "—"
      : rateSummary(c);
    const party = c.comp_type === "sale" ? c.buyer : c.tenant_name;
    return [date ?? "undated", money, party].filter(Boolean).join(" · ");
  };

  return (
    <section className="warning">
      <p style={{ margin: 0 }}>
        <strong>{rows.length} comp{rows.length === 1 ? "" : "s"} need{rows.length === 1 ? "s" : ""} review.</strong>{" "}
        They&apos;re saved but left out of every market figure until confirmed. Delete a duplicate
        or a bad row; confirm one that&apos;s real.
      </p>
      {duplicates > 0 && (
        <p style={{ margin: "8px 0 0" }}>
          <button type="button" disabled={busy !== null} onClick={dedupe}>
            {busy === "all" ? "Deleting…" : `Dedupe: delete all ${duplicates} duplicate${duplicates === 1 ? "" : "s"}`}
          </button>{" "}
          <span className="muted">Keeps the original of each pair.</span>
        </p>
      )}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="summary-table log-table">
          <thead>
            <tr>
              <th>Why held</th>
              <th>Comp</th>
              <th>Details</th>
              <th>Already in Hopper</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const orig = c.duplicate_of ? originals[c.duplicate_of] : undefined;
              return (
                <tr key={c.id}>
                  <td>
                    {(c.review_flags ?? []).map((f) => (
                      <span key={f} className="doc-type" style={{ marginRight: 4 }}>
                        {REVIEW_FLAG_LABELS[f as ReviewFlag] ?? f}
                      </span>
                    ))}
                  </td>
                  <td>
                    <span className="doc-type">{c.comp_type === "sale" ? "SALE" : "LEASE"}</span>{" "}
                    <Link href={`/comps/${c.id}`}>{c.address}</Link>
                    {c.market ? <span className="muted"> · {c.market}</span> : null}
                    {c.source_ref ? <div className="muted">{c.source_ref}</div> : null}
                  </td>
                  <td>{line(c)}</td>
                  <td>
                    {orig ? (
                      <>
                        <Link href={`/comps/${orig.id}`}>{orig.address}</Link>
                        <div className="muted">{line(orig)}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" disabled={busy !== null} onClick={() => decide(c.id, "confirm")}>
                      Confirm
                    </button>{" "}
                    <button type="button" className="secondary" disabled={busy !== null} onClick={() => decide(c.id, "delete")}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
