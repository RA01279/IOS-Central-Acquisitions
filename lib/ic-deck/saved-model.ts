import { getServiceClient } from "../supabase";
import { extractModel } from "./model";
import { openWorkbook } from "./xlsx-lite";

/** Read the current recorded workbook, never an old embedded model tab. */
export async function loadSavedDeckModel(dealId: string) {
  const db = getServiceClient();
  const { data: version, error } = await db.from("uw_versions")
    .select("id,version_number,excel_document_id,created_at").eq("deal_id", dealId)
    .order("version_number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load the saved underwriting version.");
  if (!version) return null;
  const { data: doc, error: docError } = await db.from("documents").select("storage_path,file_name")
    .eq("id", version.excel_document_id).eq("deal_id", dealId).maybeSingle();
  if (docError || !doc) throw new Error("The current underwriting workbook is missing from this deal.");
  const { data: file, error: downloadError } = await db.storage.from("documents").download(doc.storage_path);
  if (downloadError || !file) throw new Error("Could not read the current underwriting workbook.");
  const name = doc.file_name || doc.storage_path.split("/").pop() || "Saved underwriting.xlsx";
  return { model: extractModel(openWorkbook(await file.arrayBuffer()), name), version: version.version_number, savedAt: version.created_at };
}
