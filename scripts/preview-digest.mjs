// scripts/preview-digest.mjs
// Writes the morning brief's HTML to a file so you can open it in a browser
// before it goes out.
//
//   node scripts/preview-digest.mjs [out.html] [baseUrl]
//   node scripts/preview-digest.mjs brief.html http://localhost:3000
//
// This used to re-implement the brief's composition, which made it the third
// copy of the same HTML (cron route, lib/digest.ts, here) and the three
// drifted. It now pulls the real thing from the RSS feed -- the same bytes the
// Power Automate flow emails -- so a preview can never disagree with what the
// team receives. The feed's ?key= is the export token, read straight from
// app_settings with the service key.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""),
      l.slice(l.indexOf("=") + 1).trim(),
    ])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const out = process.argv[2] ?? "digest-preview.html";
const baseUrl = (process.argv[3] ?? "https://ios-central-acquisitions.vercel.app").replace(/\/$/, "");

const { data: tokenRow, error } = await supabase
  .from("app_settings")
  .select("value")
  .eq("key", "export_token")
  .maybeSingle();
if (error) {
  console.error(`Could not read export_token: ${error.message}`);
  process.exit(1);
}
if (!tokenRow?.value) {
  console.error(
    "No 'export_token' row in app_settings -- the RSS feed and export API are both keyed on it."
  );
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/digest/rss?key=${encodeURIComponent(tokenRow.value)}`);
if (!res.ok) {
  console.error(`${baseUrl} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const xml = await res.text();

// The item's title is the email subject; the channel has its own title first.
const title = /<item>[\s\S]*?<title>([^<]*)<\/title>/.exec(xml)?.[1];
const html = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(xml)?.[1];
if (!html) {
  console.error("Could not find the brief HTML in the feed. Feed head:\n" + xml.slice(0, 400));
  process.exit(1);
}

writeFileSync(out, html);
console.log(`Wrote ${out} from ${baseUrl}`);
if (title) console.log(`Subject: ${title.replace(/&amp;/g, "&").replace(/&lt;/g, "<")}`);
