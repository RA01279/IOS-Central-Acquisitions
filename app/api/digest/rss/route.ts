// app/api/digest/rss/route.ts
// The morning digest as an RSS feed with exactly one item per weekday
// (guid = the date). Exists because Power Automate's HTTP trigger needs a
// premium license, but its Recurrence trigger + RSS connector + Send-email
// action are all FREE: a scheduled flow lists this feed each morning and
// emails the item's content. Guarded by ?key= matching app_settings
// 'export_token'.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { composeDigest } from "@/lib/digest";
import { bearerMatches } from "@/lib/sync-export";
import { ctToday } from "@/lib/summary";
import { composeOfferReminder } from "@/lib/offer-deadlines";
import { fetchAll } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

function cdata(s: string) {
  return `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

export async function GET(req: NextRequest) {
  const supabase = getServiceClient();
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "export_token")
    .maybeSingle();
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !bearerMatches(`Bearer ${key}`, tokenRow?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reminderMode = req.nextUrl.searchParams.get("mode") === "offer-reminders";
  const today = ctToday();
  const content = reminderMode
    ? composeOfferReminder(await fetchAll((from, to) => supabase.from("deals")
        .select("id, stage, call_for_offers_on, offer_round, assigned_analyst, properties(address), tasks(title, due_date, status)")
        .eq("deal_type", "acquisition")
        .not("stage", "in", "(closed,archived)").order("id").range(from, to)) as any[], today)
    : await composeDigest();
  const pubDate = new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Central Acquisitions morning brief</title>
    <link>https://ios-central-acquisitions.vercel.app/</link>
    <description>Call-for-offers dates, DD expirations, closings, and follow-ups</description>
    ${content ? `
    <item>
      <title>${content.subject.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
      <link>https://ios-central-acquisitions.vercel.app/</link>
      <!-- guid prefix is historical: changing it would make every past item
           look new to the Power Automate flow and re-send the backlog. -->
      <guid isPermaLink="false">hopper-${reminderMode ? "offer-reminders" : "digest"}-${today}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${cdata(content.html)}</description>
    </item>
    ` : ""}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
