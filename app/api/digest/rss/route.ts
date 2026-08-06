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
  if (!tokenRow?.value || key !== tokenRow.value) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subject, html } = await composeDigest();
  const today = new Date().toISOString().slice(0, 10);
  const pubDate = new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Hopper morning digest</title>
    <link>https://ios-central-acquisitions.vercel.app/dashboard</link>
    <description>Overdue follow-ups, targets due, and stale deals from Hopper</description>
    <item>
      <title>${subject.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
      <link>https://ios-central-acquisitions.vercel.app/dashboard</link>
      <guid isPermaLink="false">hopper-digest-${today}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${cdata(html)}</description>
    </item>
  </channel>
</rss>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
