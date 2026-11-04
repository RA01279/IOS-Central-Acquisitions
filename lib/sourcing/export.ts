import ExcelJS from "exceljs";
import type { Site } from "./sweep";
import type { SourcedSite } from "../agents/sourcing";
import type { ExportAssignment } from "./export-assignment";
import { usableSummary } from "./usable-summary";

/** Use the completed search geography, not the current search form controls. */
export function sourcingExportFilename(searchLabel: string, assignment?: ExportAssignment) {
  const area = searchLabel.split(" | ")[0].trim();
  const divider = area.indexOf(": ");
  const market = divider >= 0 ? area.slice(0, divider) : area;
  const submarket = divider >= 0 ? area.slice(divider + 2).replace(/\s*\([^)]*\)\s*$/, "") : "Unspecified submarket";
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "").slice(0, 70).trim() || "Unspecified";
  return `${safe(market)}_${safe(submarket)}_${safe(assignment?.brokerName || assignment?.firmName || "Unassigned")}.xlsx`;
}

export async function buildSourcingWorkbook(sites: Site[], label: string, research?: SourcedSite[], assignment?: ExportAssignment) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hopper";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Opportunities", { views: [{ state: "frozen", ySplit: 4, xSplit: 2 }] });
  const columns = [
    ["ref", "Site", 10], ["address", "Property Address", 42], ["operators", "Operators / Occupant", 35],
    ["categories", "Yard Use", 28], ["owner", "Owner of Record", 35], ["mail", "Owner Mailing Address", 42],
    ["ownerType", "Owner Type", 20], ["acres", "Gross Parcel Acres", 16], ["building", "Building SF", 15],
    ["built", "Year Built", 12], ["county", "County", 18], ["parcel", "Parcel ID", 22],
    ["ownedSince", "Owned Since", 18], ["zoning", "Zoning", 30], ["storage", "Outdoor Storage", 22],
    ["fit", "Buy Box Fit", 16], ["reason", "Fit Reason", 50], ["signals", "Off-market Signals", 50],
    ["unverified", "Unverified Items", 50], ["sources", "Sources", 60], ["map", "Map", 22],
    ["broker", "Broker Comments", 40], ["next", "Next Step", 35],
    ["phone", "Business Phone (Google)", 38], ["website", "Business Website (Google)", 55],
    ["google", "Google Business Source", 65], ["matches", "Business / Matched Profiles", 55],
    ["assignedBroker", "Assigned Broker", 28], ["assignedFirm", "Assigned Firm", 30],
    ["brokerEmail", "Assigned Broker Email", 35], ["brokerPhone", "Assigned Broker Phone", 24],
    ["usableAcres", "Verified Usable Yard Acres", 22], ["footprint", "Building Footprint SF", 22],
    ["identity", "Property Identity Review", 45], ["related", "Related Hopper Records", 60],
    ["netUsable", "Net Usable Acres (measured)", 20], ["coverage", "Building Coverage % (measured)", 20], ["usableBreakdown", "Net Usable Breakdown", 60],
  ] as const;
  sheet.columns = columns.map(([key, , width]) => ({ key, width }));
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = "OFF-MARKET SOURCING OPPORTUNITIES";
  sheet.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF0A2540" } };
  sheet.mergeCells("H1:O1");
  sheet.getCell("H1").value = `Assigned to: ${[assignment?.brokerName, assignment?.firmName].filter(Boolean).join(" · ") || "Unassigned"}`;
  sheet.getCell("H1").font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF0E5AA7" } };
  sheet.mergeCells("A2:F2");
  sheet.getCell("A2").value = `${label} | ${sites.length} opportunities | Exported ${workbook.created.toISOString().slice(0, 10)}`;
  sheet.mergeCells("A3:W3");
  sheet.getCell("A3").value = "Google business contacts are occupier contacts, not verified property-owner contacts. Verify ownership and parcel facts. Blank fields are unknown. Google results are a limited sample.";
  sheet.getRow(3).font = { name: "Calibri", size: 10, color: { argb: "FF6B7A88" } };
  sheet.getRow(4).values = columns.map(([, header]) => header);
  sheet.getRow(4).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5AA7" } };
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
  });
  sheet.getRow(4).height = 28;
  const byRef = new Map(research?.map((s) => [s.ref, s]));
  for (const site of sites) {
    const r = byRef.get(site.ref);
    const p = site.parcel;
    const row = sheet.addRow({
      ref: site.ref, address: r?.parcelAddress ?? site.address,
      operators: r?.occupant ?? site.operators.map((o) => o.name).join(", "), categories: site.categories.join(", "),
      owner: r?.owner ?? p?.owner, mail: r?.ownerMailingAddress ?? p?.mailingAddress,
      ownerType: p?.ownerClass === "public" ? "public" : r && r.ownerType !== "unknown" ? r.ownerType : site.ownerUser ? "possible owner-user (name similarity; unverified)" : p?.ownerClass,
      acres: r?.acres ?? p?.acres, building: r?.buildingSf, built: r?.yearBuilt ?? p?.yearBuilt,
      county: r?.county ?? p?.county, parcel: r?.parcelId ?? p?.propId, ownedSince: r?.ownedSince,
      zoning: r?.zoning, storage: r?.outdoorStorage, fit: r?.fit, reason: r?.fitReason,
      signals: r?.signals.join("\n"), unverified: r?.unverified.join("\n"),
      sources: [...new Set([...(r?.sources ?? []), ...(p?.source ? [p.source] : [])])].join("\n"),
      map: { text: "View on Google Maps", hyperlink: `https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}` },
      phone: site.operators.filter((o) => o.phone).map((o) => `${o.name}: ${o.phone}`).join("\n"),
      website: site.operators.filter((o) => o.website).map((o) => `${o.name}: ${o.website}`).join("\n"),
      google: site.operators.map((o) => `${o.name}: ${o.googleUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name)}&query_place_id=${encodeURIComponent(o.placeId)}`}`).join("\n"),
      matches: site.operators.map((o) => `${o.name}: ${(o.categories ?? [o.category]).join(", ")}`).join("\n"),
      assignedBroker: assignment?.brokerName, assignedFirm: assignment?.firmName,
      brokerEmail: assignment?.brokerEmail, brokerPhone: assignment?.brokerPhone,
      usableAcres: r?.usableAcres, footprint: r?.buildingFootprintSf,
      netUsable: site.usable?.netAcres, coverage: site.usable?.coveragePct,
      usableBreakdown: site.usable ? `${usableSummary(site.usable)}. Measured from the parcel outline: building footprints (USA Structures), FEMA 100-yr floodplain, NWI wetlands, ground over a 5% grade (USGS 3DEP), strips under 60 ft wide. ${site.usable.notChecked.join(", ")} not checked.` : site.parcel ? "Not measured" : undefined,
      identity: site.identityStatus ?? "unverified", related: [site.known, ...(site.nearby ?? [])].filter(Boolean).map(k => `${k!.label}: ${k!.match ?? "unverified match"}`).join("\n"),
    });
    row.height = 62;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF364049" } };
      if (row.number % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F9" } };
    });
    row.getCell("map").font = { color: { argb: "FF0E5AA7" }, underline: true };
  }
  sheet.getColumn("acres").numFmt = "0.00";
  sheet.getColumn("building").numFmt = "#,##0";
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, sheet.rowCount), column: columns.length } };
  return workbook;
}

export async function downloadSourcingWorkbook(sites: Site[], label: string, research?: SourcedSite[], assignment?: ExportAssignment) {
  const workbook = await buildSourcingWorkbook(sites, label, research, assignment);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = sourcingExportFilename(label, assignment);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
