// lib/outbox.ts
//
// CLIENT ONLY. Notes written with no connection (a site visit with no signal)
// wait here and post when the browser comes back online. Text only: photos
// need a connection to upload, and the note form says so. Kept in
// localStorage, so a queued note survives closing the app.

export interface QueuedPost {
  id: string;
  url: string;
  body: unknown;
  label: string;
  at: number;
}

const KEY = "hopper.outbox.v1";

export function readOutbox(): QueuedPost[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list: QueuedPost[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("hopper-outbox"));
  } catch {
    /* storage unavailable */
  }
}

export function enqueue(url: string, body: unknown, label: string) {
  write([...readOutbox(), { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url, body, label, at: Date.now() }]);
}

let flushing = false;
/** Post everything queued; keeps whatever still fails. Returns how many sent. */
export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of readOutbox()) {
      try {
        const res = await fetch(item.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        });
        // A redirect or an HTML page means the session lapsed and we were sent
        // to /login -- not delivered; keep it for after sign-in.
        const delivered = res.ok && !res.redirected && (res.headers.get("content-type") ?? "").includes("json");
        if (res.ok && !delivered) break;
        // 4xx won't fix itself on retry; drop it rather than loop forever.
        if (delivered || (res.status >= 400 && res.status < 500 && res.status !== 401)) {
          write(readOutbox().filter((x) => x.id !== item.id));
          if (delivered) sent++;
        }
      } catch {
        break; // still offline
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
