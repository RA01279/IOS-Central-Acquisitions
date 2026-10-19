// scripts/run-tests.mjs
//
// Runs every scripts/test-*.mjs / *.cjs that needs nothing but the repo
// (`npm test`, and CI on every push). Each runs in its own process; a failure
// prints that test's output and the run exits 1.
//
// Skipped here, with the reason -- run them by hand when you have the setup:
//   test-closed-deal-assets, test-comp-location, test-intake-transaction
//     run SQL against a real Supabase project (SUPABASE_ACCESS_TOKEN)
//   test-demand-pptx
//     needs the pptxgenjs bundle downloaded into .tmp-pptx first
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const NEEDS_SETUP = new Set([
  "test-closed-deal-assets.mjs",
  "test-comp-location.mjs",
  "test-intake-transaction.mjs",
  "test-demand-pptx.mjs",
]);

const tests = readdirSync(new URL(".", import.meta.url))
  .filter((f) => /^test-.*\.(mjs|cjs)$/.test(f) && !NEEDS_SETUP.has(f))
  .sort();

let failed = 0;
for (const t of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [`scripts/${t}`], { encoding: "utf8", timeout: 120000 });
  const ms = Date.now() - started;
  if (r.status === 0) {
    console.log(`ok    ${t} (${ms} ms)`);
  } else {
    failed++;
    console.log(`FAIL  ${t} (${r.signal ? `killed: ${r.signal}` : `exit ${r.status}`})`);
    console.log((r.stdout + r.stderr).split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} passed; ${NEEDS_SETUP.size} need setup and were skipped.`);
process.exit(failed ? 1 : 0);
