// lib/auth.ts
import { getServerSession } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import type { NextRequest } from "next/server";

export const authOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      // Delegated scopes needed later for sending mail via Graph
      // (market-lead MLA notifications) -- Mail.Send is the one that
      // matters for this app; Calendars.Read only if calendar sync
      // gets added.
      authorization: { params: { scope: "openid profile email Mail.Send" } },
    }),
  ],
  callbacks: {
    async session({ session, token }: any) {
      if (session.user) {
        session.user.email = token.email;
      }
      return session;
    },
  },
};

// Only Rhett/John should reach PSA-confirm actions -- enforced wherever
// that action is triggered, not just hidden in the UI. See
// app/api/deals/[id]/route.ts.
const PSA_CONFIRM_ALLOWLIST = (process.env.PSA_CONFIRM_ALLOWLIST ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function canConfirmPsa(email: string) {
  return PSA_CONFIRM_ALLOWLIST.includes(email.toLowerCase());
}

export async function getCurrentUser(_req: NextRequest) {
  const session = await getServerSession(authOptions as any);
  if (!session?.user?.email) return null;
  return { email: session.user.email as string };
}
