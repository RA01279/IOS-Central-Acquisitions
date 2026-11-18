import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { acquisitionBrief, BriefError } from "@/lib/acquisition-brief";
import { acquisitionBriefPdf } from "@/lib/acquisition-brief-pdf";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await props.params;
  const { data, error } = await getServiceClient().from("deals").select("*, properties(*), uw_versions(*), documents(*), mla_data(*)").eq("id", id).eq("deal_type", "acquisition").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the deal." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  try {
    const b = acquisitionBrief(data, req.nextUrl.searchParams.get("version") ?? undefined);
    const pdf = await acquisitionBriefPdf(b);
    const filename = `Acquisition Brief - ${b.address} - v${b.versionNumber}.pdf`.replace(/[^a-zA-Z0-9 ._-]/g, "_");
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BriefError ? e.message : "Could not generate the brief. Please retry." }, { status: e instanceof BriefError ? e.status : 500 });
  }
}
