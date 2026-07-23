// app/api/activities/route.ts
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.activityType) {
    return NextResponse.json({ error: "activityType is required" }, { status: 400 });
  }

  try {
    const activity = await logActivity({
      activityType: body.activityType,
      subject: body.subject,
      body: body.body,
      occurredAt: body.occurredAt,
      contactId: body.contactId,
      companyId: body.companyId,
      dealId: body.dealId,
      propertyId: body.propertyId,
      createdBy: user.email,
    });
    return NextResponse.json({ activity }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
