// scripts/rotate-export-token.mjs
// Issues a new export token (guards /api/export and the RSS digest feed) and
// prints it once. Anything holding the old token stops working immediately.
// Usage: node scripts/rotate-export-token.mjs
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const token = randomBytes(24).toString("hex");

const res = await fetch(`${env.SUPABASE_URL}/rest/v1/app_settings?key=eq.export_token`, {
  method: "PATCH",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({ value: token }),
});
const rows = await res.json();
if (!res.ok || !Array.isArray(rows) || rows.length !== 1) {
  console.error(`Rotation failed (HTTP ${res.status}). The old token is still active.`);
  process.exitCode = 1;
} else {
  console.log(`New export token: ${token}`);
  console.log("Export: https://ios-central-acquisitions.vercel.app/api/export?token=" + token);
}
