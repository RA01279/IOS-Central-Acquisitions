"use client";
// components/RentCalculator.tsx
//
// "Rent calculator" in the sidebar: a pop-up that converts rent per usable
// acre per month into rent per square foot of usable land per month, and back.
// One acre = 43,560 SF. Per-SF shows 8 decimal places; per-acre shows cents.
// Pure arithmetic in the browser -- nothing is saved.

import { useState } from "react";
import { Calculator } from "lucide-react";
import { SF_PER_ACRE, perAcreToPerSf, perSfToPerAcre, parseRate } from "@/lib/rent-convert";

export default function RentCalculator() {
  const [open, setOpen] = useState(false);
  const [perAcre, setPerAcre] = useState("");
  const [perSf, setPerSf] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const fromAcre = (v: string) => {
    setPerAcre(v);
    const n = parseRate(v);
    setPerSf(n == null ? "" : perAcreToPerSf(n));
  };
  const fromSf = (v: string) => {
    setPerSf(v);
    const n = parseRate(v);
    setPerAcre(n == null ? "" : perSfToPerAcre(n));
  };
  const copy = async (label: string, v: string) => {
    try { await navigator.clipboard.writeText(v); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <>
      <button type="button" className="hs-link hs-tool" onClick={() => setOpen(true)}>
        <Calculator size={17} strokeWidth={1.75} />
        Rent calculator
      </button>
      {open ? (
        <div className="calc-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="calc-dialog" role="dialog" aria-modal="true" aria-labelledby="calc-title" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <div className="calc-head">
              <h2 id="calc-title">Rent calculator</h2>
              <button type="button" className="calc-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="calc-hint">Usable land rent. Type in either box; 1 acre = {SF_PER_ACRE.toLocaleString()} SF.</p>
            <label className="calc-field">
              <span>$ per usable acre / month</span>
              <div className="calc-input">
                <span>$</span>
                <input autoFocus inputMode="decimal" value={perAcre} onChange={(e) => fromAcre(e.target.value)} placeholder="7,500" />
                <button type="button" className="calc-copy" disabled={!perAcre} onClick={() => copy("acre", perAcre)}>{copied === "acre" ? "Copied" : "Copy"}</button>
              </div>
            </label>
            <label className="calc-field">
              <span>$ per SF of usable land / month</span>
              <div className="calc-input">
                <span>$</span>
                <input inputMode="decimal" value={perSf} onChange={(e) => fromSf(e.target.value)} placeholder="0.17217631" />
                <button type="button" className="calc-copy" disabled={!perSf} onClick={() => copy("sf", perSf)}>{copied === "sf" ? "Copied" : "Copy"}</button>
              </div>
            </label>
            <p className="calc-hint" style={{ marginBottom: 0 }}>Per SF = per acre ÷ {SF_PER_ACRE.toLocaleString()}, to 8 decimal places.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
