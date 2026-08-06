// app/api/deals/[id]/loi/route.ts
// Generates a Letter of Intent for an acquisition deal, in two flavors:
//   * standard -- templates/loi-ios.docx  (straight purchase)
//   * slb      -- templates/loi-slb.docx  (sale-leaseback: lease term,
//                 rent quotable per month / per acre / per building SF,
//                 escalations, explicit expiry date)
// Saves the submitted terms to deals.loi_terms (next open prefills), files a
// copy in the deal's Documents, and returns the .docx as a download.
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
// Rates can be decimals ($1.75/SF) -- format integers with commas, keep
// decimals exactly as typed.
function fmtRate(v: string | undefined): string {
  const raw = String(v ?? "").replace(/[$,\s]/g, "");
  if (/^\d+$/.test(raw)) return Number(raw).toLocaleString("en-US");
  return raw || String(v ?? "");
}
function longDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const RENT_PHRASES: Record<string, (amt: string) => string> = {
  total_monthly: (a) => `a blended monthly base rental rate of $${a}`,
  per_acre_monthly: (a) => `a blended base rental rate of $${a} per usable acre per month`,
  per_sf_monthly: (a) => `a blended base rental rate of $${a} per square foot of building per month`,
  per_sf_annual: (a) => `a blended base rental rate of $${a} per square foot of building per year`,
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const t = await req.json();
  const supabase = getServiceClient();

  const loiType = t.loiType === "slb" ? "slb" : "standard";
  const dateIso: string = t.date ?? new Date().toISOString().slice(0, 10);
  const dateLong = longDate(dateIso);
  const year = dateIso.slice(0, 4);

  let data: Record<string, string>;
  if (loiType === "slb") {
    const rentPhrase = (RENT_PHRASES[t.rentBasis] ?? RENT_PHRASES.total_monthly)(
      fmtRate(t.rentAmount)
    );
    const expiryIso = t.expiryDate || new Date(Date.parse(dateIso) + 7 * 86400000).toISOString().slice(0, 10);
    data = {
      tel: t.tel ?? "",
      sender_email: t.senderEmail ?? "",
      date: dateLong,
      expiry_date: longDate(expiryIso),
      seller_name: t.sellerName ?? "",
      attn: t.attn ?? "",
      broker_firm: t.brokerFirm ?? "",
      broker_address1: t.brokerAddress1 ?? "",
      broker_address2: t.brokerAddress2 ?? "",
      property_description: t.propertyDescription ?? "",
      price_words: t.priceWords ?? "",
      price: fmtNumber(t.price),
      building_sf: fmtNumber(t.buildingSf),
      acres: String(t.acres ?? ""),
      lease_term_years: String(t.leaseTermYears ?? ""),
      rent_phrase: rentPhrase,
      escalations: String(t.escalations ?? ""),
      deposit_words: t.depositWords ?? "",
      deposit_amount: fmtNumber(t.depositAmount),
      dd_days: t.ddDays ?? "Forty-Five (45)",
      closing_days: t.closingDays ?? "Thirty (30)",
      commission_payer: t.commissionPayer === "Buyer" ? "Buyer" : "Seller",
      signer1_name: t.signer1Name ?? "John Lettieri",
      signer1_title: t.signer1Title ?? "Market Officer | Central",
      signer2_name: t.signer2Name ?? "Rhett Anderson",
      signer2_title: t.signer2Title ?? "IOS Market Lead | Central",
      year,
    };
  } else {
    data = {
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
  }

  // 1. Persist the raw form so the next open prefills with it.
  const { error: saveErr } = await supabase
    .from("deals")
    .update({ loi_terms: t })
    .eq("id", params.id);
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  // 2. Render the right template.
  const templatePath = loiType === "slb" ? "templates/loi-slb.docx" : "templates/loi-ios.docx";
  const { data: tpl, error: tplErr } = await supabase.storage
    .from("documents")
    .download(templatePath);
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
  const fileName = `LOI${loiType === "slb" ? "-SLB" : ""}-${slug}-${dateIso}.docx`;
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
  await logDealEvent(
    params.id,
    "loi_generated",
    { type: loiType, price: data.price, date: dateLong },
    user.email
  );

  // 4. Hand the file back as a download.
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
