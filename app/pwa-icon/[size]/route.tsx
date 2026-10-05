import { ImageResponse } from "next/og";

// App icon, drawn rather than shipped as binaries: navy tile, sky rule, white
// "H". ?maskable=1 shrinks the mark into the safe zone for Android masks.
const SIZES = new Set([96, 180, 192, 512]);

export async function GET(req: Request, props: { params: Promise<{ size: string }> }) {
  const { size: raw } = await props.params;
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192;
  const maskable = new URL(req.url).searchParams.get("maskable") === "1";
  const mark = Math.round(size * (maskable ? 0.42 : 0.58));
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: "#0A2540",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: maskable || size === 180 ? 0 : Math.round(size * 0.18),
        }}
      >
        <div style={{ color: "#FFFFFF", fontSize: mark, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>H</div>
        <div style={{ width: Math.round(mark * 0.42), height: Math.max(2, Math.round(size * 0.025)), background: "#4E9FD6", marginTop: Math.round(size * 0.04) }} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } }
  );
}
