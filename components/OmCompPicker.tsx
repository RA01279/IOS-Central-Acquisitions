"use client";
// components/OmCompPicker.tsx
//
// Comps out of an offering memorandum. Drop an OM PDF (or arrive from a deal's
// OM with ?om=<dealId>:<docId>), and its lease and sale comparables pages are
// read by the comp-import agent on the Hopper helper. The rows land in the
// normal review step -- nothing saves until the person clicks Save -- and saved
// comps are geocoded onto the comps map like any other.

import { useEffect, useRef, useState } from "react";
import { pdfText } from "@/lib/pdf-text";
import { parseCompImport } from "@/lib/agents/comp-import";
import { compPages, omCompSource } from "@/lib/om-comps";
import type { CompSourcePart } from "./OutlookCompPicker";

export default function OmCompPicker({
  onSelect,
  disabled,
  initialDoc,
}: {
  onSelect: (parts: CompSourcePart[]) => void;
  disabled?: boolean;
  /** An OM already on a deal: { dealId, docId, name }. Read on open. */
  initialDoc?: { dealId: string; docId: string; name: string } | null;
}) {
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentsOnline, setAgentsOnline] = useState<boolean | null>(null);
  const alive = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    alive.current = true;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((a) => alive.current && setAgentsOnline(!!a.online))
      .catch(() => alive.current && setAgentsOnline(false));
    return () => { alive.current = false; };
  }, []);

  async function readTables(text: string) {
    const post = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "comp-import", text: text.slice(0, 98000) }),
    });
    const queued = await post.json();
    if (!post.ok) throw new Error(queued.error || "Could not start reading the OM.");
    const deadline = Date.now() + 10 * 60000;
    while (alive.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const run = await (await fetch(`/api/agents?id=${queued.id}`, { cache: "no-store" })).json();
      if (run.status === "failed") throw new Error(run.error || "The helper could not read this OM.");
      if (run.status === "completed") {
        const parsed = parseCompImport(run.result?.report ?? "");
        if (!parsed) throw new Error("The helper's answer wasn't comp tables. Try again.");
        return parsed;
      }
    }
    throw new Error("Reading the OM is taking too long. Check the Hopper helper is still running.");
  }

  async function read(buf: ArrayBuffer, name: string, ref: string) {
    setError(null);
    try {
      setStep(`Reading ${name}…`);
      const pdf = await pdfText(buf, 900000, 400);
      if (pdf.scanned) throw new Error("This PDF is scanned images with no text layer, so its comps can't be read. Enter them by hand.");
      const pages = compPages(pdf.text);
      if (!pages.found) {
        onSelect([{ label: name, payload: null, warnings: ["No lease or sale comparables pages found in this OM."] }]);
        return;
      }
      setStep(`Reading the comps on page${pages.pages.length === 1 ? "" : "s"} ${pages.pages.join(", ")} with the Hopper helper… (usually under a minute)`);
      const tables = await readTables(omCompSource(name, pages.text));
      const warn = [
        `Read from the OM's comparables pages (${pages.pages.join(", ")}). Check each row against the OM before saving; the subject property itself is excluded.`,
        ...tables.notes,
      ];
      if (!tables.leases && !tables.sales) {
        onSelect([{ label: name, payload: null, warnings: ["No executed leases or closed sales found on the OM's comparables pages.", ...tables.notes] }]);
        return;
      }
      const parts: CompSourcePart[] = [];
      if (tables.leases) parts.push({ label: name, payload: { text: tables.leases, defaultCompType: "lease", source: "import", sourceRef: ref }, warnings: warn });
      if (tables.sales) parts.push({ label: name, payload: { text: tables.sales, defaultCompType: "sale", source: "import", sourceRef: ref }, warnings: tables.leases ? [] : warn });
      onSelect(parts);
    } catch (e: any) {
      setError(e?.message ?? "Could not read that OM.");
    } finally {
      if (alive.current) setStep(null);
    }
  }

  // Arriving from a deal: fetch that OM through the vault and read it.
  useEffect(() => {
    if (!initialDoc || started.current) return;
    started.current = true;
    (async () => {
      setStep(`Opening ${initialDoc.name}…`);
      try {
        const res = await fetch(`/api/deals/${initialDoc.dealId}/vault?doc=${initialDoc.docId}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not open that OM.");
        await read(await res.arrayBuffer(), initialDoc.name, `OM: ${initialDoc.name}`);
      } catch (e: any) {
        setError(e.message);
        setStep(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDoc]);

  return (
    <div className="inline-add-form" style={{ width: "100%" }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Drop an offering memorandum (PDF). Hopper finds its lease and sale comparables pages, reads the comps with the
        Hopper helper, and lists them below for review. The subject property&apos;s own rent roll and price are left out.
      </p>
      <input
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled || step !== null}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await read(await f.arrayBuffer(), f.name, `OM: ${f.name}`);
          e.target.value = "";
        }}
      />
      {agentsOnline === false && <p className="error">The Hopper helper is offline. Start it from your desktop, then try again.</p>}
      {step && <p className="hint">{step}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
