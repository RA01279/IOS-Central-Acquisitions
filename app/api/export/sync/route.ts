// app/api/export/sync/route.ts
// Read-only mirror feed for Prospector (Dalfen's sourcing app), which pulls
// it every few minutes and keeps its own copy of our deals, offers, tasks and
// contact book so the two teams see one pipeline while both apps are in use.
//
// Its own key, not /api/export's: the caller sends
// "Authorization: Bearer <PROSPECTOR_SYNC_TOKEN>". This feed carries emails
// and phone numbers, which the export token deliberately does not unlock, so
// the two rotate separately. Unset env var = feed off (503), never open.
// No write capability, no auth/user data. Unlike /api/export this is not a
// roll-up -- it is every row, every stage, so the consumer can upsert by id.
// See lib/sync-export.ts for the shapes.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { ctToday } from "@/lib/summary";
import { bearerMatches, buildSyncPayload } from "@/lib/sync-export";

export const dynamic = "force-dynamic";

// PostgREST caps a single select at 1000 rows; page until a short page.
const PAGE = 1000;

async function fetchAll(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const secret = process.env.PROSPECTOR_SYNC_TOKEN;
  if (!secret) {
    return NextResponse.json({ error: "Sync feed is not configured" }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();
    const [deals, offers, tasks, companies, contacts, dealContacts, activities] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from("deals")
          .select(
            "id, deal_type, stage, asset_class, mla_status, marketing_status, acquisition_type, dd_end_on, closing_on, closed_on, contract_price, closed_price, death_stage, death_reason, disposition, pursuit_score, follow_up_on, assigned_analyst, created_by, created_at, updated_at, properties(address, city, market, submarket, lot_sf, building_sf, latitude, longitude, geocode_precision, occupancy_status, walt_years, tenancy)"
          )
          .eq("deal_type", "acquisition")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("offers")
          .select("id, deal_id, offered_at, price, notes, source, created_by, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("tasks")
          .select(
            "id, deal_id, contact_id, company_id, title, notes, due_date, status, assigned_to, created_by, completed_at, created_at"
          )
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("companies")
          .select("id, name, company_type, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("contacts")
          .select("id, company_id, name, email, phone, title, address, contact_type, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("deal_contacts")
          .select("id, deal_id, contact_id, role, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("activities")
          .select("id, activity_type, subject, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);
    return NextResponse.json(
      buildSyncPayload(
        { deals, offers, tasks, companies, contacts, dealContacts, activities },
        { now: new Date(), asOfDate: ctToday() }
      )
    );
  } catch (err: any) {
    // A consumer that gets a 502 skips the run and tries again on the next;
    // one that gets a half-payload 200 would delete the missing half.
    return NextResponse.json({ error: err?.message ?? "export failed" }, { status: 502 });
  }
}
