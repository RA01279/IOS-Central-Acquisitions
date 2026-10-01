# Public zoning research
No Zoneomics account or key is needed. The authenticated deal-level POST /api/deals/[id]/zoning route reads deal coordinates and uses official City of Plano boundary, zoning and overlay services, plus the existing GOOGLE_MAPS_SERVER_KEY for business discovery.

Lookup returns subject zoning first. Neighbors runs ten IOS-related business searches in parallel with municipal polygon requests. All candidate pins are checked locally against those polygons; no per-tenant GIS requests. Same full mapped designation and same base district with differing special-use/PD/overlay provisions are separate groups. Outside-municipality candidates never count as matches.

Municipal responses have a one-hour Next data cache and bounded per-process cache; business queries and completed searches reuse results for five minutes per instance. Failed requests are evicted. Reports retain their original generatedAt when reused. GIS and business requests time out after 12 and 8 seconds respectively. No requests run automatically when the deal page loads.

Instant coverage: Plano, Dallas, Fort Worth and Austin, verified spatially rather than by postal city. Dallas, Fort Worth and Austin compare published zoning codes; separate permits and overlays remain unverified. Other municipalities use the U.S. zoning research link to the existing Site Research workspace with the deal preselected. This requires a paired, online Hopper helper and takes longer; source availability limits verification. It does not guarantee an automated result for every U.S. city. Rooftop, geometric-center or manually verified subject pins are required. Point zoning is not parcel-wide zoning; map identifiers do not prove allowed operations. Multiple intersecting zoning polygons, incomplete responses and records under research are not accepted as verified.

Business listings identify operators, not leasehold tenancy. Search categories alone do not establish outdoor operations. Location-specific primary-source evidence is reviewed separately in lib/zoning/evidence.ts. JSON download preserves research; reports are not saved to the deal database.

Official layers:
- https://maps.planogis.org/arcgiswad/rest/services/OpenData/Zoning/MapServer/0
- https://maps.planogis.org/arcgiswad/rest/services/OpenData/MunicipalBoundary/MapServer/0
- https://maps.planogis.org/arcgiswad/rest/services/OpenData/OverlayDistricts/MapServer/0

Underwriting isolation: reads deal coordinates only. No writes to deals, properties, documents, uw_versions or stage events. Model-upload components/routes, Excel parsing and stage actions are unchanged. The page change adds one independent panel.

Verification:
- node scripts/test-municipal-zoning.mjs
- node scripts/test-municipal-zoning.mjs --live
- node scripts/test-zoning.mjs
- npm run build

Live Rigsbee check on 2026-09-29: Plano, LC, S-500/501. Three-mile search checked 28 business listings; one same-base LC candidate (Value Towing, S-521), no full designation matches. Counts describe limited discovery, not a complete inventory. Initial subject lookup took 5.3 seconds, neighbors 8.3 seconds locally. Timing depends on source availability.

The Zoneomics adapter remains unused and is not imported by the active feature.
