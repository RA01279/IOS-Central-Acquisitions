// app/deals/[id]/layout.tsx
//
// The deal workspace shell: breadcrumb, address, one-line facts, stage badge,
// Export IC Deck, and the five tabs. Every tab is its own URL
// (/deals/[id], /demand-map, /financials, /notes, /ic-deck) so any view can be
// shared as a link. /deals/D-1042 resolves the short ref to the deal.

import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { getServiceClient } from "@/lib/supabase";
import { getDealContacts } from "@/lib/crm";
import { ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { dealRef, fmtAcres, fmtSf } from "@/lib/format";
import Nav from "@/components/Nav";
import { Badge, ScoreTile, STAGE_TONES } from "@/components/ui";
import { getSiteView } from "@/lib/deal-workspace";
import { DealTabs, DealMobileBar, DealMobileTabs, TrackRecent } from "@/components/DealWorkspaceClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Deal" };
  const { data } = await getServiceClient().from("deals").select("properties(address)").eq("id", id).maybeSingle();
  return { title: (data?.properties as any)?.address ?? "Deal" };
}

export default async function DealLayout(props: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = getServiceClient();

  const short = /^d-?(\d+)$/i.exec(id);
  if (short) {
    const { data } = await supabase.from("deals").select("id").eq("ref", Number(short[1])).maybeSingle();
    if (!data) return notFound();
    redirect(`/deals/${data.id}`);
  }
  if (!UUID.test(id)) return notFound();

  const { data: deal } = await supabase
    .from("deals")
    .select("id, ref, stage, asset_class, deal_type, properties(address, city, state, market, submarket, lot_sf, building_sf, asset_type)")
    .eq("id", id)
    .maybeSingle();
  if (!deal) return notFound();

  const p: any = deal.properties ?? {};
  const links = (await getDealContacts(deal.id).catch(() => [])) as any[];
  const broker = links.find((l) => l.role === "seller_broker")?.contacts;
  const ios = deal.asset_class !== "industrial";
  const facts = [
    ios ? "IOS yard" : "Industrial",
    ios ? (p.lot_sf ? fmtAcres(p.lot_sf).replace(" ac", " acres") : null) : p.building_sf ? fmtSf(p.building_sf) : null,
    [p.city, p.state].filter(Boolean).join(", ") || p.market,
    broker ? `Broker: ${broker.companies?.name ? `${broker.companies.name} (${broker.name})` : broker.name}` : null,
  ].filter(Boolean);
  const site = await getSiteView(deal.id);
  const name = p.address ?? "Untitled deal";
  const ref = dealRef(deal.ref);

  return (
    <>
      <Nav active="deals" />
      <TrackRecent id={deal.id} name={name} />
      <main className="bleed">
        <div className="ph tabs-below ph-deal">
          <Suspense>
            <DealMobileBar id={deal.id} name={name} />
          </Suspense>
          <div className="crumbs">
            <a href="/deals">Deals</a>
            <ChevronRight size={13} color="#4E9FD6" />
            {p.market ? (
              <>
                <a href={`/deals?market=${encodeURIComponent(p.market)}${ios ? "" : "&asset=industrial"}`}>{p.market}</a>
                <ChevronRight size={13} color="#4E9FD6" />
              </>
            ) : null}
            <span className="ref">{ref || "Deal"}</span>
          </div>
          <div className="ph-row">
            <div className="ph-title">
              <h1>{name}</h1>
              <span className="ph-sub">{facts.join(" · ")}</span>
            </div>
            <span className="mobile-only">
              <ScoreTile score={site.score.score} size="md" />
            </span>
            <div className="ph-actions">
              <Badge tone={STAGE_TONES[deal.stage] ?? "neutral"}>{STAGE_LABELS[deal.stage] ?? deal.stage}</Badge>
              {deal.asset_class && (
                <Badge tone="brand">{ASSET_CLASS_LABELS[deal.asset_class] ?? deal.asset_class}</Badge>
              )}
              <a href={`/deals/${deal.id}/ic-deck`} className="btn-inverse">
                Export IC Deck
              </a>
            </div>
          </div>
          <Suspense>
            <DealTabs id={deal.id} />
          </Suspense>
        </div>
        {props.children}
      </main>
      <Suspense>
        <DealMobileTabs id={deal.id} />
      </Suspense>
    </>
  );
}
