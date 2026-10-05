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

  // Photos must be ones this deal's upload route issued -- never an arbitrary
  // path into the documents bucket.
  const photoPaths: string[] = Array.isArray(body.photoPaths) ? body.photoPaths.slice(0, 12) : [];
  if (photoPaths.some((p) => typeof p !== "string" || !body.dealId || !p.startsWith(`deals/${body.dealId}/site-visits/`) || p.includes(".."))) {
    return NextResponse.json({ error: "Invalid photo" }, { status: 400 });
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
      photoPaths,
      createdBy: user.email,
    });
    return NextResponse.json({ activity }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
