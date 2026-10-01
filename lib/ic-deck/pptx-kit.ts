// lib/ic-deck/pptx-kit.ts
//
// Just enough PresentationML to put editable text boxes, native tables and
// pictures onto the slides of the sanitized Dalfen template. Coordinates are
// inches on the template's 10" x 7.5" (4:3) page.

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

export const NAVY = "132B46";
export const INK = "162B49";
export const MUTED = "66717E";
export const BAND = "F1F3F6";

export const emu = (inches: number) => Math.round(inches * 914400);
export const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export type Box = { x: number; y: number; w: number; h: number };
export interface Run { text: string; bold?: boolean; color?: string; size?: number; italic?: boolean }
export interface Para { runs: Run[]; bullet?: boolean; align?: "l" | "ctr" | "r"; spaceAfter?: number }
export type TextInput = string | Run | Para | Array<string | Run | Para>;
export interface Picture { bytes: Uint8Array; ext: "png" | "jpeg"; source: string }

function toParas(input: TextInput): Para[] {
  const list = Array.isArray(input) ? input : [input];
  return list.map((p) => (typeof p === "string" ? { runs: [{ text: p }] } : "runs" in p ? p : { runs: [p] }));
}

export function imageSize(bytes: Uint8Array, ext: "png" | "jpeg"): [number, number] {
  const b = bytes;
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  if (ext === "png") return [((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0];
  for (let p = 2; p + 8 < b.length;) {
    if (b[p] !== 0xff) break;
    const marker = b[p + 1], len = u16(p + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return [u16(p + 7), u16(p + 5)];
    p += 2 + len;
  }
  throw new Error("Could not read image dimensions.");
}

export class SlideBuilder {
  shapes = "";
  notes: string[] = [];
  pictures: Array<{ rid: string; bytes: Uint8Array; ext: "png" | "jpeg" }> = [];
  private id = 10;

  constructor(readonly number: number) {}

  rect(b: Box, fill: string, line?: string) {
    this.shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${this.id++}" name="Panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${line ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>"}</p:spPr></p:sp>`;
  }

  text(input: TextInput, b: Box, o: { size?: number; color?: string; bold?: boolean; fill?: string; anchor?: "t" | "ctr" | "b"; align?: "l" | "ctr" | "r"; autofit?: boolean; name?: string } = {}) {
    const size = o.size ?? 11;
    const paras = toParas(input).map((p) => {
      const bullet = p.bullet ? `marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/>` : `marL="0" indent="0"><a:buNone/>`;
      const runs = p.runs.map((r) => `<a:r><a:rPr lang="en-US" sz="${Math.round((r.size ?? size) * 100)}" b="${(r.bold ?? o.bold) ? 1 : 0}"${r.italic ? ' i="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? o.color ?? INK}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`).join("");
      return `<a:p><a:pPr algn="${p.align ?? o.align ?? "l"}" ${bullet}<a:spcAft><a:spcPts val="${(p.spaceAfter ?? 3) * 100}"/></a:spcAft></a:pPr>${runs}<a:endParaRPr lang="en-US" sz="${size * 100}"/></a:p>`;
    }).join("");
    const fill = o.fill ? `<a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill>` : "<a:noFill/>";
    this.shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${this.id++}" name="${esc(o.name ?? "Text")}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${emu(0.07)}" rIns="${emu(0.07)}" tIns="${emu(0.04)}" bIns="${emu(0.04)}" anchor="${o.anchor ?? "t"}">${o.autofit === false ? "" : "<a:normAutofit/>"}</a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }

  /** The navy "> Title" band the Golden Spike deck uses on every body slide. */
  title(title: string) {
    this.text([{ runs: [{ text: "> " + title }] }], { x: 0, y: 0.8, w: 10, h: 0.47 }, { size: title.length > 60 ? 13 : 16, color: "FFFFFF", bold: true, fill: NAVY, anchor: "ctr" });
  }

  /**
   * Native, editable table. `align` per column ("r" for figures). Rows in
   * `emphasis` are bold with a rule above; `header` rows are navy.
   */
  /** Returns the table's bottom edge so the next block can sit under it. */
  table(columns: string[], rows: string[][], b: Box, o: { size?: number; widths?: number[]; align?: Array<"l" | "ctr" | "r">; emphasis?: number[]; highlight?: Array<[number, number]>; rowHeight?: number; headerSize?: number } = {}): number {
    const size = o.size ?? 9;
    const widths = o.widths ?? columns.map(() => 1);
    const total = widths.reduce((a, c) => a + c, 0);
    const colW = widths.map((w) => emu((b.w * w) / total));
    const rowH = o.rowHeight ?? Math.min(0.32, b.h / (rows.length + 1));
    const cell = (text: string, ri: number, ci: number) => {
      const header = ri < 0;
      const emph = !header && o.emphasis?.includes(ri);
      const hl = !header && o.highlight?.some(([r, c]) => r === ri && c === ci);
      const fill = header ? NAVY : hl ? "D9E4F2" : ri % 2 ? BAND : "FFFFFF";
      const color = header ? "FFFFFF" : INK;
      const align = o.align?.[ci] ?? "l";
      const border = emph ? `<a:lnT w="9525"><a:solidFill><a:srgbClr val="${INK}"/></a:solidFill></a:lnT>` : "";
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${Math.round((header ? o.headerSize ?? size : size) * 100)}" b="${header || emph || hl ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${Math.round((header ? o.headerSize ?? size : size) * 100)}"/></a:p></a:txBody><a:tcPr marL="${emu(0.05)}" marR="${emu(0.05)}" marT="${emu(0.025)}" marB="${emu(0.025)}" anchor="ctr">${border}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
    };
    const tr = (cells: string[], ri: number) => `<a:tr h="${emu(rowH)}">${cells.map((c, ci) => cell(c, ri, ci)).join("")}</a:tr>`;
    const xml = `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${colW.map((w) => `<a:gridCol w="${w}"/>`).join("")}</a:tblGrid>${tr(columns, -1)}${rows.map((r, i) => tr(r, i)).join("")}</a:tbl>`;
    this.shapes += `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${this.id++}" name="Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(rowH * (rows.length + 1))}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${xml}</a:graphicData></a:graphic></p:graphicFrame>`;
    return b.y + rowH * (rows.length + 1);
  }

  /** Picture scaled to fit inside the box, centred. */
  picture(pic: Picture, b: Box) {
    const [iw, ih] = imageSize(pic.bytes, pic.ext);
    const scale = Math.min(b.w / iw, b.h / ih);
    const w = iw * scale, h = ih * scale;
    const rid = `rIdImg${this.pictures.length + 1}`;
    this.pictures.push({ rid, bytes: pic.bytes, ext: pic.ext });
    this.notes.push(`Exhibit source: ${pic.source}`);
    this.shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${this.id++}" name="Exhibit" descr="${esc(pic.source)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(b.x + (b.w - w) / 2)}" y="${emu(b.y + (b.h - h) / 2)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }

  /** Grey box saying exactly what exhibit belongs here. */
  placeholder(what: string, b: Box) {
    this.rect(b, "F4F5F7", "C9CED6");
    this.text([{ runs: [{ text: "Exhibit needed", bold: true, color: MUTED, size: 12 }], align: "ctr" }, { runs: [{ text: what, color: MUTED, size: 10 }], align: "ctr" }], { x: b.x + 0.2, y: b.y, w: b.w - 0.4, h: b.h }, { anchor: "ctr" });
    this.notes.push(`Open item: ${what}`);
  }

  pageNumber() {
    this.text(String(this.number), { x: 9.2, y: 7.12, w: 0.45, h: 0.24 }, { size: 8, color: MUTED, align: "r", autofit: false });
  }

  footer(text: string) {
    this.text(text, { x: 0.25, y: 6.98, w: 8.8, h: 0.26 }, { size: 7, color: MUTED, autofit: false });
  }

  xml() {
    return `<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${this.shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  notesXml() {
    const paras = this.notes.map((t) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(t)}</a:t></a:r></a:p>`).join("") || "<a:p/>";
    return `<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  }
}

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const R_NS = R;
