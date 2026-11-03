import type { BuyBox } from "./markets";
import type { SourcedSite } from "../agents/sourcing";

/** Gross parcel area is not usable yard; an unknown input cannot earn strong fit. */
export function assessSourcingFit(site: SourcedSite, box: BuyBox): Pick<SourcedSite, "fit" | "fitReason"> {
  if (site.ownerType === "public") return { fit: "poor", fitReason: "Public ownership; requires a separate acquisition approach." };
  if (site.outdoorStorage === "not permitted") return { fit: "poor", fitReason: "Outdoor storage is not permitted according to the cited evidence." };
  if (site.acres != null && site.acres < box.minAcres) return { fit: "poor", fitReason: `Gross parcel area (${site.acres} acres) is below the minimum; usable yard cannot exceed it.` };
  const usable = site.usableAcres;
  if (usable != null && (usable < box.minAcres || usable > box.maxAcres)) return { fit: "poor", fitReason: `Verified usable area (${usable} acres) is outside ${box.minAcres}–${box.maxAcres} acres.` };
  const coverage = site.acres && site.buildingFootprintSf != null ? site.buildingFootprintSf / (site.acres * 43560) * 100 : null;
  if (coverage != null && coverage > box.maxCoveragePct) return { fit: "poor", fitReason: `Building footprint coverage (${coverage.toFixed(1)}%) exceeds ${box.maxCoveragePct}%.` };
  if (usable == null || coverage == null) return { fit: "unknown", fitReason: `${usable == null ? "Usable yard area is unverified. " : ""}${coverage == null ? "Building footprint coverage is unverified. " : ""}Gross parcel acreage alone does not establish fit.` };
  if (site.outdoorStorage === "unverified") return { fit: "possible", fitReason: `${usable} usable acres and ${coverage!.toFixed(1)}% footprint coverage fit; outdoor-storage permission still needs verification.` };
  return { fit: site.outdoorStorage === "permitted" ? "strong" : "possible", fitReason: `${usable} verified usable acres; ${coverage!.toFixed(1)}% footprint coverage; outdoor storage ${site.outdoorStorage}.` };
}
