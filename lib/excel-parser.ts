// lib/excel-parser.ts
//
// Parses the Dalfen underwriting model's returns summary. Two template
// families are supported:
//
//  - IOS template ("Summary Table" tab): a formula-linked one-pager with
//    fixed cell addresses. Mapped against 1717 Shady Oaks - V1 - CURRENT.xlsx.
//    If a future IOS template version moves these cells, IOS_CELLS below
//    needs to be updated.
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
}

type FieldKey = keyof Omit<ReturnsSummary, "warnings">;

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
    // Formula cells come back as { formula, result } -- use the cached
  // result rather than re-evaluating (we don't have a calc engine here).
  if (typeof raw === "object" && "result" in (raw as any)) {
        const result = (raw as any).result;
        if (typeof result === "string" && result.startsWith("#")) {
                warnings.push(`"${label}" contains a formula error (${result}) in the source workbook`);
                return null;
        }
        return typeof result === "number" ? result : null;
  }
    if (typeof raw === "number") return raw;
    // Non-numeric value where a number was expected (e.g. someone typed
  // "TBD", or the model uses "n/a" for an inactive refi) -- flag it
  // rather than silently returning null.
  warnings.push(`"${label}" expected a number, found "${raw}"`);
    return null;
}

// ---------- IOS template ("Summary Table") ----------

const IOS_SHEET_NAME = "Summary Table";

const IOS_CELLS: Record<FieldKey, string> = {
    purchasePrice: "F7",
    allInCost: "F12",
    goingInYieldPct: "F14",
    stabilizedReturnOnCostPct: "F15",
    exitCapPct: "F16",
    marketRentPsfMo: "G18",
    holdPeriodYears: "G23",
    irrPct: "G24",
    equityMultiple: "G25",
    stabilizedCashOnCashPct: "G26",
};

function parseIosTemplate(sheet: ExcelJS.Worksheet): ReturnsSummary {
    const warnings: string[] = [];
    const summary = Object.fromEntries(
          Object.entries(IOS_CELLS).map(([key, addr]) => [
                  key,
                  readCellValue(sheet.getCell(addr), `${key} (${addr})`, warnings),
                ])
        ) as Omit<ReturnsSummary, "warnings">;
    return { ...summary, warnings };
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

export async function parseReturnsSummary(buffer: Buffer): Promise<ReturnsSummary> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

  const iosSheet = workbook.getWorksheet(IOS_SHEET_NAME);
    if (iosSheet) {
          return parseIosTemplate(iosSheet);
    }

  const industrialSheet = workbook.getWorksheet(INDUSTRIAL_SHEET_NAME);
    if (industrialSheet) {
          return parseIndustrialTemplate(industrialSheet);
    }

  throw new Error(
        `Didn't recognize this workbook's template. Expected either a "${IOS_SHEET_NAME}" tab (IOS models) ` +
          `or a "${INDUSTRIAL_SHEET_NAME}" tab (industrial models), and found neither. Check this file matches a standard template.`
      );
}
