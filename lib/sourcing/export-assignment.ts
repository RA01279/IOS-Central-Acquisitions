export type ExportAssignee = {
  key: string;
  kind: "broker" | "firm";
  name: string;
  firmId: string | null;
  firmName: string | null;
  email: string | null;
  phone: string | null;
};

export type ExportAssignment = {
  brokerId?: string;
  brokerName?: string;
  firmId?: string;
  firmName?: string;
  brokerEmail?: string;
  brokerPhone?: string;
};

export function assignmentFor(assignees: ExportAssignee[], key: string): ExportAssignment | undefined {
  const picked = assignees.find((a) => a.key === key);
  if (!picked) return undefined;
  return picked.kind === "firm"
    ? { firmId: picked.firmId ?? undefined, firmName: picked.name }
    : { brokerId: picked.key.slice("broker:".length), brokerName: picked.name, firmId: picked.firmId ?? undefined, firmName: picked.firmName ?? undefined, brokerEmail: picked.email ?? undefined, brokerPhone: picked.phone ?? undefined };
}

export function exportAssignees(companies: any[], contacts: any[], brokerContactIds: Set<string>): ExportAssignee[] {
  const firms: ExportAssignee[] = companies.filter((c) => c.company_type === "broker").map((c) => ({ key: `firm:${c.id}`, kind: "firm", name: c.name, firmId: c.id, firmName: c.name, email: null, phone: null }));
  const brokers: ExportAssignee[] = contacts.filter((c) => c.contact_type === "broker" || c.companies?.company_type === "broker" || brokerContactIds.has(c.id)).map((c) => ({ key: `broker:${c.id}`, kind: "broker", name: c.name, firmId: c.companies?.id ?? null, firmName: c.companies?.name ?? null, email: c.email ?? null, phone: c.phone ?? null }));
  const byFirm = new Map(firms.map((f) => [f.key, f]));
  for (const broker of brokers) if (broker.firmId && broker.firmName && !byFirm.has(`firm:${broker.firmId}`)) byFirm.set(`firm:${broker.firmId}`, { key: `firm:${broker.firmId}`, kind: "firm", name: broker.firmName, firmId: broker.firmId, firmName: broker.firmName, email: null, phone: null });
  return [...brokers, ...byFirm.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.firmName ?? "").localeCompare(b.firmName ?? "") || a.key.localeCompare(b.key));
}
