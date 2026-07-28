// app/api/contacts/[id]/route.ts
// Edit (PATCH) or delete a contact. All fields editable, including
// classification and company (with inline company creation).
import { NextRequest, NextResponse } from "next/server";
import { createCompany } from "@/lib/crm";
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
            companyType: body.newCompanyType ?? "other",
          })).id;
    }

    const { data, error } = await supabase
      .from("contacts")
      .update({
        name: body.name,
        contact_type: body.contactType ?? null,
        title: body.title || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        company_id: companyId,
      })
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
