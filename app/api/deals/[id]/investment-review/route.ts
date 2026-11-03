import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { modelIdentity, parseInvestmentReview } from "@/lib/investment-review";
import { logDealEvent } from "@/lib/deals";
export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  const user=await getCurrentUser(req); if(!user)return NextResponse.json({error:"Not authenticated"},{status:401});
  const {id}=await props.params; const body=await req.json().catch(()=>null); const db=getServiceClient();
  const {data:deal,error}=await db.from("deals").select("*,properties(*),uw_versions(*)").eq("id",id).maybeSingle();
  if(error||!deal)return NextResponse.json({error:error?.message ?? "Deal not found"},{status:error?500:404});
  try {
    if(body?.action==="resolve_model") {
      const version=deal.uw_versions.find((v:any)=>v.id===body.versionId);
      if(!version)throw new Error("Choose a version belonging to this deal");
      if(body.expectedResolutionAt!==(version.returns_summary?.identityResolution?.at??null))return NextResponse.json({error:"Resolution changed; refresh before reviewing"},{status:409});
      if(!["accepted","wrong_upload"].includes(body.outcome)||typeof body.reason!=="string"||body.reason.trim().length<10||body.reason.length>2000)throw new Error("Record the outcome and a supported explanation (10–2000 characters)");
      const checked=modelIdentity(deal,version);
      const returnsSummary={...version.returns_summary,identityResolution:{fingerprint:checked.fingerprint,outcome:body.outcome,reason:body.reason.trim(),actor:user.email,at:new Date().toISOString()}};
      const saved=await db.from("uw_versions").update({returns_summary:returnsSummary}).eq("id",version.id).eq("deal_id",id).eq("returns_summary",JSON.stringify(version.returns_summary)).select("id");
      if(saved.error)throw new Error(saved.error.message);if(!saved.data?.length)return NextResponse.json({error:"Version changed; refresh before resolving"},{status:409});
      await logDealEvent(id,"model_identity_resolved",{versionId:version.id,...returnsSummary.identityResolution},user.email);
    } else {
      if(body.expectedReviewAt!==(deal.investment_review?.updatedAt??null))return NextResponse.json({error:"Review changed; refresh before saving"},{status:409});
      const review={...deal.investment_review,...parseInvestmentReview(body?.review),updatedAt:new Date().toISOString(),updatedBy:user.email};
      if(review.selectedModelId&&!deal.uw_versions.some((v:any)=>v.id===review.selectedModelId))throw new Error("Selected model must belong to this deal");
      const update:any={investment_review:review};
      const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;
      if(body.followUpOn!==undefined){if(body.followUpOn&&!date(body.followUpOn))throw new Error("Invalid follow-up date");update.follow_up_on=body.followUpOn||null;}
      if(body.callForOffersOn!==undefined){if(body.callForOffersOn&&(!date(body.callForOffersOn)||!review.deadlineSource||!review.deadlineSourceDate))throw new Error("Explicit deadline requires date, source quote and source date");update.call_for_offers_on=body.callForOffersOn||null;}
      const q=db.from("deals").update(update).eq("id",id);
      const saved=deal.investment_review==null?q.is("investment_review",null):q.eq("investment_review",JSON.stringify(deal.investment_review));
      const result=await saved.select("id");if(result.error)throw new Error(result.error.message);if(!result.data?.length)return NextResponse.json({error:"Review changed; refresh before saving"},{status:409});
      await logDealEvent(id,"investment_reviewed",{before:deal.investment_review,review,followUpOn:update.follow_up_on,callForOffersOn:update.call_for_offers_on},user.email);
    }
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
}
