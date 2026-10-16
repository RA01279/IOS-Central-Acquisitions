// lib/team.ts
//
// The people who can own a deal: Hopper's signed-up users. Read from Supabase
// Auth with the service key, once per request.

import { cache } from "react";
import { getServiceClient } from "./supabase";

export type TeamMember = { email: string; name: string };

/** "randerson@dalfen.com" -> "R. Anderson"; a stored full name wins. */
export function displayName(email: string, fullName?: unknown): string {
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  const local = email.split("@")[0] ?? email;
  if (/^[a-z][a-z]{2,}$/i.test(local)) return `${local[0].toUpperCase()}. ${local[1].toUpperCase()}${local.slice(2)}`;
  return local;
}

export const listTeam = cache(async (): Promise<TeamMember[]> => {
  const { data, error } = await getServiceClient().auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`Loading the team: ${error.message}`);
  return (data?.users ?? [])
    .filter((u) => u.email)
    .map((u) => ({ email: u.email!.toLowerCase(), name: displayName(u.email!, (u.user_metadata as any)?.full_name ?? (u.user_metadata as any)?.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

export function nameOf(team: TeamMember[], email: string | null | undefined): string | null {
  if (!email) return null;
  return team.find((t) => t.email === email.toLowerCase())?.name ?? displayName(email);
}
