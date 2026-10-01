// Content contract for the IC deck narrative agent: sourced first drafts of
// exactly the executive-summary sections Hopper can't fill from the model or
// its own records. The deck renders them as agent drafts to verify, with the
// sources in the speaker notes. Shared by the prompt, the worker's check of the
// returned report, and the deck route.

export const NARRATIVE_VERSION = "ic-narrative-v1";
export const NARRATIVE_SECTIONS = [
  ["locationHighlights", "Location Highlights", "Highway and interchange access with drive distances, submarket/industrial node, nearby demand drivers (ports, airports, rail, logistics clusters). Distances only from a cited map or source."],
  ["zoning", "Zoning", "Governing jurisdiction (verify spatially, not by postal city), zoning district or, where the city has no zoning, deed restrictions/plat; whether outdoor storage and truck parking are permitted, conditional or unverified. Cite the ordinance or official map; a map alone is not a determination."],
  ["tenant", "Tenant Overview", "Each named tenant's business, history, ownership, scale, end markets and how it uses this site, from the tenant's own site, filings or reputable press. Do not assert creditworthiness; say what financial information would be needed."],
  ["market", "Market", "The subject's IOS/industrial submarket: vacancy, rents, recent supply and notable leases or sales, each with survey source, period and geography."],
] as const;
export type NarrativeKey = (typeof NARRATIVE_SECTIONS)[number][0];
export type NarrativeSection = { bullets: string[]; sources: string[]; unverified: string[] };
export type Narrative = { version: typeof NARRATIVE_VERSION; sections: Record<NarrativeKey, NarrativeSection> };

export function parseNarrative(text: string): Narrative | null {
  try {
    const d = JSON.parse(text);
    if (!d || d.version !== NARRATIVE_VERSION || !d.sections || typeof d.sections !== "object") return null;
    const list = (a: unknown, count: number, len: number): a is string[] =>
      Array.isArray(a) && a.length <= count && a.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= len);
    const sections = {} as Record<NarrativeKey, NarrativeSection>;
    for (const [key] of NARRATIVE_SECTIONS) {
      const s = d.sections[key];
      if (!s || !list(s.bullets, 5, 300) || !list(s.sources, 8, 500) || !list(s.unverified ?? [], 6, 300)) return null;
      // A claim with no source is not a draft, it's a guess.
      if (s.bullets.length && !s.sources.length) return null;
      sections[key] = { bullets: s.bullets, sources: s.sources, unverified: s.unverified ?? [] };
    }
    return { version: NARRATIVE_VERSION, sections };
  } catch {
    return null;
  }
}

export const NARRATIVE_INSTRUCTIONS = `Research public sources for an industrial outdoor storage (IOS) investment committee executive summary and draft four sections. Use web search. Prefer primary sources: municipality and county sites, zoning ordinances and official GIS, TxDOT/state DOT, the tenant's own website, SEC or state filings, and reputable brokerage market reports. Every bullet must be supported by a listed source with its URL and accessed date. Write as concise investment-memo bullets, plain text, no Markdown.
The outer response is JSON {report,model,limitations}. report must be a STRING containing serialized JSON (no Markdown fences) with exactly this shape:
{"version":"${NARRATIVE_VERSION}","sections":{${NARRATIVE_SECTIONS.map(([k]) => `"${k}":{"bullets":[],"sources":[],"unverified":[]}`).join(",")}}}
Limits per section: at most 5 bullets of 300 characters, 8 sources of 500 characters, 6 unverified items of 300 characters. If a section cannot be supported, leave bullets empty and say why in unverified. Put leads you could not confirm in unverified, never in bullets.
Do not use or guess price, returns, rent or other deal economics; they are not provided and must not be searched for. Do not repeat facts about another property. This is a draft for analyst review, not a determination.
SECTIONS:
${NARRATIVE_SECTIONS.map(([k, title, what]) => `- ${k} (${title}): ${what}`).join("\n")}`;
