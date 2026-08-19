// app/api/deals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createDeal } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();

  try {
    const result = await createDeal({
      address: body.address,
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

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
