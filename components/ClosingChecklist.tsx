"use client";
// components/ClosingChecklist.tsx
//
// The closing checklist on the Diligence tab, and importing counsel's
// "Critical Dates and Closing Checklist" Word file: upload -> preview what it
// holds (dates against the schedule, checklist items, contract price) ->
// apply. The file itself is filed in the vault.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type ChecklistRow = {
  id: string;
  section: string;
  item: string;
  responsible: string | null;
  signatories: string | null;
  status: string | null;
  done: boolean;
  notes: string | null;
};

type Preview = {
  property: string | null;
  contractDate: string | null;
  price: number | null;
  dates: { key: string | null; label: string; due_on: string | null; notes: string | null }[];
  checklist: { section: string; item: string; responsible: string | null; signatories: string | null; status: string | null; done: boolean }[];
  current: { contractPrice: number | null; psaEffectiveOn: string | null; ddEndOn: string | null; closingOn: string | null };
};

const KEY_LABEL: Record<string, string> = {
  psa_effective: "PSA effective", deposit: "Deposit", dd_end: "DD expiry", closing: "Closing", estoppels: "Estoppels",
  title_objections: "Title objections", extension: "Extension", phase1: "Phase I", phase2: "Phase II", survey: "Survey",
  title_commitment: "Title commitment", zoning: "Zoning",
};
const usd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Request failed");
  return out;
}

export default function ClosingChecklist({ dealId, items }: { dealId: string; items: ChecklistRow[] }) {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [opts, setOpts] = useState({ dates: true, checklist: true, price: true, fillSchedule: true });
  const [done, setDone] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const api = `/api/deals/${dealId}/checklist`;

  async function upload(file: File) {
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      if (!/\.docx$/i.test(file.name)) throw new Error("Choose the Word (.docx) version of the checklist.");
      setStep("Uploading…");
      const { path, token } = await call(`/api/deals/${dealId}/vault`, "POST", { action: "upload-url", fileName: file.name });
      const { error: upErr } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(path, token, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const reg = await call(`/api/deals/${dealId}/vault`, "POST", { action: "register", path, fileName: file.name, docType: "checklist" });
      setDocId(reg.id);
      setStep("Reading the checklist…");
      setPreview(await call(api, "POST", { action: "preview", docId: reg.id }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  async function apply() {
    if (!docId) return;
    setStep("Applying…");
    setError(null);
    try {
      const r = await call(api, "POST", { action: "apply", docId, ...opts });
      setDone(
        [
          r.datesSet ? `${r.datesSet} date${r.datesSet === 1 ? "" : "s"} set on the schedule` : null,
          r.itemsAdded ? `${r.itemsAdded} checklist item${r.itemsAdded === 1 ? "" : "s"} added` : null,
          r.itemsUpdated ? `${r.itemsUpdated} updated` : null,
          r.priceSet ? "contract price recorded" : null,
        ].filter(Boolean).join(" · ") || "Nothing to change."
      );
      setPreview(null);
      setDocId(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  async function act(method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await call(api, method, body);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const sections = [...new Set(items.map((i) => i.section))];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="panel">
      <h2>Closing checklist</h2>
      {items.length > 0 && <p className="hint" style={{ marginTop: 0 }}>{doneCount} of {items.length} done</p>}

      <div className="inline-add-form" style={{ width: "100%" }}>
        <label>
          Import counsel&apos;s Critical Dates &amp; Closing Checklist (.docx)
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={step !== null}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
        <span className="hint">Its dates set the diligence schedule above; its document list becomes this checklist. You see everything before it&apos;s applied.</span>
        {step && <p className="hint">{step}</p>}
        {done && <p className="hint"><strong>Done:</strong> {done}</p>}
      </div>

      {preview && (
        <div className="inline-add-form" style={{ width: "100%" }}>
          <p style={{ margin: 0 }}>
            <strong>{preview.property ?? "Checklist"}</strong>
            {preview.contractDate ? ` · contract dated ${day(preview.contractDate)}` : ""}
            {preview.price ? ` · ${usd(preview.price)}` : ""}
          </p>
          {preview.dates.length > 0 && (
            <>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={opts.dates} onChange={(e) => setOpts((o) => ({ ...o, dates: e.target.checked }))} />
                Set {preview.dates.length} critical date{preview.dates.length === 1 ? "" : "s"} on the schedule
              </label>
              <table className="summary-table">
                <thead><tr><th>Date</th><th>Action</th><th>Schedule line</th></tr></thead>
                <tbody>
                  {preview.dates.map((d, i) => (
                    <tr key={i}>
                      <td>{day(d.due_on)}</td>
                      <td>{d.label}{d.notes ? <><br /><span className="muted">{d.notes.split("\n")[0].slice(0, 140)}</span></> : null}</td>
                      <td>{d.key ? KEY_LABEL[d.key] ?? d.key : <span className="muted">added as its own milestone</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {opts.dates && (
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={opts.fillSchedule} onChange={(e) => setOpts((o) => ({ ...o, fillSchedule: e.target.checked }))} />
                  Also add the rest of the standard schedule (title, survey, Phase I, zoning…) from the effective date
                </label>
              )}
            </>
          )}
          {preview.checklist.length > 0 && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={opts.checklist} onChange={(e) => setOpts((o) => ({ ...o, checklist: e.target.checked }))} />
              Add {preview.checklist.length} checklist items ({preview.checklist.filter((c) => c.done).length} already marked executed / delivered)
            </label>
          )}
          {preview.price != null && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={opts.price} disabled={preview.current.contractPrice != null}
                onChange={(e) => setOpts((o) => ({ ...o, price: e.target.checked }))} />
              {preview.current.contractPrice != null
                ? `Contract price already recorded (${usd(preview.current.contractPrice)}); left as is`
                : `Record ${usd(preview.price)} as the contract price`}
            </label>
          )}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" onClick={() => void apply()} disabled={step !== null}>Apply</button>
            <button type="button" className="secondary" onClick={() => { setPreview(null); setDocId(null); }}>Cancel</button>
            <span className="hint">The file stays in the vault either way.</span>
          </div>
        </div>
      )}

      {sections.map((s) => (
        <div key={s} style={{ overflowX: "auto" }}>
          <p className="label" style={{ margin: "12px 0 4px" }}>{s}</p>
          <table className="summary-table">
            <thead><tr><th style={{ width: 40 }}>Done</th><th>Document</th><th>Responsible</th><th>Signatories</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.filter((i) => i.section === s).map((i) => (
                <tr key={i.id} style={{ opacity: i.done ? 0.6 : 1 }}>
                  <td><input type="checkbox" checked={i.done} disabled={busy} aria-label={`Done: ${i.item}`} onChange={(e) => void act("PATCH", { itemId: i.id, done: e.target.checked })} /></td>
                  <td>{i.item}</td>
                  <td>{i.responsible ?? "—"}</td>
                  <td>{i.signatories ?? "—"}</td>
                  <td>
                    <input defaultValue={i.status ?? ""} placeholder="—" disabled={busy} style={{ minWidth: 140 }}
                      onBlur={(e) => { if (e.target.value.trim() !== (i.status ?? "")) void act("PATCH", { itemId: i.id, status: e.target.value }); }} />
                  </td>
                  <td><button type="button" className="secondary" title="Remove" disabled={busy} onClick={() => { if (confirm(`Remove "${i.item}"?`)) void act("DELETE", { itemId: i.id }); }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <form className="stage-actions" style={{ marginBottom: 0, marginTop: 8 }}
        onSubmit={(e) => { e.preventDefault(); void act("POST", { action: "add", item: newItem }).then(() => setNewItem("")); }}>
        <input placeholder="Add a checklist item, e.g. SNDA from lender" value={newItem} onChange={(e) => setNewItem(e.target.value)} style={{ minWidth: 280 }} />
        <button type="submit" className="secondary" disabled={!newItem.trim() || busy}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
