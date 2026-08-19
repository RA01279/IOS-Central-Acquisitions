// app/api/cron/digest/route.ts
// Morning brief email. Triggered by Vercel Cron (see vercel.json) each weekday.
//
// This route is only the *sender* -- the brief itself is composed by
// composeDigest() in lib/digest.ts, shared with the RSS feed. It used to carry
// a second copy of the composition logic and the two drifted apart, so any
// change to what the brief says belongs in lib/digest.ts alone.
//
// Sender is provider-agnostic, resolved from env:
//   REMINDER_WEBHOOK_URL  -> POST {to, subject, html} (e.g. a Power Automate
//                            flow that sends from a team member's mailbox)
//   RESEND_API_KEY        -> Resend API (DIGEST_FROM sets the from address)
// Recipients: DIGEST_RECIPIENTS (comma-separated) or PSA_CONFIRM_ALLOWLIST.
// Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token).
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { composeDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { subject, html, counts } = await composeDigest();

  const recipients = (process.env.DIGEST_RECIPIENTS ?? process.env.PSA_CONFIRM_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    return NextResponse.json({ sent: false, reason: "No recipients configured", counts });
  }

  // Webhook URL comes from app_settings (writable without a redeploy) or env.
  const supabase = getServiceClient();
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "reminder_webhook_url")
    .maybeSingle();
  const webhookUrl = setting?.value ?? process.env.REMINDER_WEBHOOK_URL;

  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients.join(";"), subject, html }),
    });
    return NextResponse.json({ sent: res.ok, via: "webhook", status: res.status, counts });
  }

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM ?? "Central Acquisitions <onboarding@resend.dev>",
        to: recipients,
        subject,
        html,
      }),
    });
    return NextResponse.json({ sent: res.ok, via: "resend", status: res.status, counts });
  }

  return NextResponse.json({
    sent: false,
    reason: "No sender configured (set REMINDER_WEBHOOK_URL or RESEND_API_KEY)",
    preview: { subject, recipients },
    counts,
  });
}
