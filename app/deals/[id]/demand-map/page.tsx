// Demand Map tab: the split map/data view, then the location evidence that
// goes with it -- the verified pin, municipal zoning, and what we own or are
// chasing nearby.

import { getDeal, getEvidence, getSiteView, subjectOf } from "@/lib/deal-workspace";
import { parseMapView } from "@/lib/site-score";
import DemandMapView from "@/components/DemandMapView";
import DealLocationEditor from "@/components/DealLocationEditor";
import ZoningResearchPanel from "@/components/ZoningResearchPanel";
import AssetProximityPanel, { type AssetRow, type NearbyComp } from "@/components/AssetProximityPanel";

export const metadata = { title: "Demand Map" };

export default async function DemandMapPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ r?: string; cats?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const [deal, site, evidence] = await Promise.all([getDeal(id), getSiteView(id), getEvidence()]);
  const view = parseMapView(sp);
  const subject = subjectOf(deal);
  const center = subject.lat != null && subject.lng != null ? { lat: subject.lat, lng: subject.lng } : null;

  return (
    <>
      <DemandMapView
        dealId={deal.id}
        center={center}
        snapshot={site.snapshot}
        initialRadius={view.radius}
        initialCats={view.cats}
      />
      <div className="ws-body">
        <DealLocationEditor
          dealId={deal.id}
          address={deal.properties?.address ?? "This property"}
          latitude={subject.lat}
          longitude={subject.lng}
        />
        <ZoningResearchPanel dealId={deal.id} />
        <AssetProximityPanel
          dealId={deal.id}
          assets={evidence.assets as AssetRow[]}
          comps={evidence.comps as NearbyComp[]}
          pipeline={evidence.pipeline}
          subjectLat={subject.lat}
          subjectLng={subject.lng}
          subjectAddress={deal.properties?.address ?? "This deal"}
        />
      </div>
    </>
  );
}
