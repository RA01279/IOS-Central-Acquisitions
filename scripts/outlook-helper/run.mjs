import { startAgentLoop } from "./agents.mjs";
import { OutlookConnection, searchResult, emailResult } from "./codex.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const base = new URL(option("--url") || "https://ios-central-acquisitions.vercel.app");
if (base.origin !== "https://ios-central-acquisitions.vercel.app" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
  throw new Error("Helper URL must be Hopper production or a local development server.");
const directory = join(homedir(), ".hopper-outlook");
await mkdir(directory, { recursive: true, mode: 0o700 });
const configPath = join(directory, base.hostname === "ios-central-acquisitions.vercel.app" ? "connection.json" : "connection-dev.json");
function protect(value, decrypt = false) {
  if (process.platform !== "win32") return value;
  const code = decrypt
    ? '$s = ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }'
    : '$s = ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s))';
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", code],
    { input: value, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Could not protect your Hopper pairing code with Windows credentials.");
  return result.stdout.trim();
}
let token;
if (args.includes("--pair")) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  token = (await terminal.question("Paste the pairing code from Hopper > Comps: ")).trim(); terminal.close();
} else {
  try { const saved = JSON.parse(await readFile(configPath, "utf8")); if (saved.origin === base.origin) token = protect(saved.token, true); } catch {}
}
if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) throw new Error("Pair this computer first: npm run outlook:helper -- --pair");
let connection; let stopAgents;
async function request(method = "GET", body) {
  const response = await fetch(new URL("/api/outlook-helper/worker", base), { method, redirect: "error",
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (response.status === 401) { const e = new Error("Your helper was disconnected or expired. Pair it again in Hopper."); e.fatal = true; throw e; }
  if (!response.ok) throw new Error("Hopper could not be reached. Retrying shortly.");
  return data;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on("SIGINT", () => { connection?.close(); process.exit(0); });
process.on("SIGTERM", () => { connection?.close(); process.exit(0); });
try {
  connection = await new OutlookConnection({ launcher: option("--codex-launcher"), cwd: directory }).start();
  let persisted = false;
  console.log("Outlook helper started. Keep this running to import emails in Hopper.");
  while (true) {
    try {
      if (!connection.child) connection = await new OutlookConnection({ launcher: option("--codex-launcher"), cwd: directory }).start();
      const { ownerEmail, job } = await request();
      if (connection.mailbox !== ownerEmail?.toLowerCase()) {
        const error = new Error("The Hopper login and Outlook connection must belong to the same email address."); error.fatal = true; throw error;
      }
      if (!persisted) {
        await writeFile(configPath, JSON.stringify({ origin: base.origin, token: protect(token) }), { mode: 0o600 });
        persisted = true; stopAgents = startAgentLoop({ base, token, launcher: option("--codex-launcher") }); console.log("Connected to Hopper. Search for an email in Comps.");
      }
      if (job) {
        let result, error;
        try {
          if (job.kind === "search" && typeof job.input?.query === "string" && job.input.query.length <= 200 &&
              Number.isInteger(job.input.fromIndex) && job.input.fromIndex >= 0 && job.input.fromIndex <= 10000) {
            result = searchResult(await connection.call("search_messages", { query: job.input.query, from_index: job.input.fromIndex, size: 20 }));
          } else if (job.kind === "fetch" && typeof job.input?.messageId === "string" && job.input.messageId.length <= 4096) {
            result = emailResult(await connection.call("fetch_message", { message_id: job.input.messageId }));
          } else throw new Error("Unsupported email request.");
        } catch (e) { error = e.message; }
        await request("POST", { id: job.id, result, error });
        console.log(error ? "Email request failed. See Hopper for details." : "Email request completed.");
      }
    } catch (e) { if (e.fatal) throw e; console.log("Connection interrupted. Retrying in a few seconds."); }
    await sleep(4000);
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { stopAgents?.(); connection?.close(); }
