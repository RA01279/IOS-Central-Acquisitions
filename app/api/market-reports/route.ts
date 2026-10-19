// app/api/market-reports/route.ts
//
// Broker market reports.
// POST { action: "upload-url", fileName }                        -> signed upload slot (PDF)
// POST { action: "save", path, fileName, pages, report }          -> save a reviewed report + its statistics
// POST { action: "evidence", market, submarket? }                 -> the narrative agent's evidence pack
// POST { action: "save-narrative", market, submarket?, report }   -> store the agent's narrative
// GET  ?doc=<reportId>                                            -> the PDF (5-minute signed link)
// DELETE { id }                                                    -> remove a report, its statistics and file
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { parseMarketReport } from "@/lib/agents/market-report";
import { parseMarketNarrative } from "@/lib/agents/market-narrative";
import { narrativeEvidence, saveReport } from "@/lib/market-reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^market-reports\/[0-9a-f-]{36}-[A-Za-z0-9._-]+\.pdf$/i;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = getServiceClient();
  try {
    if (body.action === "upload-url") {
      const name = String(body.fileName ?? "report.pdf").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
      if (!/\.pdf$/i.test(name)) return NextResponse.json({ error: "Upload the report as a PDF" }, { status: 400 });
      const path = `market-reports/${crypto.randomUUID()}-${name}`;
      const { data, error } = await db.storage.from("documents").createSignedUploadUrl(path);
      if (error || !data) throw new Error(error?.message ?? "Could not start the upload");
      return NextResponse.json({ path: data.path, token: data.token });
    }

    if (body.action === "save") {
      const path = String(body.path ?? "");
      if (!PATH.test(path)) return NextResponse.json({ error: "Upload the report first" }, { status: 400 });
      const report = parseMarketReport(JSON.stringify(body.report ?? null));
      if (!report) return NextResponse.json({ error: "The report needs at least a market" }, { status: 400 });
      const [folder, base] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
      const { data: listed } = await db.storage.from("documents").list(folder, { search: base, limit: 2 });
      if (!listed?.some((o: any) => o.name === base)) return NextResponse.json({ error: "The PDF didn't arrive. Upload it again." }, { status: 400 });
      const id = await saveReport(report, { path, name: String(body.fileName ?? base).slice(0, 200), pages: Number.isInteger(body.pages) ? body.pages : null }, user.email);
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }

    if (body.action === "evidence") {
      const market = String(body.market ?? "").trim();
      if (!market) return NextResponse.json({ error: "Choose a market" }, { status: 400 });
      const ev = await narrativeEvidence(market, body.submarket ?? null);
      if (!ev.reports.length) return NextResponse.json({ error: `No market reports on file for ${ev.submarket ? `${ev.submarket}, ` : ""}${ev.market} yet. Upload one first.` }, { status: 400 });
      return NextResponse.json({ text: ev.text, sources: ev.sources, labels: ev.labels, market: ev.market, submarket: ev.submarket });
    }

    if (body.action === "save-narrative") {
      const ev = await narrativeEvidence(String(body.market ?? ""), body.submarket ?? null);
      const n = parseMarketNarrative(String(body.report ?? ""), ev.labels);
      if (!n) return NextResponse.json({ error: "The narrative didn't cite its sources. Generate it again." }, { status: 400 });
      const row = {
        market: ev.market, submarket: ev.submarket, headline: n.headline, narrative: n.narrative, points: n.points,
        conflicts: n.conflicts, gaps: n.gaps, sources: ev.sources, generated_by: user.email, generated_at: new Date().toISOString(),
      };
      // One narrative per area: replace the last one.
      let q = db.from("market_narratives").delete().ilike("market", ev.market);
      q = ev.submarket ? q.ilike("submarket", ev.submarket) : q.is("submarket", null);
      const { error: delErr } = await q;
      if (delErr) throw new Error(delErr.message);
      const { error } = await db.from("market_narratives").insert(row);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Request failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("doc") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Missing report" }, { status: 400 });
  const db = getServiceClient();
  const { data: r } = await db.from("market_reports").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!r) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const { data, error } = await db.storage.from("documents").createSignedUrl(r.storage_path, 300);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not open the file" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.id ?? ""))) return NextResponse.json({ error: "Missing report" }, { status: 400 });
  const db = getServiceClient();
  const { data: r } = await db.from("market_reports").delete().eq("id", body.id).select("storage_path").maybeSingle();
  if (!r) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  await db.storage.from("documents").remove([r.storage_path]);
  return NextResponse.json({ ok: true });
}
