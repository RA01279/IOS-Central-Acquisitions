// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

// Service-role client for server-side use only (API routes, server actions).
// Never import this in a client component -- the service key bypasses RLS.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
