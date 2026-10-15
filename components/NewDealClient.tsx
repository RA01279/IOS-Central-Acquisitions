"use client";
// New Deal: the Import panel (OM / Outlook) above the form. When an import
// lands, the form remounts prefilled for review. A portfolio OM has its own
// panel: one deal per site, grouped as a portfolio.

import { useState } from "react";
import DealForm from "./DealForm";
import DealImport, { ImportReview, type ImportedFile } from "./DealImport";
import PortfolioImport from "./PortfolioImport";
import type { DealImport as Draft } from "@/lib/agents/deal-import";

export default function NewDealClient() {
  const [kind, setKind] = useState<"single" | "portfolio">("single");
  const [imp, setImp] = useState<{ draft: Draft; file: ImportedFile | null; source: string; n: number } | null>(null);
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button type="button" className={kind === "single" ? "on" : ""} onClick={() => setKind("single")} style={{ fontFamily: "var(--font-body)" }}>
          Single property
        </button>
        <button type="button" className={kind === "portfolio" ? "on" : ""} onClick={() => setKind("portfolio")} style={{ fontFamily: "var(--font-body)" }}>
          Portfolio OM
        </button>
      </div>
      {kind === "portfolio" ? (
        <PortfolioImport />
      ) : (
        <>
          <DealImport onImported={(draft, file, source) => setImp((p) => ({ draft, file, source, n: (p?.n ?? 0) + 1 }))} />
          {imp && <ImportReview draft={imp.draft} source={imp.source} file={imp.file} />}
          <DealForm key={imp?.n ?? 0} prefill={imp?.draft.fields} importedFile={imp?.file ?? null} />
        </>
      )}
    </>
  );
}
