import { NextRequest } from "next/server";
import { userContext, json } from "@/lib/agents/server";
import { UUID } from "@/lib/agents/catalog";
import { parseMemo } from "@/lib/agents/memo";
import { renderMemo, validateImages } from "@/lib/agents/memo-pptx";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
 const ctx = await userContext(req, true); if (ctx.response) return ctx.response;
 try {
  const raw = await req.text(); if (raw.length > 3500000) return json({ error: "Exhibits are too large. Remove an image and try again." },413);
  let body; try { body=JSON.parse(raw); } catch { return json({error:"Invalid request."},400); }
  if(!body || typeof body.id!=="string" || !UUID.test(body.id))return json({error:"Select a saved memo."},400);
  const {data,error}=await ctx.db.from("agent_runs").select("agent,status,result").eq("id",body.id).eq("owner_email",ctx.email).maybeSingle();
  if(error||!data)return json({error:"Memo unavailable."},404);
  if(data.agent!=="investment-memo"||data.status!=="completed")return json({error:"Generate an investment memo first."},409);
  const deck=parseMemo(data.result?.report||"");
  if(!deck)return json({error:"This older memo has no PowerPoint content. Generate a new investment memo."},409);
  let exhibits; try {exhibits=validateImages(body.exhibits||[]);}catch(e){return json({error:e instanceof Error?e.message:"Invalid exhibits."},400);}
  const bytes=renderMemo(deck,exhibits);
  const name=deck.property.replace(/[^a-zA-Z0-9 -]/g,"").slice(0,90)||"Hopper";
  return new Response(new Uint8Array(bytes), {headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.presentationml.presentation","Content-Disposition":`attachment; filename="${name} - Exec Summary.pptx"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return json({error:"Could not export the PowerPoint. Please try again."},500);}
}
