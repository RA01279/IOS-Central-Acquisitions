"use client";
// components/LoiPanel.tsx
//
// Generate LOI from a deal (UW stage onward), in two flavors:
//   * Standard        -- straight purchase
//   * Sale-leaseback  -- adds seller/broker address block, lease term,
//                        rent (quotable per month / per acre / per building
//                        SF monthly or annually), escalations, expiry date
// Fields prefill: previously saved terms -> live deal data -> defaults.
// Generating saves every field back to the deal.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type LoiDefaults = Record<string, string>;

const FIELDS = [
  "loiType", "date", "tel", "senderEmail", "attn", "sellerClause", "sellerName",
  "brokerFirm", "brokerAddress1", "brokerAddress2", "propertyDescription",
  "price", "priceWords", "buildingSf", "acres", "leaseTermYears", "rentAmount",
  "rentBasis", "escalations", "expiryDate", "depositWords", "depositAmount",
  "ddDays", "closingDays", "brokerClauseName", "commissionPayer",
  "signer1Name", "signer1Title", "signer2Name", "signer2Title",
];

export default function LoiPanel({ dealId, defaults }: { dealId: string; defaults: LoiDefaults }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loiType, setLoiType] = useState(defaults.loiType || "standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSlb = loiType === "slb";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = { loiType };
    for (const k of FIELDS) {
      if (k === "loiType") continue;
      const v = form.get(k);
      if (v !== null) payload[k] = v as string;
    }
    try {
      const res = await fetch(`/api/deals/${dealId}/loi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "LOI generation failed");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(cd)?.[1] ?? "LOI.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Letter of Intent</h2>
      {!open ? (
        <div className="stage-actions" style={{ marginBottom: 0 }}>
          <button onClick={() => setOpen(true)}>Generate LOI</button>
          <span className="muted">
            Prefills from this deal; anything you type is saved for next time.
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <label>
              LOI type
              <select value={loiType} onChange={(e) => setLoiType(e.target.value)}>
                <option value="standard">Standard purchase</option>
                <option value="slb">Sale-leaseback (SLB)</option>
              </select>
            </label>
            <label>
              LOI date
              <input name="date" type="date" defaultValue={defaults.date} required />
            </label>
            <label>
              Market officer phone
              <input name="tel" defaultValue={defaults.tel} />
            </label>
            {isSlb ? (
              <label>
                Sender email (letterhead)
                <input name="senderEmail" defaultValue={defaults.senderEmail} />
              </label>
            ) : (
              <label>
                Seller (name, or leave as-is)
                <input name="sellerClause" defaultValue={defaults.sellerClause} />
              </label>
            )}
            <label>
              Attn (broker contact)
              <input name="attn" defaultValue={defaults.attn} required />
            </label>
            {isSlb && (
              <label>
                Seller / addressee company
                <input name="sellerName" defaultValue={defaults.sellerName} required />
              </label>
            )}
          </div>

          {isSlb && (
            <div className="grid-2">
              <label>
                Broker firm
                <input name="brokerFirm" defaultValue={defaults.brokerFirm} required />
              </label>
              <label>
                Broker address line 1
                <input name="brokerAddress1" defaultValue={defaults.brokerAddress1} />
              </label>
              <label>
                Broker address line 2 (city, state, zip)
                <input name="brokerAddress2" defaultValue={defaults.brokerAddress2} />
              </label>
              <label>
                Offer expires on
                <input name="expiryDate" type="date" defaultValue={defaults.expiryDate} />
              </label>
            </div>
          )}

          <label>
            Property description
            <input name="propertyDescription" defaultValue={defaults.propertyDescription} required />
          </label>

          <div className="grid-2">
            <label>
              Price ($)
              <input name="price" defaultValue={defaults.price} required />
            </label>
            {isSlb && (
              <label>
                Price in words
                <input
                  name="priceWords"
                  defaultValue={defaults.priceWords}
                  placeholder="e.g. Four Million, Two Hundred Thousand"
                  required
                />
              </label>
            )}
            {isSlb && (
              <>
                <label>
                  Building SF
                  <input name="buildingSf" defaultValue={defaults.buildingSf} />
                </label>
                <label>
                  Usable acres
                  <input name="acres" defaultValue={defaults.acres} />
                </label>
              </>
            )}
            <label>
              Deposit amount ($)
              <input name="depositAmount" defaultValue={defaults.depositAmount} required />
            </label>
            <label>
              Deposit in words
              <input
                name="depositWords"
                defaultValue={defaults.depositWords}
                placeholder="e.g. Fifty Thousand"
                required
              />
            </label>
            <label>
              Commission paid by
              <select name="commissionPayer" defaultValue={defaults.commissionPayer}>
                <option value="Seller">Seller</option>
                <option value="Buyer">Buyer</option>
              </select>
            </label>
            <label>
              Due diligence period
              <input name="ddDays" defaultValue={defaults.ddDays} placeholder="e.g. Sixty (60)" />
            </label>
            <label>
              Closing (days after DD)
              <input name="closingDays" defaultValue={defaults.closingDays} placeholder="e.g. thirty (30)" />
            </label>
          </div>

          {isSlb && (
            <div className="grid-2">
              <label>
                Leaseback term (years)
                <input name="leaseTermYears" defaultValue={defaults.leaseTermYears} placeholder="e.g. 3" required />
              </label>
              <label>
                Rent escalations (% / yr)
                <input name="escalations" defaultValue={defaults.escalations} placeholder="e.g. 3.5" required />
              </label>
              <label>
                Lease rate ($)
                <input name="rentAmount" defaultValue={defaults.rentAmount} placeholder="e.g. 34,500 or 1.75" required />
              </label>
              <label>
                Rate basis
                <select name="rentBasis" defaultValue={defaults.rentBasis || "total_monthly"}>
                  <option value="total_monthly">Total $ / month</option>
                  <option value="per_acre_monthly">$ / acre / month</option>
                  <option value="per_sf_monthly">$ / SF of building / month</option>
                  <option value="per_sf_annual">$ / SF of building / year</option>
                </select>
              </label>
            </div>
          )}

          {!isSlb && (
            <label>
              Broker clause (name of firm)
              <input
                name="brokerClauseName"
                defaultValue={defaults.brokerClauseName}
                placeholder="e.g. Jane Doe of XYZ Brokerage"
                required
              />
            </label>
          )}

          <div className="grid-2">
            <label>
              Signer 1
              <input name="signer1Name" defaultValue={defaults.signer1Name} />
            </label>
            <label>
              Signer 1 title
              <input name="signer1Title" defaultValue={defaults.signer1Title} />
            </label>
            <label>
              Signer 2
              <input name="signer2Name" defaultValue={defaults.signer2Name} />
            </label>
            <label>
              Signer 2 title
              <input name="signer2Title" defaultValue={defaults.signer2Title} />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={busy}>
              {busy ? "Generating…" : "Generate & download"}
            </button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
