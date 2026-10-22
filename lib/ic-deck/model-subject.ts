import type { ModelSummary } from "./model";
const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Bind a workbook to its selected deal. The model's own address cell is often
 * stale template data, so a mismatch never blocks the build: the deck uses the
 * deal's address and says so in the model checks. */
export function bindModelSubject(model: ModelSummary, address: string): ModelSummary {
  if (!address || !model.property.address || key(model.property.address) === key(address)) return model;
  const named = key(model.source.fileName).includes(key(address));
  const warning = named
    ? `The workbook filename identifies ${address}, but its ES Summary address says ${model.property.address}. The deck uses the deal address; fix the workbook's address cell.`
    : `The workbook's ES Summary address says ${model.property.address}; this deal is ${address}. The deck uses the deal address. Confirm this is the right model (the address cell is often stale template data).`;
  return { ...model, property: { ...model.property, address }, warnings: [...model.warnings, warning] };
}
