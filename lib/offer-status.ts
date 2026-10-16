// lib/offer-status.ts
//
// What happened to an offer, and the bid-ask gap it leaves. Shared by the
// offers API, the deal's Offers panel and the /offers roll-up.

export const OFFER_STATUSES = ["sent", "countered", "accepted", "rejected", "withdrawn", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  countered: "Countered",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

/** Seller's counter over our offer, in dollars and as a share of our offer. */
export function bidAskGap(price: number | null | undefined, counter: number | null | undefined) {
  const p = price == null ? NaN : Number(price);
  const c = counter == null ? NaN : Number(counter);
  if (!(p > 0) || !(c > 0)) return null;
  return { dollars: c - p, pct: (c - p) / p };
}
