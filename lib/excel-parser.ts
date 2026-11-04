// lib/excel-parser.ts
//
// Parses the Dalfen underwriting model's returns summary. Two template
// families are supported:
//
//  - IOS template ("Pro Forma" tab): values found by their row label in
//    column B, never from the hidden Summary Table. Mapped against
//    10526 Tanner Rd (Nov 2026 template).
//
//  - Industrial template ("_Upload_" tab): a much larger institutional
//    JV/development model (T_ExecUpd, waterfall, refi, etc.) that ships
//    its own machine-readable "_Upload_" sheet -- label in column B,
//    value/formula in column C. We match by label text rather than a
//    fixed row number, since that's the more stable surface Dalfen's
//    model authors clearly intended (it's a self-describing schema
//    sheet, unlike IOS's raw grid). Mapped against
//    Cameron_Tech_Center__City_Renews__-_V3_-_CURRENT.xlsm.
//
// If neither tab is found, the workbook doesn't match a known template.

import ExcelJS from "exceljs";

export interface ReturnsSummary {
    purchasePrice: number | null;
    allInCost: number | null;
    goingInYieldPct: number | null;
    stabilizedReturnOnCostPct: number | null;
    exitCapPct: number | null;
    marketRentPsfMo: number | null;
    holdPeriodYears: number | null;
    irrPct: number | null;
    equityMultiple: number | null;
    stabilizedCashOnCashPct: number | null;
    warnings: string[];
    /** Internal workbook identity and the unit evidence behind normalized rent. */
    sourceProperty?: string | null;
    marketRentSourceBasis?: string | null;
    sourceIdentity?: { address: string | null; city: string | null; acres: number | null; buildingSf: number | null };
    identityResolution?: { fingerprint: string; outcome: "accepted" | "wrong_upload"; reason: string; actor: string; at: string };
}

type FieldKey = keyof Omit<ReturnsSummary, "warnings" | "sourceProperty" | "marketRentSourceBasis" | "sourceIdentity" | "identityResolution">;

// ---------- shared cell-reading helper ----------

function readCellValue(
    cell: ExcelJS.Cell | undefined,
    label: string,
    warnings: string[]
  ): number | null {
    if (!cell) {
          warnings.push(`Could not locate a cell for "${label}"`);
          return null;
    }
    const raw = cell.value;
    if (raw === null || raw === undefined) return null;
    // Reading a saved formula result is normal; a missing or erroneous
    // result is a workbook issue that needs a specific, actionable warning.
    const isFormula = typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw);
    // ExcelJS's cell.value getter omits falsy formula results, including 0.
    // cell.result preserves the actual saved value.
    const value = isFormula ? cell.result : raw;
    const error = value && typeof value === "object" && "error" in value
      ? value.error
      : typeof value === "string" && value.startsWith("#") ? value : null;
    if (error) {
      warnings.push(`"${label}" contains a formula error (${error}) in the source workbook`);
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (isFormula) {
      warnings.push(`"${label}" has no saved numeric calculation result. Recalculate and save the workbook in Excel, then upload it again.`);
      return null;
    }
    // Non-numeric value where a number was expected (e.g. someone typed
  // "TBD", or the model uses "n/a" for an inactive refi) -- flag it
  // rather than silently returning null.
  warnings.push(`"${label}" expected a number, found "${raw}"`);
    return null;
}

// ---------- IOS template ("Pro Forma") ----------
//
// Everything comes from the visible Pro Forma tab, found by the row label in
// column B. The template also carries a hidden "Summary Table" (and "Deal
// Overview", "Memo Table") that can be left over from an earlier deal or an
// earlier price, so those are never read. Labels survive inserted rows;
// fixed cell addresses did not.

const IOS_SHEET_NAME = "Pro Forma";
const LABEL_COL = 2; // B

const textOf = (cell: ExcelJS.Cell | undefined): string | null => {
    let v: any = cell?.value;
    if (v && typeof v === "object") v = "result" in v ? v.result : "richText" in v ? v.richText.map((t: any) => t.text).join("") : null;
    return typeof v === "string" && v.trim() ? v.trim() : null;
};
const sameLabel = (a: string | null, label: string) => !!a && a.replace(/\s+/g, " ").toLowerCase() === label.toLowerCase();

/** Rows whose column B reads `label` (a label can repeat, e.g. an "Exit Cap" heading above the "Exit Cap" value). */
function labelRows(sheet: ExcelJS.Worksheet, label: string): number[] {
    const rows: number[] = [];
    sheet.eachRow((row, r) => { if (sameLabel(textOf(row.getCell(LABEL_COL)), label)) rows.push(r); });
    return rows;
}

/** Column of the "Levered" heading in the returns block at the top of Pro Forma. */
function leveredColumn(sheet: ExcelJS.Worksheet): number | null {
    for (let r = 1; r <= 15; r++) {
      const row = sheet.getRow(r);
      for (let c = 3; c <= 7; c++) if (sameLabel(textOf(row.getCell(c)), "Levered")) return c;
    }
    return null;
}

function parseIosTemplate(sheet: ExcelJS.Worksheet): ReturnsSummary {
    const warnings: string[] = [];
    const missing: string[] = [];
    // The first row with this label whose `col` holds a saved result; a missing
    // label or empty value is reported once in plain language.
    const read = (label: string, col: number | null, field: string): number | null => {
      const rows = labelRows(sheet, label);
      if (!rows.length || col == null) { missing.push(`"${label}"`); return null; }
      for (const r of rows) {
        const cell = sheet.getRow(r).getCell(col);
        if (cell.value === null || cell.value === undefined) continue;
        return readCellValue(cell, `${field} (Pro Forma ${cell.address}, "${label}")`, warnings);
      }
      missing.push(`"${label}"`);
      return null;
    };
    const F = 6, E = 5, D = 4, C = 3;
    const lev = leveredColumn(sheet);
    if (lev == null) warnings.push('Could not find the "Levered" column in the returns block at the top of Pro Forma, so IRR, multiple and cash-on-cash were not read.');
    const months = read("Month of Sale", D, "holdPeriodYears");
    const summary: Pick<ReturnsSummary, FieldKey> = {
      purchasePrice: read("Purchase Price", F, "purchasePrice"),
      allInCost: read("Total All-in Cost", F, "allInCost"),
      goingInYieldPct: read("Going-in Cap Rate (tax adj.)", C, "goingInYieldPct"),
      stabilizedReturnOnCostPct: read("Yield on Cost at Exit", C, "stabilizedReturnOnCostPct"),
      exitCapPct: read("Exit Cap", F, "exitCapPct"),
      // "Market Rent" in the exit block is stated in $ PSF / Mo. (column E).
      marketRentPsfMo: read("Market Rent", E, "marketRentPsfMo"),
      holdPeriodYears: months != null ? months / 12 : null,
      irrPct: read("IRR", lev, "irrPct"),
      equityMultiple: read("Multiple", lev, "equityMultiple"),
      // Average levered cash-on-cash over the hold, as in the industrial template.
      stabilizedCashOnCashPct: read("Avg. Cash-on-Cash", lev, "stabilizedCashOnCashPct"),
    };
    if (missing.length) warnings.push(`Pro Forma rows not found or empty: ${missing.join(", ")}. Check the workbook follows the standard IOS template.`);
    const address = textOf(sheet.getRow(labelRows(sheet, "Address")[0] ?? 0).getCell(F)) ?? textOf(sheet.getRow(labelRows(sheet, "Property Name")[0] ?? 0).getCell(F));
    const city = textOf(sheet.getRow(labelRows(sheet, "City, State")[0] ?? 0).getCell(F));
    const lotRow = labelRows(sheet, "Lot Size (Acre / SF)")[0], bldgRow = labelRows(sheet, "Building SF")[0];
    const acres = lotRow ? readCellValue(sheet.getRow(lotRow).getCell(E), "Identity acres", warnings) : null;
    const buildingSf = bldgRow ? readCellValue(sheet.getRow(bldgRow).getCell(F), "Identity building SF", warnings) : null;
    return { ...summary, sourceProperty: address, sourceIdentity: { address, city, acres, buildingSf }, marketRentSourceBasis: summary.marketRentPsfMo != null ? "Pro Forma Market Rent ($ PSF / Mo.)" : null, warnings };
}

// ---------- Industrial template ("_Upload_") ----------

const INDUSTRIAL_SHEET_NAME = "_Upload_";

// Label text as it appears in column B of the _Upload_ sheet -> our field.
// "Last sale" is in months-from-close in this template, so holdPeriodYears
// divides it by 12 below.
const INDUSTRIAL_LABELS: Record<FieldKey, string> = {
    purchasePrice: "Purchase Price",
    allInCost: "Total Sources",
    goingInYieldPct: "In-Place Cap on PP",
    stabilizedReturnOnCostPct: "Stab cap-on-all-in (Yield to Cost)",
  exitCapPct: "Exit Cap with adj",
    marketRentPsfMo: "", // not present in this template's _Upload_ sheet
    holdPeriodYears: "Last sale",
    irrPct: "Gross IRR Lev",
    equityMultiple: "Gross Equity Mult.",
    stabilizedCashOnCashPct: "Lev Avg CoC",
};

function findLabelRow(sheet: ExcelJS.Worksheet, label: string): number | null {
    let found: number | null = null;
    sheet.eachRow((row, rowNumber) => {
          if (found !== null) return;
          const cellVal = row.getCell(2).value; // column B
                      if (typeof cellVal === "string" && cellVal.trim() === label) {
                              found = rowNumber;
                      }
    });
    return found;
}

function parseIndustrialTemplate(sheet: ExcelJS.Worksheet): ReturnsSummary {
    const warnings: string[] = [];
    const result: Partial<Record<FieldKey, number | null>> = {};

  for (const [key, label] of Object.entries(INDUSTRIAL_LABELS) as [FieldKey, string][]) {
        if (!label) {
                result[key] = null;
                continue;
        }
        const rowNum = findLabelRow(sheet, label);
        if (rowNum === null) {
                warnings.push(`Could not find a row labeled "${label}" in the "${INDUSTRIAL_SHEET_NAME}" tab`);
                result[key] = null;
                continue;
        }
        const cell = sheet.getRow(rowNum).getCell(3); // column C
      result[key] = readCellValue(cell, label, warnings);
  }

  if (typeof result.holdPeriodYears === "number") {
        result.holdPeriodYears = result.holdPeriodYears / 12;
  }

  return { ...(result as Omit<ReturnsSummary, "warnings">), warnings };
}

// ---------- entry point ----------

export async function parseReturnsSummary(buffer: Buffer, expectedProperty?: string): Promise<ReturnsSummary> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

  const iosSheet = workbook.getWorksheet(IOS_SHEET_NAME);
    if (iosSheet && labelRows(iosSheet, "Purchase Price").length) {
          const result = parseIosTemplate(iosSheet);
          // A conflicting street number is definite evidence of an identity
          // problem, not something the upload filename can override.
          const sourceNumber = result.sourceProperty?.match(/^\d+(?:-\d+)?\b/)?.[0];
          const expectedNumber = expectedProperty?.match(/^\d+(?:-\d+)?\b/)?.[0];
          if (sourceNumber && expectedNumber && sourceNumber !== expectedNumber) result.warnings.push(`Detected identity discrepancy: workbook ${result.sourceProperty}; deal ${expectedProperty}. Review before using this source; this does not confirm a wrong upload.`);
          if (!result.sourceProperty) result.warnings.push('No property address was found on Pro Forma (the "Address" row).');
          return result;
    }

  const industrialSheet = workbook.getWorksheet(INDUSTRIAL_SHEET_NAME);
    if (industrialSheet) {
          return parseIndustrialTemplate(industrialSheet);
    }

  throw new Error(
        `Didn't recognize this workbook's template. Expected either a "${IOS_SHEET_NAME}" tab with a "Purchase Price" row (IOS models) ` +
          `or a "${INDUSTRIAL_SHEET_NAME}" tab (industrial models), and found neither. Check this file matches a standard template.`
      );
}
