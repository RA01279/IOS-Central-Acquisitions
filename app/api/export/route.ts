// app/api/export/route.ts
// Read-only JSON export for external dashboards (e.g. John's roll-up).
// Token-protected: ?token=... must match app_settings key 'export_token'.
// Deliberately exposes NO write capability and no auth/user data -- rotate
// the token by updating the settings row.
//
// schemaVersion 2 (Aug 2026) -- see HOPPER-HANDOFF.md. Breaking changes from
// v1, all consequences of the Central Acquisitions rework:
//   * `leasing` is GONE. Leasing left the product; lease rows still exist in
//     the database but nothing here reads them.
//   * `acquisitions.activeCount` / `byStage` now exclude the new 'closed'
//     stage. A closed deal is reported under `closed`, not as active pipeline.
//   * Every deal carries `assetClass` ("ios" | "industrial"), and the
//     aggregates are split the same way.
//
// Money (added Aug 2026, additive -- no version bump): deals now carry real
// contractPrice / closedPrice, and every deal reports `value` + `valueBasis`
// resolving closing price > contract price > last offer. The aggregate blocks
// gained `value` / `valueTotal` alongside the original `lastOfferValue*` fields,
// which are unchanged so existing consumers keep working. Prefer `value`, and
// show `estimatedFromOffers` when it's non-zero -- part of that total is then
// an offer, not a settled number.
//
// Optional, opt-in blocks (off by default, so the default payload stays the
// same size it always was):
//   ?include=contacts       -- deal counterparties by role, names only
//   ?include=lois           -- LOI generation history per deal
//   ?include=contacts,lois  -- both
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  ASSET_CLASSES,
  IN_CONTRACT_STAGES,
  STAGE_LABELS,
  type AssetClass,
} from "@/lib/deals";
import {
  assetClassOf,
  closedDate,
  ctToday,
  dealValue,
  rangeStart,
  upcomingMilestones,
} from "@/lib/summary";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_URL = "https://ios-central-acquisitions.vercel.app";
// Pipeline stages, excluding 'closed' (reported separately) and 'archived'.
const PIPELINE_STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"] as const;

function zeroByClass(): Record<AssetClass, number> {
  return { ios: 0, industrial: 0 };
}

export async function GET(req: NextRequest) {
  const supabase = getServiceClient();

  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "export_token")
    .maybeSingle();
  const token = req.nextUrl.searchParams.get("token");
  if (!tokenRow?.value || token !== tokenRow.value) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includes = new Set(
    (req.nextUrl.searchParams.get("include") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const wantContacts = includes.has("contacts");
  const wantLois = includes.has("lois");

  const today = ctToday();
  const [dealsRes, offersRes, tasksRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, deal_type, stage, asset_class, created_at, dd_end_on, closing_on, closed_on, contract_price, closed_price, death_stage, death_reason, disposition, pursuit_score, follow_up_on, marketing_status, acquisition_type, properties(address, city, market, submarket, lot_sf, building_sf, occupancy_status, walt_years, tenancy), offers(price, offered_at), deal_events(created_at), documents(doc_type, uploaded_at)" +
          (wantContacts ? ", deal_contacts(role, contacts(name, title, contact_type, companies(name)))" : "")
      )
      .eq("deal_type", "acquisition"),
    supabase
      .from("offers")
      .select("price, offered_at, created_at, source, deals(id, deal_type, asset_class, properties(address))")
      .order("offered_at", { ascending: false, nullsFirst: false })
      .limit(25),
    supabase.from("tasks").select("id, title, due_date, assigned_to").eq("status", "open"),
  ]);

  const deals = dealsRes.data ?? [];
  const openTasks = tasksRes.data ?? [];

  function loiDocs(d: any) {
    return (d.documents ?? []).filter((x: any) => x.doc_type === "loi");
  }

  function dealShape(d: any) {
    const lastOffer = [...(d.offers ?? [])].sort((a: any, b: any) =>
      (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
    )[0];
    const lastTouch =
      (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop() ?? d.created_at;
    const lois = loiDocs(d);
    const reported = dealValue(d);
    const shape: Record<string, unknown> = {
      id: d.id,
      url: `${APP_URL}/deals/${d.id}`,
      address: d.properties?.address ?? null,
      city: d.properties?.city ?? null,
      market: d.properties?.market ?? null,
      submarket: d.properties?.submarket ?? null,
      assetClass: assetClassOf(d),
      stage: d.stage,
      stageLabel: STAGE_LABELS[d.stage] ?? d.stage,
      createdAt: d.created_at,
      daysSinceLastTouch: Math.floor((Date.now() - new Date(lastTouch).getTime()) / DAY_MS),
      buildingSf: d.properties?.building_sf ?? null,
      lotSf: d.properties?.lot_sf ?? null,
      acres: d.properties?.lot_sf ? Number((d.properties.lot_sf / 43560).toFixed(2)) : null,
      occupancy: d.properties?.occupancy_status ?? null,
      waltYears: d.properties?.walt_years ?? null,
      tenancy: d.properties?.tenancy ?? null,
      marketingStatus: d.marketing_status ?? null,
      acquisitionType: d.acquisition_type ?? null,
      lastOfferPrice: lastOffer?.price ?? null,
      lastOfferAt: lastOffer?.offered_at ?? null,
      offerCount: (d.offers ?? []).length,
      // Diligence milestones. ddEndOn/closingOn are set when a deal enters
      // Due Diligence and are editable after; closedOn is the actual closing.
      ddEndOn: d.dd_end_on ?? null,
      closingOn: d.closing_on ?? null,
      closedOn: d.closed_on ?? null,
      // Real prices, where they exist. contractPrice is the agreed PSA price;
      // closedPrice is what the deal actually closed at.
      contractPrice: d.contract_price === null || d.contract_price === undefined ? null : Number(d.contract_price),
      closedPrice: d.closed_price === null || d.closed_price === undefined ? null : Number(d.closed_price),
      // The figure to report for this deal, and which of the three it came
      // from: "closed" | "contract" | "last_offer" | "none". Prefer this over
      // lastOfferPrice for any money display -- and surface the basis, so a
      // last_offer figure is never shown as though it were settled.
      value: reported.amount,
      valueBasis: reported.basis,
      loiCount: lois.length,
      lastLoiAt:
        lois.map((x: any) => x.uploaded_at).sort().pop() ?? null,
    };

    if (wantContacts) {
      // Names, roles, titles, and firms only. Email and phone are still NOT
      // exported -- a roll-up dashboard needs to know who the counterparty is,
      // not how to contact them. Ask Rhett if that changes.
      shape.contacts = (d.deal_contacts ?? []).map((l: any) => ({
        role: l.role,
        name: l.contacts?.name ?? null,
        title: l.contacts?.title ?? null,
        contactType: l.contacts?.contact_type ?? null,
        company: l.contacts?.companies?.name ?? null,
      }));
    }

    if (wantLois) {
      shape.lois = lois
        .map((x: any) => ({ generatedAt: x.uploaded_at }))
        .sort((a: any, b: any) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
    }

    return shape;
  }

  const archived = deals.filter((d: any) => d.stage === "archived");
  const closed = deals.filter((d: any) => d.stage === "closed");
  // "Active" = live pipeline. Closed deals are done, archived deals are dead;
  // neither belongs in a pipeline count.
  const active = deals.filter((d: any) => d.stage !== "archived" && d.stage !== "closed");

  // -- Aggregates -----------------------------------------------------------
  const byStage = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s, active.filter((d: any) => d.stage === s).length])
  );
  const byAssetClass = zeroByClass();
  const byStageAndAssetClass: Record<AssetClass, Record<string, number>> = {
    ios: Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])),
    industrial: Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])),
  };
  const byMarket: Record<string, { count: number; byAssetClass: Record<AssetClass, number> }> = {};

  for (const d of active as any[]) {
    const ac = assetClassOf(d);
    byAssetClass[ac]++;
    if (byStageAndAssetClass[ac][d.stage] !== undefined) byStageAndAssetClass[ac][d.stage]++;
    const market = d.properties?.market ?? "Unknown";
    byMarket[market] ??= { count: 0, byAssetClass: zeroByClass() };
    byMarket[market].count++;
    byMarket[market].byAssetClass[ac]++;
  }

  const inContractDeals = active.filter((d: any) =>
    (IN_CONTRACT_STAGES as readonly string[]).includes(d.stage)
  );
  // Two money views, deliberately both present:
  //   lastOfferValue -- pure last-offer sum. Unchanged from earlier v2 payloads
  //                     so a consumer built against it keeps working.
  //   value          -- the real figure (closing price > contract price > last
  //                     offer), with `estimated`/`missing` counts so a partly
  //                     inferred total can be labelled honestly.
  const inContractByClass = zeroByClass();
  const inContractValueByClass = zeroByClass();
  const inContractRealByClass = zeroByClass();
  let inContractEstimated = 0;
  let inContractMissing = 0;
  for (const d of inContractDeals as any[]) {
    const ac = assetClassOf(d);
    inContractByClass[ac]++;
    const last = [...(d.offers ?? [])].sort((a: any, b: any) =>
      (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
    )[0];
    if (last?.price) inContractValueByClass[ac] += last.price;
    const { amount, basis } = dealValue(d);
    if (amount === null) inContractMissing++;
    else {
      inContractRealByClass[ac] += amount;
      if (basis === "last_offer") inContractEstimated++;
    }
  }

  // Closings bucketed by window, so a consumer doesn't have to redo the date
  // math (and get a different answer than the home screen).
  function closedIn(range: "7d" | "mtd" | "ytd") {
    const start = rangeStart(range, today);
    return closed.filter((d: any) => closedDate(d) >= start);
  }
  function closedSummary(list: any[]) {
    const count = zeroByClass();
    const lastOfferValue = zeroByClass();
    const value = zeroByClass();
    let estimated = 0;
    let missing = 0;
    for (const d of list) {
      const ac = assetClassOf(d);
      count[ac]++;
      const last = [...(d.offers ?? [])].sort((a: any, b: any) =>
        (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
      )[0];
      if (last?.price) lastOfferValue[ac] += last.price;
      const resolved = dealValue(d);
      if (resolved.amount === null) missing++;
      else {
        value[ac] += resolved.amount;
        if (resolved.basis === "last_offer") estimated++;
      }
    }
    return {
      count: list.length,
      byAssetClass: count,
      // Real money: actual closing prices where recorded.
      value,
      valueTotal: value.ios + value.industrial,
      // How much of `valueTotal` is inferred rather than actual.
      estimatedFromOffers: estimated,
      unpriced: missing,
      // Retained for consumers built against the earlier v2 payload.
      lastOfferValue,
      lastOfferValueTotal: lastOfferValue.ios + lastOfferValue.industrial,
    };
  }

  const overdueTasks = openTasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );
  const targetsDue = archived.filter(
    (d: any) => d.follow_up_on && d.follow_up_on <= today && d.pursuit_score !== 0
  );
  const deathCounts: Record<string, number> = {};
  for (const d of archived.filter(
    (x: any) => !(x.death_reason ?? "").startsWith("Imported: historical")
  ) as any[]) {
    deathCounts[d.death_stage ?? "unknown"] = (deathCounts[d.death_stage ?? "unknown"] ?? 0) + 1;
  }

  const offersInRange = (range: "7d" | "mtd" | "ytd") => {
    const start = rangeStart(range, today);
    let count = 0;
    const byClass = zeroByClass();
    let value = 0;
    for (const d of deals as any[]) {
      const ac = assetClassOf(d);
      for (const o of d.offers ?? []) {
        if (!o.offered_at || o.offered_at < start) continue;
        count++;
        byClass[ac]++;
        value += o.price ?? 0;
      }
    }
    return { count, byAssetClass: byClass, value };
  };

  return NextResponse.json({
    source: "hopper",
    schemaVersion: 2,
    app: { name: "Central Acquisitions", url: APP_URL },
    generatedAt: new Date().toISOString(),
    asOfDate: today, // the CT calendar date every date range below is relative to

    acquisitions: {
      activeCount: active.length,
      byStage,
      byAssetClass,
      byStageAndAssetClass,
      byMarket,
      inContract: {
        count: inContractDeals.length,
        byAssetClass: inContractByClass,
        value: inContractRealByClass,
        valueTotal: inContractRealByClass.ios + inContractRealByClass.industrial,
        estimatedFromOffers: inContractEstimated,
        unpriced: inContractMissing,
        lastOfferValue: inContractValueByClass,
        lastOfferValueTotal: inContractValueByClass.ios + inContractValueByClass.industrial,
        stages: IN_CONTRACT_STAGES,
      },
      deals: active.map(dealShape),
    },

    closed: {
      total: closed.length,
      last7Days: closedSummary(closedIn("7d")),
      monthToDate: closedSummary(closedIn("mtd")),
      yearToDate: closedSummary(closedIn("ytd")),
      deals: closed
        .slice()
        .sort((a: any, b: any) => closedDate(b).localeCompare(closedDate(a)))
        .map(dealShape),
    },

    // DD expirations and closings within 7 days, plus any already past. This is
    // the same list the morning brief warns on.
    milestones: {
      withinDays: 7,
      items: upcomingMilestones(deals, { today, withinDays: 7 }).map((m) => ({
        ...m,
        url: `${APP_URL}/deals/${m.dealId}`,
      })),
    },

    targets: {
      dueCount: targetsDue.length,
      due: targetsDue.map((d: any) => ({
        ...dealShape(d),
        pursuitScore: d.pursuit_score,
        followUpOn: d.follow_up_on,
        disposition: d.disposition,
      })),
    },

    tasks: { open: openTasks.length, overdue: overdueTasks.length },

    offers: {
      last7Days: offersInRange("7d"),
      monthToDate: offersInRange("mtd"),
      yearToDate: offersInRange("ytd"),
    },
    recentOffers: (offersRes.data ?? [])
      .filter((o: any) => o.deals && o.deals.deal_type !== "lease")
      .map((o: any) => ({
        price: o.price,
        offeredAt: o.offered_at,
        address: o.deals?.properties?.address ?? null,
        assetClass: o.deals?.asset_class ?? null,
        // 'loi' = recorded automatically when an LOI was generated.
        source: o.source ?? "manual",
      })),

    archive: { total: archived.length, decidedDeathsByStage: deathCounts },

    includes: { contacts: wantContacts, lois: wantLois },
    assetClasses: ASSET_CLASSES,
  });
}
