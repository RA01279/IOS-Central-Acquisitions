// lib/sourcing/screen.ts
//
// Sweep-list screen, before anyone spends a touch or an agent run on a site.
// Two flags, each with the evidence behind it:
//   * house -- a business registered at a home: a small owner-occupied lot
//     owned by a person, or a small lot whose neighbours are houses;
//   * small -- the owner's whole holding (adjoining same-owner parcels
//     included) is under the buy-box minimum.
// A flag never hides a site. It keeps it out of "Select all" and asks before
// it is sent; the evidence is shown so a wrong flag is easy to overrule.
// Nothing is concluded where the evidence is missing: no parcel, or a parcel
// whose address disagrees with the listing, is a site to check, not a flag.

import type { BuyBox } from "./markets";
import type { Site } from "./sweep";
import { individualOwner, ownerOccupied } from "./holding";

export type ScreenFlag = { code: "house" | "small"; label: string; detail: string };

/** Lots this small can be a house; a house-sized lot is never an IOS yard either way. */
const HOUSE_LOT_ACRES = 1;

export function siteAcres(s: Pick<Site, "parcel" | "holding">): number | null {
  return s.holding?.acres ?? s.parcel?.acres ?? null;
}

export function screenSite(s: Pick<Site, "parcel" | "holding" | "identityStatus">, box: Pick<BuyBox, "minAcres">): ScreenFlag[] {
  const p = s.parcel;
  if (!p || s.identityStatus === "address-conflict") return [];
  const flags: ScreenFlag[] = [];
  const acres = siteAcres(s);
  const h = s.holding;
  const person = individualOwner(p.owner);
  const lived = person && ownerOccupied(p);
  // Among houses: the neighbours were all read, none carries a business, and
  // they are house lots -- one is enough when the owner lives on the site.
  const street = !!h?.complete && h.businessLots === 0 && h.houseLots >= (lived ? 1 : 3);
  // Sweeps saved before neighbours were read: only a house-sized lot the owner lives on.
  const house = acres != null && acres < HOUSE_LOT_ACRES && person && (h?.complete ? street : lived && acres < 0.35);
  if (house) {
    flags.push({ code: "house", label: "Looks like a house", detail: [
      `${acres} acre lot owned by ${p.owner}`,
      lived ? "who gets tax mail there" : null,
      h?.complete ? `${h.houseLots} of ${h.neighbours} neighbouring lots are house-sized, none carries a business` : null,
      p.yearBuilt ? `built ${p.yearBuilt}` : null,
    ].filter(Boolean).join("; ") + "." });
  }
  if (acres != null && acres < box.minAcres) {
    const many = (h?.parcels.length ?? 1) > 1;
    flags.push({ code: "small", label: `Under ${box.minAcres} ac`, detail: many
      ? `The owner's ${h!.parcels.length} adjoining parcels total ${acres} acres, under the ${box.minAcres}-acre minimum.`
      : `${acres} acres${h ? h.complete ? "; the owner holds no adjoining parcels" : "; adjoining parcels could not all be checked" : "; adjoining parcels not checked"}, under the ${box.minAcres}-acre minimum.` });
  }
  return flags;
}
