// app/api/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createContact, listContacts } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("q") ?? undefined;
  try {
    const contacts = await listContacts(search);
    return NextResponse.json({ contacts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  try {
    const contact = await createContact({
      name: body.name,
      email: body.email,
      phone: body.phone,
      title: body.title,
      companyId: body.companyId,
    });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
