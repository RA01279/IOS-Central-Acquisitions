import { createHash } from "node:crypto";
import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const helperTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const helperJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function cleanupHelperJobs(db: ReturnType<typeof getServiceClient>) {
  const { error } = await db.from("outlook_helper_jobs").delete().lt("expires_at", new Date().toISOString());
  if (error) throw new Error("Could not clean up expired email imports.");
}
export function validInput(kind: unknown, input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  if (kind === "search") return typeof input.query === "string" && input.query.length <= 200 &&
    Number.isInteger(input.fromIndex) && input.fromIndex >= 0 && input.fromIndex <= 10000;
  if (kind === "fetch" || kind === "fetch_om") return typeof input.messageId === "string" && input.messageId.length > 0 &&
    input.messageId.length <= 4096 && typeof input.searchJobId === "string";
  return false;
}
/** Storage paths for imported OMs: imports/<owner hash>/<file>.pdf */
export const IMPORT_PATH = /^imports\/[0-9a-f]{16}\/[A-Za-z0-9._-]+\.pdf$/;
export const importOwnerDir = (email: string) => `imports/${helperTokenHash(email.toLowerCase()).slice(0, 16)}`;

export function safeResult(kind: string, result: any) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid email result.");
  if (kind === "search") {
    if (!Array.isArray(result.messages) || result.messages.length > 20) throw new Error("Invalid search results.");
    return {
      messages: result.messages.map((m: any) => {
        if (!m || typeof m.id !== "string" || !m.id || m.id.length > 4096) throw new Error("Invalid email identifier.");
        return { id: m.id, subject: String(m.subject || "").slice(0, 1000),
          sender: String(m.sender || "").slice(0, 500), receivedAt: String(m.receivedAt || "").slice(0, 100),
          preview: String(m.preview || "").slice(0, 1500), hasAttachments: m.hasAttachments === true };
      }),
      nextFromIndex: Number.isInteger(result.nextFromIndex) && result.nextFromIndex >= 0 && result.nextFromIndex <= 10000 ? result.nextFromIndex : null,
    };
  }
  if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 1_000_000)
    throw new Error("Email body is empty or exceeds 1 MB.");
  // fetch_om also carries the PDF attachments the helper uploaded to storage.
  // Paths must be ones /api/outlook-helper/upload issued (imports/ prefix).
  const attachments = kind === "fetch_om" && Array.isArray(result.attachments)
    ? result.attachments.slice(0, 3).filter((a: any) => a && typeof a.path === "string" && IMPORT_PATH.test(a.path))
        .map((a: any) => ({ path: a.path, name: String(a.name || "attachment.pdf").slice(0, 200), size: Number(a.size) || 0 }))
    : undefined;
  return { text: result.text, html: typeof result.html === "string" && result.html.length <= 1_000_000 ? result.html : undefined,
    source: "email", sourceRef: String(result.sourceRef || "").slice(0, 12000),
    emailHasAttachments: result.emailHasAttachments === true, ...(attachments ? { attachments } : {}) };
}
