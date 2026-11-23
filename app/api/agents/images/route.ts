// POST { count } -> { paths, slots: [{ path, token }] }
// Signed upload slots for the page images of a PDF with no text layer, read by
// the Hopper helper (lib/agents/images.ts). JPEGs only, up to 12 pages.
import { NextRequest } from "next/server";
import { userContext, json } from "@/lib/agents/server";
import { MAX_AGENT_IMAGES, imagePaths } from "@/lib/agents/images";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ctx = await userContext(req, true); if (ctx.response) return ctx.response;
    const body = await req.json().catch(() => null);
    const count = Number(body?.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_AGENT_IMAGES) return json({ error: `Send 1 to ${MAX_AGENT_IMAGES} pages.` }, 400);
    const paths = imagePaths(crypto.randomUUID(), count);
    const slots = [];
    for (const path of paths) {
      const { data, error } = await ctx.db.storage.from("documents").createSignedUploadUrl(path);
      if (error || !data) throw new Error("slot");
      slots.push({ path: data.path, token: data.token });
    }
    return json({ paths, slots });
  } catch {
    return json({ error: "Could not start the page upload." }, 500);
  }
}
