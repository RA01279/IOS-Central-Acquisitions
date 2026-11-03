import type { BuyBox } from "./markets";
import type { SourcedSite } from "../agents/sourcing";
import type { UsableAcres } from "./usable-summary";

/**
 * Gross parcel area is not usable yard; an unknown input cannot earn strong fit.
 * A measurement from the parcel outline (buildings, floodplain, wetlands)
 * takes precedence over researched figures. One with a layer that could not
 * be read is an upper bound: it can rule a site out, never earn strong fit.
 */
export function assessSourcingFit(site: SourcedSite, box: BuyBox, measured?: UsableAcres | null): Pick<SourcedSite, "fit" | "fitReason"> {
  if (site.ownerType === "public") return { fit: "poor", fitReason: "Public ownership; requires a separate acquisition approach." };
  if (site.outdoorStorage === "not permitted") return { fit: "poor", fitReason: "Outdoor storage is not permitted according to the cited evidence." };
  const gross = site.acres ?? measured?.grossAcres ?? null;
  if (gross != null && gross < box.minAcres) return { fit: "poor", fitReason: `Gross parcel area (${gross} acres) is below the minimum; usable yard cannot exceed it.` };
  const partial = !!measured?.failed.length;
  const usable = measured ? measured.netAcres : site.usableAcres;
  const label = measured ? `Measured net usable area${partial ? " (upper bound)" : ""}` : "Verified usable area";
  if (usable != null && (usable < box.minAcres || (!partial && usable > box.maxAcres))) return { fit: "poor", fitReason: `${label} (${usable} acres) is outside ${box.minAcres}–${box.maxAcres} acres.` };
  const coverage = measured ? measured.coveragePct : site.acres && site.buildingFootprintSf != null ? site.buildingFootprintSf / (site.acres * 43560) * 100 : null;
  if (coverage != null && coverage > box.maxCoveragePct) return { fit: "poor", fitReason: `Building footprint coverage (${coverage.toFixed(1)}%) exceeds ${box.maxCoveragePct}%.` };
  if (usable == null || coverage == null) return { fit: "unknown", fitReason: `${usable == null ? "Usable yard area is unverified. " : ""}${coverage == null ? "Building footprint coverage is unverified. " : ""}Gross parcel acreage alone does not establish fit.` };
  if (measured) {
    const basis = `${usable} net usable acres measured from the parcel outline${partial ? ` (${measured.failed.join(", ")} not read)` : ""}; ${coverage.toFixed(1)}% footprint coverage; ${measured.notChecked.join(", ")} not checked`;
    if (site.outdoorStorage === "unverified") return { fit: "possible", fitReason: `${basis}. Outdoor-storage permission still needs verification.` };
    return { fit: site.outdoorStorage === "permitted" && !partial ? "strong" : "possible", fitReason: `${basis}; outdoor storage ${site.outdoorStorage}.` };
  }
  if (site.outdoorStorage === "unverified") return { fit: "possible", fitReason: `${usable} usable acres and ${coverage.toFixed(1)}% footprint coverage fit; outdoor-storage permission still needs verification.` };
  return { fit: site.outdoorStorage === "permitted" ? "strong" : "possible", fitReason: `${usable} verified usable acres; ${coverage.toFixed(1)}% footprint coverage; outdoor storage ${site.outdoorStorage}.` };
}
