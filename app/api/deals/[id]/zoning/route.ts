import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { researchZoning, MunicipalResearchError } from "@/lib/zoning/research";

export const dynamic="force-dynamic";
export const maxDuration=60;
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function POST(req:NextRequest,{params}:{params:{id:string}}) {
  if(!await getCurrentUser(req)) return NextResponse.json({error:"Not authenticated"},{status:401});
  if(!validId(params.id)) return NextResponse.json({error:"Invalid deal"},{status:400});
  let body;
  try{body=await req.json();}catch{return NextResponse.json({error:"Invalid request"},{status:400});}
  if(!body || !["lookup","neighbors"].includes(body.action) || ![1,3,5].includes(body.radiusMiles)) return NextResponse.json({error:"Choose a 1, 3 or 5 mile radius."},{status:400});
  const {data:deal,error}=await getServiceClient().from("deals").select("id,properties(address,city,latitude,longitude,geocode_precision)").eq("id",params.id).maybeSingle();
  if(error) return NextResponse.json({error:"Could not load this deal."},{status:500});
  if(!deal) return NextResponse.json({error:"Deal not found."},{status:404});
  const p=deal.properties as any;
  if(p?.latitude==null || p?.longitude==null) return NextResponse.json({error:"Set and verify the property map pin first."},{status:422});
  try {
    const report=await researchZoning({dealId:deal.id,address:p.address??"",point:{lat:Number(p.latitude),lng:Number(p.longitude)},precision:p.geocode_precision??"",radiusMiles:body.radiusMiles},body.action==="neighbors");
    // Deliberately read-only: research cannot mutate stages, underwriting
    // versions, documents, property locations, or Returns summary.
    return NextResponse.json({report},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return NextResponse.json({error:error instanceof MunicipalResearchError ? error.message : "Zoning research failed. Please retry."},{status:422});
  }
}
