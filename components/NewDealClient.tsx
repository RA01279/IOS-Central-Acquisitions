"use client";
// New Deal: the Import panel (OM / Outlook) above the form. When an import
// lands, the form remounts prefilled for review.

import { useState } from "react";
import DealForm from "./DealForm";
import DealImport, { ImportReview, type ImportedFile } from "./DealImport";
import type { DealImport as Draft } from "@/lib/agents/deal-import";

export default function NewDealClient() {
  const [imp, setImp] = useState<{ draft: Draft; file: ImportedFile | null; source: string; n: number } | null>(null);
  return (
    <>
      <DealImport onImported={(draft, file, source) => setImp((p) => ({ draft, file, source, n: (p?.n ?? 0) + 1 }))} />
      {imp && <ImportReview draft={imp.draft} source={imp.source} file={imp.file} />}
      <DealForm key={imp?.n ?? 0} prefill={imp?.draft.fields} importedFile={imp?.file ?? null} />
    </>
  );
}
