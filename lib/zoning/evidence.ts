import type { TenantEvidence } from "./types";
// Location-specific primary sources, reviewed by a researcher. Search keywords
// alone never become evidence of outdoor operations or a verified tenant use.
export const TENANT_EVIDENCE: Record<string, TenantEvidence> = {
  "ChIJm_0E7RkZTIYRNAYZs9Ps540": {
    category: "Landscape / masonry supply yard",
    use: "Plano stone yard and nursery selling bulk gravel, soil, mulch, stone and pavers; truck and trailer pickup and loading.",
    url: "https://www.outdoorwarehousesupply.com/plano-location/",
    checkedOn: "2026-09-29", outdoorUse: true,
  },
  "ChIJ0Y1StxAZTIYROm3NB7HXwes": {
    category: "Sod / grass supply",
    use: "Plano location offers sod and grass for pickup and delivery. The company identifies this branch as grass only; broader sand and stone operations are not established here.",
    url: "https://a1grass.com/pages/locations",
    checkedOn: "2026-09-29", outdoorUse: false,
  },
};
