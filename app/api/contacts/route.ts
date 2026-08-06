// app/api/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  createContact,
  createCompany,
  listContacts,
  CONTACT_TO_COMPANY_TYPE,
  COMPANY_TO_CONTACT_TYPE,
} from "@/lib/crm";
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
    const supabase = getServiceClient();
    let companyId = body.companyId;
    let contactType = body.contactType || null;

    // Inline company creation: the new company inherits the CONTACT's
    // category (a broker's firm is a broker company, a tenant's a tenant
    // company).
    if (!companyId && body.newCompanyName) {
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
            companyType: CONTACT_TO_COMPANY_TYPE[contactType ?? "other"] ?? "other",
          })).id;
    }

    // Existing company picked but no type chosen -> the contact inherits the
    // company's category.
    if (companyId && !contactType) {
      const { data: co } = await supabase
        .from("companies")
        .select("company_type")
        .eq("id", companyId)
        .single();
      if (co?.company_type) contactType = COMPANY_TO_CONTACT_TYPE[co.company_type] ?? null;
    }

    const contact = await createContact({
      name: body.name,
      contactType,
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
