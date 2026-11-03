import { describe, expect, it } from "vitest";
import { offerDeadlines, dayBeforeOffers, composeOfferReminder } from "../offer-deadlines";
import { callForOffersDate, isCallForOffersTask } from "../call-for-offers";
import { toDealCard, DEAL_CARD_SELECT } from "../deal-view";
import CallForOffersDate from "../../components/CallForOffersDate";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const deal = (id: string, date: string | null, stage = "uw") => ({ id, stage, call_for_offers_on: date, properties: { address: "A & B <site>" } });

describe("call-for-offers dates", () => {
  it("reads Benelli's existing CFO task even when its deal is marked off market", () => {
    const benelli = { ...deal("benelli", null), marketing_status: "off_market", tasks: [
      { title: "Call for offers", due_date: "2026-11-12", status: "open" },
      { title: "Finish underwriting", due_date: "2026-10-28", status: "open" },
    ] };
    expect(callForOffersDate(benelli)).toBe("2026-11-12");
    expect(DEAL_CARD_SELECT).toContain("tasks(title, due_date, status)");
    const card = toDealCard({ ...benelli, created_at: "2026-10-21T12:00:00Z" }, undefined);
    expect(card.callForOffersOn).toBe("2026-11-12");
    expect(renderToStaticMarkup(createElement(CallForOffersDate, {date: card.callForOffersOn}))).toContain("Nov 12");
    expect(offerDeadlines([benelli], "2026-10-28")[0].date).toBe("2026-11-12");
    expect(composeOfferReminder([benelli], "2026-11-11")?.count).toBe(1);
  });
  it("omits the CFO row for an off-market deal without a deadline", () => {
    const date = callForOffersDate({ tasks: [{title: "Call owner", due_date: "2026-11-12", status: "open"}] });
    expect(renderToStaticMarkup(createElement(CallForOffersDate, {date}))).toBe("");
  });
  it("follows task edits and ignores completed, cleared and unrelated tasks", () => {
    const d = { ...deal("a", null), tasks: [
      { title: "Call for Offers", due_date: "2026-11-06", status: "done" },
      { title: "CFO deadline", due_date: "2026-11-12", status: "open" },
      { title: "Call broker for offer update", due_date: "2026-10-29", status: "open" },
    ] };
    expect(callForOffersDate(d)).toBe("2026-11-12");
    d.tasks[1].due_date = "2026-11-13";
    expect(callForOffersDate(d)).toBe("2026-11-13");
    d.tasks[1].status = "done";
    expect(callForOffersDate(d)).toBeNull();
    expect(callForOffersDate({ tasks: [{title: "Call for offers", due_date: null, status: "open"}] })).toBeNull();
    expect(isCallForOffersTask({title: "Call-for-Offers"})).toBe(true);
  });
  it("sorts upcoming dates and excludes completed, archived, cleared and past dates", () => {
    expect(offerDeadlines([deal("later", "2026-11-20"), deal("today", "2026-10-28"), deal("tomorrow", "2026-10-29"), deal("past", "2026-10-27"), deal("closed", "2026-10-29", "closed"), deal("archived", "2026-10-29", "archived"), deal("cleared", null)], "2026-10-28").map(x => x.id)).toEqual(["today", "tomorrow", "later"]);
  });
  it.each([["2026-10-31", "2026-11-01"], ["2026-11-01", "2026-11-02"], ["2026-03-08", "2026-03-09"], ["2026-12-31", "2027-01-01"]])("reminds one calendar day before %s including weekends and DST", (today, due) => {
    expect(dayBeforeOffers([deal("a", due)], today)).toHaveLength(1);
    expect(dayBeforeOffers([deal("a", due)], due)).toHaveLength(0);
  });
  it("uses the latest edited date, omits cleared dates and produces no email when none are due", () => {
    expect(composeOfferReminder([deal("a", "2026-10-30"), deal("b", null)], "2026-10-28")).toBeNull();
  });
  it("includes all tomorrow's deals, links and escaped property names", () => {
    const result = composeOfferReminder([deal("a", "2026-10-29"), deal("b", "2026-10-29"), deal("later", "2026-11-10")], "2026-10-28")!;
    expect(result.count).toBe(2);
    expect(result.subject).toContain("tomorrow");
    expect(result.html).toContain("A &amp; B &lt;site&gt;");
    expect(result.html).toContain("/deals/a");
    expect(result.html).not.toContain("/deals/later");
  });
});
