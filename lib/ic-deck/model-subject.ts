import type { ModelSummary } from "./model";
const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Bind a workbook to its selected deal; tolerate a disclosed cover-cell typo
 * only when the actual workbook filename identifies this subject. */
export function bindModelSubject(model: ModelSummary, address: string): ModelSummary {
  if (!address || !model.property.address || key(model.property.address) === key(address)) return model;
  if (!key(model.source.fileName).includes(key(address))) throw new Error(`The model identifies ${model.property.address}, but this deal is ${address}. Choose the workbook for this deal.`);
  const warning = `The workbook filename identifies ${address}, but its ES Summary address says ${model.property.address}. The deck uses the selected deal address (${address}); verify the workbook address and model checks before circulating.`;
  return { ...model, property: { ...model.property, address }, warnings: [...model.warnings, warning] };
}
