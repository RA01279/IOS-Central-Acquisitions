// app/api/deals/[id]/loi/route.ts
// Generates a Letter of Intent for an acquisition deal:
//   1. saves the submitted terms to deals.loi_terms (so the next LOI, and
//      future templated docs, prefill from them),
//   2. renders the team's LOI template (private storage:
//      documents/templates/loi-ios.docx) with the terms,
//   3. files a copy in the deal's Documents (doc_type 'loi'),
//   4. returns the .docx as a download.
import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

function fmtNumber(v: string | undefined): string {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString("en-US") : String(v ?? "");
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const t = await req.json();
  const supabase = getServiceClient();

  // Long-form date + acknowledgment year derived from the SAME value so they
  // can never disagree. Date arrives as yyyy-mm-dd from the form (defaulted
  // to today there, manually editable).
  const dateIso: string = t.date ?? new Date().toISOString().slice(0, 10);
  const dateLong = new Date(dateIso + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const year = dateIso.slice(0, 4);

  const data = {
    tel: t.tel ?? "",
    date: dateLong,
    attn: t.attn ?? "",
    seller_clause: t.sellerClause || "its current ownership",
    property_description: t.propertyDescription ?? "",
    price: fmtNumber(t.price),
    deposit_words: t.depositWords ?? "",
    deposit_amount: fmtNumber(t.depositAmount),
    dd_days: t.ddDays ?? "Sixty (60)",
    closing_days: t.closingDays ?? "thirty (30)",
    broker_clause_name: t.brokerClauseName ?? "",
    commission_payer: t.commissionPayer === "Buyer" ? "Buyer" : "Seller",
    signer1_name: t.signer1Name ?? "John Lettieri",
    signer1_title: t.signer1Title ?? "Market Officer | Central",
    signer2_name: t.signer2Name ?? "Rhett Anderson",
    signer2_title: t.signer2Title ?? "IOS Market Lead | Central",
    year,
  };

  // 1. Persist the raw form so the next open prefills with it.
  const { error: saveErr } = await supabase
    .from("deals")
    .update({ loi_terms: t })
    .eq("id", params.id);
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  // 2. Render the template.
  const { data: tpl, error: tplErr } = await supabase.storage
    .from("documents")
    .download("templates/loi-ios.docx");
  if (tplErr || !tpl) {
    return NextResponse.json(
      { error: `LOI template missing from storage: ${tplErr?.message ?? "not found"}` },
      { status: 500 }
    );
  }
  let buffer: Buffer;
  try {
    const zip = new PizZip(Buffer.from(await tpl.arrayBuffer()));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    buffer = doc.getZip().generate({ type: "nodebuffer" });
  } catch (err: any) {
    return NextResponse.json({ error: `Template render failed: ${err.message}` }, { status: 500 });
  }

  // 3. File a copy on the deal.
  const slug = (data.property_description.split(",")[0] || "LOI")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .slice(0, 40);
  const fileName = `LOI-${slug}-${dateIso}.docx`;
  const storagePath = `deals/${params.id}/${Date.now()}-${fileName}`;
  const { error: upErr } = await supabase.storage.from("documents").upload(storagePath, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (!upErr) {
    await supabase.from("documents").insert({
      deal_id: params.id,
      doc_type: "loi",
      storage_path: storagePath,
      uploaded_by: user.email,
    });
  }
  await logDealEvent(params.id, "loi_generated", { price: data.price, date: dateLong }, user.email);

  // 4. Hand the file back as a download.
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
