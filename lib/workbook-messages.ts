// This historical message explains the import method, not a parser failure.
// Keep real workbook issues visible, including on previously saved versions.
const LEGACY_CALCULATION_NOTE = "Workbook returns are cached source values; Hopper does not recalculate Excel formulas. Verify workbook identity and recalculate/save in Excel before relying on them.";

export function workbookWarnings(warnings: unknown): string[] {
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === "string" && warning !== LEGACY_CALCULATION_NOTE)
      .map(warning => warning.replace(/^"(.+)" expected a number, found "\[object Object\]"$/, 'A numeric result for "$1" was not captured in this saved version. Upload the workbook again to read this result.'))
    : [];
}
