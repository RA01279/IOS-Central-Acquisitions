// scripts/outlook-helper/om.mjs
//
// fetch_om: read one email for New Deal > Import -- the body plus up to three
// PDF attachments (largest first, the OM is rarely the smallest file). Each
// PDF is downloaded from the connector's short-lived link and uploaded
// straight into Hopper storage through a one-time slot, so the file never sits
// on disk here. Nothing in the mailbox is changed.
import { emailResult } from "./codex.mjs";

const MAX_PDFS = 3;
const MAX_BYTES = 40 * 1024 * 1024;

export async function fetchOm(connection, job, requestUploadSlot) {
  const messageId = job.input.messageId;
  const message = await connection.call("fetch_message", { message_id: messageId });
  let email;
  try { email = emailResult(message); }
  catch { email = { text: String(message.subject || "(no body)"), source: "email", emailHasAttachments: true,
    sourceRef: [message.subject, message.id].filter(Boolean).join(" | ") }; }

  const list = await connection.call("list_attachments", { message_id: messageId, content_mode: "metadata_only" });
  const pdfs = (list.attachments ?? [])
    .filter(a => !a.is_inline && (/pdf/i.test(a.content_type || "") || /\.pdf$/i.test(a.name || "")) && (a.size_bytes ?? 0) <= MAX_BYTES)
    .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0))
    .slice(0, MAX_PDFS);

  const attachments = [];
  for (const a of pdfs) {
    const f = await connection.call("fetch_attachment", { message_id: messageId, attachment_id: a.id });
    const url = f.file_uri?.download_url ?? f.download_url ?? f.structuredContent?.download_url;
    if (!url) continue;
    const download = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!download.ok) continue;
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.length > MAX_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") continue;
    const slot = await requestUploadSlot(job.id);
    const put = await fetch(slot.signedUrl, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: bytes, signal: AbortSignal.timeout(120000) });
    if (!put.ok) throw new Error("Could not upload the attachment to Hopper.");
    attachments.push({ path: slot.path, name: String(a.name || "OM.pdf"), size: bytes.length });
  }
  return { ...email, attachments };
}
