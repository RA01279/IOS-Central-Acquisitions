// lib/comps/ai-read.ts
//
// Browser side: read comps out of free-form broker material -- an email body,
// a pasted table, PDF text -- with the comp-import agent on the Hopper helper.
// The agent only lays the transactions out under Hopper's standard column
// headers; the result then goes through the same deterministic parser as any
// paste (/api/comps/parse), so units, rent bases and dates are still handled
// in one tested place, and every row is reviewed before it is saved.

import { runAgent } from "../agent-client";
import { parseCompImport } from "../agents/comp-import";
import { htmlToDelimitedText } from "./parse";

export type CompSourcePart = { label: string | null; payload: Record<string, unknown> | null; warnings?: string[] };

/** Plain text for the agent: HTML tables keep their cell boundaries as tabs. */
export function readableText(html: string | null | undefined, text: string | null | undefined): string {
  const fromHtml = html ? htmlToDelimitedText(html) : "";
  return (fromHtml.trim().length >= (text ?? "").trim().length * 0.5 ? fromHtml : text ?? "").trim();
}

/**
 * Parts for the intake form from the agent's tables. Empty when the agent
 * found no executed leases or closed sales; its notes come back either way.
 */
export async function aiReadComps(
  material: string,
  opts: { label: string | null; sourceRef?: string | null; source?: string; alive?: () => boolean }
): Promise<{ parts: CompSourcePart[]; notes: string[] }> {
  const tables = parseCompImport(await runAgent("comp-import", material, { alive: opts.alive }));
  if (!tables) throw new Error("The helper's answer wasn't a comp table.");
  const warn = ["Read by the Hopper helper. Check each row against the source before saving.", ...tables.notes];
  const base = { ...(opts.source ? { source: opts.source } : {}), ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}) };
  const parts: CompSourcePart[] = [];
  if (tables.leases) parts.push({ label: opts.label, payload: { text: tables.leases, defaultCompType: "lease", ...base }, warnings: warn });
  if (tables.sales) parts.push({ label: opts.label, payload: { text: tables.sales, defaultCompType: "sale", ...base }, warnings: tables.leases ? [] : warn });
  return { parts, notes: tables.notes };
}
