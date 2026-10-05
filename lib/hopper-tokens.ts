// lib/hopper-tokens.ts
//
// One token file for both renderers: the React components (components/ui) and
// the .pptx slide builder (lib/ic-deck/summary-slide.ts). Hex values carry no
// leading '#' so they drop straight into PresentationML; use `hex()` in CSS.
//
// The signal scale is the ONLY use of red, amber and green in the app. Category
// identity (demand categories, map pins) uses blues and slates so "this is
// trucking" never reads as "this is good".

export const hex = (c: string) => `#${c}`;

export const color = {
  navy: "0A2540",
  brand: "0E5AA7",
  brandStrong: "0B4884",
  sky: "4E9FD6",
  skyLight: "A9D0EC",
  blue200: "9EC3E5",
  blue50: "EAF2FA",
  steel: "5E7A93",
  slateBlue: "2C4A63",
  canvas: "F6F8FA",
  muted100: "EDF1F5",
  border: "DDE4EB",
  borderStrong: "C4CFD9",
  n400: "9AA8B5",
  textMuted: "6B7A88",
  n600: "4C5966",
  textBody: "364049",
  n800: "232B33",
  textStrong: "111820",
  white: "FFFFFF",
} as const;

export type SignalState = "strong" | "watch" | "weak" | "unknown";

export const signal: Record<SignalState, { fg: string; bg: string; label: string }> = {
  strong: { fg: "2E7D5B", bg: "E4F1EA", label: "Strong" },
  watch: { fg: "C9862B", bg: "FBF0DC", label: "Watch" },
  weak: { fg: "C0392B", bg: "F8E4E1", label: "Weak" },
  // Not part of the design's three-step scale: a flag Hopper has no evidence
  // for yet. Grey, so a missing input never passes for a judgement.
  unknown: { fg: "6B7A88", bg: "EDF1F5", label: "No data" },
};

/** Score bands: 75+ strong, 55–74 watch, below 55 weak. */
export function scoreState(score: number | null | undefined): SignalState {
  if (score == null || !Number.isFinite(score)) return "unknown";
  return score >= 75 ? "strong" : score >= 55 ? "watch" : "weak";
}

export const kpiCard = { radius: 6, label: 9, value: 22 };

/** Fixed flag order. Never reorder: cards, summary and slides all rely on it. */
export const FLAG_KEYS = ["demand", "zoning", "access", "site", "basis", "rent"] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export const FLAG_META: Record<FlagKey, { label: string; short: string }> = {
  demand: { label: "Demand", short: "DEM" },
  zoning: { label: "Zoning", short: "ZON" },
  access: { label: "Truck Access", short: "ACC" },
  site: { label: "Site & Flood", short: "SITE" },
  basis: { label: "Basis vs Comps", short: "BASIS" },
  rent: { label: "Rent Upside", short: "RENT" },
};

/**
 * Demand categories, keyed by the labels the demand-map API searches
 * (lib/sourcing/yard-users DEFAULT_CATEGORIES). Blues and slates only.
 * `key` is the short form used in ?cats= so links stay readable.
 */
export const DEMAND_CATEGORIES: Array<{ label: string; key: string; icon: string; color: string }> = [
  { label: "Trucking & Towing", key: "truck", icon: "truck", color: "0A2540" },
  { label: "Equip. Rental & Sales", key: "equip", icon: "forklift", color: "0E5AA7" },
  { label: "Contractor Yard", key: "constr", icon: "hardhat", color: "4E9FD6" },
  { label: "Building Materials", key: "bldg", icon: "bricks", color: "5E7A93" },
  { label: "Container Storage", key: "contain", icon: "container", color: "2C4A63" },
  { label: "Auto & RV Storage", key: "rv", icon: "car", color: "9EC3E5" },
  { label: "Pipe & Steel", key: "steel", icon: "pipe", color: "0B4884" },
  { label: "Stone & Masonry", key: "stone", icon: "stone", color: "6BA3D6" },
  { label: "Landscape & Soil", key: "land", icon: "sprout", color: "3E82C4" },
  { label: "Chemical/Waste Mgmt", key: "waste", icon: "recycle", color: "9AA8B5" },
];

export const RADII = [1, 3, 5] as const;
export type Radius = (typeof RADII)[number];
