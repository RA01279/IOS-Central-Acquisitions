// app/api/deals/[id]/ic-deck/route.ts
//
// POST { model } -> the 23-slide IC executive summary as .pptx.
// `model` is the ModelSummary the browser extracted from the acquisition
// workbook (the workbook itself never reaches Hopper). Everything else comes
// from Hopper's own records and Google Static Maps of the recorded pin.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { UUID } from "@/lib/agents/catalog";
import { loadSavedDeckModel } from "@/lib/ic-deck/saved-model";
import { bindModelSubject } from "@/lib/ic-deck/model-subject";
import { buildExecSummary, saveExecSummary, BuildError } from "@/lib/ic-deck/build";
import { BUILT_EVENT, DELIVERED_EVENT, FAILED_EVENT } from "@/lib/ic-deck/auto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Unknown deal" }, { status: 400 });
  try {
    const [saved, { data: docs, error }, { data: selectedDeal }] = await Promise.all([
      loadSavedDeckModel(id),
      getServiceClient().from("documents").select("id,file_name,uploaded_at").eq("deal_id", id)
        .ilike("file_name", "%Exec%Summary%.pptx").order("uploaded_at", { ascending: false }).limit(20),
      getServiceClient().from("deals").select("properties(address)").eq("id", id).maybeSingle(),
    ]);
    // Automatic-draft status is informational; it never blocks the panel.
    let events: any[] | null = null;
    try { events = await Promise.resolve(getServiceClient().from("deal_events").select("event_type,detail,created_at").eq("deal_id", id)
      .in("event_type", [BUILT_EVENT, DELIVERED_EVENT, FAILED_EVENT, "exec_summary_research_skipped"]).order("created_at", { ascending: false }).limit(20))
      .then((r: any) => r?.data ?? null, () => null); } catch { events = null; }
    const lastBuilt: any = events?.find(e => e.event_type === BUILT_EVENT);
    const auto = {
      built: lastBuilt ? { ...lastBuilt.detail, at: lastBuilt.created_at } : null,
      delivered: lastBuilt ? (events?.find((e: any) => e.event_type === DELIVERED_EVENT && e.detail?.documentId === lastBuilt.detail?.documentId)?.detail ?? null) : null,
      failed: (() => { const f: any = events?.find(e => e.event_type === FAILED_EVENT); return f && (!lastBuilt || f.created_at > lastBuilt.created_at) ? { ...f.detail, at: f.created_at } : null; })(),
      researchSkipped: (() => { const r: any = events?.find(e => e.event_type === "exec_summary_research_skipped"); return r && (!lastBuilt || r.created_at >= lastBuilt.created_at) ? r.detail?.why ?? null : null; })(),
    };
    if (error) throw new Error("Could not load source decks.");
    const property: any = Array.isArray(selectedDeal?.properties) ? selectedDeal.properties[0] : selectedDeal?.properties;
    return NextResponse.json({ saved: saved ? { ...saved, model: bindModelSubject(saved.model, property?.address ?? "") } : null, references: docs ?? [], auto }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 422 }); }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    const { buffer, name, warnings } = await buildExecSummary({ dealId: params.id, actorEmail: user.email, model: body?.model, narrativeRunId: body?.narrativeRunId, referenceId: body?.referenceId });
    if (body?.delivery === "vault") {
      // Large source decks exceed the platform's response-body limit. Store the
      // artifact and download it directly, just like workbook/vault uploads.
      const { documentId, path } = await saveExecSummary(params.id, buffer, name, user.email);
      const { data: link, error: linkError } = await getServiceClient().storage.from("documents").createSignedUrl(path, 300, { download: name });
      if (linkError || !link) return NextResponse.json({ error: "The deck is saved in Documents, but its download link could not be created." }, { status: 500 });
      return NextResponse.json({ url: link.signedUrl, fileName: name, documentId, slides: 24, warnings }, { headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof BuildError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
