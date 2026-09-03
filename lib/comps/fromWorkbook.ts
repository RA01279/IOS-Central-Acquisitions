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
  let out: string;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) out = value.toISOString().slice(0, 10);
  else if (typeof value === "object") {
    const v = value as any;
    // Formula cells carry a cached result; use it, since there's no calc engine.
    if ("result" in v) out = v.result === null || v.result === undefined ? "" : String(v.result);
    else if ("error" in v) out = ""; // #REF! etc -- treat as missing
    else if ("text" in v) out = String(v.text); // hyperlink
    else if ("richText" in v) out = v.richText.map((r: any) => r.text).join("");
    else if (v instanceof Date) out = v.toISOString().slice(0, 10);
    else out = String(v);
  } else out = String(value);

  // Newlines INSIDE a cell must not survive. Broker headers routinely wrap --
  // "Type\n(N, R, EXP)", "Sprinkler\n(ESFR, Wet, or No)" -- and since rows are
  // flattened to one line of text each, an embedded newline splits a single
  // spreadsheet row into several text lines. The parser then matches a fragment
  // as the header row and every column maps to the wrong field: addresses came
  // out as "N" and "EXP" from the Type column.
  return out.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface SheetText {
  name: string;
  /** Pipe-delimited rows, ready for parseCompTable. */
  text: string;
}

export interface WorkbookText {
  /** All sheets concatenated. Kept for callers that don't care about tabs. */
  text: string;
  /**
   * Per sheet, because tabs are not always the same dataset. The real Conroe
   * workbook has three: two tabs of Conroe comps and one of Houston Southwest
   * rear-load comps from four years earlier. Importing all of them under one
   * market/city would file the Southwest data as Conroe.
   */
  sheets: SheetText[];
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
    const text = rows.map((r) => r.join(" | ")).join("\n");
    return { text, sheets: [{ name: "csv", text }], sheetNames: ["csv"], warnings };
  }

  try {
    await workbook.xlsx.load(buffer as any);
  } catch (err: any) {
    throw new Error(`Could not read that workbook: ${err.message}`);
  }

  const sheets: SheetText[] = [];
  const sheetNames: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheetNames.push(sheet.name);
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // row.values is 1-based with a leading hole; slice it off.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      for (const v of values) cells.push(cellText(v));
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (!cells.length) return;
      lines.push(cells.join(" | "));
    });
    if (lines.length === 0) warnings.push(`Sheet "${sheet.name}" was empty.`);
    else sheets.push({ name: sheet.name, text: lines.join("\n") });
  }

  if (!sheets.length) warnings.push("The workbook had no rows in any sheet.");
  return {
    text: sheets.map((s) => s.text).join("\n"),
    sheets,
    sheetNames,
    warnings,
  };
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
