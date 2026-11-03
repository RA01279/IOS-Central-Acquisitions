import { fmtShortDate } from "@/lib/format";

/** Shared by the board, scored cards and portfolio package cards. */
export default function CallForOffersDate({ date }: { date: string | null }) {
  if (!date) return null;
  return (
    <span className="stage-age" style={{ display: "block", color: "#0E5AA7", fontWeight: 600 }}>
      Call for offers: <time dateTime={date}>{fmtShortDate(date)}</time>
    </span>
  );
}
