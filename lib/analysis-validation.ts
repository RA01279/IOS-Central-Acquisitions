export function validAnalysis(kind: string, payload: any): boolean {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.excluded) || payload.excluded.length>5000 || !payload.excluded.every((id:unknown)=>typeof id==="string")) return false;
  if (kind==="comps") {
    return ["lease","sale"].includes(payload.compType) && ["building","land"].includes(payload.basis)
      && [3,5,10,15,25].includes(payload.radiusMiles) && [12,24,36,60].includes(payload.maxAgeMonths)
      && typeof payload.allowOtherClasses==="boolean" && typeof payload.analysisDate==="string"
      && Number.isFinite(Date.parse(payload.analysisDate)) && !!payload.subject && typeof payload.subject==="object"
      && Array.isArray(payload.comps) && payload.comps.length<=5000
      && payload.comps.every((comp:any)=>comp && typeof comp.id==="string" && typeof comp.address==="string" && ["lease","sale"].includes(comp.comp_type));
  }
  const d=payload.data;
  return kind==="demand" && !!d && typeof d.address==="string" && [3,5,7].includes(d.radiusMiles)
    && Number.isFinite(d.center?.lat) && Math.abs(d.center.lat)<=90 && Number.isFinite(d.center?.lng) && Math.abs(d.center.lng)<=180
    && Number.isFinite(d.zoom) && d.zoom>=0 && d.zoom<=22 && ["satellite","hybrid",undefined].includes(d.maptype)
    && typeof d.imageBase64==="string" && /^data:image\/(png|jpeg);base64,/.test(d.imageBase64)
    && Array.isArray(d.tenants) && d.tenants.length<=200
    && d.tenants.every((t:any)=>t && typeof t.name==="string" && typeof t.placeId==="string" && typeof t.category==="string" && Number.isFinite(t.lat) && Number.isFinite(t.lng));
}
