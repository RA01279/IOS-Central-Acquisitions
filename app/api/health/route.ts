// app/api/health/route.ts
//
// Unauthenticated diagnostic: reports which Supabase project this deployment
// is talking to and when it responded. Exposes only the project ref (already
// public in the client bundle via NEXT_PUBLIC_SUPABASE_URL) -- no keys, no
// data. Exists because production once ran against a different database than
// local dev and it took hours to prove; this makes it a 2-second check.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.replace("https://", "").split(".")[0] || "MISSING";
  return NextResponse.json({
    supabaseProjectRef: ref,
    respondedAt: new Date().toISOString(),
  });
}
