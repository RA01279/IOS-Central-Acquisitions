// lib/deal-workspace.ts
//
// SERVER ONLY. Data for the deal workspace tabs. cache() dedupes within one
// request, so a tab that needs the deal twice (page + a helper) queries once.

import { cache } from "react";
import { notFound } from "next/navigation";
import { getServiceClient } from "./supabase";
import { loadDemandSnapshot, loadSignals } from "./site-signals";
import { resolveFlags, siteScore, demandBreakdown, type DemandSnapshot } from "./site-score";
import { dealValue, VALUE_BASIS_LABELS } from "./summary";
import { acres, fmtMoney, fmtPct } from "./format";
import { LOCATED_PRECISIONS } from "./ic-deck/geo";

export const getDeal = cache(async (id: string) => {
  const { data: deal } = await getServiceClient()
    .from("deals")
    .select("*, properties(*), mla_data(*), uw_versions(*), documents(*), deal_events(*), offers(*)")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();
  return deal as any;
});

export const getSiteView = cache(async (id: string) => {
  const [signals, snapshot] = await Promise.all([loadSignals([id]), loadDemandSnapshot(id)]);
  const flags = resolveFlags(signals.get(id));
  return { flags, score: siteScore(flags), snapshot: snapshot as DemandSnapshot | null };
});

// Comps, our portfolio, and other live deals: the evidence panels on the
// Demand Map (proximity) and Financials (comps) tabs.
export const getEvidence = cache(async () => {
  const supabase = getServiceClient();
  // Confirmed and locatable only -- a draft or an ungeocoded comp has no
  // business influencing an underwriting assumption. Fetched for the whole
  // repository rather than pre-filtered by market: the panels' radius filter
  // is the real constraint, and market labels are too inconsistent to trust.
  const [{ data: comps }, { data: assets }, { data: pipeline }] = await Promise.all([
    supabase
      .from("comps")
      .select(
        "id, comp_type, address, project_name, suite, city, market, submarket, asset_class, latitude, longitude, building_sf, lot_sf, yard_acres, coverage_pct, year_built, clear_height_ft, rent, rent_basis, lease_type, cam_psf_annual, date_commenced, date_estimated, sale_price, closed_on, cap_rate, tenant_name, buyer, geocode_precision"
      )
      .eq("status", "confirmed")
      .not("latitude", "is", null)
      .limit(1000),
    // Sold assets come through too -- the panel holds them behind a toggle.
    supabase
      .from("assets")
      .select("id, address, city, state, market, submarket, status, occupancy, site_acres, building_sf, latitude, longitude")
      .neq("status", "under_contract")
      .in("geocode_precision", LOCATED_PRECISIONS)
      .not("latitude", "is", null)
      .limit(1000),
    supabase
      .from("deals")
      .select("id, stage, asset_class, properties!inner(address, city, market, latitude, longitude)")
      .neq("stage", "archived")
      .neq("stage", "closed")
      .not("properties.latitude", "is", null)
      .limit(1000),
  ]);
  return {
    comps: comps ?? [],
    assets: assets ?? [],
    pipeline: (pipeline ?? []).map((d: any) => {
      const dp = Array.isArray(d.properties) ? d.properties[0] : d.properties;
      return {
        id: d.id,
        stage: d.stage,
        asset_class: d.asset_class,
        address: dp?.address ?? "(no address)",
        city: dp?.city ?? null,
        market: dp?.market ?? null,
        latitude: dp?.latitude != null ? Number(dp.latitude) : null,
        longitude: dp?.longitude != null ? Number(dp.longitude) : null,
      };
    }),
  };
});

export function subjectOf(deal: any) {
  const p = deal.properties ?? {};
  return {
    lat: p.latitude != null ? Number(p.latitude) : null,
    lng: p.longitude != null ? Number(p.longitude) : null,
    buildingSf: p.building_sf != null ? Number(p.building_sf) : null,
    lotSf: p.lot_sf != null ? Number(p.lot_sf) : null,
    // Coverage isn't stored on a property, but it's derivable and it's the
    // factor that separates a yard from a warehouse.
    coveragePct: p.building_sf && p.lot_sf ? Number(p.building_sf) / Number(p.lot_sf) : null,
    assetClass: deal.asset_class ?? null,
    market: p.market ?? null,
    submarket: p.submarket ?? null,
  };
}

export function latestReturns(deal: any) {
  const latest = [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number)[0];
  return (latest?.returns_summary ?? null) as any;
}

/** The KPI figures the summary, financials and IC slide all show. */
export function dealKpis(deal: any, snapshot: DemandSnapshot | null, radius = 3, cats?: string[] | null) {
  const ios = deal.asset_class !== "industrial";
  const p = deal.properties ?? {};
  const value = dealValue(deal);
  const ac = acres(p.lot_sf);
  const bsf = p.building_sf ? Number(p.building_sf) : null;
  const ask = deal.asking_price != null ? Number(deal.asking_price) : null;
  const shown = value.amount ?? ask;
  const basis = shown ? (ios ? (ac ? shown / ac : null) : bsf ? shown / bsf : null) : null;
  const r = latestReturns(deal);
  const demand = demandBreakdown(snapshot, radius, cats);
  return {
    ios,
    price: shown,
    priceLabel: fmtMoney(shown),
    priceBasis:
      value.amount == null && ask
        ? "Asking price"
        : value.basis === "none"
          ? "No price yet"
          : VALUE_BASIS_LABELS[value.basis].replace(/^./, (c) => c.toUpperCase()) + (ask ? ` · ask ${fmtMoney(ask)}` : ""),
    basis,
    basisLabel: basis == null ? "—" : ios ? fmtMoney(basis) : `$${Math.round(basis)}`,
    basisUnit: ios ? "/ac" : "/SF",
    landLabel: ac ? `${ac.toFixed(ac >= 10 ? 1 : 2).replace(/0$/, "")} ac` : "—",
    yieldLabel: fmtPct(r?.goingInYieldPct),
    stabilizedLabel: r?.stabilizedReturnOnCostPct != null ? `Stabilized RoC ${fmtPct(r.stabilizedReturnOnCostPct)}` : "No model yet",
    irrLabel: fmtPct(r?.irrPct),
    emLabel: r?.equityMultiple != null ? `${Number(r.equityMultiple).toFixed(2)}x` : "—",
    demand,
    radius,
  };
}
