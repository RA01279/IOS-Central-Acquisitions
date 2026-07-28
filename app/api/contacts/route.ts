// app/api/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createContact, createCompany, listContacts } from "@/lib/crm";
import { getServiceClient } from "@/lib/supabase";
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
    // Inline company creation from the contact form: find an existing
    // company by that name (case-insensitive) or create it.
    let companyId = body.companyId;
    if (!companyId && body.newCompanyName) {
      const supabase = getServiceClient();
      const { data: existing } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", String(body.newCompanyName).trim())
        .limit(1)
        .maybeSingle();
      companyId = existing
        ? existing.id
        : (await createCompany({
            name: String(body.newCompanyName).trim(),
            companyType: body.newCompanyType ?? "other",
          })).id;
    }

    const contact = await createContact({
      name: body.name,
      contactType: body.contactType,
      email: body.email,
      phone: body.phone,
      title: body.title,
      address: body.address,
      companyId,
    });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
