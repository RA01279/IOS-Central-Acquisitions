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
import { logDealEvent, recordOffer } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import { dropSecondSigner, appendPortfolioSchedule, omitBrokerDetails } from "@/lib/loi-docx";
import { parseMoney } from "@/lib/money";
import { validDate } from "@/lib/stage-rules";

// Dollar amounts go through the app's one money parser ("$4.2M" -> 4200000)
// and are rejected before anything renders, so the letter and the logged offer
// can never disagree with what was typed.
const dollars = (n: number | null) => (n == null ? "" : Math.round(n).toLocaleString("en-US"));

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

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const t = await req.json();
  if (t.offerChannel === "direct") {
    t.attn = String(t.attn ?? "").trim() || "Property Owner";
    for (const key of ["brokerFirm", "brokerAddress1", "brokerAddress2", "brokerClauseName", "commissionPayer"]) t[key] = "";
  }
  const supabase = getServiceClient();
  let portfolioSites: any[] | null = null;
  let anchorTerms: Record<string, unknown> = {};
  if (t.portfolioId) {
    if (!Array.isArray(t.selectedDealIds) || !t.selectedDealIds.length || t.selectedDealIds.some((id: unknown) => typeof id !== "string")) {
      return NextResponse.json({ error: "Select at least one portfolio asset" }, { status: 400 });
    }
    const { data: anchor, error: anchorError } = await supabase.from("deals").select("deal_portfolio_id, loi_terms, deal_portfolios(name)").eq("id", params.id).maybeSingle();
    if (anchorError) return NextResponse.json({ error: anchorError.message }, { status: 500 });
    if (!anchor || anchor.deal_portfolio_id !== t.portfolioId) return NextResponse.json({ error: "Portfolio does not match this deal" }, { status: 400 });
    anchorTerms = anchor.loi_terms ?? {};
    const portfolio = Array.isArray(anchor.deal_portfolios) ? anchor.deal_portfolios[0] : anchor.deal_portfolios;
    t.portfolioTitle = portfolio?.name?.trim();
    if (!t.portfolioTitle) return NextResponse.json({ error: "Set a portfolio title before generating its LOI" }, { status: 400 });
    const ids = [...new Set<string>(t.selectedDealIds)];
    const { data: sites, error } = await supabase.from("deals")
      .select("id, properties(address, city)").eq("deal_portfolio_id", t.portfolioId).in("id", ids).order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!sites || sites.length !== ids.length) return NextResponse.json({ error: "Every selected asset must belong to this portfolio" }, { status: 400 });
    portfolioSites = sites;
    if (sites.some((s: any) => !s.properties?.address)) return NextResponse.json({ error: "Each selected asset needs an address before generating the LOI" }, { status: 400 });
    t.loiType = "standard";
    t.selectedDealIds = sites.map((s) => s.id);
    t.propertyDescription = t.portfolioTitle;
  }

  let offerPrice: number | null;
  let deposit: number | null;
  try {
    offerPrice = parseMoney(t.price);
    deposit = parseMoney(t.depositAmount);
  } catch (err: any) {
    return NextResponse.json({ error: `Price and deposit: ${err.message}` }, { status: 400 });
  }
  if (offerPrice == null || offerPrice <= 0) return NextResponse.json({ error: "Enter a positive offer price" }, { status: 400 });
  if (t.date && !validDate(t.date)) return NextResponse.json({ error: "Enter a valid LOI date" }, { status: 400 });
  if (t.expiryDate && !validDate(t.expiryDate)) return NextResponse.json({ error: "Enter a valid expiry date" }, { status: 400 });

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
      seller_name: t.sellerName || (t.offerChannel === "direct" ? "Property Owner" : ""),
      attn: t.attn ?? "",
      broker_firm: t.brokerFirm ?? "",
      broker_address1: t.brokerAddress1 ?? "",
      broker_address2: t.brokerAddress2 ?? "",
      property_description: t.propertyDescription ?? "",
      price_words: t.priceWords ?? "",
      price: dollars(offerPrice),
      building_sf: fmtNumber(t.buildingSf),
      acres: String(t.acres ?? ""),
      lease_term_years: String(t.leaseTermYears ?? ""),
      rent_phrase: rentPhrase,
      escalations: String(t.escalations ?? ""),
      deposit_words: t.depositWords ?? "",
      deposit_amount: dollars(deposit),
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
      price: dollars(offerPrice),
      deposit_words: t.depositWords ?? "",
      deposit_amount: dollars(deposit),
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

  if (portfolioSites) {
    data.portfolio_title = t.portfolioTitle;
    data.portfolio_assets = portfolioSites.map((s: any, i: number) => `${i + 1}. ${[s.properties.address, s.properties.city].filter(Boolean).join(", ")}`).join("\n");
    data.property_description = t.portfolioTitle;
  }

  // 1. Persist the raw form so the next open prefills with it.
  const { error: saveErr } = await supabase
    .from("deals")
    .update({ loi_terms: portfolioSites ? { ...anchorTerms, portfolioOfferTerms: t } : t })
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
    if (t.offerChannel === "direct") zip.file("word/document.xml", omitBrokerDetails(zip.file("word/document.xml")!.asText()));
    if (portfolioSites) zip.file("word/document.xml", appendPortfolioSchedule(zip.file("word/document.xml")!.asText()));
    if (!data.signer2_name.trim()) {
      zip.file("word/document.xml", dropSecondSigner(zip.file("word/document.xml")!.asText()));
    }
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    buffer = doc.getZip().generate({ type: "nodebuffer" });
  } catch (err: any) {
    return NextResponse.json({ error: `Template render failed: ${err.message}` }, { status: 500 });
  }

  // 3. File a copy on the deal.
  const slug = (t.portfolioTitle || data.property_description.split(",")[0] || "LOI")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .slice(0, 40);
  const fileName = `LOI${loiType === "slb" ? "-SLB" : ""}-${slug}-${dateIso}.docx`;
  const storagePath = `deals/${params.id}/${Date.now()}-${fileName}`;
  const { error: upErr } = await supabase.storage.from("documents").upload(storagePath, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (upErr) return NextResponse.json({ error: `Could not file LOI: ${upErr.message}` }, { status: 500 });
  {
    const { error: docError } = await supabase.from("documents").insert((portfolioSites ?? [{ id: params.id }]).map((site) => ({
      deal_id: site.id,
      doc_type: "loi",
      storage_path: storagePath,
      uploaded_by: user.email,
    })));
    if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });
  }
  await logDealEvent(
    params.id,
    "loi_generated",
    { type: loiType, price: data.price, date: dateLong },
    user.email
  );

  // 4. Record the offer. Sending an LOI at a price IS offering that price, and
  // relying on someone to also press "Log offer" is exactly how the old
  // tracker's offer count drifted from reality. Deduped on same date + same
  // price so regenerating the document (typo fix, second download) doesn't
  // inflate the count. Never fatal: the LOI download must not fail because the
  // offer row didn't insert.
  if (portfolioSites) {
    // Keep the package total in the event and saved terms, never as a building price.
    for (const site of portfolioSites) {
      await logDealEvent(site.id, "portfolio_offer_generated", { portfolioId: t.portfolioId, selectedDealIds: t.selectedDealIds, totalPrice: offerPrice, date: dateIso, storagePath }, user.email);
      await recordOffer(site.id, { price: null, offeredAt: dateIso, notes: `Portfolio offer: $${dollars(offerPrice)} total across ${portfolioSites.length} assets. No asset price allocated. LOI: ${storagePath}`, source: "loi" }, user.email, { dedupeSameDayPrice: true });
    }
  } else {
    try {
      await recordOffer(
        params.id,
        {
          price: offerPrice,
          offeredAt: dateIso,
          notes: `Auto-logged from ${loiType === "slb" ? "SLB " : ""}LOI generation`,
          source: "loi",
        },
        user.email,
        { dedupeSameDayPrice: true }
      );
    } catch (err: any) {
      await logDealEvent(
        params.id,
        "offer_autolog_failed",
        { error: String(err?.message ?? err), price: offerPrice },
        "system"
      );
    }
  }

  // 5. Hand the file back as a download.
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
