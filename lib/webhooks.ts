// lib/webhooks.ts
//
// Outbound stage-change notifications, for consumers that would rather be
// pushed to than poll /api/export (the roll-up dashboard, a Power Automate
// flow, a Teams channel connector).
//
// Configuration lives in app_settings so a URL can be added or revoked
// without a redeploy:
//
//   insert into app_settings (key, value)
//   values ('stage_webhook_url', 'https://...')
//   on conflict (key) do update set value = excluded.value, updated_at = now();
//
// Falls back to the STAGE_WEBHOOK_URL env var. With neither set this is a
// no-op, which is the default state -- nothing is sent anywhere.
//
// Deliberately fire-and-forget: a dead webhook endpoint must never turn a
// stage advance into a failed request for the person clicking the button. A
// delivery failure is recorded as a deal_event so there's a trail, and that's
// the whole retry story -- if a consumer needs guaranteed delivery it should
// poll /api/export instead.
//
// Does not import from ./deals: deals.ts imports this file, and going back the
// other way for logDealEvent would be a cycle. The event insert is inlined.

import { getServiceClient } from "./supabase";

const TIMEOUT_MS = 5000;

export interface StageChange {
  to: string;
  from?: string | null;
  actor: string;
  via?: string;
}

async function resolveWebhookUrl(): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "stage_webhook_url")
    .maybeSingle();
  return data?.value ?? process.env.STAGE_WEBHOOK_URL ?? null;
}

export async function fireStageChangeWebhook(dealId: string, change: StageChange): Promise<void> {
  try {
    const url = await resolveWebhookUrl();
    if (!url) return;

    const supabase = getServiceClient();
    const { data: deal } = await supabase
      .from("deals")
      .select("id, stage, asset_class, deal_type, properties(address, city, market)")
      .eq("id", dealId)
      .maybeSingle();

    const payload = {
      event: "stage_changed",
      source: "central-acquisitions",
      dealId,
      dealUrl: `https://ios-central-acquisitions.vercel.app/deals/${dealId}`,
      address: (deal as any)?.properties?.address ?? null,
      city: (deal as any)?.properties?.city ?? null,
      market: (deal as any)?.properties?.market ?? null,
      assetClass: (deal as any)?.asset_class ?? null,
      from: change.from ?? null,
      to: change.to,
      actor: change.actor,
      via: change.via ?? null,
      at: new Date().toISOString(),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      await supabase.from("deal_events").insert({
        deal_id: dealId,
        event_type: "webhook_failed",
        detail: { status: res.status, to: change.to },
        actor: "system",
      });
    }
  } catch (err: any) {
    // Never propagate: the stage change itself already succeeded.
    try {
      await getServiceClient()
        .from("deal_events")
        .insert({
          deal_id: dealId,
          event_type: "webhook_failed",
          detail: { error: String(err?.message ?? err), to: change.to },
          actor: "system",
        });
    } catch {
      // Nothing left to do -- swallow.
    }
  }
}
