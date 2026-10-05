import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { loadDemandSnapshot, loadSignals, refreshSignals, setOverride } from "@/lib/site-signals";
import { FLAG_KEYS, type FlagKey } from "@/lib/hopper-tokens";

export const dynamic = "force-dynamic";
// The refresh fans out to Places, FEMA, OSM and municipal GIS in parallel.
export const maxDuration = 60;

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// GET /api/deals/[id]/signals -> { signals, snapshot }
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!(await getCurrentUser(req))) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!validId(id)) return NextResponse.json({ error: "Invalid deal" }, { status: 400 });
  const [signals, snapshot] = await Promise.all([loadSignals([id]), loadDemandSnapshot(id)]);
  return NextResponse.json({ signals: signals.get(id) ?? [], snapshot }, { headers: { "Cache-Control": "no-store" } });
}

// POST { action: "refresh", demand?: boolean }
// POST { action: "override", key, state: "strong"|"watch"|"weak"|null, note? }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!validId(id)) return NextResponse.json({ error: "Invalid deal" }, { status: 400 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (body?.action === "refresh") {
      const errors = await refreshSignals(id, { demand: !!body.demand });
      await logDealEvent(id, "site_score_refreshed", { demand: !!body.demand, errors }, user.email).catch(() => {});
      const [signals, snapshot] = await Promise.all([loadSignals([id]), loadDemandSnapshot(id)]);
      return NextResponse.json({ signals: signals.get(id) ?? [], snapshot, errors });
    }
    if (body?.action === "override") {
      if (!(FLAG_KEYS as readonly string[]).includes(body.key)) return NextResponse.json({ error: "Unknown flag" }, { status: 400 });
      if (body.state !== null && !["strong", "watch", "weak"].includes(body.state)) {
        return NextResponse.json({ error: "State must be strong, watch, weak or null" }, { status: 400 });
      }
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : null;
      if (body.state && !note) return NextResponse.json({ error: "Say why -- the note shows on the IC slide." }, { status: 400 });
      await setOverride(id, body.key as FlagKey, body.state, note, user.email);
      const signals = await loadSignals([id]);
      return NextResponse.json({ signals: signals.get(id) ?? [] });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}
