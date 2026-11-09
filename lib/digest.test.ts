import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "./supabase";
import { composeDigest } from "./digest";

vi.mock("./supabase", () => ({ getServiceClient: vi.fn() }));
vi.mock("./deals", () => ({
  ASSET_CLASSES: ["ios", "industrial"],
  ASSET_CLASS_LABELS: { ios: "IOS", industrial: "Industrial" },
  STAGE_LABELS: { prospect: "Prospect", uw: "UW", offered: "Offered", moving_to_psa: "Moving to PSA", due_diligence: "Due Diligence" },
  IN_CONTRACT_STAGES: ["moving_to_psa", "due_diligence"],
}));

function database(tables: Record<string, any[]>, failOffers = false) {
  const calls: Array<[string, string, unknown]> = [];
  vi.mocked(getServiceClient).mockImplementation(() => ({ from(table: string) {
    let rows = tables[table] ?? [];
    const query: any = {};
    for (const method of ["select", "eq", "gte", "lte", "is", "not", "or", "order"]) {
      query[method] = (column: string, value: unknown) => {
        calls.push([table, `${method}:${column}`, value]);
        if (table === "offers" && method === "gte") rows = rows.filter(r => r[column] >= String(value));
        if (table === "offers" && method === "lte") rows = rows.filter(r => r[column] <= String(value));
        if (table === "offers" && method === "eq" && column === "deals.deal_type") rows = rows.filter(r => r.deals.deal_type === value);
        return query;
      };
    }
    query.range = (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return query;
    };
    query.limit = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: rows, error: table === "offers" && failOffers ? { message: "Offers unavailable" } : null,
    }).then(resolve);
    return query;
  } }) as any);
  return calls;
}

const offer = (id: string, offered_at: string, price: unknown, deal_type = "acquisition") => ({ id, offered_at, price, deals: { deal_type } });

describe("morning brief context and offer activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T17:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("counts all dated acquisition offers in the seven CT days, including revisions, and adds numeric prices", async () => {
    const calls = database({ offers: [
      offer("old", "2026-11-02", 999), offer("start", "2026-11-03", "1500000"),
      offer("revision", "2026-11-09", 2250000), offer("unpriced", "2026-11-09", null),
      offer("future", "2026-11-10", 999), offer("lease", "2026-11-09", 999, "lease"),
    ] });
    const digest = await composeDigest();
    expect(digest.counts).toMatchObject({ offersLast7Days: 3, offerValueLast7Days: 3750000, unpricedOffersLast7Days: 1 });
    expect(digest.html).toContain("$3,750,000");
    expect(digest.html).toContain("2026-11-03 through 2026-11-09");
    expect(digest.html).toContain("1 offer has no recorded price");
    expect(calls).toContainEqual(["offers", "eq:deals.deal_type", "acquisition"]);
  });

  it("pages offer activity beyond 1,000 rows", async () => {
    database({ offers: Array.from({ length: 1001 }, (_, i) => offer(String(i), "2026-11-09", 1000)) });
    const digest = await composeDigest();
    expect(digest.counts.offersLast7Days).toBe(1001);
    expect(digest.counts.offerValueLast7Days).toBe(1001000);
  });

  it("shows the linked deal address for each task, even outside the acquisition snapshot, and escapes its text", async () => {
    database({ tasks: [
      { id: "a", title: "Call <seller>", due_date: "2026-11-01", deal_id: "lease-deal", deals: { properties: { address: "123 Main & <West>" } } },
      { id: "b", title: "General follow-up", due_date: "2026-11-01", deal_id: null },
    ] });
    const digest = await composeDigest();
    expect(digest.html).toContain('/deals/lease-deal"');
    expect(digest.html).toContain("123 Main &amp; &lt;West&gt;</a><br/>Call &lt;seller&gt;");
    expect(digest.html).toContain("No associated deal");
    expect(digest.html).not.toContain(">Open deal</a>");
  });

  it("shows zero activity clearly and fails rather than reporting zero on an offer-query error", async () => {
    database({});
    expect((await composeDigest()).counts.offersLast7Days).toBe(0);
    database({}, true);
    await expect(composeDigest()).rejects.toThrow("Offers unavailable");
  });
});
