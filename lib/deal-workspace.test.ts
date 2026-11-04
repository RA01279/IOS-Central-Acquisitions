import { describe, expect, it, vi } from "vitest";

// deal-workspace imports server-only helpers; the KPI math under test is pure.
vi.mock("react", () => ({ cache: (f: unknown) => f }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("./supabase", () => ({ getServiceClient: () => { throw new Error("no db in tests"); } }));

const { dealKpis } = await import("./deal-workspace");

const deal = (extra: Record<string, unknown> = {}) => ({
  asset_class: "ios",
  properties: { address: "100 Test Rd", lot_sf: 4 * 43560 },
  uw_versions: [{ id: "v1", version_number: 1, returns_summary: { purchasePrice: 3000000, irrPct: 0.2, sourceIdentity: { address: "100 Test Rd" } } }],
  offers: [],
  ...extra,
});

describe("Price card", () => {
  it("shows the underwriting model price when there is no traded price or ask", () => {
    const k = dealKpis(deal(), null);
    expect(k.price).toBe(3000000);
    expect(k.priceBasis).toBe("Underwriting model price");
    expect(k.basis).toBe(750000);
  });
  it("prefers the asking price over the model", () => {
    const k = dealKpis(deal({ asking_price: 3500000 }), null);
    expect([k.price, k.priceBasis]).toEqual([3500000, "Asking price"]);
  });
  it("prefers a contract price over both", () => {
    expect(dealKpis(deal({ asking_price: 3500000, contract_price: 3200000 }), null).price).toBe(3200000);
  });
  it("says there is no price only when nothing at all is recorded", () => {
    expect(dealKpis(deal({ uw_versions: [] }), null).priceBasis).toBe("No price yet");
  });
});
