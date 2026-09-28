import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
export class OutlookConnection {
  constructor({ launcher, cwd } = {}) { this.launcher = launcher; this.cwd = cwd; this.pending = new Map(); this.seq = 0; }
  async start() {
    let command = "codex", args = ["app-server", "--stdio"];
    if (process.platform === "win32") {
      const entry = this.launcher || join(dirname(process.execPath), "node_modules/@openai/codex/bin/codex.js");
      if (!existsSync(entry)) throw new Error("Codex CLI was not found. Install Codex CLI and sign in with your existing ChatGPT account.");
      command = process.execPath; args.unshift(entry);
    }
    this.child = spawn(command, args, { cwd: this.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 8_000_000) { this.close(); return; }
      let n;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        const request = this.pending.get(message.id);
        if (request) {
          this.pending.delete(message.id); clearTimeout(request.timer);
          message.error ? request.reject(new Error(message.error.message || "Codex request failed.")) : request.resolve(message.result);
        } else if (message.id != null && message.method) {
          // This helper never grants execution, write, or new connector permissions.
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601,
            message: "This Outlook helper supports read-only email operations. Complete any required approval in Codex." } }) + "\n");
        }
      }
    });
    this.child.stderr.on("data", () => {}); // Do not log mailbox contents or credentials.
    this.child.on("error", () => this.close());
    this.child.on("exit", () => this.close());
    await this.rpc("initialize", { clientInfo: { name: "hopper_outlook_helper", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const { thread } = await this.rpc("thread/start", { sandbox: "read-only", ephemeral: true, cwd: this.cwd });
    this.threadId = thread.id;
    const inventory = await this.rpc("mcpServerStatus/list", { threadId: this.threadId, detail: "toolsAndAuthOnly" });
    const server = inventory.data.find(s => s.name === "codex_apps");
    this.mailbox = server?.tools?.["microsoft_outlook_email.search_messages"]?._meta?.link_owner_profile?.email?.toLowerCase();
    for (const name of ["search_messages", "fetch_message"]) {
      const tool = server?.tools?.["microsoft_outlook_email." + name];
      if (!tool || tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true)
        throw new Error("Connect Outlook Email in Codex before starting this helper.");
    }
    if (!this.mailbox) throw new Error("Could not verify the owner of your Outlook connection.");
    return this;
  }
  rpc(method, params) {
    if (!this.child || this.child.killed) return Promise.reject(new Error("Outlook connection closed. Restart the helper."));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Outlook took too long. Please try again.")); }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async call(name, args) {
    if (!["search_messages", "fetch_message"].includes(name)) throw new Error("Unsupported email operation");
    const result = await this.rpc("mcpServer/tool/call", { threadId: this.threadId, server: "codex_apps",
      tool: "microsoft_outlook_email." + name, arguments: args });
    if (result.isError) throw new Error("Outlook could not read this email. Check the connection in Codex and try again.");
    if (!result.structuredContent) throw new Error("Outlook returned an unsupported response.");
    return result.structuredContent;
  }
  close() {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Outlook connection closed. Restart the helper.")); }
    this.pending.clear();
    const child = this.child; this.child = null; if (child && !child.killed) child.kill();
  }
}
export function searchResult(result) {
  if (!Array.isArray(result.results)) throw new Error("Outlook returned invalid search results.");
  return { messages: result.results.slice(0, 20).map(m => ({ id: m.id, subject: m.subject,
    sender: m.sender?.emailAddress?.address || m.from?.emailAddress?.address || "",
    receivedAt: m.receivedDateTime, preview: m.bodyPreview || "",
    hasAttachments: m.has_attachments === true || m.hasAttachments === true })),
    nextFromIndex: result.has_more && Number.isInteger(result.next_from_index) ? result.next_from_index : null };
}
export function emailResult(message) {
  // Connector bodies may be Markdown even when Graph's original type says HTML.
  const body = typeof message.body === "string" ? message.body : message.body?.content;
  if (typeof body !== "string" || !body.trim()) throw new Error("This email has no readable body.");
  if (body.length > 1_000_000) throw new Error("This email exceeds 1 MB. Paste the comp section instead.");
  const html = /<(?:html|body|table|div|p|br)\b/i.test(body) ? body : undefined;
  return { text: body, html, source: "email", emailHasAttachments: message.has_attachments === true || message.hasAttachments === true,
    sourceRef: [message.subject, message.sender?.emailAddress?.address || message.from?.emailAddress?.address,
      message.receivedDateTime, message.web_link || message.webLink, message.id].filter(Boolean).join(" | ") };
}
