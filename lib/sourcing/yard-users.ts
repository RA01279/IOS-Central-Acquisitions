// lib/sourcing/yard-users.ts
//
// Which Google Places results are businesses that actually occupy an outdoor
// yard. Shared by the IOS demand map and off-market sourcing so both screen
// the same way. Moved verbatim from the demand-map route.

// IOS demand categories. Each holds SEVERAL Places keywords, merged and deduped
// by place_id, because no single keyword covers a use: stone yards need three
// ("stone yard", "natural stone supplier", "masonry supply") and Triton Stone
// shows up under all of them.
//
// Every keyword here was probed against live Places data and kept only if it
// returned businesses that actually occupy a yard. Notable rejects:
//   "general contractor construction" -> residential remodelers (ATX Construction
//       & Remodeling, AGC Home Remodeling) -- no yard, was the old Contractor Yard
//   "utility contractor"              -> electricians working out of vans
//   "concrete contractor"             -> decorative coatings and stamped patios
//   "oilfield service"                -> data and analytics firms
//   "quarry stone"                    -> a church and a diagnostic imaging centre
//   "sand gravel quarry"              -> zero results
//   "vehicle RV boat storage"         -> self-storage chains, a different asset
//       class; replaced with keywords that target outdoor lots
//
// Callers can override via ?categories=Label:kw one;kw two,Label2:kw three
export const DEFAULT_CATEGORIES: { label: string; keywords: string[] }[] = [
  { label: "Auto & RV Storage", keywords: ["RV boat outdoor storage lot", "trailer storage yard"] },
  { label: "Building Materials", keywords: ["building materials supplier", "lumber yard", "roofing supply"] },
  { label: "Chemical/Waste Mgmt", keywords: ["waste management chemical distributor"] },
  { label: "Container Storage", keywords: ["shipping container storage", "portable storage container sales"] },
  { label: "Contractor Yard", keywords: ["paving contractor", "fence company", "excavating contractor"] },
  { label: "Equip. Rental & Sales", keywords: ["equipment rental sales", "crane service"] },
  { label: "Stone & Masonry", keywords: ["stone yard", "natural stone supplier", "masonry supply"] },
  { label: "Trucking & Towing", keywords: ["trucking company", "towing service"] },
  { label: "Landscape & Soil", keywords: ["landscape supply yard", "soil compost mulch supplier"] },
  { label: "Pipe & Steel", keywords: ["pipe supply", "steel supply"] },
];

// A business can match a keyword and still be worthless on an IOS demand map,
// because it works out of a van, a showroom, or a climate-controlled unit. The
// patterns below were calibrated against real results, and the comments record
// what each is there to catch -- and, as importantly, what it must NOT catch.
//
// Two false positives from the first pass are deliberately absent:
//   * /coating/ used to sit in the showroom rule and killed "Texan Paving &
//     Asphalt SealCoating" -- sealcoating is paving work, done from a yard.
//   * home_goods_store / furniture_store used to be excluded types, which
//     killed "GTown Lumber & Supply" and "APEX Building Supply". Google tags
//     lumber yards that way, so the type is unusable as a yard test.
const EXCLUDE_NAME: [RegExp, string][] = [
  // Self-storage is its own asset class -- units and drive-up doors, not yard.
  [/self.?storage|extra space|u-?haul|public storage|storage star|cubesmart|life storage|stash.?n.?go/i, "self-storage"],
  // Movers rent trucks and sell boxes; the containers aren't stored on site.
  [/\bmovers?\b|moving (company|labor|service)|u-?pack|door to door|state to state/i, "moving company"],
  [/remodel|renovation|home design|handyman/i, "residential remodeler"],
  [/countertop|cabinet|interior|showroom|surfaces|stone studio|fixtures|bath (&|and) kitchen/i, "showroom / fabrication"],
  [/electric(ian|al)\b|\bhvac\b|air conditioning|\bplumber\b/i, "van-based trade"],
  [/painting|pressure wash|window clean|janitorial|pest control|lawn (care|mowing)/i, "van-based trade"],
  [/church|school|hospital|imaging|clinic|dental/i, "not a business use"],
  [/consult|\bintel\b|analytics|marketing|realty|insurance|law firm/i, "office use"],
];

// Types that are never a yard. Retail-ish types are absent on purpose -- see
// the lumber-yard note above.
const EXCLUDE_TYPES = new Set([
  "church", "place_of_worship", "school", "hospital", "doctor", "dentist",
  "lawyer", "insurance_agency", "real_estate_agency", "beauty_salon",
  "restaurant", "cafe", "lodging", "bank", "finance", "accounting",
]);

// Rules that only make sense inside one category. "Is a nursery a stone yard?"
// can't be answered by a global pattern -- it's no for Stone & Masonry and yes
// for Landscape & Soil. `require` is a positive test the name must pass at all;
// `exclude` removes uses that belong to a different category or aren't yards.
const CATEGORY_RULES: Record<string, { require?: RegExp; exclude?: RegExp }> = {
  // Without the require, this keyword set drags in self-storage that dodges the
  // brand list ("ATX Storage", "Storage Town USA") plus food-truck parks and
  // supermarket car parks. An outdoor vehicle yard says so in its name.
  "Auto & RV Storage": {
    require: /\b(rv|boat|trailer|truck|fleet|vehicle|auto|motorhome)\b/i,
    exclude: /food.?truck|supermarket|grocery|apartment|airport/i,
  },
  // "stone yard" pulls in landscapers and nurseries, which crowded the real
  // stone suppliers out of the per-category cap. They have their own category.
  "Stone & Masonry": { exclude: /landscap|nursery|garden|tree service/i },
  "Landscape & Soil": { exclude: /lowe'?s|home depot|walmart|ace hardware/i },
  // Plumbing counters and fixture showrooms, which aren't yards. Scoped here so
  // it can't touch "All-Tex Pipe & Supply".
  "Pipe & Steel": { exclude: /\bplumb/i },
  "Container Storage": { exclude: /barrel/i },
};

/** Why this place isn't an IOS user in this category, or null if it looks like one. */
export function rejectReason(place: any, categoryLabel: string): string | null {
  if (place.business_status && place.business_status !== "OPERATIONAL") return "not operational";
  for (const t of place.types ?? []) if (EXCLUDE_TYPES.has(t)) return `type:${t}`;
  const name = place.name ?? "";
  for (const [re, reason] of EXCLUDE_NAME) if (re.test(name)) return reason;

  const rules = CATEGORY_RULES[categoryLabel];
  if (rules?.exclude && rules.exclude.test(name)) return "belongs to another use";
  if (rules?.require && !rules.require.test(name)) return "no yard signal in name";
  return null;
}

/** Chains and duplicate listings share a name under different place_ids. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
