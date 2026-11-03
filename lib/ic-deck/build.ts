// lib/ic-deck/build.ts
//
// Builds the executive summary deck for a deal: model figures (saved UW
// version or a browser-extracted summary), Hopper comps, owned assets, maps,
// the IC narrative agent's draft and any retained source exhibits. Shared by
// the deck panel's API route and the automatic build on model upload.

import { getServiceClient } from "@/lib/supabase";
import { STAGE_LABELS } from "@/lib/deals";
import { COMP_POLICY, scoreComps, unitValue, directBuildingRent, isUsableForDistance, haversineMiles } from "@/lib/comps/match";
import { loadCompEvidence, subjectOf } from "@/lib/comps/evidence";
import { validateModelSummary } from "@/lib/ic-deck/model";
import { renderIcDeck, type DeckAsset, type DeckComp } from "@/lib/ic-deck/deck";
import type { Picture } from "@/lib/ic-deck/pptx-kit";
import { parseNarrative } from "@/lib/agents/ic-narrative";
import { UUID } from "@/lib/agents/catalog";
import { modelIdentity, incomePosition, canExportModel } from "@/lib/investment-review";
import { compReview } from "@/lib/comps/reviewed-evidence";
import { loadSavedDeckModel } from "@/lib/ic-deck/saved-model";
import { validateReference, referenceNarrative, referenceBudget } from "@/lib/ic-deck/reference";
import { bindModelSubject } from "@/lib/ic-deck/model-subject";
import { parcelFootprint, highwayAccess, highwayCaption, parcelPaths, type ParcelFootprint, type HighwayAccess } from "@/lib/ic-deck/site-geo";

/** Resolve within ms or give up with null -- these exhibits never hold up the deck. */
const within = <T,>(p: Promise<T | null>, ms: number) => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))]);

export class BuildError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface BuildInput {
  dealId: string;
  actorEmail: string;
  /** A browser-extracted ModelSummary; omitted = the deal's latest saved UW workbook. */
  model?: unknown;
  narrativeRunId?: unknown;
  referenceId?: unknown;
}

const ASSET_RADIUS_MILES = 50;
const RENT_UNITS: Record<string, string> = {
  total_monthly: "/ mo", per_sf_bldg_monthly: "/ SF / mo", per_sf_bldg_annual: "/ SF / yr",
  per_acre_monthly: "/ AC / mo", per_sf_land_monthly: "/ SF land / mo",
};
const money = (v: number, d = 0) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

async function staticMap(params: Record<string, string | string[]>, ext: "png" | "jpeg", source: string): Promise<Picture | undefined> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return undefined;
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  for (const [k, v] of Object.entries(params)) for (const x of ([] as string[]).concat(v)) url.searchParams.append(k, x);
  url.searchParams.set("scale", "2");
  if (ext === "jpeg") url.searchParams.set("format", "jpg");
  url.searchParams.set("key", key);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return undefined;
    // A missing exhibit becomes a marked placeholder; it never fails the deck.
    return { bytes: new Uint8Array(await r.arrayBuffer()), ext, source };
  } catch {
    return undefined;
  }
}
/** Static Maps size string with the frame's aspect ratio (max 640 per side). */
const sized = (w: number, h: number) => (w >= h ? `640x${Math.round((640 * h) / w)}` : `${Math.round((640 * w) / h)}x640`);
// Static Maps labels are one character: 1-9, then A-Z.
const label = (n: number) => (n <= 9 ? String(n) : String.fromCharCode(55 + n));

export async function buildExecSummary(input: BuildInput): Promise<{ buffer: Buffer; name: string; warnings: string[] }> {
  let model;
  try {
    const saved = input.model ? null : await loadSavedDeckModel(input.dealId);
    model = validateModelSummary(input.model ?? saved?.model);
  } catch (e: any) { throw new BuildError(400, e.message); }

  const db = getServiceClient();

  // Optional agent narrative: the requester's own completed run for THIS deal.
  let narrative: { sections: NonNullable<ReturnType<typeof parseNarrative>>["sections"]; runAt: string } | undefined;
  if (input.narrativeRunId != null) {
    if (typeof input.narrativeRunId !== "string" || !UUID.test(input.narrativeRunId)) throw new BuildError(400, "Invalid narrative.");
    const { data: run, error: runErr } = await db.from("agent_runs").select("result,finished_at")
      .eq("id", input.narrativeRunId).eq("owner_email", input.actorEmail.toLowerCase()).eq("deal_id", input.dealId)
      .eq("agent", "ic-narrative").eq("status", "completed").maybeSingle();
    if (runErr) throw new BuildError(500, runErr.message);
    const parsed = run?.result?.report ? parseNarrative(run.result.report) : null;
    if (!parsed) throw new BuildError(404, "That narrative isn't available for this deal. Build without it or run the agent again.");
    narrative = { sections: parsed.sections, runAt: String(run!.finished_at ?? "").slice(0, 10) };
  }

  const { data: deal, error } = await db
    .from("deals")
    .select("id, stage, asset_class, investment_review, deal_analysis_versions(*), uw_versions(*), acquisition_type, contract_price, dd_end_on, closing_on, loi_terms, properties(address, city, market, submarket, latitude, longitude, geocode_precision, building_sf, lot_sf, occupancy_status), offers(price, offered_at)")
    .eq("id", input.dealId)
    .maybeSingle();
  if (error) throw new BuildError(500, error.message);
  if (!deal) throw new BuildError(404, "Deal not found");
  const incoming={address:model.property.address,acres:model.property.acres,buildingSf:model.property.buildingSf};
  const checked=modelIdentity(deal,{returns_summary:{sourceIdentity:incoming}});
  // A browser-supplied workbook cannot inherit a resolution for another source.
  const incomingPrice=model.capitalization.find(c=>/^price$/i.test(c.label))?.amount??null;
  if(!canExportModel(deal,incoming,model.source.fileName,incomingPrice,model.returns.levered.irr))throw new BuildError(422, "This workbook was marked a wrong upload for this deal. Use the right model, or change that decision under \"Investment evidence and decision\".");
  if(!checked.authoritative&&checked.issues.length)model.warnings.push("Model's property identity differs from the deal (often stale template data): "+checked.issues.join("; "));
  model.warnings.push(incomePosition(deal).label+". Returns are cached workbook scenario results, not verified current income.");
  const prop: any = Array.isArray(deal.properties) ? deal.properties[0] : deal.properties;
  try { model = bindModelSubject(model, prop?.address ?? ""); }
  catch (error) { throw new BuildError(422, (error as Error).message); }
  let reference: { bytes: Uint8Array; name: string } | undefined;
  if (input.referenceId) {
    if (typeof input.referenceId !== "string" || !UUID.test(input.referenceId)) throw new BuildError(400, "Invalid source deck");
    const { data: doc } = await db.from("documents").select("storage_path,file_name")
      .eq("id", input.referenceId).eq("deal_id", input.dealId).maybeSingle();
    if (!doc || !/\.pptx$/i.test(doc.storage_path)) throw new BuildError(404, "Source deck not found on this deal");
    const { data: file, error: sourceError } = await db.storage.from("documents").download(doc.storage_path);
    if (sourceError || !file) throw new BuildError(422, "Could not read the source exhibits");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const referenceZip = validateReference(bytes, prop?.address ?? model.property.address ?? "");
      reference = { bytes, name: doc.file_name ?? "Recorded source deck" };
      const sourceBudget = referenceBudget(referenceZip);
      const recordedDeposit = Number(String((deal.loi_terms as any)?.depositAmount ?? "").replace(/[$,\s]/g, ""));
      if (recordedDeposit && sourceBudget.deposit != null && Math.abs(recordedDeposit - sourceBudget.deposit) > 1) model.warnings.push(`The retained budget uses a ${money(sourceBudget.deposit)} deposit; saved LOI terms use ${money(recordedDeposit)}. Update the budget source or confirm the intended deposit before circulating.`);
      if (!narrative) narrative = { sections: referenceNarrative(referenceZip, reference.name).sections, runAt: "retained source" };
    } catch (error) { throw new BuildError(422, (error as Error).message); }
  }
  const located = prop?.latitude != null && prop?.longitude != null && isUsableForDistance(prop.geocode_precision);
  const lat = located ? Number(prop.latitude) : null, lng = located ? Number(prop.longitude) : null;

  const offers = ((deal as any).offers ?? []).filter((o: any) => o.price != null).sort((a: any, b: any) => String(b.offered_at).localeCompare(String(a.offered_at)));
  const loi: Record<string, string> = {};
  for (const [k, v] of Object.entries((deal.loi_terms as Record<string, unknown>) ?? {})) if (typeof v === "string" && v.trim()) loi[k] = v.trim().slice(0, 120);

  // ---- comps: Hopper's own ranking, same as the deal page's comps panel ----
  let leaseComps: DeckComp[] = [], saleComps: DeckComp[] = [];
  const compRadii = { lease: COMP_POLICY.radiusMiles as number, sale: COMP_POLICY.radiusMiles as number };
  if (lat !== null && lng !== null) {
    const rows = compReview(deal,await loadCompEvidence(),subjectOf(deal)).comps;
    // The workbook's sizes win over the property record, but the subject is
    // otherwise the comps panel's. Coverage is a FRACTION on both sides; the
    // deck once passed a percentage, which zeroed the coverage factor for
    // every comp and ranked them differently from the panel.
    const base = subjectOf(deal);
    const buildingSf = model.property.buildingSf ?? base.buildingSf;
    const lotSf = model.property.siteSf ?? base.lotSf;
    const subject = {
      ...base, lat, lng, buildingSf, lotSf,
      coveragePct: model.property.coverage ?? (buildingSf && lotSf ? buildingSf / lotSf : null),
    };
    const pick = (type: "lease" | "sale"): DeckComp[] => {
      const basis = subject.assetClass === "ios" ? "land" as const : "building" as const;
      const nearby = scoreComps(rows, subject, type, { topN: 10, basis }).filter(s => s.inRange);
      compRadii[type] = nearby.length < 3 ? 25 : COMP_POLICY.radiusMiles;
      return scoreComps(rows, subject, type, { topN: 10, radiusMiles: compRadii[type], basis })
        .filter((s) => s.inRange)
        .map((s, i) => {
          const c = s.comp;
          const acres = c.lot_sf ? Number(c.lot_sf) / 43560 : null;
          const value = unitValue(c, basis);
          const norm = value == null ? null : basis === "land" ? value * 43560 : value;
          const normalizedUnit = basis === "land" ? (type === "lease" ? "$/Site AC/Mo" : "$/Site AC") : (type === "lease" ? "$/SF Bldg/Mo" : "$/SF Bldg");
          return type === "lease"
            ? { n: i + 1, address: c.address, city: c.city ?? null, date: c.date_commenced ?? null, dateEstimated: !!c.date_estimated, buildingSf: c.building_sf ?? null, acres,
                quoted: c.rent != null ? `${money(Number(c.rent), Number(c.rent) < 100 ? 2 : 0)} ${RENT_UNITS[c.rent_basis ?? ""] ?? ""}`.trim() : "—",
                normalized: norm === null ? "—" : `${money(norm, basis === "land" ? 0 : 2)}${basis === "building" && !directBuildingRent(c) ? " whole-site equiv." : ""}`, normalizedUnit, party: c.tenant_name ?? null, distanceMi: s.distanceMi,
                lat: Number(c.latitude), lng: Number(c.longitude) }
            : { n: i + 1, address: c.address, city: c.city ?? null, date: c.closed_on ?? null, buildingSf: c.building_sf ?? null, acres,
                quoted: c.sale_price != null ? money(Number(c.sale_price)) : "—", normalized: norm === null ? "—" : money(norm, basis === "land" ? 0 : 2), normalizedUnit,
                party: c.buyer ?? null, distanceMi: s.distanceMi, capRate: c.cap_rate != null ? Number(c.cap_rate) : null,
                lat: Number(c.latitude), lng: Number(c.longitude) };
        });
    };
    leaseComps = pick("lease");
    saleComps = pick("sale");
  }

  // ---- owned assets near the subject ----------------------------------------
  let assets: Array<DeckAsset & { lat: number; lng: number }> = [];
  if (lat !== null && lng !== null) {
    const { data: rows, error: aErr } = await db.from("assets")
      .select("address, city, status, occupancy, site_acres, building_sf, latitude, longitude, geocode_precision")
      .eq("status", "owned").not("latitude", "is", null).limit(1000);
    if (aErr) throw new BuildError(500, aErr.message);
    assets = (rows ?? [])
      .filter((a: any) => isUsableForDistance(a.geocode_precision))
      .map((a: any) => ({ address: a.address, city: a.city, acres: a.site_acres != null ? Number(a.site_acres) : null, buildingSf: a.building_sf != null ? Number(a.building_sf) : null,
        status: a.status, occupancy: a.occupancy, lat: Number(a.latitude), lng: Number(a.longitude), distanceMi: haversineMiles(lat, lng, Number(a.latitude), Number(a.longitude)) }))
      .filter((a) => a.distanceMi <= ASSET_RADIUS_MILES)
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .slice(0, 15);
  }

  // ---- maps (in parallel; each falls back to a placeholder) -----------------
  const maps: Record<string, Picture | undefined> = {};
  let parcel: ParcelFootprint | null = null, highway: HighwayAccess | null = null;
  if (lat !== null && lng !== null) {
    const dealAcres = model.property.acres ?? (prop?.lot_sf ? Number(prop.lot_sf) / 43560 : null);
    [parcel, highway] = await Promise.all([within(parcelFootprint(lat, lng, dealAcres), 20000), within(highwayAccess(lat, lng), 40000)]);
  }
  if (lat !== null && lng !== null) {
    const at = `${lat},${lng}`, pin = `color:red|${at}`;
    const src = (what: string) => `Google Maps ${what} of the Hopper-recorded pin (${prop.geocode_precision}), retrieved ${new Date().toISOString().slice(0, 10)}.`;
    const markers = (list: Array<{ lat: number; lng: number }>, color: string) =>
      list.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map((c, i) => `color:${color}|label:${label(i + 1)}|${c.lat},${c.lng}`);
    const jobs: Array<[string, Promise<Picture | undefined>]> = [
      ["coverPhoto", staticMap({ center: at, zoom: "18", size: sized(5.25, 3.77), maptype: "satellite" }, "jpeg", src("satellite imagery"))],
      ["coverAerial", staticMap({ center: at, zoom: "16", size: sized(4.75, 3.77), maptype: "satellite", ...(parcel ? { path: parcelPaths(parcel) } : { markers: pin }) }, "jpeg", src(parcel ? "satellite imagery with the parcel outline" : "satellite imagery"))],
      ["location", staticMap({ center: at, zoom: "11", size: sized(9.4, 5.45), markers: pin }, "png", src("road map"))],
      ["aerial", highway
        // Fitted to the site and both routes: the drive to the highway (white)
        // and to the nearest on-ramp (yellow), with H and R markers.
        ? staticMap({ size: sized(9.4, 5.0), maptype: "satellite",
            markers: [pin, `color:white|label:H|${highway.toHighway.point.join(",")}`, ...(highway.toRamp ? [`color:yellow|label:R|${highway.toRamp.point.join(",")}`] : [])],
            path: [...(highway.toHighway.polyline ? [`color:0xffffffcc|weight:5|enc:${highway.toHighway.polyline}`] : []), ...(highway.toRamp?.polyline ? [`color:0xffd400cc|weight:5|enc:${highway.toRamp.polyline}`] : []), ...(parcel ? parcelPaths(parcel) : [])] },
            "jpeg", src("satellite imagery with Google Routes drives to the highway and on-ramp"))
        : staticMap({ center: at, zoom: "16", size: sized(9.4, 5.0), maptype: "satellite", markers: pin }, "jpeg", src("satellite imagery"))],
      ["aerialClose", parcel
        ? staticMap({ size: sized(9.4, 5.0), maptype: "satellite", path: parcelPaths(parcel) }, "jpeg", src("satellite imagery with the parcel outline"))
        : staticMap({ center: at, zoom: "18", size: sized(9.4, 5.0), maptype: "satellite" }, "jpeg", src("satellite imagery"))],
    ];
    if (leaseComps.length) jobs.push(["leaseComps", staticMap({ size: sized(9.4, 5.45), markers: [pin, ...markers(leaseComps as any, "blue")] }, "png", src("road map with Hopper lease comps"))]);
    if (saleComps.length) jobs.push(["saleComps", staticMap({ size: sized(9.4, 5.45), markers: [pin, ...markers(saleComps as any, "green")] }, "png", src("road map with Hopper sale comps"))]);
    if (assets.length) jobs.push(["portfolio", staticMap({ size: sized(9.4, 5.45), markers: [pin, ...markers(assets, "blue")] }, "png", src("road map with Dalfen owned assets"))]);
    for (const [k, v] of await Promise.all(jobs.map(async ([k, p]) => [k, await p] as const))) maps[k] = v;
  }

  const buffer = renderIcDeck({
    model,
    deal: {
      id: deal.id, address: prop?.address ?? model.property.address ?? "Subject property", city: prop?.city ?? null,
      state: model.property.state, market: prop?.market ?? null, submarket: prop?.submarket ?? null,
      stage: deal.stage, stageLabel: STAGE_LABELS[deal.stage] ?? deal.stage, acquisitionType: deal.acquisition_type ?? null,
      contractPrice: deal.contract_price != null ? Number(deal.contract_price) : null,
      lastOffer: offers[0] ? { price: Number(offers[0].price), date: String(offers[0].offered_at).slice(0, 10) } : null,
      ddEndOn: deal.dd_end_on ?? null, closingOn: deal.closing_on ?? null, loi,
    },
    leaseComps, saleComps, compRadiusMiles: COMP_POLICY.radiusMiles, compRadii, assets, maps, narrative, reference, preparedOn: new Date(),
    site: {
      parcel: parcel ? { acres: parcel.acres, parcelCount: parcel.parcelCount, dealAcres: parcel.dealAcres, matchesDeal: parcel.matchesDeal, owner: parcel.owner, source: parcel.source } : null,
      highway: highway ? { caption: highwayCaption(highway), source: "Nearest numbered highway from OpenStreetMap; drive distance and time from Google Routes (no traffic), from the Hopper-recorded pin." } : null,
    },
  });
  const name = `${(prop?.address ?? "Deal").replace(/[^\w .-]+/g, "").trim()} - IC Exec Summary (draft).pptx`;
  return { buffer: Buffer.from(buffer), name, warnings: model.warnings };
}

/** Store a built deck in the deal's Documents. */
export async function saveExecSummary(dealId: string, buffer: Buffer, name: string, actorEmail: string) {
  const db = getServiceClient();
  const path = `deals/${dealId}/doc-${Date.now()}-${name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  const { error: uploadError } = await db.storage.from("documents").upload(path, buffer, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  if (uploadError) throw new BuildError(500, "Could not save the executive summary. Please try again.");
  const { data: doc, error: docError } = await db.from("documents").insert({ deal_id: dealId, doc_type: "other", storage_path: path, file_name: name, size_bytes: buffer.length, uploaded_by: actorEmail }).select("id").single();
  if (docError || !doc) throw new BuildError(500, "The deck was generated but could not be registered in this deal's documents.");
  return { documentId: doc.id as string, path };
}
