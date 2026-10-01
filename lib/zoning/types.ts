export type Point = { lat: number; lng: number };
export type Zoning = {
  provider?: string; municipalityId?: string; modifiersVerified?: boolean;
  district: string; description: string; specialUse: string; plannedDevelopment: string;
  subarea: string; overlays: string[]; caseNumber: string; ordinance: string;
  sourceUrl: string; boundaryUrl: string; overlayUrl: string; status: "mapped" | "ambiguous" | "unknown";
};
export type TenantEvidence = { use: string; category: string; url: string; checkedOn: string; outdoorUse: boolean };
export type ZoningCandidate = {
  placeId: string; name: string; address: string; point: Point; distanceMi: number;
  category: string; mapsUrl: string; zoning: Zoning | null;
  match: "same_code" | "same_designation" | "same_base" | "different" | "outside" | "unknown";
  evidence: TenantEvidence | null;
};
export type ZoningReport = {
  providerUpdated?: string;
  schemaVersion: 1; generatedAt: string; dealId: string; address: string; point: Point;
  municipality: string; radiusMiles: number; subject: Zoning;
  candidates: ZoningCandidate[]; warnings: string[]; searchCount: number;
};
