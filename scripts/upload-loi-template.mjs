// scripts/upload-loi-template.mjs
// Uploads the tagged LOI template to private Supabase Storage (bucket
// "documents", path templates/loi-ios.docx). Kept OUT of the git repo on
// purpose -- it's a company form document.
//   node scripts/upload-loi-template.mjs <tagged.docx> [dest-path]
//   dest-path defaults to templates/loi-ios.docx; use templates/loi-slb.docx
//   for the sale-leaseback variant.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const file = process.argv[2];
const dest = process.argv[3] ?? "templates/loi-ios.docx";
if (!file) { console.error("usage: node upload-loi-template.mjs <tagged.docx> [dest-path]"); process.exit(1); }

// Ensure the bucket exists (it's also used for deal uploads).
const { data: buckets } = await supabase.storage.listBuckets();
if (!(buckets ?? []).some((b) => b.name === "documents")) {
  const { error } = await supabase.storage.createBucket("documents", { public: false });
  if (error) throw error;
  console.log("Created private bucket: documents");
}

const buf = readFileSync(file);
const { error } = await supabase.storage
  .from("documents")
  .upload(dest, buf, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
if (error) throw error;
console.log(`Uploaded ${dest} (${buf.length} bytes)`);
