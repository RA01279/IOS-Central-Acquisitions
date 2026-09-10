const STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence", "closed"];
export function transitionError(from: string, to: string, correction: boolean): string | null {
  const fromIndex = STAGES.indexOf(from), toIndex = STAGES.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return "Restore archived deals before changing stage";
  if (correction) return toIndex < fromIndex ? null : "Corrections can only move a deal backward. Use the normal stage action to advance.";
  return toIndex === fromIndex + 1 ? null : "The deal stage has changed. Refresh and use the next available action.";
}
export function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
