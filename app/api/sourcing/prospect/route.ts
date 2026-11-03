// POST { runId, ref, site: { lat, lng, address, operators }, market? }
// Turns one qualified sweep site into a Prospect deal: off-market,
// sale-leaseback when the owner is the operator, owner of record as the seller
// contact, and the agent's research (sources, signals, outreach draft) on the
// deal's history. Uses only the requester's own completed sourcing run.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { createDeal, logDealEvent } from "@/lib/deals";
import { geocodeAddress } from "@/lib/geocode";
import { canonicalMarket, stateOfMarket } from "@/lib/markets";
import { validCoordinates } from "@/lib/location";
import { UUID } from "@/lib/agents/catalog";
import { parseSourcing } from "@/lib/agents/sourcing";
import { lookupParcel } from "@/lib/sourcing/parcels";
import { defaultOwner } from "@/lib/market-owners";
import { reviewedSites } from "@/lib/sourcing/snapshot";
import { parcelKey } from "@/lib/sourcing/identity";
import { haversineMiles } from "@/lib/comps/match";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.runId !== "string" || !UUID.test(body.runId) || typeof body.ref !== "string" || !/^S\d{1,3}$/.test(body.ref)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: run, error } = await db.from("agent_runs").select("result,sources")
    .eq("id", body.runId).eq("owner_email", user.email.toLowerCase()).eq("agent", "off-market-sourcing").eq("status", "completed").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const reviewed = reviewedSites(run?.sources);
  if (!reviewed) return NextResponse.json({ error: "Requalify a saved sweep before adding this prospect." }, { status: 409 });
  const site = reviewed.sites.find(s => s.ref === body.ref);
  if (!site) return NextResponse.json({ error: "That site was not selected in this review." }, { status: 404 });
  const market = reviewed.market || undefined;
  const report = run?.result?.report ? parseSourcing(run.result.report, reviewed.sites.map(s => s.ref), true) : null;
  const sourced = report?.sites.find((s) => s.ref === body.ref);
  if (!sourced) return NextResponse.json({ error: "That site isn't in your sourcing report." }, { status: 404 });
  const hash = createHash("sha256").update(`sourcing:${reviewed.sweepId}:${site.ref}`).digest("hex");
  const intakeKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const prior = await db.from("deals").select("id").eq("intake_key", intakeKey).maybeSingle();
  if (prior.error) return NextResponse.json({ error: "Could not check previous promotion" }, { status: 503 });
  if (prior.data) return NextResponse.json({ dealId: prior.data.id });

  // Owner of record straight from the appraisal roll, looked up here rather
  // than taken from the browser; it fills whatever the agent left empty.
  const parcel = await lookupParcel(Number(site.lat), Number(site.lng));
  const record = parcelKey(parcel), researched = parcelKey({ county: sourced.county, propId: sourced.parcelId });
  if (record && researched && record !== researched) return NextResponse.json({ error: "Parcel sources disagree. Review the property location before adding it." }, { status: 409 });
  if (site.identityStatus === "address-conflict" && (!researched || record !== researched)) return NextResponse.json({ error: "Resolve the listing/parcel address conflict before adding this prospect." }, { status: 409 });
  const owner = sourced.owner ?? parcel?.owner ?? null;
  const situs = parcel?.situsAddress?.split(",")[0].replace(/\s+/g, " ").trim() || null;

  // Prefer a verified rooftop for the parcel address; otherwise the operators'
  // Google pin, which the analyst has just looked at on the map.
  const address = sourced.parcelAddress ?? situs ?? site.address;
  const verified = sourced.parcelAddress ? await geocodeAddress([sourced.parcelAddress, sourced.city, canonicalMarket(market, sourced.city)], { requirePrecise: true, state: stateOfMarket(canonicalMarket(market, sourced.city)) }) : null;
  if (verified && haversineMiles(site.lat, site.lng, verified.lat, verified.lng) > .25) return NextResponse.json({ error: "The researched address is away from the reviewed site. Review the location before adding it." }, { status: 409 });
  const point = verified ? { latitude: verified.lat, longitude: verified.lng, geocodePrecision: verified.precision } : { latitude: Number(site.lat), longitude: Number(site.lng), geocodePrecision: undefined };

  let result: any;
  try {
    result = await createDeal({
      address, city: sourced.city ?? undefined, market, ...point,
      assetType: "ios", assetClass: "ios", substantialYard: false,
      acres: sourced.acres ?? parcel?.acres ?? undefined, buildingSf: sourced.buildingSf ?? undefined,
      marketingStatus: "off_market", acquisitionType: sourced.ownerType === "owner-user" ? "slb" : "unsolicited",
      currentOwnerName: owner ?? undefined,
      mla: { status: "assumed" },
      createdBy: user.email,
      intakeKey,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Could not create the prospect." }, { status: 400 });
  }
  if (!result?.deal) {
    return NextResponse.json({ error: "Hopper already has a deal at this address.", duplicates: result?.duplicates ?? [] }, { status: 409 });
  }
  const operators = site.operators.map(o => o.name);
  // Owner: the market's coverer, else the analyst who ran the sweep. Never fatal.
  try {
    await db.from("deals").update({ assigned_analyst: await defaultOwner(market, sourced.city, user.email) }).eq("id", result.deal.id);
  } catch {}
  await logDealEvent(result.deal.id, "sourcing_research", {
    runId: body.runId, ref: body.ref, operators,
    owner, ownerMailingAddress: sourced.ownerMailingAddress ?? parcel?.mailingAddress ?? null, ownerType: sourced.ownerType,
    appraisalRoll: parcel ? { owner: parcel.owner, mailingAddress: parcel.mailingAddress, situsAddress: parcel.situsAddress, acres: parcel.acres, yearBuilt: parcel.yearBuilt, marketValue: parcel.marketValue, propId: parcel.propId, county: parcel.county, taxYear: parcel.taxYear, source: parcel.source } : null,
    parcelId: sourced.parcelId, county: sourced.county, zoning: sourced.zoning, outdoorStorage: sourced.outdoorStorage,
    ownedSince: sourced.ownedSince, yearBuilt: sourced.yearBuilt, signals: sourced.signals, fit: sourced.fit, fitReason: sourced.fitReason,
    outreachDraft: sourced.outreach, sources: sourced.sources, unverified: sourced.unverified,
    note: "Agent research draft from an off-market sweep. Verify before outreach.",
  }, user.email);
  return NextResponse.json({ dealId: result.deal.id });
}
