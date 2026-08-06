// app/api/export/route.ts
// Read-only JSON export for external dashboards (e.g. John's roll-up).
// Token-protected: ?token=... must match app_settings key 'export_token'.
// Deliberately exposes NO write capability and no auth/user data -- rotate
// the token by updating the settings row.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, LEASE_STAGES, STAGE_LABELS } from "@/lib/deals";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const today = new Date().toISOString().slice(0, 10);
  const [dealsRes, offersRes, tasksRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, deal_type, stage, created_at, death_stage, death_reason, disposition, pursuit_score, follow_up_on, marketing_status, acquisition_type, properties(address, city, market, submarket, lot_sf, building_sf, occupancy_status, walt_years, tenancy), offers(price, offered_at), deal_events(created_at)"
      ),
    supabase
      .from("offers")
      .select("price, offered_at, created_at, deals(id, properties(address))")
      .order("offered_at", { ascending: false, nullsFirst: false })
      .limit(25),
    supabase.from("tasks").select("id, title, due_date, assigned_to").eq("status", "open"),
  ]);

  const deals = dealsRes.data ?? [];
  const openTasks = tasksRes.data ?? [];

  function dealShape(d: any) {
    const lastOffer = [...(d.offers ?? [])].sort((a: any, b: any) =>
      (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
    )[0];
    const lastTouch =
      (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop() ?? d.created_at;
    return {
      id: d.id,
      url: `https://ios-central-acquisitions.vercel.app/${d.deal_type === "lease" ? "leasing" : "deals"}/${d.id}`,
      address: d.properties?.address ?? null,
      city: d.properties?.city ?? null,
      market: d.properties?.market ?? null,
      submarket: d.properties?.submarket ?? null,
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
    };
  }

  const active = deals.filter((d: any) => d.stage !== "archived");
  const archived = deals.filter((d: any) => d.stage === "archived");
  const acq = active.filter((d: any) => d.deal_type === "acquisition");
  const lease = active.filter((d: any) => d.deal_type === "lease");

  const overdueTasks = openTasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );
  const targetsDue = archived.filter(
    (d: any) =>
      d.deal_type === "acquisition" &&
      d.follow_up_on &&
      d.follow_up_on <= today &&
      d.pursuit_score !== 0
  );
  const deathCounts: Record<string, number> = {};
  for (const d of archived.filter(
    (x: any) => !(x.death_reason ?? "").startsWith("Imported: historical")
  ) as any[]) {
    deathCounts[d.death_stage ?? "unknown"] = (deathCounts[d.death_stage ?? "unknown"] ?? 0) + 1;
  }

  return NextResponse.json({
    source: "hopper",
    generatedAt: new Date().toISOString(),
    acquisitions: {
      activeCount: acq.length,
      byStage: Object.fromEntries(
        ACQUISITION_STAGES.map((s) => [s, acq.filter((d: any) => d.stage === s).length])
      ),
      deals: acq.map(dealShape),
    },
    leasing: {
      activeCount: lease.length,
      byStage: Object.fromEntries(
        LEASE_STAGES.map((s) => [s, lease.filter((d: any) => d.stage === s).length])
      ),
      deals: lease.map(dealShape),
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
    recentOffers: (offersRes.data ?? []).map((o: any) => ({
      price: o.price,
      offeredAt: o.offered_at,
      address: o.deals?.properties?.address ?? null,
    })),
    archive: { total: archived.length, decidedDeathsByStage: deathCounts },
  });
}
