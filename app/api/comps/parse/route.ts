// app/api/comps/parse/route.ts
// Turns a paste or a dropped file into candidate comps for review. Writes
// NOTHING -- the review step in the UI is what saves, via POST /api/comps.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseCompInput } from "@/lib/comps/parse";
import { workbookToDelimitedText } from "@/lib/comps/fromWorkbook";

export const dynamic = "force-dynamic";

// POST body:
//   { html?, text?, fileBase64?, fileName?, city?, market?, submarket? }
// html/text come from the clipboard (a paste carries both; HTML is preferred
// because it has real cell boundaries). fileBase64 is a dropped .xlsx/.csv.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const context = {
    city: body.city || null,
    market: body.market || null,
    submarket: body.submarket || null,
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
      const perSheet: { name: string; count: number; warnings: string[] }[] = [];
      for (const sheet of sheets) {
        // The tab's own name is the last word on comp type when the header
        // columns are ambiguous -- "Sale Comps" and "Lease Comps" are not
        // subtle. Header signals still win where they're decisive.
        const nameHint = /lease/i.test(sheet.name)
          ? ("lease" as const)
          : /sale|sold/i.test(sheet.name)
            ? ("sale" as const)
            : undefined;
        const parsed = parseCompInput(
          { text: sheet.text },
          { ...context, defaultCompType: nameHint }
        );
        for (const c of parsed.comps) comps.push({ ...c, sheet: sheet.name });
        perSheet.push({ name: sheet.name, count: parsed.comps.length, warnings: parsed.warnings });
      }

      const sheetWarnings = perSheet
        .filter((s) => s.count === 0)
        .map((s) => `Sheet "${s.name}": ${s.warnings[0] ?? "no comps found"}`);

      return NextResponse.json({
        comps,
        warnings: [...warnings, ...sheetWarnings],
        source: "excel",
        sheetNames,
        perSheet,
      });
    }

    if (!body.html && !body.text) {
      return NextResponse.json({ error: "Nothing pasted or dropped" }, { status: 400 });
    }

    const result = parseCompInput({ html: body.html, text: body.text }, context);
    return NextResponse.json({ ...result, source: body.html ? "email" : "manual" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
