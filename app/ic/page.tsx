// /ic -- upcoming IC dates, deals heading to IC with no date yet, and the
// summary slides exported recently.

import { getServiceClient } from "@/lib/supabase";
import { ctToday } from "@/lib/summary";
import { DEAL_CARD_SELECT, toDealCard } from "@/lib/deal-view";
import { loadSignals } from "@/lib/site-signals";
import { daysUntil, fmtShortDate } from "@/lib/format";
import Nav from "@/components/Nav";
import { Badge, ScoreTile, STAGE_TONES } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "IC Decks" };

const HEADING_TO_IC = ["offered", "moving_to_psa", "due_diligence"];

export default async function IcHubPage() {
  const supabase = getServiceClient();
  const today = ctToday();
  const [{ data: rows }, { data: exports }] = await Promise.all([
    supabase.from("deals").select(DEAL_CARD_SELECT).eq("deal_type", "acquisition").not("stage", "in", "(archived,closed)"),
    supabase
      .from("deal_events")
      .select("id, deal_id, actor, created_at, detail, deals(properties(address))")
      .eq("event_type", "ic_deck_exported")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);
  const signals = await loadSignals((rows ?? []).map((d: any) => d.id));
  const cards = (rows ?? []).map((d: any) => toDealCard(d, signals.get(d.id)));
  const upcoming = cards.filter((c) => c.icOn && c.icOn >= today).sort((a, b) => a.icOn!.localeCompare(b.icOn!));
  const undated = cards.filter((c) => !c.icOn && HEADING_TO_IC.includes(c.stage));

  return (
    <>
      <Nav active="ic" />
      <main className="bleed">
        <div className="ph">
          <div className="ph-row">
            <div className="ph-title">
              <span className="eyebrow">Investment Committee</span>
              <h1>IC Decks</h1>
              <span className="ph-sub">Set a deal&apos;s IC date from its Summary tab (Next dates → Edit).</span>
            </div>
          </div>
        </div>
        <div className="ws-body">
          <div className="two-col">
            <div className="card">
              <span className="overline">Upcoming IC</span>
              {upcoming.length ? (
                <div className="list-rows">
                  {upcoming.map((c) => {
                    const d = daysUntil(c.icOn!, today);
                    const [mon, day] = fmtShortDate(c.icOn).split(" ");
                    return (
                      <a key={c.id} href={`/deals/${c.id}/ic-deck`} className="list-row">
                        <span className="date-block">
                          <span>{mon}</span>
                          <b>{day}</b>
                        </span>
                        <span className="grow">
                          <b>{c.name}</b>
                          <span>
                            {[c.market, c.priceLabel, d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <ScoreTile score={c.score} />
                      </a>
                    );
                  })}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>No IC dates set.</p>
              )}
            </div>
            <div className="card">
              <span className="overline">Recently exported</span>
              {exports?.length ? (
                <div className="list-rows">
                  {exports.map((e: any) => (
                    <a key={e.id} href={`/deals/${e.deal_id}/ic-deck${e.detail?.view ?? ""}`} className="list-row">
                      <span className="grow">
                        <b>{e.deals?.properties?.address ?? "Deal"}</b>
                        <span>
                          {new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {e.actor}
                        </span>
                      </span>
                      <span className="link-caps">Open</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>Summary slides you download will be listed here.</p>
              )}
            </div>
          </div>
          <div className="card">
            <span className="overline">Heading to IC, no date yet</span>
            {undated.length ? (
              <div className="list-rows">
                {undated.map((c) => (
                  <a key={c.id} href={`/deals/${c.id}`} className="list-row">
                    <span className="grow">
                      <b>{c.name}</b>
                      <span>{[c.market, c.priceLabel].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Badge tone={STAGE_TONES[c.stage] ?? "neutral"}>{c.stageLabel}</Badge>
                    <ScoreTile score={c.score} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>Every deal past Offered has an IC date.</p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
