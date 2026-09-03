// lib/comps/fromWorkbook.ts
//
// Flattens a dropped .xlsx/.csv into the delimited text the comp row parser
// expects, so a spreadsheet and a pasted email go through exactly one parser
// rather than two that drift apart.
//
// ExcelJS is already a dependency (it reads the underwriting models), so this
// costs nothing new.

import ExcelJS from "exceljs";

/** Cell -> text, resolving the shapes ExcelJS returns for formulas and links. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const v = value as any;
    // Formula cells carry a cached result; use it, since there's no calc engine.
    if ("result" in v) return v.result === null || v.result === undefined ? "" : String(v.result);
    if ("text" in v) return String(v.text); // hyperlink
    if ("richText" in v) return v.richText.map((r: any) => r.text).join("");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("error" in v) return ""; // #REF! etc -- treat as missing
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export interface WorkbookText {
  /** Pipe-delimited rows, ready for parseCompTable. */
  text: string;
  sheetNames: string[];
  warnings: string[];
}

/**
 * Every sheet is flattened and concatenated. Comp workbooks routinely put
 * sale comps on one tab and lease comps on another, and the row parser already
 * re-reads the header whenever it meets one -- so concatenating lets a
 * two-tab workbook come in as one paste, with each tab's type detected from
 * its own headers.
 */
export async function workbookToDelimitedText(buffer: Buffer, fileName = ""): Promise<WorkbookText> {
  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();

  if (/\.csv$/i.test(fileName)) {
    // CSV is read here rather than handed to the row parser, which splits on
    // tabs, pipes, and space runs but never commas -- an address like
    // "1000 Main St, Suite 4" makes comma-splitting unsafe without real quote
    // handling. Leading BOM stripped so the first header isn't "﻿Address".
    const csv = buffer.toString("utf8").replace(/^﻿/, "");
    const rows = parseCsv(csv);
    return {
      text: rows.map((r) => r.join(" | ")).join("\n"),
      sheetNames: ["csv"],
      warnings,
    };
  }

  try {
    await workbook.xlsx.load(buffer as any);
  } catch (err: any) {
    throw new Error(`Could not read that workbook: ${err.message}`);
  }

  const lines: string[] = [];
  const sheetNames: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheetNames.push(sheet.name);
    let rowsInSheet = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // row.values is 1-based with a leading hole; slice it off.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      for (const v of values) cells.push(cellText(v).trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (!cells.length) return;
      lines.push(cells.join(" | "));
      rowsInSheet++;
    });
    if (rowsInSheet === 0) warnings.push(`Sheet "${sheet.name}" was empty.`);
  }

  if (!lines.length) warnings.push("The workbook had no rows in any sheet.");
  return { text: lines.join("\n"), sheetNames, warnings };
}

/**
 * Minimal RFC 4180 CSV reader -- handles quoted fields containing commas,
 * newlines, and escaped quotes, which a naive split on "," does not. Comp
 * spreadsheets have addresses like "1000 Main St, Suite 4" in them.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
