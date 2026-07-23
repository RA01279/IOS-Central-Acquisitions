// lib/auth.ts
//
// Simple Supabase email/password auth -- no Azure AD app registration,
// no IT approval needed. You create the 3 accounts yourself in the
// Supabase dashboard (Authentication -> Users -> Add user) and hand out
// the passwords directly. If Dalfen IT later wants this on SSO, swap
// this file for an Azure AD provider -- nothing else in the app needs
// to change, since every route just calls getCurrentUser().

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export function getSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          // Server Components can't set cookies -- this only succeeds
          // when called from a Route Handler or Server Action. Middleware
          // already refreshes the session on every request, so it's safe
          // to swallow this in the Server Component case.
          try {
            cookieStore.set(name, value, options);
          } catch {
            // no-op: expected when called during a page render
          }
        },
        remove: (name: string, options: any) => {
          try {
            cookieStore.set(name, "", { ...options, maxAge: 0 });
          } catch {
            // no-op: expected when called during a page render
          }
        },
      },
    }
  );
}

export async function getCurrentUser(_req?: NextRequest) {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { email: user.email };
}

// Only Rhett/John should reach PSA-confirm actions -- enforced here,
// not just hidden in the UI. See app/api/deals/[id]/archive/route.ts
// and wherever the "Moving to PSA" button ends up calling into.
const PSA_CONFIRM_ALLOWLIST = (process.env.PSA_CONFIRM_ALLOWLIST ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function canConfirmPsa(email: string) {
  return PSA_CONFIRM_ALLOWLIST.includes(email.toLowerCase());
}
