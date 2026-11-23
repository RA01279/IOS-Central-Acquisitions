// lib/agents/images.ts
//
// Page images for a helper read. Some broker PDFs have no text layer -- the
// page is a picture, or the designer converted the text to outlines (the
// Elmwood "Savannah IOS Sale Comparables" sheet) -- so there is nothing for a
// text reader to read. The browser renders those pages to JPEGs and uploads
// them (POST /api/agents/images); the run records their paths in meta.images;
// the worker hands the helper short-lived links; the helper attaches the
// images to its Codex run.

/** Agents that read documents, and so may be given page images. */
export const IMAGE_AGENTS = ["comp-import", "deal-import", "portfolio-import", "market-report"] as const;
export const MAX_AGENT_IMAGES = 12;
const PATH = /^agent-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/page-\d{1,2}\.jpg$/;

/** The upload folder's paths, or null when they aren't ones this server hands out. */
export function validImagePaths(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_AGENT_IMAGES) return null;
  if (!v.every((p) => typeof p === "string" && PATH.test(p))) return null;
  const folders = new Set(v.map((p: string) => p.slice(0, p.lastIndexOf("/"))));
  return folders.size === 1 && new Set(v).size === v.length ? (v as string[]) : null;
}

export function imagePaths(folder: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `agent-images/${folder}/page-${i + 1}.jpg`);
}
