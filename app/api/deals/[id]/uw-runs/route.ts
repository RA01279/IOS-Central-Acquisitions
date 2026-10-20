// app/api/deals/[id]/uw-runs/route.ts
//
// Saved runs of the Underwriting tab's screening engine.
// GET                                   -> this deal's runs, newest first
// POST { inputs, sources, label? }      -> re-run on the server and save, with the comp set frozen
// DELETE { runId }                      -> remove a run
//
// The server never trusts the browser's numbers: inputs are checked field by
// field, the engine is re-run here, and the comp snapshot is rebuilt from the
// comps as they stand at save time.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { latestModel, listRuns, screenFor } from "@/lib/uw-screen";
import { engineInputs, sanitizeInputs, SCREEN_VERSION, SOURCE_KEYS } from "@/lib/uw/deal-inputs";
import { runUnderwriting } from "@/lib/uw/engine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = ["model", "comps", "deal", "default", "manual"];

async function loadDeal(id: string) {
  const { data } = await getServiceClient()
    .from("deals")
    .select("id, asking_price, contract_price, closed_price, in_place_rent, in_place_rent_basis, exit_cap_rate, properties(address, city, state, market, lot_sf, building_sf, occupancy_status), offers(price, offered_at), uw_versions(id, version_number, model_detail)")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad deal id" }, { status: 400 });
  return NextResponse.json({ runs: await listRuns(id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad deal id" }, { status: 400 });
  const raw = await req.text();
  if (raw.length > 300_000) return NextResponse.json({ error: "Run too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const inputs = sanitizeInputs(body.inputs);
  if (typeof inputs === "string") return NextResponse.json({ error: inputs }, { status: 400 });
  const sources: Record<string, { source: string; note: string }> = {};
  for (const k of SOURCE_KEYS) {
    const s = body.sources?.[k];
    if (s && SOURCES.includes(s.source) && typeof s.note === "string") sources[k] = { source: s.source, note: s.note.slice(0, 400) };
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;

  const deal = await loadDeal(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  let result;
  try {
    result = runUnderwriting(engineInputs(inputs));
  } catch (e: any) {
    return NextResponse.json({ error: `The engine rejected these inputs: ${e.message}` }, { status: 400 });
  }
  const screen = await screenFor(deal);
  const model = latestModel(deal);

  const { data, error } = await getServiceClient()
    .from("uw_runs")
    .insert({
      deal_id: id,
      label,
      engine_version: SCREEN_VERSION,
      scenario: inputs.scenario,
      inputs,
      sources,
      comp_snapshot: screen.comps,
      uw_version_id: model?.versionId ?? null,
      results: { returns: result.returns, active: result.active, sensitivity: result.sensitivity },
      created_by: user.email,
    })
    .select("id, label, scenario, created_by, created_at, uw_version_id, inputs, sources, results")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDealEvent(id, "uw_run_saved", { run_id: data.id, label, scenario: inputs.scenario, unlevered_irr: result.returns.unleveredIrr }, user.email);
  return NextResponse.json({ run: data });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(id) || !UUID.test(String(body.runId ?? ""))) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const { error } = await getServiceClient().from("uw_runs").delete().eq("id", body.runId).eq("deal_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
