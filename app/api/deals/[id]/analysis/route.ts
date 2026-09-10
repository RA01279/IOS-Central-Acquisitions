import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { validAnalysis } from "@/lib/analysis-validation";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await getCurrentUser(req)) return NextResponse.json({error:"Not authenticated"},{status:401});
  const kind=req.nextUrl.searchParams.get("kind");
  if (kind!=="comps" && kind!=="demand") return NextResponse.json({error:"Invalid analysis type"},{status:400});
  const {data,error}=await getServiceClient().from("deal_analysis_versions").select("version,payload,created_at,created_by").eq("deal_id",params.id).eq("kind",kind).order("version",{ascending:false}).limit(1).maybeSingle();
  return error ? NextResponse.json({error:"Could not load saved analysis"},{status:500}) : NextResponse.json({saved:data});
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user=await getCurrentUser(req);
  if (!user) return NextResponse.json({error:"Not authenticated"},{status:401});
  const text=await req.text();
  if (Buffer.byteLength(text)>3_000_000) return NextResponse.json({error:"Report is too large to save"},{status:413});
  let body;
  try {body=JSON.parse(text);} catch { return NextResponse.json({error:"Invalid request"},{status:400}); }
  if (!body || !["comps","demand"].includes(body.kind) || !Number.isInteger(body.expected) || body.expected<0 || !validAnalysis(body.kind,body.payload)) return NextResponse.json({error:"Invalid analysis. Refresh and try again."},{status:400});
  const {data,error}=await getServiceClient().rpc("save_deal_analysis",{p_deal:params.id,p_kind:body.kind,p_expected:body.expected,p_payload:body.payload,p_actor:user.email});
  if (error) return NextResponse.json({error:error.message},{status:409});
  return NextResponse.json({saved:{version:data.version,created_at:data.created_at,created_by:data.created_by}});
}
