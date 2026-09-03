// app/api/comps/parse/route.ts
// Turns a paste or a dropped file into candidate comps for review. Writes
// NOTHING -- the review step in the UI is what saves, via POST /api/comps.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { asPropertyReport, assessSheet, parseCompInput } from "@/lib/comps/parse";
import { workbookToDelimitedText } from "@/lib/comps/fromWorkbook";

export const dynamic = "force-dynamic";

// POST body:
//   { html?, text?, fileBase64?, fileName?,
//     city?, market?, submarket?, address?, assumedTermMonths? }
// html/text come from the clipboard (a paste carries both; HTML is preferred
// because it has real cell boundaries). fileBase64 is a dropped .xlsx/.csv.
//
// address and assumedTermMonths exist for rent rolls. A roll's rows are suites
// in ONE building, so the address lives in the title block rather than in a
// column, and the rows carry a lease expiration with no commencement and no
// term -- so the start date has to be backed into from a typical term. Both are
// caller-supplied because both are facts about the building rather than
// anything the table states.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const term = Number(body.assumedTermMonths);
  const context = {
    city: body.city || null,
    market: body.market || null,
    submarket: body.submarket || null,
    address: body.address || null,
    // Bounded so a typo can't produce a commencement date in the 1800s or one
    // after the expiration it was derived from.
    assumedTermMonths:
      Number.isFinite(term) && term > 0 && term <= 480 ? Math.round(term) : null,
  };

  try {
    if (body.fileBase64) {
      const buffer = Buffer.from(String(body.fileBase64), "base64");
      const fileName = String(body.fileName ?? "");
      if (!/\.(xlsx|xlsm|csv)$/i.test(fileName)) {
        return NextResponse.json(
          { error: `Can't read "${fileName}". Drop an .xlsx, .xlsm or .csv, or paste the table instead.` },
          { status: 400 }
        );
      }
      const { sheets, sheetNames, warnings } = await workbookToDelimitedText(buffer, fileName);

      // Parsed per sheet, not as one concatenated blob. Tabs are frequently
      // different datasets -- the real Conroe workbook has two tabs of Conroe
      // comps and one of Houston Southwest comps from four years earlier -- so
      // each comp is tagged with the tab it came from and the reviewer can
      // exclude a whole sheet that doesn't belong.
      const comps: any[] = [];
      // Buildings from a property report: not comps, but the address/market a
      // rent roll can't supply for itself.
      const properties: any[] = [];
      const perSheet: {
        name: string;
        count: number;
        warnings: string[];
        propertyReport?: boolean;
      }[] = [];
      // Which tabs are comps at all. A real comp workbook has more than one
      // (the Conroe file has a sale tab and a lease tab, both genuine), so this
      // filters rather than picks -- and every exclusion is reported with its
      // reason instead of quietly narrowing the import.
      const assessed = sheets.map((s) => assessSheet(s.name, s.text));
      const usable = sheets.filter((_, i) => assessed[i].include);
      const excluded = assessed.filter((a) => !a.include);

      for (const sheet of usable) {
        // The tab's own name is the last word on comp type when the header
        // columns are ambiguous -- "Sale Comps" and "Lease Comps" are not
        // subtle. Header signals still win where they're decisive.
        // A rent roll is a table of leases, and says so on the tab -- but it
        // never contains the word "lease" except inside "Lease Expiration",
        // which is a date column rather than a type signal.
        const nameHint = /lease|rent\s*roll|tenancy|stacking/i.test(sheet.name)
          ? ("lease" as const)
          : /sale|sold/i.test(sheet.name)
            ? ("sale" as const)
            : undefined;
        const parsed = parseCompInput(
          { text: sheet.text },
          { ...context, defaultCompType: nameHint }
        );
        const asProperties = asPropertyReport(parsed.comps);
        if (asProperties) {
          for (const p of asProperties) properties.push({ ...p, sheet: sheet.name });
          perSheet.push({ name: sheet.name, count: 0, warnings: [], propertyReport: true });
          continue;
        }
        for (const c of parsed.comps) comps.push({ ...c, sheet: sheet.name });
        perSheet.push({ name: sheet.name, count: parsed.comps.length, warnings: parsed.warnings });
      }

      const sheetWarnings = perSheet
        .filter((s) => s.count === 0 && !s.propertyReport)
        .map((s) => `Sheet "${s.name}": ${s.warnings[0] ?? "no comps found"}`);

      // A file that is ONLY a property report isn't a failure -- say what it is
      // and what it's good for, rather than "no comps found".
      if (properties.length && !comps.length) {
        sheetWarnings.push(
          `This is a property report, not a comp table — no rents and no closed sales in it. ` +
            `Its ${properties.length} building${properties.length === 1 ? "" : "s"} can fill in the ` +
            `address and market for a rent roll instead; pick one below.`
        );
      }

      // Naming the tabs that were left out, and why. A workbook with nine tabs
      // where only one holds comps should say so out loud -- silently reading
      // one of nine looks identical to silently reading the wrong one.
      const excludedWarnings = excluded.map((a) => `Skipped tab "${a.name}": ${a.skipped}.`);
      if (usable.length && excluded.length) {
        excludedWarnings.unshift(
          `Read ${usable.length} of ${sheets.length} visible tab${sheets.length === 1 ? "" : "s"}: ` +
            usable.map((s) => `"${s.name}"`).join(", ") + "."
        );
      }
      if (!usable.length && sheets.length) {
        excludedWarnings.unshift(
          `None of the ${sheets.length} visible tabs read as a comp table. A comp table needs a ` +
            `header row with an address and a rent or price column.`
        );
      }

      return NextResponse.json({
        comps,
        properties,
        warnings: [...warnings, ...excludedWarnings, ...sheetWarnings],
        source: "excel",
        sheetNames,
        perSheet,
        tabs: assessed,
      });
    }

    if (!body.html && !body.text) {
      return NextResponse.json({ error: "Nothing pasted or dropped" }, { status: 400 });
    }

    const result = parseCompInput({ html: body.html, text: body.text }, context);
    // A pasted property report gets the same treatment as a dropped one.
    const asProperties = asPropertyReport(result.comps);
    if (asProperties) {
      return NextResponse.json({
        comps: [],
        properties: asProperties,
        warnings: [
          ...result.warnings,
          `That's a property report, not a comp table — no rents and no closed sales in it. ` +
            `Its ${asProperties.length} building${asProperties.length === 1 ? "" : "s"} can fill in ` +
            `the address and market for a rent roll instead; pick one below.`,
        ],
        source: body.html ? "email" : "manual",
      });
    }
    return NextResponse.json({ ...result, properties: [], source: body.html ? "email" : "manual" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
