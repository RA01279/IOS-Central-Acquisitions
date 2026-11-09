import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { callForOffersDate, nextRoundAction, offerRoundLabel } from "../call-for-offers";
import { composeOfferReminder, offerDeadlineLine, offerDeadlines } from "../offer-deadlines";
import { DEAL_CARD_SELECT, toDealCard } from "../deal-view";
import CallForOffersDate from "../../components/CallForOffersDate";

describe("bid rounds", () => {
  it("names rounds and the next-round action", () => {
    expect(offerRoundLabel(1)).toBe("Call for offers");
    expect(offerRoundLabel(null)).toBe("Call for offers");
    expect(offerRoundLabel(2)).toBe("Best & final");
    expect(offerRoundLabel(3)).toBe("Round 3");
    expect(nextRoundAction(1)).toBe("Call for best & final");
    expect(nextRoundAction(2)).toBe("Start round 3");
  });

  it("uses the later round's date over a stale round-1 task left open", () => {
    const tasks = [{ title: "Call for offers", due_date: "2026-11-06", status: "open" }];
    expect(callForOffersDate({ tasks, call_for_offers_on: "2026-11-14", offer_round: 1 })).toBe("2026-11-06");
    expect(callForOffersDate({ tasks, call_for_offers_on: "2026-11-14", offer_round: 2 })).toBe("2026-11-14");
    // Round 2 without a date yet falls back to the task, as before.
    expect(callForOffersDate({ tasks, call_for_offers_on: null, offer_round: 2 })).toBe("2026-11-06");
  });

  it("labels the tile for best & final and keeps round 1 unchanged", () => {
    expect(DEAL_CARD_SELECT).toContain("offer_round");
    const base = { id: "w", stage: "offered", created_at: "2026-11-01T12:00:00Z", properties: { address: "921 E Waggoman St" }, tasks: [] };
    const r2 = toDealCard({ ...base, offer_round: 2, call_for_offers_on: "2026-11-14" }, undefined);
    expect(r2.offerRound).toBe(2);
    const html = renderToStaticMarkup(createElement(CallForOffersDate, { date: r2.callForOffersOn, round: r2.offerRound }));
    expect(html).toContain("Best &amp; final due");
    expect(html).toContain("Nov 14");
    const r1 = toDealCard({ ...base, call_for_offers_on: "2026-11-14" }, undefined);
    expect(r1.offerRound).toBe(1);
    expect(renderToStaticMarkup(createElement(CallForOffersDate, { date: r1.callForOffersOn, round: r1.offerRound }))).toContain("Call for offers:");
  });

  it("marks later rounds in the brief and the day-before reminder", () => {
    const d = { id: "w", stage: "offered", offer_round: 2, call_for_offers_on: "2026-11-14", properties: { address: "921 E Waggoman St" } };
    expect(offerDeadlineLine(offerDeadlines([d], "2026-11-09")[0])).toContain("(Best &amp; final)");
    expect(composeOfferReminder([d], "2026-11-13")?.html).toContain("(Best &amp; final)");
    const r1 = { ...d, offer_round: 1 };
    expect(offerDeadlineLine(offerDeadlines([r1], "2026-11-09")[0])).not.toContain("Best");
  });
});
