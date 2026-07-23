// app/api/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  try {
    const task = await createTask({
      title: body.title,
      notes: body.notes,
      dueDate: body.dueDate,
      assignedTo: body.assignedTo || user.email,
      contactId: body.contactId,
      companyId: body.companyId,
      dealId: body.dealId,
      createdBy: user.email,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
