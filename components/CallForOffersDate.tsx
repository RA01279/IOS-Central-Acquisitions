import { fmtShortDate } from "@/lib/format";
import { offerRoundLabel } from "@/lib/call-for-offers";

/** Shared by the board, scored cards and portfolio package cards. */
export default function CallForOffersDate({ date, round }: { date: string | null; round?: number | null }) {
  if (!date) return null;
  const r = Math.max(1, Number(round) || 1);
  return (
    <span className="stage-age" style={{ display: "block", color: r > 1 ? "var(--warn-text, #8a5a14)" : "#0E5AA7", fontWeight: 600 }}>
      {r > 1 ? `${offerRoundLabel(r)} due` : "Call for offers"}: <time dateTime={date}>{fmtShortDate(date)}</time>
    </span>
  );
}
