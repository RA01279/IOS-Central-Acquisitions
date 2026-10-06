// IC Deck tab: live preview of the one-page IC summary slide and its .pptx
// export, then the two longer exports that already existed -- the executive
// summary deck built from the acquisition model, and the IOS demand map deck.

import { getDeal, getSiteView, dealKpis } from "@/lib/deal-workspace";
import { parseMapView } from "@/lib/site-score";
import { DEMAND_CATEGORIES, scoreState } from "@/lib/hopper-tokens";
import { ASSET_CLASS_LABELS } from "@/lib/deals";
import { dealRef, fmtShortDate } from "@/lib/format";
import { slideMap, type SummarySlideModel } from "@/lib/ic-deck/summary-slide";
import IcSlidePreview from "@/components/IcSlidePreview";
import IcDeckBuilder from "@/components/IcDeckBuilder";
import IcDeckPanel from "@/components/IcDeckPanel";

export const metadata = { title: "IC Deck" };

export default async function IcDeckPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ r?: string; cats?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const [deal, site] = await Promise.all([getDeal(id), getSiteView(id)]);
  const view = parseMapView(sp);
  const active = view.cats ?? DEMAND_CATEGORIES.map((c) => c.key);
  const k = dealKpis(deal, site.snapshot, view.radius, view.cats);
  const p = deal.properties ?? {};
  const ref = dealRef(deal.ref);
  const where = p.city ?? "";
  const map = slideMap(
    site.snapshot?.center ?? (p.latitude != null ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null),
    site.snapshot?.tenants ?? [],
    view.radius,
    (label) => {
      const c = DEMAND_CATEGORIES.find((x) => x.label === label);
      return c && active.includes(c.key) ? c.color : null;
    }
  );

  const model: SummarySlideModel = {
    eyebrow: `Investment Committee · ${ASSET_CLASS_LABELS[deal.asset_class] ?? "IOS"} Acquisition${deal.ic_on ? ` · ${fmtShortDate(deal.ic_on)}, ${deal.ic_on.slice(0, 4)}` : ""}`,
    title: [p.address, where].filter(Boolean).join(", "),
    kpis: [
      { label: "Site score", value: String(site.score.score ?? "—"), tone: scoreState(site.score.score) },
      { label: "Price", value: k.priceLabel },
      k.ios ? { label: "Land", value: k.landLabel } : { label: "Building", value: p.building_sf ? `${Math.round(p.building_sf / 1000)}K SF` : "—" },
      { label: `Basis ${k.basisUnit}`, value: k.basisLabel },
      { label: "Demand idx", value: String(k.demand.index ?? "—") },
    ],
    flags: site.flags,
    recommendation: deal.ic_recommendation ?? "",
    radius: view.radius,
    demandRows: [...k.demand.rows].sort((a, b) => b.count - a.count),
    activeCats: active,
    pins: map.pins,
    rings: map.rings,
    footerLeft: "Dalfen Industrial · Confidential · For Investment Committee use only",
    footerRight: `Source: Hopper ${ref} · Places Nearby, ${view.radius} mi`,
    fileName: `IC Summary - ${(p.address ?? "Deal").replace(/[^a-zA-Z0-9 ]+/g, "")}.pptx`,
  };

  const missing = [
    site.score.score == null && "site score",
    !k.price && "price",
    !site.snapshot && "demand search",
    !deal.ic_on && "IC date",
  ].filter(Boolean) as string[];

  const stem = p.address?.replace(/[^a-zA-Z0-9]+/g, "_");
  return (
    <>
      <IcSlidePreview dealId={deal.id} model={model} missing={missing} />
      <div className="ws-body">
        <IcDeckBuilder dealId={deal.id} fileNameStem={stem} />
        <IcDeckPanel
          dealId={deal.id}
          addressForSubtitle={[p.address, p.city].filter(Boolean).join(", ")}
          fileNameStem={stem}
        />
      </div>
    </>
  );
}
