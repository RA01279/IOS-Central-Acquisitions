"use client";
// components/RentCalculator.tsx
//
// "Rent calculator" in the sidebar and the phone menu: a pop-up that converts
// rent per usable acre per month into rent per square foot of usable land per
// month (and back), and -- given the usable acres -- the site's total monthly
// and annual rent. 1 acre = 43,560 SF. Per-SF to 8 decimal places, dollars to
// the cent. Pure arithmetic in the browser; nothing is saved.
//
// The pop-up is rendered on document.body so it covers the page wherever the
// link sits (the phone menu is a sliding sheet).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator } from "lucide-react";
import { SF_PER_ACRE, perAcreToPerSf, perSfToPerAcre, parseRate, siteRent, usd } from "@/lib/rent-convert";

export default function RentCalculator({ onOpen }: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [perAcre, setPerAcre] = useState("");
  const [perSf, setPerSf] = useState("");
  const [acres, setAcres] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

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
  const total = siteRent(parseRate(perAcre), parseRate(acres));

  const field = (label: string, key: string, value: string, set: (v: string) => void, placeholder: string, prefix = "$", autoFocus = false) => (
    <label className="calc-field">
      <span>{label}</span>
      <div className="calc-input">
        {prefix ? <span>{prefix}</span> : null}
        <input autoFocus={autoFocus} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
        <button type="button" className="calc-copy" disabled={!value} onClick={() => copy(key, value)}>{copied === key ? "Copied" : "Copy"}</button>
      </div>
    </label>
  );

  const dialog = open ? (
    <div className="calc-backdrop" role="presentation" onClick={() => setOpen(false)}>
      <div className="calc-dialog" role="dialog" aria-modal="true" aria-labelledby="calc-title" onClick={(e) => e.stopPropagation()}>
        <div className="calc-head">
          <h2 id="calc-title">Rent calculator</h2>
          <button type="button" className="calc-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="calc-hint">Usable land rent. Type in either rate box; 1 acre = {SF_PER_ACRE.toLocaleString()} SF.</p>
        {field("$ per usable acre / month", "acre", perAcre, fromAcre, "7,000", "$", true)}
        {field("$ per SF of usable land / month", "sf", perSf, fromSf, "0.16069789")}
        {field("Usable acres (optional)", "acres", acres, setAcres, "5", "")}
        {total ? (
          <dl className="calc-results">
            <div><dt>Monthly rent</dt><dd>{usd(total.monthly)}</dd></div>
            <div><dt>Annual rent</dt><dd>{usd(total.annual)}</dd></div>
            <div><dt>Usable SF</dt><dd>{Math.round(total.usableSf).toLocaleString()}</dd></div>
            <div><dt>$ / SF / year</dt><dd>${total.perSfAnnual}</dd></div>
          </dl>
        ) : (
          <p className="calc-hint" style={{ margin: 0 }}>Add the usable acres to see the site&apos;s monthly and annual rent.</p>
        )}
        <p className="calc-hint" style={{ marginBottom: 0 }}>Per SF = per acre ÷ {SF_PER_ACRE.toLocaleString()}, to 8 decimal places. Monthly rent = per acre × usable acres.</p>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button type="button" className="hs-link hs-tool" onClick={() => { onOpen?.(); setOpen(true); }}>
        <Calculator size={17} strokeWidth={1.75} />
        Rent calculator
      </button>
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
