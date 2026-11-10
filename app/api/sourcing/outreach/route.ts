// app/api/sourcing/outreach/route.ts
//
// POST { sweepId, refs: ["S1", "S4", ...] } -> { results: [{ ref, dealId } | { ref, error }] }
//
// Sends sites straight from a saved sweep (step 2 of Sourcing) to Outreach,
// without waiting for the agent to qualify them. Each becomes a deal in the
// Outreach stage -- off-market, owner of record from the appraisal roll as
// the seller contact, the sweep's evidence (operators, parcel, usable acres)
// on its history -- worked on the Outreach page until the owner is interested.
//
// Uses the same intake key as the agent path (app/api/sourcing/prospect), so
// a site sent here and later qualified and sent again stays one deal. Only
// the requester's own saved sweep is read; sites already active in Hopper or
// with an unresolved listing / parcel address conflict are refused.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { createDeal, logDealEvent } from "@/lib/deals";
import { UUID } from "@/lib/agents/catalog";
import { canonicalMarket } from "@/lib/markets";
import { defaultOwner } from "@/lib/market-owners";
import { blocksSourcing } from "@/lib/sourcing/identity";
import type { Site } from "@/lib/sourcing/sweep";

export const dynamic = "force-dynamic";
const MAX = 25;

/** "100 Yard Rd, Testville, TX 77001" -> "Testville". */
function cityOf(address: string | null | undefined): string | undefined {
  const parts = String(address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 && !/^\d/.test(parts[1]) ? parts[1].replace(/\s+[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/, "") || undefined : undefined;
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const refs: string[] = Array.isArray(body?.refs) ? [...new Set<string>(body.refs.filter((r: unknown) => typeof r === "string" && /^S\d{1,3}$/.test(r)))] : [];
  if (!body || typeof body.sweepId !== "string" || !UUID.test(body.sweepId) || !refs.length) {
    return NextResponse.json({ error: "Pick at least one site from a saved sweep." }, { status: 400 });
  }
  if (refs.length > MAX) return NextResponse.json({ error: `Send at most ${MAX} sites at a time.` }, { status: 400 });

  const db = getServiceClient();
  const { data: sweep, error } = await db.from("sourcing_sweeps").select("id, snapshot")
    .eq("id", body.sweepId).eq("owner_email", user.email.toLowerCase()).maybeSingle();
  if (error) return NextResponse.json({ error: "Sweep unavailable" }, { status: 503 });
  if (!sweep) return NextResponse.json({ error: "Sweep not found. Run or reopen the sweep first." }, { status: 404 });
  const snapshot = sweep.snapshot as { sites?: Site[]; market?: string | null };
  const market = snapshot.market ?? undefined;

  const results: ({ ref: string; dealId: string } | { ref: string; error: string })[] = [];
  for (const ref of refs) {
    const site = snapshot.sites?.find((s) => s.ref === ref);
    if (!site) { results.push({ ref, error: "Not in this sweep." }); continue; }
    if (blocksSourcing(site)) { results.push({ ref, error: "Already active in Hopper." }); continue; }
    if (site.identityStatus === "address-conflict") { results.push({ ref, error: "Listing and parcel addresses disagree. Qualify it with the agent or check the location first." }); continue; }

    // Same key as the agent path, so a site can only ever become one deal.
    const hash = createHash("sha256").update(`sourcing:${sweep.id}:${ref}`).digest("hex");
    const intakeKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const prior = await db.from("deals").select("id").eq("intake_key", intakeKey).maybeSingle();
    if (prior.error) { results.push({ ref, error: "Could not check for an earlier send." }); continue; }
    if (prior.data) { results.push({ ref, dealId: prior.data.id }); continue; }

    const parcel = site.parcel;
    const situs = parcel?.situsAddress?.split(",")[0].replace(/\s+/g, " ").trim() || null;
    const address = situs ? titleCase(situs) : site.address.split(",")[0].trim();
    const city = cityOf(parcel?.situsAddress) ? titleCase(cityOf(parcel?.situsAddress)!) : cityOf(site.address);
    const acres = site.usable?.netAcres ?? parcel?.acres ?? undefined;
    let result: any;
    try {
      result = await createDeal({
        address, city, market: canonicalMarket(market, city, Number(site.lng)) ?? market,
        latitude: Number(site.lat), longitude: Number(site.lng),
        assetType: "ios", assetClass: "ios", substantialYard: false,
        acres: acres ?? undefined,
        marketingStatus: "off_market", acquisitionType: site.ownerUser ? "slb" : "unsolicited",
        currentOwnerName: parcel?.owner ?? undefined,
        mla: { status: "assumed" },
        createdBy: user.email,
        intakeKey,
      });
    } catch (e: any) {
      results.push({ ref, error: e.message ?? "Could not create it." });
      continue;
    }
    if (!result?.deal) { results.push({ ref, error: "Hopper already has a deal at this address." }); continue; }
    const dealId = result.deal.id as string;

    // Into Outreach, off the pipeline until the owner is interested.
    const { error: stageError } = await db.from("deals").update({ stage: "outreach", entered_pipeline_at: null }).eq("id", dealId).eq("stage", "prospect");
    if (stageError) { results.push({ ref, error: `Created, but couldn't move it to Outreach: ${stageError.message}` }); continue; }
    try {
      await db.from("deals").update({ assigned_analyst: await defaultOwner(market, city, user.email) }).eq("id", dealId);
    } catch {}
    await logDealEvent(dealId, "sent_to_outreach", { via: "sweep", sweepId: sweep.id, ref }, user.email);
    await logDealEvent(dealId, "sourcing_sweep", {
      sweepId: sweep.id, ref,
      operators: site.operators.map((o) => ({ name: o.name, phone: o.phone ?? null, website: o.website ?? null })),
      ownerUser: site.ownerUser,
      appraisalRoll: parcel ? { owner: parcel.owner, careOf: parcel.ownerCareOf, mailingAddress: parcel.mailingAddress, situsAddress: parcel.situsAddress, acres: parcel.acres, yearBuilt: parcel.yearBuilt, marketValue: parcel.marketValue, propId: parcel.propId, county: parcel.county, taxYear: parcel.taxYear, source: parcel.source } : null,
      usableAcres: site.usable ?? null,
      note: "Sent to outreach from a sweep, before agent research. Owner and parcel are from the appraisal roll; verify before reaching out.",
    }, user.email);
    results.push({ ref, dealId });
  }
  return NextResponse.json({ results });
}
