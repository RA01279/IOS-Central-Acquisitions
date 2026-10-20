// scripts/backfill-model-detail.mts
//
// Fills uw_versions.model_detail for model versions uploaded before uploads
// started saving all of it: the price x exit-cap sensitivity tables (Financials
// tab) and the rent roll / debt / returns snapshot (Underwriting tab, under
// "uw"). Reads each version's stored workbook with the IC deck parser, exactly
// as an upload does today. Versions that already have both are skipped; an
// existing value is kept, the missing part added.
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
const { modelDetailOf } = await import(new URL("../lib/uw/model-snapshot.ts", import.meta.url).href);

const db = getServiceClient();
const { data: all, error } = await db
  .from("uw_versions")
  .select("id, version_number, model_detail, excel_document_id, deals(ref, properties(address))")
  .not("excel_document_id", "is", null)
  .order("created_at");
if (error) throw new Error(error.message);
const versions = (all ?? []).filter((v: any) => !v.model_detail || !v.model_detail.uw);
// excel_document_id has no foreign key, so the files are looked up by id.
const docIds = [...new Set(versions.map((v: any) => v.excel_document_id))];
const pathOf = new Map<string, string>();
for (let i = 0; i < docIds.length; i += 100) {
  const { data: docs, error: docErr } = await db.from("documents").select("id, storage_path").in("id", docIds.slice(i, i + 100));
  if (docErr) throw new Error(docErr.message);
  for (const d of docs ?? []) pathOf.set(d.id, d.storage_path);
}

let written = 0, notStandard = 0, missing = 0, tables = 0;
for (const v of versions as any[]) {
  const path = pathOf.get(v.excel_document_id);
  const label = `D-${v.deals?.ref} ${v.deals?.properties?.address ?? ""} v${v.version_number}`;
  if (!path) { missing++; continue; }
  const { data: file } = await db.storage.from("documents").download(path);
  if (!file) { missing++; console.log(`missing file  ${label}`); continue; }
  let fresh: Record<string, unknown>;
  try {
    fresh = modelDetailOf(extractModel(openWorkbook(new Uint8Array(await file.arrayBuffer())), path.split("/").pop()!));
  } catch {
    notStandard++;
    continue;
  }
  // Keep whatever is already stored; add what's missing.
  const detail = { ...fresh, ...(v.model_detail ?? {}) };
  if (!v.model_detail?.sensitivities && fresh.sensitivities) tables++;
  if (apply) {
    const { error: upErr } = await db.from("uw_versions").update({ model_detail: detail }).eq("id", v.id);
    if (upErr) { console.log(`FAILED        ${label}: ${upErr.message}`); continue; }
  }
  written++;
  const uw = fresh.uw as { rentRoll: unknown[] };
  console.log(`${apply ? "written " : "would write"}  ${label}  (${uw.rentRoll.length} tenant${uw.rentRoll.length === 1 ? "" : "s"}${!v.model_detail?.sensitivities && fresh.sensitivities ? ", + sensitivity tables" : ""})`);
}
console.log(`\n${versions.length} versions missing detail: ${written} ${apply ? "written" : "would be written"} (${tables} also gain sensitivity tables), ${notStandard} not the standard model, ${missing} file missing.`);
if (!apply) console.log("Dry run -- nothing changed. Re-run with --apply to write.");
