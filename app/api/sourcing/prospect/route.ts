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
import { validCoordinates } from "@/lib/location";
import { UUID } from "@/lib/agents/catalog";
import { parseSourcing } from "@/lib/agents/sourcing";
import { lookupParcel } from "@/lib/sourcing/parcels";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const site = body?.site;
  if (!body || typeof body.runId !== "string" || !UUID.test(body.runId) || typeof body.ref !== "string" || !/^S\d{1,3}$/.test(body.ref)
      || !site || !validCoordinates({ latitude: site.lat, longitude: site.lng }) || typeof site.address !== "string" || site.address.length > 200) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const market = typeof body.market === "string" ? body.market.slice(0, 80) : undefined;

  const db = getServiceClient();
  const { data: run, error } = await db.from("agent_runs").select("result")
    .eq("id", body.runId).eq("owner_email", user.email.toLowerCase()).eq("agent", "off-market-sourcing").eq("status", "completed").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const report = run?.result?.report ? parseSourcing(run.result.report) : null;
  const sourced = report?.sites.find((s) => s.ref === body.ref);
  if (!sourced) return NextResponse.json({ error: "That site isn't in your sourcing report." }, { status: 404 });

  // Owner of record straight from the appraisal roll, looked up here rather
  // than taken from the browser; it fills whatever the agent left empty.
  const parcel = await lookupParcel(Number(site.lat), Number(site.lng));
  const owner = sourced.owner ?? parcel?.owner ?? null;
  const situs = parcel?.situsAddress?.split(",")[0].replace(/\s+/g, " ").trim() || null;

  // Prefer a verified rooftop for the parcel address; otherwise the operators'
  // Google pin, which the analyst has just looked at on the map.
  const address = sourced.parcelAddress ?? situs ?? site.address;
  const verified = sourced.parcelAddress ? await geocodeAddress([sourced.parcelAddress, sourced.city, "TX"], { requirePrecise: true }) : null;
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
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Could not create the prospect." }, { status: 400 });
  }
  if (!result?.deal) {
    return NextResponse.json({ error: "Hopper already has a deal at this address.", duplicates: result?.duplicates ?? [] }, { status: 409 });
  }
  const operators = Array.isArray(site.operators) ? site.operators.filter((o: unknown) => typeof o === "string").slice(0, 10).map((o: string) => o.slice(0, 120)) : [];
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
