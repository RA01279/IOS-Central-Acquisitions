// scripts/deploy-production.mjs  (npm run deploy:prod)
//
// Manual redeploy of Central production. Pushing to main already deploys it
// (Vercel Git integration); use this to redeploy without a new commit, e.g.
// after changing environment variables. Production has twice lost work
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

// Returns a refusal reason, or null once production has been (or would be) deployed.
async function deploy() {
  const branch = git("rev-parse --abbrev-ref HEAD");
  if (branch !== "main") return `this checkout is on "${branch}". Merge the work into main and push it; pushing main deploys.`;
  if (git("status --porcelain")) return "there are uncommitted or untracked changes. Commit and push them, or stash them.";
  git("fetch -q origin main");
  const head = git("rev-parse HEAD"), remote = git("rev-parse origin/main");
  if (head !== remote) {
    const ahead = git("rev-list --count origin/main..HEAD"), behind = git("rev-list --count HEAD..origin/main");
    return `HEAD is ${ahead} commit(s) ahead and ${behind} behind origin/main. ${behind !== "0" ? "Pull first; someone else has pushed." : "Push first."}`;
  }

  let linked = null;
  try { linked = JSON.parse(readFileSync(".vercel/project.json", "utf8")).projectId; } catch {}
  if (linked !== PROJECT_ID) return "this folder is not linked to the ios-central-acquisitions Vercel project (.vercel/project.json).";

  // CI status for this exact commit. A private repository needs GITHUB_TOKEN set.
  const headers = { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${head}&per_page=5`, { headers });
  if (!res.ok) return `could not read CI status from GitHub (${res.status}).${res.status === 404 ? " If the repository is private, set GITHUB_TOKEN to a token that can read Actions." : ""}`;
  const run = ((await res.json()).workflow_runs ?? []).find((r) => r.name === "CI");
  if (!run) return `no CI run found for ${head.slice(0, 7)} yet. Wait for GitHub Actions to start, then retry.`;
  if (run.status !== "completed") return `CI for ${head.slice(0, 7)} is still ${run.status}: ${run.html_url}`;
  if (run.conclusion !== "success") return `CI for ${head.slice(0, 7)} ${run.conclusion}: ${run.html_url}`;

  console.log(`main ${head.slice(0, 7)} is pushed, clean and passed CI (${run.html_url}).`);
  if (dryRun) { console.log("Dry run: checks passed, nothing deployed."); return null; }
  const status = spawnSync("npx", ["vercel", "deploy", "--prod", "--yes"], { stdio: "inherit", shell: process.platform === "win32" }).status;
  return status === 0 ? null : `vercel deploy exited with ${status}.`;
}

// Set exitCode rather than calling process.exit: exiting right after fetch
// trips a libuv assertion on Windows.
const refused = await deploy();
if (refused) { console.error(`\nNot deployed: ${refused}`); process.exitCode = 1; }
