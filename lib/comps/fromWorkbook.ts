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
    if ("result" in v) {
      const r = v.result;
      // A cached result can itself be an error object ({error:'#REF!'}) or a
      // Date. Neither survives String() usefully.
      if (r === null || r === undefined) out = "";
      else if (r instanceof Date) out = r.toISOString().slice(0, 10);
      else if (typeof r === "object" && "error" in (r as any)) out = "";
      else out = String(r);
    } else if ("error" in v) out = ""; // #REF! etc -- treat as missing
    // A formula with NO cached result at all. Excel stores one for every
    // formula it has calculated, so this means the formula has never
    // successfully evaluated -- the standard TX IOS template is full of
    // IFERROR(VLOOKUP(#REF!,...)) left behind by a deleted column. Without this
    // branch it fell through to String(object) and put the literal text
    // "[object Object]" in the cell: 14,791 of them in that one workbook, one
    // of which became a comp's street address.
    else if ("formula" in v || "sharedFormula" in v) out = "";
    else if ("text" in v) out = String(v.text); // hyperlink
    else if ("richText" in v) out = v.richText.map((r: any) => r.text).join("");
    else if (v instanceof Date) out = v.toISOString().slice(0, 10);
    else out = "";
  } else out = String(value);

  // Newlines INSIDE a cell must not survive. Broker headers routinely wrap --
  // "Type\n(N, R, EXP)", "Sprinkler\n(ESFR, Wet, or No)" -- and since rows are
  // flattened to one line of text each, an embedded newline splits a single
  // spreadsheet row into several text lines. The parser then matches a fragment
  // as the header row and every column maps to the wrong field: addresses came
  // out as "N" and "EXP" from the Type column.
  // And a PIPE inside a cell must not survive either, because the pipe is the
  // delimiter these rows are joined with. A free-text cell containing one
  // shatters into extra cells and shifts every column to its right.
  //
  // Found in the standard TX IOS template, where 35 of 282 comment cells
  // contain a pipe: those rows flattened to 36-39 cells against a 35-column
  // header, so Latitude read the Source string ("CBRE MLA - TX IOS Portfolio
  // Lease Comps 07.02.26") and Longitude read a latitude. Every field past
  // Comments was wrong on one row in eight, silently.
  //
  // Replaced with a slash rather than dropped, so a comment that used pipes to
  // separate clauses stays readable.
  return out
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SheetText {
  name: string;
  /** Pipe-delimited rows, ready for parseCompTable. */
  text: string;
  /** Rows the sheet contributed, for reporting what was skipped and why. */
  rows: number;
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
    return {
      text,
      sheets: [{ name: "csv", text, rows: rows.length }],
      sheetNames: ["csv"],
      warnings,
    };
  }

  try {
    await workbook.xlsx.load(buffer as any);
  } catch (err: any) {
    throw new Error(`Could not read that workbook: ${err.message}`);
  }

  const sheets: SheetText[] = [];
  const sheetNames: string[] = [];
  const hiddenSkipped: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheetNames.push(sheet.name);
    // Hidden tabs are the workbook's machinery, not its data. In the standard
    // TX IOS template five of the nine tabs are hidden, and one of them --
    // "Submarket Grouping", a 16,709-row market/submarket lookup -- carries a
    // header of Address | City | Submarket | Market | State | Region that reads
    // as a perfectly good comp table. Left in, it alone offered 16,698 comps
    // out of a file holding 282.
    if (sheet.state === "hidden" || sheet.state === "veryHidden") {
      hiddenSkipped.push(sheet.name);
      continue;
    }
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
    else sheets.push({ name: sheet.name, text: lines.join("\n"), rows: lines.length });
  }

  if (hiddenSkipped.length) {
    warnings.push(
      `Skipped ${hiddenSkipped.length} hidden tab${hiddenSkipped.length === 1 ? "" : "s"} ` +
        `(${hiddenSkipped.join(", ")}) — hidden tabs are a workbook's lookups and charts, not its comps.`
    );
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
