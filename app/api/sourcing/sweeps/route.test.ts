import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ email: "one@example.com" as string | null, rows: [] as any[], filters: [] as any[], error: null as any }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.email ? { email: state.email } : null }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: () => {
 const filters: any[] = []; state.filters = filters;
 const result = () => ({ data: state.rows.filter(row => filters.every(([key, value]) => row[key] === value)), error: state.error });
 const q: any = { select: () => q, eq: (k: any,v: any) => { filters.push([k,v]); return q; }, order: () => q, limit: async () => result(), maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }) }; return q;
} }) }));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = (query = "") => ({ nextUrl: new URL("https://hopper.example/api/sourcing/sweeps" + query) }) as any;
beforeEach(() => { state.email = "one@example.com"; state.error = null; state.rows = [{ id, owner_email: state.email, snapshot: { label: "Saved Houston", sites: [{ ref: "S1", lat: 29.8, lng: -95.5 }] } }]; });
it("reopens the exact server snapshot for its owner", async () => {
 const response = await GET(request("?id=" + id));
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ sweepId: id, label: "Saved Houston", sites: [{ ref: "S1", lat: 29.8 }] });
 expect(response.headers.get("cache-control")).toContain("no-store");
});
it("does not expose another user's saved sweep or listing", async () => {
 state.email = "two@example.com";
 expect((await GET(request("?id=" + id))).status).toBe(404);
 expect(await (await GET(request())).json()).toEqual({ sweeps: [] });
});
it("rejects unauthenticated and malformed requests and surfaces storage failure", async () => {
 state.email = null; expect((await GET(request())).status).toBe(401);
 state.email = "one@example.com"; expect((await GET(request("?id=invalid"))).status).toBe(400);
 state.error = { message: "unavailable" }; expect((await GET(request())).status).toBe(503);
});
