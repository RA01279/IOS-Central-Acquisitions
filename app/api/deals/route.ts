// app/api/deals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createDeal } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { parseMoney } from "@/lib/money";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();

  try {
    // Validate before creating anything, so a bad ask can't leave a half-made deal.
    const askingPrice = parseMoney(body.askingPrice);
    const portfolioId = typeof body.dealPortfolioId === "string" && /^[0-9a-f-]{36}$/i.test(body.dealPortfolioId) ? body.dealPortfolioId : null;
    if (body.dealPortfolioId && !portfolioId) return NextResponse.json({ error: "Invalid portfolio" }, { status: 400 });
    if (portfolioId) {
      const { data: pf } = await getServiceClient().from("deal_portfolios").select("id").eq("id", portfolioId).maybeSingle();
      if (!pf) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }
    if (body.intakeKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.intakeKey)) {
      return NextResponse.json({ error: "Invalid intake key" }, { status: 400 });
    }
    const result = await createDeal({
      intakeKey: body.intakeKey,
      substantialYard: body.substantialYard === true,
      address: body.address,
      latitude: body.latitude,
      longitude: body.longitude,
      geocodePrecision: body.geocodePrecision,
      state: body.state,
      market: body.market,
      submarket: body.submarket,
      city: body.city,
      assetType: body.assetType,
      // Which pipeline (IOS / Industrial). Omitted -> derived from assetType.
      assetClass: body.assetClass === "industrial" ? "industrial" : body.assetClass === "ios" ? "ios" : undefined,
      lotSf: body.lotSf,
      acres: body.acres,
      buildingSf: body.buildingSf,
      marketingStatus: body.marketingStatus,
      acquisitionType: body.acquisitionType,
      occupancyStatus: body.occupancyStatus,
      waltYears: body.waltYears,
      tenancy: body.tenancy,
      currentOwnerName: body.currentOwnerName,
      buyerBrokerName: body.buyerBrokerName,
      sellerBrokerName: body.sellerBrokerName,
      sourceBrokerId: body.sourceBrokerId,
      createdBy: user.email,
      mla: body.mla,
    });

    // The seller's ask (from an OM import or typed in). Not part of the atomic
    // create RPC's column set, so it's written straight after.
    // A site created from a portfolio OM is flagged as part of the package in
    // the same write. Checked: a site that silently missed its portfolio link
    // would vanish from the portfolio view while the import reported success.
    const dealId = (result as any).deal?.id;
    // Whoever creates the deal owns it until it's reassigned.
    const extra: Record<string, unknown> = { assigned_analyst: user.email.toLowerCase() };
    if (askingPrice !== null) extra.asking_price = askingPrice;
    if (portfolioId) extra.deal_portfolio_id = portfolioId;
    if (dealId) {
      const { error: extraError } = await getServiceClient().from("deals").update(extra).eq("id", dealId);
      if (extraError) {
        return NextResponse.json(
          { ...result, error: `Deal created, but saving its ${portfolioId ? "portfolio link, " : ""}owner and asking price failed: ${extraError.message}. Open the deal to fix it.` },
          { status: 500 }
        );
      }
    }
    if (!result.deal && result.duplicates?.length) return NextResponse.json({ ...result, error: "This address already has a deal. Open the existing record below." }, { status: 409 });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
