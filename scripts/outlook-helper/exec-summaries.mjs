// scripts/outlook-helper/exec-summaries.mjs
//
// Copies each automatic executive summary Hopper builds into the deal's
// folder on the shared drive:  <root>\<ST>\<ST> (<City>) <Address>\01. Exec Sum\
// The folder is found by street address (house number + street name, with
// suffixes like St/Street folded). Nothing is ever overwritten, and a deal
// with no matching folder is reported back to Hopper instead of guessed.

import { readdir, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_ROOT = "F:\\Investments\\Acquisitions\\Live\\IOS";
const EXEC_SUM = "01. Exec Sum";

const WORDS = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", boulevard: "blvd", parkway: "pkwy", pky: "pkwy",
  highway: "hwy", freeway: "fwy", lane: "ln", court: "ct", circle: "cir", place: "pl", terrace: "ter", trail: "trl",
  expressway: "expy", square: "sq", north: "n", south: "s", east: "e", west: "w",
};
const SUFFIXES = new Set(["st", "ave", "rd", "dr", "blvd", "pkwy", "hwy", "fwy", "ln", "ct", "cir", "pl", "ter", "trl", "way", "expy", "sq", "loop"]);
export function addressKey(s) {
  const words = String(s ?? "").toLowerCase().replace(/[.,#]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean).map(w => WORDS[w] ?? w);
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join("");
}
/** "TX (Houston) 12047 Proctor St" -> "12047 Proctor St" */
const folderAddress = name => name.replace(/^[A-Z]{2}\s*\([^)]*\)\s*/, "").trim();

/** Every deal folder under <root>\<ST>\ (two levels), matched by address. */
export async function findDealFolder(root, address) {
  const want = addressKey(address);
  if (want.length < 6) return null;
  const matches = [];
  let states = [];
  try { states = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && /^[A-Z]{2}$/.test(d.name)).map(d => d.name); } catch { return null; }
  for (const st of states) {
    let deals = [];
    try { deals = (await readdir(join(root, st), { withFileTypes: true })).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of deals) if (addressKey(folderAddress(d.name)) === want) matches.push(join(root, st, d.name));
  }
  return matches.length === 1 ? matches[0] : null;
}

export function startExecSummaryLoop({ base, token, root = DEFAULT_ROOT }) {
  let stopped = false;
  const call = async (method, body) => {
    const response = await fetch(new URL("/api/exec-summaries/outbox", base), {
      method, redirect: "error", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) { stopped = true; throw new Error("Pairing expired"); }
    if (!response.ok) throw new Error("Exec summary outbox unavailable");
    return response.json();
  };
  void (async () => {
    while (!stopped) {
      try {
        const { items } = await call("GET");
        for (const item of items ?? []) {
          const folder = await findDealFolder(root, item.address);
          if (!folder) {
            await call("POST", { documentId: item.documentId, outcome: "no_folder", note: `No single folder under ${root} matches ${item.address}` });
            console.log(`Exec summary for ${item.address}: no matching deal folder under ${root}; left in Hopper Documents.`);
            continue;
          }
          const target = join(folder, EXEC_SUM, item.fileName.replace(/[<>:"/\\|?*]+/g, "_"));
          try { await access(target); await call("POST", { documentId: item.documentId, outcome: "exists", path: target }); continue; } catch {}
          try {
            const r = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
            if (!r.ok) throw new Error(`download ${r.status}`);
            await mkdir(join(folder, EXEC_SUM), { recursive: true });
            await writeFile(target, new Uint8Array(await r.arrayBuffer()), { flag: "wx" });
            await call("POST", { documentId: item.documentId, outcome: "saved", path: target });
            console.log(`Exec summary saved: ${target}`);
          } catch (e) {
            await call("POST", { documentId: item.documentId, outcome: "failed", path: target, note: String(e?.message ?? e) }).catch(() => {});
          }
        }
      } catch { /* retried on the next pass */ }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  })();
  return () => { stopped = true; };
}
