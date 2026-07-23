import { getServiceClient } from "@/lib/supabase";
import { notFound } from "next/navigation";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const supabase = getServiceClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("*, properties(*), mla_data(*), uw_versions(*), documents(*), deal_events(*)")
    .eq("id", params.id)
    .single();

  if (!deal) return notFound();

  return (
    <main>
      <h1>{deal.properties?.address}</h1>
      <p>Stage: {deal.stage}</p>
      <p>MLA status: {deal.mla_status}</p>

      {/* TODO(claude-code): build out --
          - Excel upload -> returns summary (needs Jadon's template mapped to fields)
          - "Mark Offered" / "Confirm Moving to PSA" buttons, gated by canConfirmPsa()
          - Archive/restore action with death_stage + death_reason capture
          - Version history list from uw_versions
          - Document list from documents, grouped by doc_type
      */}
    </main>
  );
}
