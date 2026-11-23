// lib/pdf-images.ts
//
// CLIENT ONLY. Render a PDF's pages to JPEGs in the browser, for a PDF with no
// text layer (scanned, or text converted to outlines), and upload them for the
// Hopper helper to read by sight (lib/agents/images.ts).

import { getSupabaseBrowserClient } from "./supabase-browser";

/** Long side about 2000 px: small print in a comp grid stays legible. */
const TARGET_PX = 2000;

export async function pdfPageImages(data: ArrayBuffer, maxPages = 12): Promise<{ blobs: Blob[]; pages: number }> {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  try {
    const blobs: Blob[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, TARGET_PX / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render a page."))), "image/jpeg", 0.88)));
      page.cleanup();
    }
    return { blobs, pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

/** Upload rendered pages; returns their storage paths, in page order. */
export async function uploadPageImages(blobs: Blob[]): Promise<string[]> {
  const res = await fetch("/api/agents/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: blobs.length }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Could not start the page upload.");
  const storage = getSupabaseBrowserClient().storage.from("documents");
  await Promise.all(body.slots.map(async (slot: { path: string; token: string }, i: number) => {
    const { error } = await storage.uploadToSignedUrl(slot.path, slot.token, blobs[i], { contentType: "image/jpeg" });
    if (error) throw new Error("A page image didn't upload. Try again.");
  }));
  return body.paths;
}
