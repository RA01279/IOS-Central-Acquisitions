// app/api/tasks/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { completeTask, reopenTask } from "@/lib/crm";
import { getCurrentUser } from "@/lib/auth";

// PATCH /api/tasks/[id]  body: { action: "complete" | "reopen" }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  try {
    if (body.action === "complete") {
      await completeTask(params.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reopen") {
      await reopenTask(params.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
