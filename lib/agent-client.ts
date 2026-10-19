// lib/agent-client.ts
//
// Browser side of a Hopper-helper agent run: queue it with the source text,
// then poll until the helper finishes. Returns the agent's report string.

export async function runAgent(agent: string, text: string, opts: { timeoutMs?: number; alive?: () => boolean } = {}): Promise<string> {
  const post = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, text: text.slice(0, 98000) }),
  });
  const queued = await post.json().catch(() => ({}));
  if (!post.ok) throw new Error(queued.error || "Couldn't start the Hopper helper.");
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60000);
  while ((opts.alive?.() ?? true) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const run = await (await fetch(`/api/agents?id=${queued.id}`, { cache: "no-store" })).json().catch(() => ({}));
    if (run.status === "failed") throw new Error(run.error || "The helper couldn't finish.");
    if (run.status === "completed") return String(run.result?.report ?? "");
  }
  throw new Error("This is taking too long. Check the Hopper helper is still running.");
}

/** Is a paired Hopper helper online for agent work? */
export async function helperOnline(): Promise<boolean> {
  try {
    const a = await (await fetch("/api/agents", { cache: "no-store" })).json();
    return !!a.online;
  } catch {
    return false;
  }
}
