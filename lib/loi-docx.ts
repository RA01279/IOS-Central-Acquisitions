// lib/loi-docx.ts
//
// A one-signer LOI (industrial: John only). Both templates carry John on the
// left and Rhett on the right: a paragraph holding the two signature images,
// then name, title and entity lines of "{signer1_x}<tab>{signer2_x}". Drop the
// right-hand image -- the one placed further across the page -- and the tabbed
// second column, so no stray signature or blank line is left behind.
export function dropSecondSigner(xml: string): string {
  const namesAt = xml.indexOf("{signer1_name}");
  const sigStart = namesAt < 0 ? -1 : xml.lastIndexOf("<w:p ", xml.lastIndexOf("<w:drawing>", namesAt));
  if (sigStart < 0) throw new Error("signature block not found in the LOI template");
  const sigEnd = xml.indexOf("</w:p>", sigStart);
  const para = xml.slice(sigStart, sigEnd);
  const runs = [...para.matchAll(/<w:r[ >](?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>(?:(?!<w:r[ >])[\s\S])*?<\/w:r>/g)];
  const offset = (run: string) => Number(/<wp:positionH[^>]*>\s*<wp:posOffset>(\d+)/.exec(run)?.[1] ?? 0);
  const right = runs.length === 2 ? runs.reduce((a, b) => (offset(b[0]) > offset(a[0]) ? b : a)) : null;
  if (!right) throw new Error("expected two signature images in the LOI template");
  const trimmed = para.slice(0, right.index!) + para.slice(right.index! + right[0].length);
  let out = xml.slice(0, sigStart) + trimmed + xml.slice(sigEnd);
  for (const tag of ["signer2_name", "signer2_title"]) {
    const re = new RegExp(`<w:r[ >](?:(?!<w:r[ >])[\\s\\S])*?<w:tab/>(?:(?!<w:r[ >])[\\s\\S])*?<w:t(?: [^>]*)?>\\{${tag}\\}</w:t></w:r>`);
    if (!re.test(out)) throw new Error(`{${tag}} column not found in the LOI template`);
    out = out.replace(re, "");
  }
  // The entity line under the titles repeats "Dalfen Industrial Acquisition
  // LLC" for each signer after a bare tab run; cut from that tab to the end of
  // the line.
  const titleAt = out.indexOf("{signer1_title}");
  const entStart = titleAt < 0 ? -1 : out.indexOf("<w:p ", titleAt);
  const entEnd = out.indexOf("</w:p>", entStart);
  const entity = out.slice(entStart, entEnd);
  const tabRun = /<w:r(?: [^>]*)?>(?:<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:tab\/><\/w:r>/.exec(entity);
  if (entStart >= 0 && tabRun && /Acquisition/.test(entity.replace(/<[^>]+>/g, ""))) {
    out = out.slice(0, entStart) + entity.slice(0, tabRun.index) + out.slice(entEnd);
  }
  return out;
}
