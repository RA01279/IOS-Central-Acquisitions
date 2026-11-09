import { describe, expect, it } from "vitest";
import { matchBroker, parseBrokers, type BrokerCandidate } from "./broker-match";

const c = (id: string, name: string, company_name: string | null = null, email: string | null = null): BrokerCandidate => ({
  id, name, email, company_id: company_name ? `co-${company_name}` : null, company_name,
});

describe("parseBrokers", () => {
  it("splits the firm off one broker", () => {
    expect(parseBrokers("Jane Smith, CBRE")).toEqual([{ name: "Jane Smith", firm: "CBRE", email: null, phone: null }]);
  });
  it("reads a team with contact details", () => {
    const team = parseBrokers("Stephen Bailey / Dustin Volz (Newmark)");
    expect(team.map((p) => p.name)).toEqual(["Stephen Bailey", "Dustin Volz"]);
    expect(team.every((p) => p.firm === "Newmark")).toBe(true);
  });
  it("keeps an email and lower-cases it", () => {
    const [p] = parseBrokers("Jane Smith jane.smith@CBRE.com");
    expect(p.name).toBe("Jane Smith");
    expect(p.email).toBe("jane.smith@cbre.com");
  });
  it("keeps a name it can't classify as typed", () => {
    expect(parseBrokers("jim")).toEqual([{ name: "jim", firm: null, email: null, phone: null }]);
  });
  it("treats a bare firm as the broker", () => {
    expect(parseBrokers("CBRE")[0]).toMatchObject({ name: "CBRE", firm: "CBRE" });
  });
  it("ignores blanks", () => {
    expect(parseBrokers("  ")).toEqual([]);
    expect(parseBrokers(null)).toEqual([]);
  });
});

describe("matchBroker", () => {
  const book = [
    c("1", "James Smith", "CBRE"),
    c("2", "Tom Ruiz", "JLL", "truiz@jll.com"),
    c("3", "Anna Lee, Colliers"), // legacy: firm typed into the name
    c("4", "John Park", "CBRE"),
    c("5", "John Park", "Newmark"),
  ];
  const m = (name: string, firm: string | null = null, email: string | null = null) =>
    matchBroker({ name, firm, email, phone: null }, book);

  it("links the same name at the same firm", () => {
    expect(m("James Smith", "CBRE").exact?.id).toBe("1");
  });
  it("links the same name when no firm was given", () => {
    expect(m("james smith").exact?.id).toBe("1");
  });
  it("links by email whatever the name", () => {
    expect(m("Thomas R.", null, "TRuiz@jll.com").exact?.id).toBe("2");
  });
  it("reads a legacy 'Name, Firm' contact as that person", () => {
    expect(m("Anna Lee", "Colliers").exact?.id).toBe("3");
  });
  it("asks about a nickname instead of linking", () => {
    const r = m("Jim Smith", "CBRE");
    expect(r.exact).toBeNull();
    expect(r.close.map((x) => x.id)).toEqual(["1"]);
  });
  it("asks about a typo", () => {
    const r = m("James Smyth");
    expect(r.exact).toBeNull();
    expect(r.close[0]?.id).toBe("1");
  });
  it("asks when the same name is at a different firm", () => {
    const r = m("Tom Ruiz", "CBRE");
    expect(r.exact).toBeNull();
    expect(r.close.map((x) => x.id)).toEqual(["2"]);
  });
  it("uses the firm to tell namesakes apart", () => {
    expect(m("John Park", "Newmark").exact?.id).toBe("5");
  });
  it("asks when namesakes can't be told apart", () => {
    const r = m("John Park");
    expect(r.exact).toBeNull();
    expect(r.close.map((x) => x.id).sort()).toEqual(["4", "5"]);
  });
  it("finds nobody for a new broker", () => {
    expect(m("Priya Natarajan", "Stream Realty")).toMatchObject({ exact: null, close: [] });
  });
});
