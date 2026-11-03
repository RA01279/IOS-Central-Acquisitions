/** A nearby record is context; only matching property evidence is a duplicate. */
export function addressKey(address?: string | null): string | null {
  const replacements: Record<string, string> = { road: "rd", street: "st", drive: "dr", boulevard: "blvd", avenue: "ave", highway: "hwy", parkway: "pkwy", lane: "ln", court: "ct", north: "n", south: "s", east: "e", west: "w" };
  const value = (address ?? "").split(",")[0].toLowerCase().replace(/\s*(#|\bste\b|\bsuite\b|\bunit\b|\bbldg\b).*$/, "")
    .replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).map(t => replacements[t] ?? t).join(" ");
  return /^\d+ [a-z0-9]/.test(value) ? value : null;
}

export function parcelKey(parcel?: { county?: string | null; propId?: string | null } | null): string | null {
  return parcel?.county && parcel.propId ? `${parcel.county.trim().toUpperCase()}:${parcel.propId.replace(/\s+/g, "").toUpperCase()}` : null;
}

export function addressConflict(address: string, situs?: string | null): boolean {
  const a = addressKey(address), b = addressKey(situs);
  return !!a && !!b && a !== b;
}

export function blocksSourcing(site: { known?: { kind: string; stage?: string; relation?: string; match?: string } | null }): boolean {
  const k = site.known;
  return !!k && k.match === "same_property" && (k.relation === "owned-asset" || (k.kind === "deal" && k.stage !== "archived" && k.stage !== "closed"));
}
