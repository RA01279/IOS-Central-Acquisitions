# Lease and sale comp intake audit

September 9, 2026. Scope: paste/workbook parsing, review, POST save, duplicate handling, geocoding, repository map and location correction.

## Austin report

The configured workspace database returns only one Austin-labeled lease comp: **100 Star Ranch Blvd N, Hutto**, created September 3, with supplied coordinates and confirmed status. The latest comp creation timestamps in this database are September 3. The reported three recent Austin IOS comps could not be identified from this database. Their addresses and the application URL are needed to distinguish missing saves, different market labels, and a different deployment/database.

No production comp records were changed during this audit.

## Confirmed issues and local fixes

| Finding | Impact | Change |
| --- | --- | --- |
| Intake saves without refreshing the server-rendered comp list/map | Newly saved lease and sale comps do not appear until reload/navigation | Refresh after save, including partial-failure paths |
| Map query excludes null latitude before missing-location counts | Unlocated comps disappear from both map and warning totals | Fetch all map-summary rows; separate coordinate validity from record existence |
| A single limit(5000) request can still be capped by the database | A growing repository can silently lose map records | Stable, paginated map retrieval; propagate database errors |
| Save response provides aggregate geocoding totals but no record links | User cannot easily locate and repair the affected comp | Return newly saved IDs and location states; show direct comp links |
| Geocoding totals include duplicate/rejected database inserts | Report can claim location problems for records that were not newly saved | Compute location totals only for inserted records |
| Completed save clears drafts even when some inserts failed | Corrections require reparsing the original input | Retain review rows after failures and preserve batch results as they arrive |

## Existing strengths

- Clipboard HTML is preferred to plain text so broker table columns survive.
- XLSX/XLSM/CSV sheets are parsed independently; excluded tabs and inferred dates are disclosed.
- Lease validation requires rent, rent basis and commencement. Sale validation requires price and closing date.
- Supplied coordinates are retained; other rows are geocoded using state/city context.
- Confirmed comps have editable source references, transaction details and manual map pin correction.
- Database uniqueness and chunk fallback prevent simple repeat imports from inserting the same rows again.

## Recommended next improvements

1. **Preview locations before save.** Show address/city/state/market and map status per row. Make IOS/Industrial explicit. Let users fix the exact yard location before finishing; saving a useful comp should remain possible when its location is unresolved.
2. **Explain geocoding failure.** Distinguish missing configuration, request denial/quota, timeout and no address match. Add bounded requests and a retry action. Current geocodeAddress collapses these into null. Do not tell users to rewrite an address when the service is unavailable.
3. **Review duplicates by record.** Return the existing comp link and offer Skip or Review update. Current uniqueness uses address/type/date/project/suite, without city/state; similarly named streets in different cities can collide, while spelling variations can evade detection. Redesign the key only after auditing existing collisions, and retain human review for uncertain matches.
4. **Validate transactions before geocoding.** Validate date values, allowed rent bases, area ranges and comp type at the API boundary. Current checks mostly establish presence; malformed values can still reach database constraints. Lease and sale failures should name the row and field.
5. **Make retries target failed rows.** Retaining drafts prevents data loss, but retry currently resubmits successful rows too. Add stable per-row outcomes and an import batch ID, preserve failed rows alone, and distinguish duplicates from updates.
6. **Unify map location semantics.** The general comp map draws approximate coordinates, while underwriting distance matching excludes them. Label approximate pins explicitly or provide a separate layer; never present a city centroid as the property location.

## Validation and remaining work

Automated checks cover parsing, workbook ingestion, comp matching, state resolution and the map-data regressions. Exact reproduction of the reported Austin import and live browser verification require the matching deployment/data. Changes remain local until deployed.
