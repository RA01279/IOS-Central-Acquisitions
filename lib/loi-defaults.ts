// lib/loi-defaults.ts
//
// LOI prefill for the Financials tab (moved verbatim from the old single-page
// deal view). Priority: LIVE DEAL DATA WINS for everything Hopper owns
// (latest offer price, property facts, linked contacts) -- update the deal and
// the next LOI follows. Saved terms from a prior LOI only fill fields Hopper
// has no source for (deposit, periods, rate...). Date always today.

export function loiDefaults(deal: any, dealContacts: any[]) {
  const saved = (deal.loi_terms ?? {}) as Record<string, string>;
  const latestOffer = [...(deal.offers ?? [])].sort((a: any, b: any) =>
    (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
  )[0];
  const brokerLink: any = dealContacts.find((l) => l.role === "seller_broker")?.contacts;
  const sellerLink: any = dealContacts.find((l) => l.role === "seller")?.contacts;
  const brokerFirm = brokerLink?.companies?.name;
  return {
    date: new Date().toISOString().slice(0, 10),
    tel: saved.tel ?? "(912) 508-4170",
    attn: (brokerLink ? `${brokerLink.name}${brokerFirm ? `, ${brokerFirm}` : ""}` : null) ?? saved.attn ?? "",
    sellerClause: sellerLink?.name ?? saved.sellerClause ?? "its current ownership",
    propertyDescription:
      [deal.properties?.address, deal.properties?.city].filter(Boolean).join(", ") || (saved.propertyDescription ?? ""),
    price: (latestOffer?.price ? Math.round(latestOffer.price).toLocaleString("en-US") : null) ?? saved.price ?? "",
    depositWords: saved.depositWords ?? "",
    depositAmount: saved.depositAmount ?? "",
    ddDays: saved.ddDays ?? "Sixty (60)",
    closingDays: saved.closingDays ?? "Thirty (30)",
    brokerClauseName:
      (brokerLink ? `${brokerLink.name}${brokerFirm ? ` of ${brokerFirm}` : ""}` : null) ?? saved.brokerClauseName ?? "",
    commissionPayer: saved.commissionPayer ?? "Seller",
    signer1Name: saved.signer1Name ?? "John Lettieri",
    signer1Title: saved.signer1Title ?? "Market Officer | Central",
    signer2Name: saved.signer2Name ?? "Rhett Anderson",
    signer2Title: saved.signer2Title ?? "IOS Market Lead | Central",
    // SLB variant fields. LOI type follows the deal's acquisition_type.
    loiType: saved.loiType ?? (deal.acquisition_type === "slb" ? "slb" : "standard"),
    senderEmail: saved.senderEmail ?? "randerson@dalfen.com",
    expiryDate: saved.expiryDate ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    sellerName: sellerLink?.name ?? saved.sellerName ?? "",
    brokerFirm: brokerFirm ?? saved.brokerFirm ?? "",
    brokerAddress1: brokerLink?.address ?? saved.brokerAddress1 ?? "",
    brokerAddress2: saved.brokerAddress2 ?? "",
    priceWords: saved.priceWords ?? "",
    buildingSf:
      (deal.properties?.building_sf ? Math.round(deal.properties.building_sf).toLocaleString("en-US") : null) ??
      saved.buildingSf ??
      "",
    acres: (deal.properties?.lot_sf ? (deal.properties.lot_sf / 43560).toFixed(2) : null) ?? saved.acres ?? "",
    leaseTermYears: saved.leaseTermYears ?? "3",
    rentAmount: saved.rentAmount ?? "",
    rentBasis: saved.rentBasis ?? "total_monthly",
    escalations: saved.escalations ?? "3.5",
  };
}
