import { describe, it, expect } from "vitest";
import { emptyTaxState, type TaxState, type TaxSource, type TaxParcel, type TaxRecord } from "../types";
import { autoReview, AUTO_NOTE } from "../auto-review";
import { historyCoverage } from "../coverage";
import { parcelScopeVerified } from "../parcel-scope";
import { taxSummary } from "../summary";

const PIN = "Official GIS polygon intersects the subject pin; this does not establish the entire acquisition boundary.";
const ADDR = "Normalized situs address matches subject.";
const DIFF = "Situs address differs or is missing; verify boundaries and legal description.";

const gis: TaxSource = { id: "gis", label: "TxGIO parcel", url: "https://example.gov/gis", retrievedAt: "2026-10-26T00:00:00Z", taxYear: 2026, kind: "official", evidence: "parcel json", storagePath: "property-tax-subjects/property/x/gis.json" };
const bill = (year: number): TaxSource => ({ id: `bill-${year}`, label: "ACT statement", url: "https://example.gov/bill", retrievedAt: "2026-10-26T00:00:00Z", taxYear: year, kind: "official", evidence: "statement", storagePath: `property-tax-subjects/property/x/bill-${year}.pdf` });
const parcel = (accountId: string, evidence: string[], patch: Partial<TaxParcel> = {}): TaxParcel => ({
  key: `tx:dallas:${accountId}`, accountId, county: "DALLAS", state: "TX", address: "100 MAIN ST", owner: "Owner LLC", legal: "", sourceIds: [gis.id],
  matchEvidence: evidence, review: "pending", reviewNote: "", component: "unknown", assessmentGroup: accountId, ...patch,
});
const record = (p: TaxParcel, year: number, authorities: Array<[string, number | undefined]>, kind: "issued_statement" | "collector_history" = "issued_statement", total?: number): TaxRecord => {
  const sum = total ?? authorities.reduce((t, [, v]) => t + (v ?? 0), 0);
  return {
    parcelKey: p.key, year,
    facts: { levied: { value: sum, sourceId: `bill-${year}`, stage: kind === "issued_statement" ? "issued" : "reported", reviewed: false } },
    jurisdictions: authorities.map(([name, levied]) => ({ name, rate: 0, unit: "per_100", taxable: null, exemption: null, levied, sourceId: `bill-${year}`, stage: "adopted" })),
    billEvidence: { kind, sourceId: `bill-${year}`, scope: "Only the named authorities collected on this record.", notes: "", collectorAccount: p.accountId, obligationStatus: "partial" },
  };
};
const state = (parcels: TaxParcel[], records: TaxRecord[]): TaxState => {
  const s = emptyTaxState();
  s.parcels = parcels; s.records = records;
  s.sources = [gis, ...[...new Set(records.map((r) => r.year))].map(bill)];
  return s;
};
const DALLAS: Array<[string, number]> = [["DALLAS COUNTY", 1000.1], ["PARKLAND HOSP", 800.2], ["DALLAS ISD", 4000.3], ["DALLAS CITY", 2500.4]];
const site = (ids: string[], matchesDeal: boolean | null = true) => ({ accountIds: ids, matchesDeal });

describe("automatic tax review", () => {
  it("approves a clear single-parcel Dallas case end to end", () => {
    const p = parcel("A1", [PIN, ADDR]);
    const years = [2026, 2025, 2024, 2023, 2022];
    const r = autoReview(state([p], years.map((y) => record(p, y, DALLAS))), site(["A1"]), new Date("2026-11-04T12:00:00Z"));
    const q = r.state.parcels[0];
    expect(q.review).toBe("included");
    expect(q.component).toBe("combined");
    expect(q.reviewNote.startsWith(AUTO_NOTE)).toBe(true);
    expect(parcelScopeVerified(r.state)).toBe(true);
    expect(r.state.records.every((x) => x.facts.levied!.reviewed && x.obligationReview?.note.startsWith(AUTO_NOTE))).toBe(true);
    expect(historyCoverage(r.state, new Date("2026-11-04")).propertyComplete).toBe(true);
    const s = taxSummary(r.state)!;
    expect(s).toMatchObject({ year: 2026, amount: 8301, status: "complete", caveats: [] });
    expect(s.coverage).toContain("Dallas ISD");
  });

  it("never reconciles a collector subtotal without a school district, and labels it", () => {
    const p = parcel("H1", [PIN, ADDR], { county: "HARRIS", key: "tx:harris:H1" });
    const rec = record(p, 2025, [["0040 - Harris County", 900], ["0061 - City of Houston", 1100]], "collector_history");
    const r = autoReview(state([p], [rec]), site(["H1"]));
    expect(r.state.records[0].facts.levied!.reviewed).toBe(true);
    expect(r.state.records[0].obligationReview).toBeUndefined();
    expect(r.blockers.some((b) => /school district/.test(b))).toBe(true);
    const s = taxSummary(r.state)!;
    expect(s.status).toBe("partial");
    expect(s.amount).toBe(2000);
    expect(s.caveats.join(" ")).toMatch(/school district not included/);
  });

  it("doesn't reconcile when authorities don't add up or aren't itemized", () => {
    const p = parcel("A2", [PIN, ADDR]);
    const off = record(p, 2026, DALLAS, "issued_statement", 9000);
    const bare = record(p, 2025, [["DALLAS COUNTY", undefined], ["DALLAS ISD", undefined]], "issued_statement", 5000);
    const r = autoReview(state([p], [off, bare]), site(["A2"]));
    expect(r.state.records.every((x) => !x.obligationReview)).toBe(true);
    expect(r.blockers.join(" ")).toMatch(/don't add up/);
    expect(r.blockers.join(" ")).toMatch(/doesn't break the bill down/);
  });

  it("includes an address mismatch only when the outlined site's acreage matches the deal", () => {
    const p = parcel("A3", [PIN, DIFF]);
    expect(autoReview(state([p], []), site(["A3"], true)).state.parcels[0].review).toBe("included");
    expect(autoReview(state([p], []), site(["A3"], false)).state.parcels[0].review).toBe("pending");
    expect(autoReview(state([p], []), site(["OTHER"], true)).state.parcels[0].review).toBe("pending");
    expect(autoReview(state([p], []), null).state.parcels[0].review).toBe("pending");
  });

  it("leaves the parcel set open when the outlined site has more accounts than tax research", () => {
    const p = parcel("A4", [PIN, ADDR]);
    const r = autoReview(state([p], []), site(["A4", "A5"]));
    expect(r.state.parcels[0].review).toBe("included");
    expect(parcelScopeVerified(r.state)).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/2 accounts .*but tax research has 1/);
  });

  it("never touches a person's decisions", () => {
    const excluded = parcel("A6", [PIN, ADDR], { review: "excluded", reviewNote: "Not part of the deal" });
    const corrected = parcel("A7", [PIN, ADDR], { identityOverride: true });
    const r = autoReview(state([excluded, corrected], []), site(["A7"]));
    expect(r.state.parcels[0]).toMatchObject({ review: "excluded", reviewNote: "Not part of the deal" });
    expect(r.state.parcels[1].review).toBe("pending");
    const s = state([parcel("A8", [PIN, ADDR], { review: "included", component: "combined", reviewNote: "Checked by RA" })], []);
    s.scopeReview = { at: "2026-10-01T00:00:00Z", note: "Checked boundary with broker", sourceIds: ["gis"], parcelKeys: ["tx:dallas:A8"], basis: "stale" };
    expect(autoReview(s, site(["A8"])).state.scopeReview!.note).toBe("Checked boundary with broker");
  });

  it("does not finalize a temporary or appealed bill", () => {
    const p = parcel("A9", [PIN, ADDR]);
    const rec = record(p, 2026, DALLAS);
    rec.facts.appeal = { value: "Official bill states property value is under appeal; temporary bill.", sourceId: "bill-2026", stage: "issued", reviewed: false };
    const r = autoReview(state([p], [rec]), site(["A9"]));
    expect(r.state.records[0].obligationReview).toBeUndefined();
    expect(r.blockers.join(" ")).toMatch(/temporary or appealed/);
  });
});
