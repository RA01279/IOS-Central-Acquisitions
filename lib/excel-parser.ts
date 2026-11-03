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
    // Formula cells come back as { formula, result } -- use the cached
  // result rather than re-evaluating (we don't have a calc engine here).
  if (typeof raw === "object" && "result" in (raw as any)) {
        const result = (raw as any).result;
        if (result && typeof result === "object" && "error" in result) {
          warnings.push(`"${label}" contains a formula error (${result.error}) in the source workbook`);
          return null;
        }
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

function parseIosTemplate(sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook): ReturnsSummary {
    const warnings: string[] = [];
    const summary = Object.fromEntries(
          Object.entries(IOS_CELLS).map(([key, addr]) => [
                  key,
                  readCellValue(sheet.getCell(addr), `${key} (${addr})`, warnings),
                ])
        ) as Pick<ReturnsSummary, FieldKey>;
    // Summary Table G18 is linked to a market rate whose period can be annual,
    // despite the template's fixed "Mo." caption. Read the actual MLA basis.
    const rawBasis = workbook.getWorksheet("Market Leasing Summary")?.getCell("D17").value;
    const basis = typeof rawBasis === "object" && rawBasis && "result" in rawBasis ? String(rawBasis.result ?? "") : String(rawBasis ?? "");
    const key = basis.toLowerCase().replace(/[^a-z]/g, "");
    if (summary.marketRentPsfMo !== null) {
      if (/^(?:dollars)?sfyear$|^sfyr$/.test(key)) summary.marketRentPsfMo /= 12;
      else if (!/^(?:dollars)?sfmonth$|^sfmo$/.test(key)) {
        summary.marketRentPsfMo = null;
        warnings.push("Market rent units are unverified: Market Leasing Summary D17 must state $/SF/month or $/SF/year. G18's fixed caption alone is insufficient.");
      }
    }
    const identity = workbook.getWorksheet("Pro Forma")?.getCell("F15").value;
    const sourceProperty = typeof identity === "string" ? identity.trim() : null;
    warnings.push("Workbook returns are cached source values; Hopper does not recalculate Excel formulas. Verify workbook identity and recalculate/save in Excel before relying on them.");
    const text = (addr: string) => { const v:any=sheet.getCell(addr).value; return typeof v==="string"?v:typeof v?.result==="string"?v.result:null; };
    return { ...summary, sourceProperty, sourceIdentity: { address: text("C8") ?? sourceProperty, city: text("C9"), acres:readCellValue(sheet.getCell("C10"),"Identity acres",warnings), buildingSf:readCellValue(sheet.getCell("C12"),"Identity building SF",warnings) }, marketRentSourceBasis: basis || null, warnings };
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
    if (iosSheet) {
          const result = parseIosTemplate(iosSheet, workbook);
          // A conflicting street number is definite evidence of an identity
          // problem, not something the upload filename can override.
          const sourceNumber = result.sourceProperty?.match(/^\d+(?:-\d+)?\b/)?.[0];
          const expectedNumber = expectedProperty?.match(/^\d+(?:-\d+)?\b/)?.[0];
          if (sourceNumber && expectedNumber && sourceNumber !== expectedNumber) result.warnings.push(`Detected identity discrepancy: workbook ${result.sourceProperty}; deal ${expectedProperty}. Review before using this source; this does not confirm a wrong upload.`);
          if (!result.sourceProperty) result.warnings.push("No internal workbook property identity was found at Pro Forma F15.");
          return result;
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
