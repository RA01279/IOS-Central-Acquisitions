// Diligence tab: the PSA / due-diligence schedule, then every document on the
// deal. Open from the start -- the vault is useful long before a PSA -- but
// the schedule only lays itself out once a PSA effective date is entered.

import { getDeal } from "@/lib/deal-workspace";
import { listMilestones } from "@/lib/diligence-db";
import { DEFAULT_CLOSING_DAYS, DEFAULT_DD_DAYS, parseDays } from "@/lib/diligence";
import { ctToday } from "@/lib/summary";
import DiligencePanel, { type MilestoneRow } from "@/components/DiligencePanel";
import DocumentVault, { type VaultDoc } from "@/components/DocumentVault";

export const metadata = { title: "Diligence" };

export default async function DiligencePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [deal, milestones] = await Promise.all([getDeal(id), listMilestones(id)]);
  const terms = (deal.loi_terms ?? {}) as Record<string, unknown>;
  const docs = [...(deal.documents ?? [])].sort((a: any, b: any) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  const labelOf = new Map(milestones.map((m: any) => [m.id, m.label]));

  const rows: MilestoneRow[] = milestones.map((m: any) => ({
    id: m.id,
    key: m.key,
    label: m.label,
    due_on: m.due_on,
    done_on: m.done_on,
    notes: m.notes,
    docs: docs
      .filter((d: any) => d.milestone_id === m.id)
      .map((d: any) => ({ id: d.id, name: d.file_name || d.storage_path.split("/").pop() })),
  }));
  const vault: VaultDoc[] = docs.map((d: any) => ({
    id: d.id,
    doc_type: d.doc_type,
    name: d.file_name || d.storage_path.split("/").pop().replace(/^(doc|uw|om)-\d+-/, ""),
    uploaded_by: d.uploaded_by ?? "",
    uploaded_at: d.uploaded_at,
    size_bytes: d.size_bytes ?? null,
    milestone_label: d.milestone_id ? labelOf.get(d.milestone_id) ?? null : null,
  }));

  return (
    <div className="ws-body">
      <DiligencePanel
        dealId={deal.id}
        today={ctToday()}
        psaEffectiveOn={deal.psa_effective_on ?? null}
        ddDaysDefault={parseDays(terms.ddDays) ?? DEFAULT_DD_DAYS}
        closingDaysDefault={parseDays(terms.closingDays) ?? DEFAULT_CLOSING_DAYS}
        milestones={rows}
      />
      <DocumentVault
        dealId={deal.id}
        docs={vault}
        milestones={milestones.map((m: any) => ({ id: m.id, key: m.key, label: m.label, done_on: m.done_on }))}
      />
    </div>
  );
}
