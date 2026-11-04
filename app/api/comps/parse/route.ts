// app/api/comps/parse/route.ts
// Turns a paste or a dropped file into candidate comps for review. Writes
// NOTHING -- the review step in the UI is what saves, via POST /api/comps.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { asPropertyReport, assessSheet, parseCompInput } from "@/lib/comps/parse";
import { workbookToDelimitedText } from "@/lib/comps/fromWorkbook";
import { pdfSaleTables } from "@/lib/comps/fromPdf";
import { groupPortfolioSales, applyPortfolioHints } from "@/lib/comps/portfolios";

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

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected an object" }, { status: 400 });
  for (const field of ["html", "text"]) {
    if (body[field] != null && (typeof body[field] !== "string" || body[field].length > 1_000_000)) {
      return NextResponse.json({ error: "Email text must be a string no larger than 1 MB." }, { status: 400 });
    }
  }
  const term = Number(body.assumedTermMonths);
  const context = {
    city: body.city || null,
    state: body.state || null,
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
      if (/\.pdf$/i.test(fileName)) {
        if(buffer.length>20*1024*1024) return NextResponse.json({error:'PDF exceeds 20 MB.'},{status:400});
        const pdf=await pdfSaleTables(buffer);
        if(!pdf.rows.length)return NextResponse.json({requiresHelper:true,comps:[],warnings:['No supported sale grid found. Use the OM/helper reader for this layout.']});
        const parsed=parseCompInput({text:pdf.text},{...context,defaultCompType:'sale'});
        if(parsed.comps.length!==pdf.rows.length)throw Error('PDF row reconciliation failed. Review the original before importing.');
        const sourceRows=parsed.comps.map((c,i)=>{
          const row=pdf.rows[i],metrics=row.sourceMetrics,warnings=[...c.warnings];
          const quotedCap=metrics['Going In Cap Rate'].match(/^([\d.]+)%\*?$/);
          if(metrics['Going In Cap Rate'].includes('*'))warnings.push('Going-in cap rate has a source footnote. Return-on-cost and mark-to-market figures remain separate quoted evidence.');
          for(const match of (c.notes??'').matchAll(/([\d.]+)%\s*(?:FAR|coverage)/gi))if(c.coveragePct!=null&&Math.abs(Number(match[1])/100-c.coveragePct)>.0001)warnings.push(`Table coverage (${(c.coveragePct*100).toFixed(2)}%) differs from narrative (${match[1]}%). Both are retained for review.`);
          return {...c,capRate:quotedCap?Number(quotedCap[1])/100:c.capRate,warnings,sourcePage:row.page,sourceRow:row.sourceRow,originalAddress:row.originalAddress,sourceMetrics:metrics,sourceRef:body.sourceRef||fileName,assetClass:body.assetClass||(/\bIOS\b/i.test(`${c.projectName} ${c.notes}`)?'ios':'industrial'),notes:[c.notes,`Source page ${row.page}, row ${row.sourceRow}.`,...Object.entries(metrics).map(([k,v])=>`${k}: ${v}`)].filter(Boolean).join('\n')};
        });
        const comps=groupPortfolioSales(sourceRows);
        return NextResponse.json({comps,source:'import',sourceRows:pdf.rows.length,warnings:[`Read ${pdf.rows.length} source rows as ${comps.length} transactions. Component rows are linked properties, not additional transactions.`,...parsed.warnings]});
      }
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
          { ...context, defaultCompType: nameHint, sourceRows: sheet.sourceRows }
        );
        const asProperties = asPropertyReport(parsed.comps);
        if (asProperties) {
          for (const p of asProperties) properties.push({ ...p, sheet: sheet.name });
          perSheet.push({ name: sheet.name, count: 0, warnings: [], propertyReport: true });
          continue;
        }
        for (const c of groupPortfolioSales(parsed.comps)) comps.push({ ...c, sheet: sheet.name });
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

    // A table from the comp-import agent arrives as leases or sales already.
    const hint = body.defaultCompType === "lease" || body.defaultCompType === "sale" ? body.defaultCompType : undefined;
    const parsedResult = parseCompInput({ html: body.html, text: body.text }, { ...context, defaultCompType: hint });
    const result = {...parsedResult,comps:groupPortfolioSales(applyPortfolioHints(parsedResult.comps,body.portfolioHints))};
    if (body.source === "email") {
      const sourceRef = typeof body.sourceRef === "string" ? body.sourceRef.slice(0, 12000) : null;
      for (const comp of result.comps) comp.sourceRef = sourceRef || comp.sourceRef;
      result.warnings.push("Review the full email against these rows. Unsupported wording may not produce a comp; add any missing transactions manually.");
      if (body.emailHasAttachments && !body.attachmentsRead) result.warnings.push("This email has attachments. Only its body was read; upload any comp spreadsheets separately.");
    }
    // Comps read out of an OM keep the OM as their source.
    if (body.source === "import" && typeof body.sourceRef === "string") {
      for (const comp of result.comps) comp.sourceRef = body.sourceRef.slice(0, 12000);
    }
    const sourceOut = body.source === "import" ? "import" : body.source === "email" || body.html ? "email" : "manual";
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
        source: sourceOut,
      });
    }
    return NextResponse.json({ ...result, properties: [], source: sourceOut });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
