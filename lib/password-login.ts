import type { SupabaseClient } from "@supabase/supabase-js";

// Only accounts explicitly provisioned with this format accept case-insensitive
// passwords. Existing Supabase passwords retain their original behavior.
export async function normalizedAuthPassword(email: string, password: string) {
  const input = `hopper-central-v1:${email.trim().toLowerCase()}:${password.toLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function signInWithPassword(
  supabase: Pick<SupabaseClient, "auth">,
  email: string,
  password: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (result.error?.code !== "invalid_credentials") return result;
  return supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: await normalizedAuthPassword(normalizedEmail, password),
  });
}
