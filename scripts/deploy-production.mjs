// scripts/deploy-production.mjs  (npm run deploy:prod)
//
// The only way to deploy Central production. Production has twice lost work
// because it was deployed from whichever worktree happened to be newest; this
// refuses unless the checkout is exactly what GitHub main holds and CI passed:
//   - on main, with no uncommitted or untracked changes;
//   - HEAD equal to origin/main after a fetch (nothing unpushed, nothing behind);
//   - the GitHub CI run for that commit completed successfully;
//   - .vercel/project.json linked to ios-central-acquisitions.
// Pass --dry-run to run the checks without deploying.

import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROJECT_ID = "prj_I491JjOxs5w61oGc0oHtRBe2EXv7";
const REPO = "RA01279/IOS-Central-Acquisitions";
const dryRun = process.argv.includes("--dry-run");
const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
const fail = (msg) => { console.error(`\nNot deployed: ${msg}`); process.exit(1); };

const branch = git("rev-parse --abbrev-ref HEAD");
if (branch !== "main") fail(`this checkout is on "${branch}". Merge the work into main, push it, and deploy from main.`);
if (git("status --porcelain")) fail("there are uncommitted or untracked changes. Commit and push them, or stash them.");
git("fetch -q origin main");
const head = git("rev-parse HEAD"), remote = git("rev-parse origin/main");
if (head !== remote) {
  const ahead = git(`rev-list --count origin/main..HEAD`), behind = git(`rev-list --count HEAD..origin/main`);
  fail(`HEAD is ${ahead} commit(s) ahead and ${behind} behind origin/main. ${behind !== "0" ? "Pull first; someone else has pushed." : "Push first."}`);
}

let linked = null;
try { linked = JSON.parse(readFileSync(".vercel/project.json", "utf8")).projectId; } catch {}
if (linked !== PROJECT_ID) fail("this folder is not linked to the ios-central-acquisitions Vercel project (.vercel/project.json).");

// CI status for this exact commit. A private repository needs GITHUB_TOKEN set.
const headers = { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${head}&per_page=5`, { headers });
if (!res.ok) fail(`could not read CI status from GitHub (${res.status}).${res.status === 404 ? " If the repository is private, set GITHUB_TOKEN to a token that can read Actions." : ""}`);
const runs = (await res.json()).workflow_runs?.filter((r) => r.name === "CI") ?? [];
const run = runs[0];
if (!run) fail(`no CI run found for ${head.slice(0, 7)} yet. Wait for GitHub Actions to start, then retry.`);
if (run.status !== "completed") fail(`CI for ${head.slice(0, 7)} is still ${run.status}: ${run.html_url}`);
if (run.conclusion !== "success") fail(`CI for ${head.slice(0, 7)} ${run.conclusion}: ${run.html_url}`);

console.log(`main ${head.slice(0, 7)} is pushed, clean and passed CI (${run.html_url}).`);
if (dryRun) { console.log("Dry run: checks passed, nothing deployed."); process.exit(0); }
const deploy = spawnSync("npx", ["vercel", "deploy", "--prod", "--yes"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(deploy.status ?? 1);
