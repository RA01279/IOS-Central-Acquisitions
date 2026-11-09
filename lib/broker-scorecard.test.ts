import { describe, expect, it } from "vitest";
import { scoreBrokers, type ScoreDeal } from "./broker-scorecard";

const deal = (id: string, extra: Partial<ScoreDeal> = {}): ScoreDeal => ({
  id, stage: "prospect", death_stage: null, created_at: "2026-10-01T00:00:00Z", offers: [], documents: [], deal_events: [], ...extra,
});
const jane = { id: "c1", name: "Jane Smith", company_id: "f1", company_name: "CBRE" };

describe("broker scorecard volume, markets and mix", () => {
  const { people, firms } = scoreBrokers({
    links: [
      { role: "seller_broker", contact: jane, deal: deal("d1", { asking_price: 4_000_000, marketing_status: "marketed", asset_class: "ios", properties: { market: "Dallas", lot_sf: 43560 * 3 } }) },
      { role: "seller_broker", contact: jane, deal: deal("d2", { asking_price: null, marketing_status: "off_market", asset_class: "ios", properties: { market: "Houston", lot_sf: null } }) },
      { role: "seller_broker", contact: jane, deal: deal("d3", { asking_price: 6_000_000, marketing_status: "off_market", asset_class: "industrial", properties: { market: "dallas", lot_sf: 43560 } }) },
      // The same deal twice (two roles) counts once.
      { role: "buyer_broker", contact: jane, deal: deal("d3", { asking_price: 6_000_000, properties: { market: "Dallas", lot_sf: 43560 } }) },
    ],
    sourced: [],
    companies: [],
    compNotes: [],
    activities: [],
  });
  const p = people[0];

  it("adds up asking prices that are known", () => {
    expect(p.volume).toBe(10_000_000);
    expect(p.priced).toBe(2);
    expect(p.deals).toBe(3);
  });
  it("adds up land", () => {
    expect(p.acres).toBeCloseTo(4);
  });
  it("counts markets case-insensitively, busiest first", () => {
    expect(p.markets).toEqual([{ name: "Dallas", deals: 2 }, { name: "Houston", deals: 1 }]);
  });
  it("splits off-market from marketed and IOS from industrial", () => {
    expect([p.offMarket, p.marketed, p.ios, p.industrial]).toEqual([2, 1, 2, 1]);
  });
  it("rolls the same up to the firm", () => {
    expect(firms[0]).toMatchObject({ name: "CBRE", volume: 10_000_000, offMarket: 2 });
  });
});

describe("broker scorecard added date", () => {
  const { people, firms } = scoreBrokers({
    links: [
      { role: "seller_broker", contact: { ...jane, created_at: "2026-11-02T15:00:00Z" }, deal: deal("d1") },
      { role: "seller_broker", contact: { id: "c2", name: "Tom Ruiz", company_id: "f1", company_name: "CBRE", created_at: "2026-03-01T15:00:00Z" }, deal: deal("d1") },
      { role: "seller_broker", contact: { id: "c3", name: "No Date", company_id: null, company_name: null }, deal: deal("d2") },
    ],
    sourced: [],
    companies: [],
    compNotes: [],
    activities: [],
  });
  it("keeps when each person was added", () => {
    expect(people.find((p) => p.key === "c1")?.addedAt).toBe("2026-11-02T15:00:00Z");
    expect(people.find((p) => p.key === "c3")?.addedAt).toBeNull();
  });
  it("dates a firm by its earliest broker", () => {
    expect(firms.find((f) => f.key === "f1")?.addedAt).toBe("2026-03-01T15:00:00Z");
  });
});
