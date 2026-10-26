# Off-market IOS sourcing

**Sourcing** in the nav. Businesses that run outdoor yards are sitting on IOS sites whether or not anyone has listed them; the tool finds them, names the owner, and moves the good ones into the pipeline.

1. **Sweep.** Pick a submarket preset (Houston, DFW, Austin, San Antonio) or an address, and a 1–10 mile radius. Hopper runs the IOS demand map's 22 Google Places searches (trucking, equipment rental, contractor yards, container storage, building materials, stone, pipe and steel...) with the same yard-use screening, then:
   - groups occupiers at the same street address or county parcel into one site; keeps nearby different addresses and separate chain branches distinct;
   - looks up each site's **owner of record** in the Texas statewide parcel layer (TxGIO StratMap Land Parcels, the county appraisal roll): owner, mailing address, acres, year built, value;
   - flags **owner-users** (owner name matches an operator: a sale-leaseback lead), **public** owners (hidden by default) and **institutional** owners;
   - marks sites already in Hopper (any deal including archived targets, owned assets, comps).
   About 2 seconds. Google returns at most 20 businesses per search term, so a sweep samples an area; use tighter radii around clusters.
2. **Qualify.** Select up to 10 sites. The *Off-market sourcing* agent (connected helper, web search) researches what the roll can't say: whether the operators occupy the parcel, who is behind the owning entity, hold period from deed records, zoning or deed restrictions on outdoor storage, building size and coverage; judges buy-box fit; and drafts a first-touch letter. Every owner/parcel fact needs a source; unconfirmed points are listed separately. Roughly a minute per site.
3. **Add as prospect.** Creates an IOS Prospect deal marked off-market (sale-leaseback when owner-user), owner of record as the seller contact, address verified with Google when possible. The research, appraisal-roll record and outreach draft are attached to the deal's history. Hopper's duplicate check refuses an address it already has. Nothing is ever sent.

Research runs and their sweep link are kept in the browser that ran them (localStorage). The current reviewed results, profiles and filters also persist in viewer-scoped session storage across property navigation.

## Broker Excel Export

### Business / Occupier Profiles

Profiles are the existing Google Places yard-use categories, not employees. All ten are visibly selected initially. Clear selects none and disables Sweep; the server rejects empty, missing or unknown profile IDs. Selecting multiple profiles runs the union of their keyword searches. Definitions remain shared with the IOS demand map:

| Profile | Stable ID | Google keywords |
| --- | --- | --- |
| Auto & RV Storage | auto-rv-storage | RV boat outdoor storage lot; trailer storage yard |
| Building Materials | building-materials | building materials supplier; lumber yard; roofing supply |
| Chemical/Waste Mgmt | chemical-waste | waste management chemical distributor |
| Container Storage | container-storage | shipping container storage; portable storage container sales |
| Contractor Yard | contractor-yard | paving contractor; fence company; excavating contractor |
| Equip. Rental & Sales | equipment | equipment rental sales; crane service |
| Stone & Masonry | stone-masonry | stone yard; natural stone supplier; masonry supply |
| Trucking & Towing | trucking-towing | trucking company; towing service |
| Landscape & Soil | landscape-soil | landscape supply yard; soil compost mulch supplier |
| Pipe & Steel | pipe-steel | pipe supply; steel supply |

Profiles are search signals, not verified land use. Existing name/type/closed-business and category-specific yard screening remain unchanged. Every business pin is checked against the search radius after Google responds.

Google place IDs merge repeat keyword results while preserving every matched profile. Same-name listings at one property consolidate with their source place IDs retained. Separate chain branches survive. Shared street addresses (within 0.25 miles, suites ignored) or identical county/parcel IDs combine different occupiers into one property. Nearby different addresses remain separate. Parcel enrichment and known-Hopper matches continue.

Google Details supplies business phone, website and source links when available, using bounded concurrency and a time budget. Missing fields stay blank and failed lookups do not discard properties. Contacts are occupier contacts, not verified property-owner contacts. Existing ownership and mailing details remain in the workbook. New business phone, website, Google source and business-level matched-profile columns are appended to Opportunities; each contact is labeled with its business.

The reviewed-search caption identifies the completed geography and profiles. Changed criteria require another sweep and do not relabel old results. A request-generation guard and cancellation prevent stale responses replacing newer results. Controls, reviewed results, selections and existing filters persist in viewer-scoped session storage across property navigation. There is no results pagination: the complete returned sample feeds existing filters, filtered property counts, map and primary export. Selected-site export is explicitly a subset.

Coverage shows each keyword, returned count, failure and limit signal. Only the first Google page (up to 20 results per keyword) is fetched, as before. This is explicitly a sample, including when no next-page token appears. Failed searches and incomplete contact lookups are reported separately.

Validation: `node scripts/test-sourcing-profiles.mjs` checks exact independent fixture IDs, OR contributions, provenance, duplicates vs shared properties vs branches, geography, partial responses, contacts and all 45 exported fixture rows. `--live` compares raw Google IDs and profile provenance independently with search output for individual/combined selections, applies parcel enrichment and checks complete XLSX membership. Redacted records and workbooks are saved to `.scratch/profile-evidence/`.

Verified October 26, 2026: independent Google calls at Houston Northwest (29.87, -95.55), 1 mile, returned 3 Trucking & Towing businesses, 2 Equipment businesses and exactly their 5-ID union. The signed-in browser matched all 5 IDs after including known sites; its default hide-known setting correctly showed 4. The existing 1.5–10 acre filter gave precisely S1/S3/S5, matching the independent parcel reference. Counts, map markers (plus the search center) and export agreed. The actual browser-downloaded workbook matched all 5 property refs, addresses, business names, owners, acreage, phones and matched profiles (`node scripts/verify-sourcing-browser-export.mjs`). Opening the known property and Back preserved profiles, radius, show-known/acreage filters and checked S1. Rapid overlapping searches ended on the latest Equipment-only 2-ID set; Clear disabled Sweep. Real anonymous HTTP access returned 401. Final build and TypeScript checks passed. No employee queries, assignment filters, schema migrations or permission changes were introduced.

Use **Export selected to Excel** for checked sweep sites or **Export filtered results to Excel** for the complete current filtered set. Selected exports include checked sites even when a later filter hides them. After qualification, **Export qualified sites to Excel** includes the research for the reported sites.

The `.xlsx` workbook includes property addresses, operators, owners and mailing addresses, acreage, parcel IDs, available qualification research, sources and map links, plus blank Broker Comments and Next Step columns. It has filters and frozen headers; missing information stays blank. Outreach drafts are excluded. ExcelJS loads only when an export is requested, and generation uses the results already in the browser.

Validation: `node scripts/test-sourcing-export.mjs` checks saved and reopened XLSX data, numeric acreage, parcel IDs, text safety, map links, filters, frozen headers and outreach exclusion.

## Notes on the parcel layer

- `DATE_ACQ` is TxGIO's data refresh date, not the owner's purchase date. It is ignored; hold period comes from deed research.
- Shapes are Web Mercator; acres are corrected by cos²(latitude). The appraisal district's legal area is kept alongside.
- A Google pin can fall on a neighbouring parcel. The agent is asked to confirm occupancy; check the parcel on the map before outreach.

Install: apply `20261002120000_sourcing_agent.sql`, deploy, restart the helper.

Validation: `node scripts/test-sourcing.mjs`, agent tests, typecheck/build, a live Houston North sweep (57 sites, owners on 56) and a live agent run.
