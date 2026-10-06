// lib/pdf-text.ts
//
// CLIENT ONLY. Pull the text out of a PDF in the browser with pdf.js, so an
// OM's contents reach the deal-import agent without a server round trip.
// Scanned OMs (images, no text layer) come back nearly empty; the caller
// tells the user rather than sending the agent nothing.
//
// The worker is served from /public. Keep public/pdf.worker.min.mjs in step
// with the pdfjs-dist version in package.json (copy it from
// node_modules/pdfjs-dist/build/ after an upgrade).

export interface PdfText {
  text: string;
  pages: number;
  /** Too little text to be a real text-layer PDF. */
  scanned: boolean;
}

const MAX_CHARS = 60000;

export async function pdfText(data: ArrayBuffer, maxChars = MAX_CHARS): Promise<PdfText> {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  let text = "";
  // OMs put the facts (address, acreage, price, broker) up front; cap the
  // pages read so a 90-page OM doesn't blow the agent's input budget.
  const pages = Math.min(doc.numPages, 40);
  for (let i = 1; i <= pages && text.length < maxChars; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim();
    if (line) text += `\n[Page ${i}] ${line}`;
  }
  await doc.destroy();
  text = text.slice(0, maxChars);
  return { text, pages: doc.numPages, scanned: text.replace(/\[Page \d+\]/g, "").trim().length < 200 };
}
