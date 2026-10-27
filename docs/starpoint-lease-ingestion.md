# Starpoint lease ingestion verification

Regression source: `scripts/fixtures/starpoint-lease-comps.xlsx`, unchanged from the supplied workbook.
SHA256: `2344B0B4A030F9A541C4C06A12321558E21758D60E2627519A6C86997A92F490`.

## Reproduced failure

Before parser edits, the actual parse route (authenticated handler with test auth) returned HTTP 200, zero drafts and excluded `Table 1` with `no rent or price column, so there's no comp in it`. `Lease Rate` was missing from the shared field aliases and sheet eligibility test.

## Complete source inspection and reconciliation

- One visible sheet, 20 populated rows. Row 1 is the repeated title, row 2 the 16-column header, rows 3–20 the 18 transactions. No transaction rows skipped.
- All 18 rent cells use `$0.00`, which establishes currency but no denominator or period. No comments/notes, hidden evidence tabs, defined names or header/footer unit evidence. The embedded image is a CBRE logo.
- Escalation numeric formats explicitly indicate percentages, but no cadence. One escalation is `Flat rate`. TI currency values have no denominator; five cells say `As-Is`. Term and free rent have no unit labels. The row-4 abatement comment conflicts with its Free Rent column; both survive with a warning.
- All lease dates are quarters. Database date anchors retain `date_precision=quarter`; review shows quarter/year rather than an apparent exact execution date.
- Building prefixes/suffixes become existing project identifiers, preserving Rex Road buildings 3, 4 and 8 at the same address. Original Building wording, including the row-17 newline, is retained.
- `SF Leased` is a separate draft field. It is displayed as tenancy area and preserved in the existing saved source notes; total Building SF remains null. No schema migration or assumed total building area.
- Every populated source cell and Excel number format is retained in the draft source evidence and saved notes. Unknown commercial units are not populated into normalized underwriting fields.

## Verification

`node scripts/test-comp-starpoint.mjs` independently reconciles all 18 addresses, quoted rates and leased areas and all populated cells across all 16 columns. It verifies physical source rows 3–20, building IDs, quarters, explicit-unit rent variants, ambiguous rows, missing-unit warnings, parser authentication and underwriting exclusion. The actual save handler rejects all 18 unconfirmed rents without repository writes; after simulated explicit reviewer confirmation, all 18 save to a fake repository with original notes, quarter precision, null building area and distinct projects intact.

Existing targeted regressions: parse 126 checks, workbook 131 checks, review 24 checks, underwriting 18 checks, and save-result checks passed. TypeScript checks passed before final release build.

Authenticated Chrome check at localhost:3130/comps: the user selected the original workbook through the normal uploader. Review displayed 18 leases, no sales, 18 requiring attention, zero ready to save. Browser DOM membership/rates exactly matched the independently transcribed full source set; all 18 had blank rent units, quarter dates, null Building SF and original source notes. Both table and form review views preserve source meaning. No live records were saved.

Existing location safeguards remained active: `6410 Langield Rd.` requires review because Google returns `Langfield Rd.`; Genoa Red Bluff has a road-level warning. Neither source address was silently corrected.
