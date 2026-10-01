// lib/ic-deck/xlsx-lite.ts
//
// Reads the cached values Excel saved in an .xlsx/.xlsm -- what the model
// showed when it was last calculated -- without evaluating a single formula.
// That's the point: the deck must say exactly what the approved model says.
// Runs in the browser, so the workbook itself never leaves the analyst's PC;
// only the handful of extracted figures are sent to Hopper.
//
// Deliberately small: sheets are parsed lazily and only when asked for, which
// matters because these models carry a 300-column monthly cash flow tab.

import PizZip from "pizzip";

export type CellValue = string | number | boolean | null;

export interface Sheet {
  name: string;
  hidden: boolean;
  /** Cached value at an A1 address, or null. */
  get(address: string): CellValue;
  at(row: number, col: number): CellValue;
  /** Every non-empty cell, row-major. */
  cells(): Array<{ row: number; col: number; value: CellValue }>;
}

export interface Workbook {
  sheetNames: string[];
  sheet(name: string): Sheet | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
// Concatenate every <t> run -- rich text splits one string across several.
const textRuns = (xml: string) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

export function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numberToCol(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function splitAddress(address: string): [number, number] {
  const m = address.match(/^([A-Z]+)(\d+)$/i);
  if (!m) throw new Error(`Bad cell address ${address}`);
  return [Number(m[2]), colToNumber(m[1])];
}

export function openWorkbook(data: ArrayBuffer | Uint8Array): Workbook {
  const zip = new PizZip(data as any);
  const read = (path: string) => zip.file(path)?.asText() ?? null;
  const workbookXml = read("xl/workbook.xml");
  if (!workbookXml) throw new Error("This isn't an Excel workbook (.xlsx or .xlsm).");
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id"), target = attr(m[1], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, ""));
  }
  const sharedXml = read("xl/sharedStrings.xml") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    // Phonetic runs (<rPh>) are reading aids, not part of the string.
    textRuns(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));

  const entries = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: decode(attr(m[1], "name") ?? ""),
    hidden: (attr(m[1], "state") ?? "visible") !== "visible",
    path: targets.get(attr(m[1], "r:id") ?? "") ?? null,
  }));
  const cache = new Map<string, Sheet>();

  function parse(entry: (typeof entries)[number]): Sheet {
    const xml = entry.path ? read(entry.path) : null;
    if (!xml) throw new Error(`The "${entry.name}" sheet is missing from the workbook.`);
    const values = new Map<number, Map<number, CellValue>>();
    const data = xml.slice(xml.indexOf("<sheetData"), xml.lastIndexOf("</sheetData>"));
    for (const m of data.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(m[1], "r");
      if (!ref) continue;
      const type = attr(m[1], "t") ?? "n";
      const inner = m[2] ?? "";
      // <v xml:space="preserve"> is common on formula strings with padding.
      const raw = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
      let value: CellValue = null;
      if (type === "inlineStr") value = textRuns(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (raw === undefined) continue;
      else if (type === "s") value = shared[Number(raw)] ?? null;
      else if (type === "str") value = decode(raw);
      else if (type === "b") value = raw === "1";
      else if (type === "e") value = null; // #REF!, #N/A ... are absent, not zero
      else { const n = Number(raw); value = Number.isFinite(n) ? n : null; }
      if (value === null || value === "") continue;
      const [row, col] = splitAddress(ref);
      if (!values.has(row)) values.set(row, new Map());
      values.get(row)!.set(col, value);
    }
    const at = (row: number, col: number) => values.get(row)?.get(col) ?? null;
    let ordered: Array<{ row: number; col: number; value: CellValue }> | null = null;
    return {
      name: entry.name,
      hidden: entry.hidden,
      at,
      get: (address) => at(...splitAddress(address)),
      cells: () => (ordered ??= [...values.entries()].sort((a, b) => a[0] - b[0]).flatMap(([row, cols]) =>
        [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([col, value]) => ({ row, col, value })))),
    };
  }

  return {
    sheetNames: entries.map((e) => e.name),
    sheet(name) {
      const entry = entries.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!entry) return null;
      if (!cache.has(entry.name)) cache.set(entry.name, parse(entry));
      return cache.get(entry.name)!;
    },
  };
}

/** Excel serial date (1900 system), or a typed m/d/yyyy string, to YYYY-MM-DD. */
export function excelDate(value: CellValue): string | null {
  if (typeof value === "string") {
    // Models often carry lease dates typed as text rather than real dates.
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof value !== "number" || value < 20000 || value > 80000) return null;
  const ms = Math.round((value - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
