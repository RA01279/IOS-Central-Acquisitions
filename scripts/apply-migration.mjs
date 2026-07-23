// scripts/apply-migration.mjs
// Applies a SQL migration file to the Hopper Supabase project via the
// Management API. Usage: node scripts/apply-migration.mjs <path-to-sql>
// Reads SUPABASE_ACCESS_TOKEN and the project ref from .env.local.
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);

const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_URL.replace("https://", "").split(".")[0];
const file = process.argv[2];
if (!token || !ref || !file) {
  console.error("Missing token, project ref, or SQL file argument");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 2000));
process.exit(res.ok ? 0 : 1);
