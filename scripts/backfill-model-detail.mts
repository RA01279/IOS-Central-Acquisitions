// scripts/backfill-model-detail.mts
//
// Fills uw_versions.model_detail (the price x exit-cap sensitivity tables on
// the Financials tab) for model versions uploaded before uploads started
// saving it. Reads each version's stored workbook with the IC deck parser,
// exactly as an upload does today.
//
// Dry run by default -- reports what it would write and changes nothing:
//   npx tsx --tsconfig tsconfig.json scripts/backfill-model-detail.mts
// Write:
//   npx tsx --tsconfig tsconfig.json scripts/backfill-model-detail.mts --apply
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.

const apply = process.argv.includes("--apply");
const { getServiceClient } = await import(new URL("../lib/supabase.ts", import.meta.url).href);
const { openWorkbook } = await import(new URL("../lib/ic-deck/xlsx-lite.ts", import.meta.url).href);
const { extractModel } = await import(new URL("../lib/ic-deck/model.ts", import.meta.url).href);

const db = getServiceClient();
const { data: versions, error } = await db
  .from("uw_versions")
  .select("id, version_number, model_detail, excel_document_id, deals(ref, properties(address))")
  .is("model_detail", null)
  .not("excel_document_id", "is", null)
  .order("created_at");
if (error) throw new Error(error.message);
// excel_document_id has no foreign key, so the files are looked up by id.
const docIds = [...new Set((versions ?? []).map((v: any) => v.excel_document_id))];
const pathOf = new Map<string, string>();
for (let i = 0; i < docIds.length; i += 100) {
  const { data: docs, error: docErr } = await db.from("documents").select("id, storage_path").in("id", docIds.slice(i, i + 100));
  if (docErr) throw new Error(docErr.message);
  for (const d of docs ?? []) pathOf.set(d.id, d.storage_path);
}
for (const v of versions ?? []) (v as any).documents = { storage_path: pathOf.get((v as any).excel_document_id) };

let written = 0, notStandard = 0, noTables = 0, missing = 0;
for (const v of versions ?? []) {
  const path = (v as any).documents?.storage_path;
  const label = `D-${(v as any).deals?.ref} ${(v as any).deals?.properties?.address ?? ""} v${v.version_number}`;
  if (!path) { missing++; continue; }
  const { data: file } = await db.storage.from("documents").download(path);
  if (!file) { missing++; console.log(`missing file  ${label}`); continue; }
  let detail: Record<string, unknown> | null = null;
  try {
    const m = extractModel(openWorkbook(new Uint8Array(await file.arrayBuffer())), path.split("/").pop()!);
    if (m.sensitivities.deal || m.sensitivities.lp) {
      detail = { sensitivities: m.sensitivities, exitCap: m.yields.exitCap, warnings: m.warnings.filter((w: string) => /sensitivity/i.test(w)) };
    } else noTables++;
  } catch {
    notStandard++;
    continue;
  }
  if (!detail) continue;
  if (apply) {
    const { error: upErr } = await db.from("uw_versions").update({ model_detail: detail }).eq("id", v.id).is("model_detail", null);
    if (upErr) { console.log(`FAILED        ${label}: ${upErr.message}`); continue; }
  }
  written++;
  const covers = (detail as any).warnings.length ? `  (${(detail as any).warnings.length} table warning${(detail as any).warnings.length === 1 ? "" : "s"})` : "";
  console.log(`${apply ? "written " : "would write"}  ${label}${covers}`);
}
console.log(`\n${versions?.length ?? 0} versions without tables: ${written} ${apply ? "written" : "would be written"}, ${notStandard} not the standard model, ${noTables} standard model without tables, ${missing} file missing.`);
if (!apply) console.log("Dry run -- nothing changed. Re-run with --apply to write.");
