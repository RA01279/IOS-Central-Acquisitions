import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
const allowed = new Set(["deal-intake", "comp-analyst", "pipeline-follow-up", "site-research", "underwriting-review", "investment-memo"]);
const schema = { type: "object", additionalProperties: false, required: ["report", "model", "limitations"], properties: {
  report: { type: "string" }, model: { type: "string" }, limitations: { type: "array", items: { type: "string" } },
} };
export async function runAgent(job, launcher) {
  if (!allowed.has(job.agent) || typeof job.prompt !== "string" || job.prompt.length > 350000) throw new Error("Invalid agent job.");
  const cwd = await mkdtemp(join(tmpdir(), "hopper-report-"));
  const schemaPath = join(cwd, "report-schema.json");
  await writeFile(schemaPath, JSON.stringify(schema));
  // A fresh empty working directory and no user config/plugins/connectors keep
  // this report generator separate from the user's coding workspace and inbox.
  const args = ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
    "--disable", "shell_tool", "--disable", "multi_agent", "--disable", "plugins", "--disable", "apps",
    "-c", "web_search=" + (job.agent === "site-research" ? '"live"' : '"disabled"'),
    "--output-schema", schemaPath, "--json", "-"];
  let command = "codex";
  if (process.platform === "win32") {
    command = process.execPath;
    args.unshift(launcher || join(dirname(process.execPath), "node_modules/@openai/codex/bin/codex.js"));
  }
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "", final = "", usage = null, failed = false;
      const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error("The report exceeded 15 minutes. Narrow the request and try again.")); }, 15 * 60000);
      child.stdout.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 2_000_000) { failed = true; child.kill(); reject(new Error("Agent output exceeded the limit.")); return; }
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let event; try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "item.completed" && event.item?.type === "agent_message") final = event.item.text;
          if (event.type === "turn.completed") usage = event.usage;
          if (event.type === "turn.failed") failed = true;
        }
      });
      child.stderr.on("data", () => {});
      child.on("error", () => { clearTimeout(timer); reject(new Error("Codex could not start. Check your Codex installation and sign-in.")); });
      child.on("exit", code => {
        clearTimeout(timer);
        if (code !== 0 || failed) return reject(new Error("Codex could not complete the report. Check sign-in and usage limits, then retry."));
        try {
          const result = JSON.parse(final);
          if (!result.report?.trim() || !Array.isArray(result.limitations)) throw new Error();
          resolve({ result, usage });
        } catch { reject(new Error("The agent did not return a valid report.")); }
      });
      child.stdin.end(job.prompt);
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
export function startAgentLoop({ base, token, launcher }) {
  let stopped = false, pending = null;
  const request = async (method = "GET", body, heartbeat = false) => {
    const response = await fetch(new URL("/api/agents/worker" + (heartbeat ? "?heartbeat=1" : ""), base), {
      method, redirect: "error", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) { stopped = true; throw new Error("Pairing expired"); }
    if (response.status === 409) return { expired: true };
    if (!response.ok) throw new Error("Agent queue unavailable");
    return response.json();
  };
  const pulse = setInterval(() => { if (!stopped) void request("GET", undefined, true).catch(() => {}); }, 15000);
  void (async () => {
    while (!stopped) {
      try {
        // Retry delivery of the SAME result, never repeat model generation.
        if (pending) { await request("POST", pending); pending = null; }
        const { job } = await request();
        if (job) {
          try { pending = { id: job.id, ...await runAgent(job, launcher) }; }
          catch (e) { pending = { id: job.id, error: e.message }; }
          console.log("Agent report finished. Saving the result in Hopper.");
        }
      } catch { /* Connectivity failures are retried; no private content logged. */ }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    clearInterval(pulse);
  })();
  return () => { stopped = true; clearInterval(pulse); };
}
