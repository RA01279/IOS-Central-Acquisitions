import { describe, expect, it } from "vitest";
import { DEAL_IMPORT_INSTRUCTIONS, MAX_IMPORT_PROPERTIES, parseDealImport } from "./deal-import";

const prop = (address: string, extra: Record<string, unknown> = {}) => ({
  fields: { address, city: "Villa Rica", state: "ga", market: "Atlanta", acres: 13.96, buildingSf: 11500, askingPrice: 10000000, assetClass: "ios", brokerNotes: "I1 zoning; owner not super motivated.", ...extra },
  evidence: { address: `${address} in Villa Rica, GA` },
  notes: ["Asking price reflects guidance."],
});

describe("parseDealImport", () => {
  it("reads a single property as before, with no others", () => {
    const d = parseDealImport(JSON.stringify(prop("155 Liberty Rd")))!;
    expect(d.fields.address).toBe("155 Liberty Rd");
    expect(d.fields.state).toBe("GA");
    expect(d.fields.brokerNotes).toMatch(/I1 zoning/);
    expect(d.others).toBeUndefined();
  });

  it("returns separately offered properties as their own drafts", () => {
    const d = parseDealImport(JSON.stringify({ ...prop("155 Liberty Rd"), otherProperties: [prop("905 Union Hill Rd", { city: "Alpharetta", askingPrice: null }), prop("1713 Old Dean Forest Rd", { city: "Pooler", market: "Savannah" })] }))!;
    expect(d.others?.map((o) => o.fields.address)).toEqual(["905 Union Hill Rd", "1713 Old Dean Forest Rd"]);
    expect(d.others?.[0].fields.askingPrice).toBeNull();
    expect(d.others?.[1].fields.market).toBe("Savannah");
    expect(d.others?.[1].evidence.address).toMatch(/1713 Old Dean Forest Rd/);
  });

  it("drops other properties with no address, repeats of the main one, and duplicates", () => {
    const d = parseDealImport(JSON.stringify({ ...prop("155 Liberty Rd"), otherProperties: [prop(""), prop("155 liberty rd"), prop("905 Union Hill Rd"), prop("905 UNION HILL RD"), "junk"] }))!;
    expect(d.others?.map((o) => o.fields.address)).toEqual(["905 Union Hill Rd"]);
  });

  it("caps how many properties one source can produce", () => {
    const many = Array.from({ length: 30 }, (_, i) => prop(`${100 + i} Yard Rd`));
    const d = parseDealImport(JSON.stringify({ ...prop("1 Main St"), otherProperties: many }))!;
    expect(1 + (d.others?.length ?? 0)).toBe(MAX_IMPORT_PROPERTIES);
  });

  it("still rejects a report with no main address", () => {
    expect(parseDealImport(JSON.stringify({ fields: { address: null }, otherProperties: [prop("905 Union Hill Rd")] }))).toBeNull();
    expect(parseDealImport("not json")).toBeNull();
  });

  it("tells the agent to split separate opportunities but keep packages whole", () => {
    expect(DEAL_IMPORT_INSTRUCTIONS).toMatch(/otherProperties/);
    expect(DEAL_IMPORT_INSTRUCTIONS).toMatch(/offered TOGETHER as one package/);
    expect(DEAL_IMPORT_INSTRUCTIONS).toMatch(/Pooler GA -> Savannah/);
  });
});
