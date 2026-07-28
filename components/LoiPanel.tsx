"use client";
// components/LoiPanel.tsx
//
// Generate LOI from a deal (UW stage onward). Fields prefill in priority
// order: previously saved terms for this deal -> live deal data (offer
// price, broker/seller contacts, address) -> standing defaults. Generating
// saves every field back to the deal, so terms are typed once.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type LoiDefaults = {
  date: string;
  tel: string;
  attn: string;
  sellerClause: string;
  propertyDescription: string;
  price: string;
  depositWords: string;
  depositAmount: string;
  ddDays: string;
  closingDays: string;
  brokerClauseName: string;
  commissionPayer: string;
  signer1Name: string;
  signer1Title: string;
  signer2Name: string;
  signer2Title: string;
};

export default function LoiPanel({ dealId, defaults }: { dealId: string; defaults: LoiDefaults }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(
      [
        "date", "tel", "attn", "sellerClause", "propertyDescription", "price",
        "depositWords", "depositAmount", "ddDays", "closingDays",
        "brokerClauseName", "commissionPayer",
        "signer1Name", "signer1Title", "signer2Name", "signer2Title",
      ].map((k) => [k, (form.get(k) as string) ?? ""])
    );
    try {
      const res = await fetch(`/api/deals/${dealId}/loi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "LOI generation failed");
      // Trigger the browser download of the returned .docx.
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
      router.refresh(); // documents list + activity trail update
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
              LOI date
              <input name="date" type="date" defaultValue={defaults.date} required />
            </label>
            <label>
              Market officer phone
              <input name="tel" defaultValue={defaults.tel} />
            </label>
            <label>
              Attn (broker, firm)
              <input name="attn" defaultValue={defaults.attn} required />
            </label>
            <label>
              Seller (name, or leave as-is)
              <input name="sellerClause" defaultValue={defaults.sellerClause} />
            </label>
          </div>
          <label>
            Property description
            <input name="propertyDescription" defaultValue={defaults.propertyDescription} required />
          </label>
          <div className="grid-2">
            <label>
              Price ($)
              <input name="price" defaultValue={defaults.price} required />
            </label>
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
              <input name="ddDays" defaultValue={defaults.ddDays} placeholder='e.g. Sixty (60)' />
            </label>
            <label>
              Closing (days after DD)
              <input name="closingDays" defaultValue={defaults.closingDays} placeholder='e.g. thirty (30)' />
            </label>
          </div>
          <label>
            Broker clause (name of firm)
            <input
              name="brokerClauseName"
              defaultValue={defaults.brokerClauseName}
              placeholder="e.g. Jane Doe of XYZ Brokerage"
              required
            />
          </label>
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
