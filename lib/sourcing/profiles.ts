import { DEFAULT_CATEGORIES } from "./yard-users";

// Stable identifiers for the existing demand-map categories. Labels and keywords
// continue to come from that catalog; employees and saved deals are unrelated.
const IDS: Record<string, string> = {
  "Auto & RV Storage": "auto-rv-storage", "Building Materials": "building-materials",
  "Chemical/Waste Mgmt": "chemical-waste", "Container Storage": "container-storage",
  "Contractor Yard": "contractor-yard", "Equip. Rental & Sales": "equipment",
  "Stone & Masonry": "stone-masonry", "Trucking & Towing": "trucking-towing",
  "Landscape & Soil": "landscape-soil", "Pipe & Steel": "pipe-steel",
};
export const SOURCING_PROFILES = DEFAULT_CATEGORIES.map((category) => ({ id: IDS[category.label], ...category }));
export function selectedProfiles(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > SOURCING_PROFILES.length || value.some((id) => typeof id !== "string" || !Object.values(IDS).includes(id))) return null;
  return SOURCING_PROFILES.filter((p) => value.includes(p.id));
}
