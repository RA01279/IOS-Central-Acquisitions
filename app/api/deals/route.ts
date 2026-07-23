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
      assetType: body.assetType,
      lotSf: body.lotSf,
      buildingSf: body.buildingSf,
      occupancyStatus: body.occupancyStatus,
      waltYears: body.waltYears,
      tenancy: body.tenancy,
      tenantName: body.tenantName,
      currentOwnerName: body.currentOwnerName,
      sourceBrokerId: body.sourceBrokerId,
      dealType: body.dealType, // "acquisition" (default) or "lease"
      createdBy: user.email,
      mla: body.mla,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
