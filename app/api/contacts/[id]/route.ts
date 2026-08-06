// app/api/contacts/[id]/route.ts
// Edit (PATCH) or delete a contact. All fields editable, including
// classification and company (with inline company creation).
import { NextRequest, NextResponse } from "next/server";
import { createCompany, CONTACT_TO_COMPANY_TYPE } from "@/lib/crm";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

  try {
    let companyId = body.companyId ?? null;
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
            companyType: CONTACT_TO_COMPANY_TYPE[body.contactType ?? "other"] ?? "other",
          })).id;
    }

    // Partial update: only fields present in the request change. Lets the
    // list-row controls send just { contactType } without nulling the rest.
    const update: Record<string, unknown> = {};
    if ("name" in body) update.name = body.name;
    if ("contactType" in body) update.contact_type = body.contactType || null;
    if ("title" in body) update.title = body.title || null;
    if ("email" in body) update.email = body.email || null;
    if ("phone" in body) update.phone = body.phone || null;
    if ("address" in body) update.address = body.address || null;
    if ("companyId" in body || body.newCompanyName) {
      update.company_id = companyId ?? null;
    }

    const { data, error } = await supabase
      .from("contacts")
      .update(update)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ contact: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getServiceClient();
  const { error } = await supabase.from("contacts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
