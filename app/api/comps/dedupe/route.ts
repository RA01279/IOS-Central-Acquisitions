// app/api/comps/dedupe/route.ts
//
// POST: delete every comp held as a possible duplicate of a comp that is still
// in Hopper. The Comps page's "Delete all duplicates" button. Only drafts
// flagged possible_duplicate whose original still exists are touched -- a
// confirmed comp, or a duplicate whose original has gone, is never deleted
// here. Returns how many were removed.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comps")
    .delete()
    .eq("status", "draft")
    .contains("review_flags", ["possible_duplicate"])
    .not("duplicate_of", "is", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: data?.length ?? 0 });
}
