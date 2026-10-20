import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { archiveDeal, restoreDeal } from "@/lib/deal-archive";

// POST /api/deals/[id]/archive
// body: { action: "archive", reason: string, ... } | { action: "restore" }
// The stage a deal dies at is read here, never taken from the request, so a
// restore can only put a deal back where it really was. The rules live in
// lib/deal-archive, shared with the portfolio page.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const out =
    body.action === "archive"
      ? await archiveDeal(params.id, { reason: body.reason, disposition: body.disposition, pursuitScore: body.pursuitScore, followUpOn: body.followUpOn }, user.email)
      : body.action === "restore"
        ? await restoreDeal(params.id, user.email)
        : ({ ok: false, status: 400, error: "Unknown action" } as const);
  return out.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: out.error }, { status: out.status });
}
