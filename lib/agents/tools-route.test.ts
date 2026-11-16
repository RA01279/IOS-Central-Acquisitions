// Access rules for app/api/agents/tools: only a paired helper, only for a job
// it is working right now, only for agents allowed tools.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { ctx: any; job: any } = { ctx: null, job: null };
vi.mock("@/lib/agents/server", () => ({
  workerContext: async () => state.ctx,
  json: (body: unknown, status = 200) => ({ body, status }),
}));
vi.mock("@/lib/agents/tools", () => ({
  toolDefinitions: () => [{ name: "parcel_lookup", description: "d", inputSchema: {} }],
  runTool: vi.fn(async (name: string) => ({ ok: true, text: `ran ${name}` })),
}));

const filters: [string, unknown][] = [];
const db = {
  from: () => {
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      maybeSingle: async () => ({ data: state.job, error: null }),
    };
    return b;
  },
};
const JOB = "11111111-2222-4333-8444-555555555555";
const req = (body: unknown) => ({ json: async () => body }) as any;

describe("agent tools route", async () => {
  const route = await import("../../app/api/agents/tools/route");
  const tools = await import("@/lib/agents/tools");
  beforeEach(() => { state.ctx = { db, helper: { id: "h1", owner_email: "owner@example.com" } }; state.job = { agent: "off-market-sourcing" }; filters.length = 0; vi.mocked(tools.runTool).mockClear(); });

  it("lists the tools for a paired helper only", async () => {
    expect((await route.GET(req(null))).body).toMatchObject({ tools: [{ name: "parcel_lookup" }] });
    state.ctx = null;
    expect((await route.GET(req(null))).status).toBe(401);
  });
  it("runs a tool for a job this helper is working", async () => {
    const r = await route.POST(req({ jobId: JOB, tool: "parcel_lookup", args: { lat: 1, lng: 2 } }));
    expect(r.body).toEqual({ ok: true, text: "ran parcel_lookup" });
    expect(filters).toEqual(expect.arrayContaining([["id", JOB], ["helper_id", "h1"], ["owner_email", "owner@example.com"], ["status", "processing"]]));
  });
  it("refuses a job that isn't running on this helper", async () => {
    state.job = null;
    expect((await route.POST(req({ jobId: JOB, tool: "parcel_lookup", args: {} }))).status).toBe(403);
    expect(tools.runTool).not.toHaveBeenCalled();
  });
  it("refuses document-reader agents", async () => {
    state.job = { agent: "comp-import" };
    expect((await route.POST(req({ jobId: JOB, tool: "comps_near", args: {} }))).status).toBe(403);
  });
  it("refuses bad requests and expired pairings", async () => {
    expect((await route.POST(req({ jobId: "nope", tool: "x" }))).status).toBe(400);
    expect((await route.POST(req(null))).status).toBe(400);
    state.ctx = null;
    expect((await route.POST(req({ jobId: JOB, tool: "parcel_lookup", args: {} }))).status).toBe(401);
  });
});
