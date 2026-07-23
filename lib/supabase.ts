// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

// Service-role client for server-side use only (API routes, server actions).
// Never import this in a client component -- the service key bypasses RLS.
//
// cache: "no-store" on every request is load-bearing. Supabase reads are
// HTTP GETs under the hood, and Vercel's Data Cache will happily cache them
// -- persisting even across deployments -- which once froze production on
// hours-old data (pages stale, API routes live) while localhost looked fine.
// Never remove this.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
