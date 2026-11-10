import { describe, expect, it } from "vitest";
import { addDays, outreachStatus, parseTouch } from "./outreach";

const t = (outcome: string | null, occurred_at = "2026-11-01T15:00:00Z", activity_type = "call") => ({ activity_type, outcome, occurred_at });

describe("outreachStatus", () => {
  it("is 'not contacted' with no touches", () => expect(outreachStatus([])).toBe("new"));
  it("is 'reaching out' until someone answers", () => expect(outreachStatus([t("left_message"), t("no_answer"), t(null, undefined, "letter")])).toBe("reaching_out"));
  it("follows the latest outcome", () => {
    expect(outreachStatus([t("interested"), t("no_answer")])).toBe("interested");
    expect(outreachStatus([t("not_selling"), t("spoke")])).toBe("not_selling");
    expect(outreachStatus([t("not_now")])).toBe("later");
    expect(outreachStatus([t("wrong_contact")])).toBe("bad_contact");
  });
  it("doesn't drop a talking owner back to 'reaching out' after an unanswered call", () => {
    expect(outreachStatus([t("no_answer"), t("spoke")])).toBe("talking");
  });
});

describe("parseTouch", () => {
  const today = "2026-11-10";
  it("accepts a call with an outcome and a follow-up", () => {
    expect(parseTouch({ type: "call", outcome: "left_message", note: " left VM ", nextOn: "2026-11-17" }, today)).toEqual({
      ok: true, type: "call", outcome: "left_message", note: "left VM", occurredOn: today, nextOn: "2026-11-17", contactId: null,
    });
  });
  it("allows no outcome and no follow-up", () => {
    const p = parseTouch({ type: "letter" }, today);
    expect(p.ok && p.outcome === null && p.nextOn === null).toBe(true);
  });
  it("rejects bad input", () => {
    expect(parseTouch({ type: "fax" }, today).ok).toBe(false);
    expect(parseTouch({ type: "call", outcome: "maybe" }, today).ok).toBe(false);
    expect(parseTouch({ type: "call", nextOn: "2026-11-01" }, today).ok).toBe(false);
    expect(parseTouch({ type: "call", occurredOn: "2026-12-01" }, today).ok).toBe(false);
    expect(parseTouch(null, today).ok).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-11-10", 91)).toBe("2027-02-09");
  });
});
