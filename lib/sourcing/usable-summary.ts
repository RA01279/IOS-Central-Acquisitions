// lib/sourcing/usable-summary.ts
//
// The net usable acres result and its one-line summary, kept apart from the
// measurement (lib/sourcing/usable-acres.ts) so client pages can show it
// without loading the geometry library.

export interface UsableAcres {
  grossAcres: number;
  netAcres: number;
  buildingsAcres: number;
  floodAcres: number;
  wetlandsAcres: number;
  buildingCount: number;
  /** Building footprint as a percentage of the parcel. */
  coveragePct: number;
  buildingFootprintSf: number;
  floodZones: string[];
  wetlandTypes: string[];
  /** Layers that could not be read; net acres is then an upper bound. */
  failed: Array<"buildings" | "flood" | "wetlands">;
  notChecked: string[];
  measuredAt: string;
}

/** One line for tables and logs: "6.2 net of 10.4 (buildings -2.1, flood -1.6)". */
export function usableSummary(u: UsableAcres): string {
  const parts = [u.buildingsAcres && `buildings −${u.buildingsAcres}`, u.floodAcres && `flood −${u.floodAcres}`, u.wetlandsAcres && `wetlands −${u.wetlandsAcres}`].filter(Boolean);
  return `${u.netAcres} net of ${u.grossAcres}${parts.length ? ` (${parts.join(", ")})` : ""}${u.failed.length ? `; ${u.failed.join(", ")} not read, so net may be lower` : ""}`;
}
