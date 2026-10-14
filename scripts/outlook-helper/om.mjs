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

// fetch_comps: read one email for Comps > Select from Outlook -- the body plus
// up to five comp attachments: spreadsheets (.xlsx, .xlsm, .csv) and PDF comp
// sheets. Same route into storage as fetch_om, one slot per file; nothing in
// the mailbox is changed.
const COMP_TYPES = [
  { ext: "xlsx", type: /spreadsheetml/i, magic: "PK" },
  { ext: "xlsm", type: /macroEnabled/i, magic: "PK" },
  { ext: "csv", type: /text\/csv/i, magic: null },
  { ext: "pdf", type: /pdf/i, magic: "%PDF-" },
];
const MAX_COMP_FILES = 5;
const CONTENT_TYPES = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", csv: "text/csv" };

function compKind(a) {
  const byName = (a.name || "").toLowerCase().match(/\.(xlsx|xlsm|csv|pdf)$/)?.[1];
  return COMP_TYPES.find(t => t.ext === byName) ?? COMP_TYPES.find(t => t.type.test(a.content_type || ""));
}

export async function fetchComps(connection, job, requestUploadSlot) {
  const messageId = job.input.messageId;
  const message = await connection.call("fetch_message", { message_id: messageId });
  let email;
  try { email = emailResult(message); }
  catch { email = { text: String(message.subject || "(no body)"), source: "email", emailHasAttachments: true,
    sourceRef: [message.subject, message.id].filter(Boolean).join(" | ") }; }

  const list = await connection.call("list_attachments", { message_id: messageId, content_mode: "metadata_only" });
  // Spreadsheets first: a comp table in Excel reads exactly, a PDF only approximately.
  const wanted = (list.attachments ?? [])
    .map(a => ({ a, kind: compKind(a) }))
    .filter(({ a, kind }) => kind && !a.is_inline && (a.size_bytes ?? 0) <= MAX_BYTES)
    .sort((x, y) => (x.kind.ext === "pdf") - (y.kind.ext === "pdf") || (y.a.size_bytes ?? 0) - (x.a.size_bytes ?? 0))
    .slice(0, MAX_COMP_FILES);

  const attachments = [];
  for (const { a, kind } of wanted) {
    const f = await connection.call("fetch_attachment", { message_id: messageId, attachment_id: a.id });
    const url = f.file_uri?.download_url ?? f.download_url ?? f.structuredContent?.download_url;
    if (!url) continue;
    const download = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!download.ok) continue;
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.length > MAX_BYTES) continue;
    if (kind.magic && new TextDecoder().decode(bytes.slice(0, kind.magic.length)) !== kind.magic) continue;
    const slot = await requestUploadSlot(job.id, kind.ext);
    const put = await fetch(slot.signedUrl, { method: "PUT", headers: { "Content-Type": CONTENT_TYPES[kind.ext], "x-upsert": "false" },
      body: bytes, signal: AbortSignal.timeout(120000) });
    if (!put.ok) throw new Error("Could not upload the attachment to Hopper.");
    attachments.push({ path: slot.path, name: String(a.name || `attachment.${kind.ext}`), size: bytes.length });
  }
  return { ...email, attachments };
}
