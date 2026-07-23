// app/api/companies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createCompany, listCompanies } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("q") ?? undefined;
  try {
    const companies = await listCompanies(search);
    return NextResponse.json({ companies });
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
    const company = await createCompany({
      name: body.name,
      companyType: body.companyType ?? "other",
    });
    return NextResponse.json({ company }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
