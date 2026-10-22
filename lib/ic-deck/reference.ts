import PizZip from "pizzip";
import type { Narrative, NarrativeKey } from "../agents/ic-narrative";

export const REFERENCE_EXHIBIT_SLIDES = [3, 4, 5, 6, 7, 12, 13, 14, 15, 21, 22, 24];
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function referenceText(zip: PizZip, number: number) {
  return [...(zip.file(`ppt/slides/slide${number}.xml`)?.asText() ?? "").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m => decode(m[1])).join(" ");
}

export function referenceBudget(zip: PizZip) {
  const xml = zip.file("ppt/slides/slide24.xml")?.asText() ?? "";
  const rows = [...xml.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map(row =>
    [...row[0].matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)].map(cell =>
      [...cell[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(t => decode(t[1])).join("").trim()).filter(Boolean));
  const amount = (row: string[] | undefined) => {
    const text = row?.[row.length - 1]?.replace(/[$,\s]/g, "") ?? "";
    return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  };
  return { deposit: amount(rows.find(row => /^refundable deposit$/i.test(row[0]))), total: amount(rows.filter(row => /^total$/i.test(row[0])).pop()) };
}

export function referenceNarrative(zip: PizZip, name: string): Narrative {
  const paragraphs = [...(zip.file("ppt/slides/slide2.xml")?.asText() ?? "").matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
    .map(m => [...m[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(t => decode(t[1])).join("").trim());
  const labels: Record<string, NarrativeKey | null> = { "Location Highlights": "locationHighlights", "Zoning": "zoning", "Business Plan": null, "Underwriting Assumptions": null, "Site Overview": null };
  const sections = Object.fromEntries(["locationHighlights", "zoning", "tenant", "market"].map(k => [k, { bullets: [] as string[], sources: [`Analyst source deck: ${name}; retained source text, not newly researched.`], unverified: [] as string[] }])) as Narrative["sections"];
  let key: NarrativeKey | null = null;
  for (const paragraph of paragraphs) {
    if (paragraph in labels) { key = labels[paragraph]; continue; }
    if (key && paragraph && paragraph.length <= 600 && sections[key].bullets.length < 2) sections[key].bullets.push(paragraph);
  }
  return { version: "ic-narrative-v1", sections };
}

/** Exhibits may be reused only for the subject explicitly identified on the cover. */
export function validateReference(bytes: Uint8Array, address: string): PizZip {
  let zip: PizZip;
  try { zip = new PizZip(bytes); } catch { throw new Error("The source deck is not a readable PowerPoint."); }
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = normalize(address);
  if (key.length < 8 || !normalize(referenceText(zip, 1)).includes(key)) throw new Error("The source deck cover does not match this property's address. Choose the executive summary for this deal.");
  const count = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  if (count !== 24 || !/tenant overview/i.test(referenceText(zip, 7)) || !/diligence budget/i.test(referenceText(zip, 24))) throw new Error("Use the 24-slide Aldine executive-summary format for source exhibits.");
  return zip;
}
