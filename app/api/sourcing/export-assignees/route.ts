import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetch-all";
import { exportAssignees } from "@/lib/sourcing/export-assignment";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const db = getServiceClient();
    // Same signed-in shared CRM directory used by Contacts and broker scorecard.
    // Paging avoids silently omitting a broker beyond the REST row limit.
    const [companies, contacts, links] = await Promise.all([
      fetchAll((f, t) => db.from("companies").select("id,name,company_type").eq("company_type", "broker").order("id").range(f, t)),
      fetchAll((f, t) => db.from("contacts").select("id,name,email,phone,contact_type,companies(id,name,company_type)").order("id").range(f, t)),
      fetchAll((f, t) => db.from("deal_contacts").select("id,contact_id").in("role", ["seller_broker", "buyer_broker", "tenant_broker", "listing_broker"]).order("id").range(f, t)),
    ]);
    return NextResponse.json({ assignees: exportAssignees(companies, contacts, new Set(links.map((l) => l.contact_id))) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the broker directory. Retry or export without an assignment." }, { status: 503 });
  }
}
