// lib/agent-client.ts
//
// Browser side of a Hopper-helper agent run: queue it with the source text,
// then poll until the helper finishes. Returns the agent's report string.
//
// It keeps waiting as long as the helper still has the job (queued behind
// other work, or being read) -- up to 90 minutes -- and reports which of the
// two it is through onStatus, rather than giving up at a fixed 10 minutes
// while the job is merely waiting its turn.

export type AgentWait = "queued" | "processing";

export async function runAgent(
  agent: string,
  text: string,
  opts: { timeoutMs?: number; alive?: () => boolean; meta?: Record<string, unknown>; onStatus?: (s: AgentWait) => void; onQueued?: (runId: string) => void } = {}
): Promise<string> {
  const post = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, text: text.slice(0, 98000), ...(opts.meta ? { meta: opts.meta } : {}) }),
  });
  const queued = await post.json().catch(() => ({}));
  if (!post.ok) throw new Error(queued.error || "Couldn't start the Hopper helper.");
  opts.onQueued?.(queued.id);
  const deadline = Date.now() + (opts.timeoutMs ?? 90 * 60000);
  let last: string | null = null;
  while ((opts.alive?.() ?? true) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const run = await (await fetch(`/api/agents?id=${queued.id}`, { cache: "no-store" })).json().catch(() => ({}));
    if (run.status === "failed") throw new Error(run.error || "The helper couldn't finish.");
    if (run.status === "completed") return String(run.result?.report ?? "");
    if ((run.status === "queued" || run.status === "processing") && run.status !== last) { last = run.status; opts.onStatus?.(run.status); }
  }
  throw new Error("This is taking very long. The read keeps going on the helper; when it finishes it will be under \"Read, waiting for your review\" on this page.");
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
