import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "./agent-client";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Fake /api/agents: POST queues run "r1"; each GET returns the next status in `seq`. */
function fakeApi(seq: { status: string; result?: unknown; error?: string }[]) {
  const posts: any[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ id: "r1" }) }; }
    const r = seq[Math.min(i++, seq.length - 1)];
    return { ok: true, json: async () => r };
  }));
  return posts;
}

describe("runAgent", () => {
  it("keeps waiting while the job is queued, then reading, and reports each", async () => {
    vi.useFakeTimers();
    const posts = fakeApi([{ status: "queued" }, { status: "queued" }, { status: "processing" }, { status: "completed", result: { report: "{\"ok\":1}" } }]);
    const seen: string[] = [];
    let queuedId = "";
    const p = runAgent("market-report", "TEXT", { meta: { path: "market-reports/x.pdf" }, onStatus: (s) => seen.push(s), onQueued: (id) => (queuedId = id) });
    for (let n = 0; n < 5; n++) await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe("{\"ok\":1}");
    expect(seen).toEqual(["queued", "processing"]);
    expect(queuedId).toBe("r1");
    expect(posts[0]).toMatchObject({ agent: "market-report", meta: { path: "market-reports/x.pdf" } });
  });

  it("does not give up at ten minutes while the helper still has the job", async () => {
    vi.useFakeTimers();
    const seq = [...Array.from({ length: 300 }, () => ({ status: "queued" })), { status: "completed", result: { report: "late" } }];
    fakeApi(seq);
    const p = runAgent("market-report", "TEXT");
    await vi.advanceTimersByTimeAsync(16 * 60000);
    await expect(p).resolves.toBe("late");
  });

  it("surfaces a failure", async () => {
    vi.useFakeTimers();
    fakeApi([{ status: "failed", error: "The helper couldn't read it." }]);
    const p = runAgent("market-report", "TEXT");
    const assertion = expect(p).rejects.toThrow("The helper couldn't read it.");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});
