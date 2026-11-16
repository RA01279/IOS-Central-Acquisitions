// scripts/outlook-helper/hopper-mcp.mjs
//
// A tiny MCP server (stdio, JSON-RPC per line) that Codex starts for an agent
// job. It offers Hopper's read-only tools (lib/agents/tools.ts) and forwards
// each call to Hopper (/api/agents/tools) with this helper's pairing token,
// scoped to the job being worked. Settings come from the environment Codex
// passes through (env_vars): HOPPER_BASE, HOPPER_TOKEN, HOPPER_JOB.
// No dependencies; nothing is logged.

import { createInterface } from "node:readline";

const base = process.env.HOPPER_BASE, token = process.env.HOPPER_TOKEN, jobId = process.env.HOPPER_JOB;
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, message, code = -32603) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function hopper(method, body) {
  const response = await fetch(new URL("/api/agents/tools", base), {
    method, redirect: "error", signal: AbortSignal.timeout(80000),
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Hopper answered ${response.status}`);
  return data;
}

let tools = null;
async function listTools() {
  if (!tools) tools = (await hopper("GET")).tools ?? [];
  return tools;
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "hopper", version: "1" } });
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: await listTools() });
    if (method === "tools/call") {
      if (!base || !token || !jobId) return reply(id, { isError: true, content: [{ type: "text", text: "Hopper tools aren't configured for this job." }] });
      const out = await hopper("POST", { jobId, tool: params?.name, args: params?.arguments ?? {} });
      return reply(id, { isError: !out.ok, content: [{ type: "text", text: String(out.text ?? "") }] });
    }
    if (id != null) fail(id, `Unknown method ${method}`, -32601);
  } catch (e) {
    if (method === "tools/call") return reply(id, { isError: true, content: [{ type: "text", text: `Hopper tool call failed: ${e?.message ?? "unknown error"}` }] });
    if (id != null) fail(id, e?.message ?? "error");
  }
});
