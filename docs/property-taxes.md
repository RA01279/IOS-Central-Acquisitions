# Deal Property Taxes

Local implementation at `/deals/<id>/property-taxes`, linked from desktop and mobile deal navigation. Existing uncommitted comp and underwriting work is retained. Nothing has been deployed or applied to the live database.

## Workflow

1. Run official-source research on demand. Progress and partial evidence are streamed; failures remain explicit and can be retried. Existing property coordinates and sourcing-event parcel evidence are reused. A point lookup is not an exhaustive acquisition-boundary search.
2. Review every parcel/account, correct its identity, and include or exclude it. Enter the evidence linking it to the subject. Identify combined, land-only and building-only coverage; overlapping accounts must share the same coverage group. The model blocks overlapping components and duplicate accounts. Pending matches prevent complete totals/projections.
3. Review dated figures against their source. Annual records distinguish market/assessed/taxable values, exemptions, levies, payments, balances, penalties, interest, due dates, delinquency and source-supported appeals. Proposed figures are distinct from adopted figures and issued bills. Unknown values remain unavailable, including missing years and partial property totals.
4. Enter unavailable information manually with a source URL or retained bill. PDF, PNG and JPEG attachments below 3 MB are validated and stored in the existing private documents workflow. Upload is evidence retention, not OCR; transcribe and review figures explicitly. Manual entries are marked as overrides and survive research refresh. Original source values and changed values remain visible. A manual parcel-ID correction also survives refresh; amounts from a conflicting old account are withheld.
5. Retain and review jurisdiction-specific rules in Sources & history. Unsupported counties can use manually sourced rule evidence. Confirm classification, ratio, reassessment effective year, exemptions, caps/expiration and rate units.
6. Prepare continuation, acquisition-sensitivity and custom cases. Each parcel has an editable row for every hold year plus the forward year used for exit NOI. Resize/align a schedule to a new hold without discarding rows with matching years. Added years are draft assumptions and need review.
7. Save the tax workspace. Open interactive IOS underwriting, load saved scenarios, explicitly select one and preview annual tax and return impacts. Review the reimbursement and embedded-expense treatment before clicking Apply. Tax research and saving a scenario never change underwriting assumptions.

## Calculations and underwriting

Rates convert explicitly: dollars per $100 and percent divide by 100; mills divide by 1,000; decimal rates are already fractions. Annual gross tax is `max(0, assessed − exemption) × decimal rate + special assessments`, unless the user explicitly overrides gross tax. Assessed value is market estimate × valuation ratio, optionally limited by a supported cap through its stated expiration year. The reset flag bypasses that cap in the explicitly selected year; it never automatically uses purchase price. Exemptions, rates, special assessments and reimbursements are annual inputs. Different jurisdiction exemptions/rates require a documented effective schedule or an explicit annual gross override calculated from the individual authority records.

The current model uses full operating years rather than calendar-date closing prorations. The selected start year maps to model Year 1; the user must confirm that mapping. Acquisition costs, closing prorations, prior-owner tax arrears, penalties and interest are not silently added to recurring taxes. Enter expected collectible reimbursements; the separate recovery line receives no additional vacancy haircut or management fee.

Applied schedules replace the existing property tax expense, show gross taxes and positive tenant reimbursements separately, and remove the explicitly entered tax component from OtherOpex once. Reimbursements already in rent must be zero in the schedule. OtherOpex deductions follow the existing expense-growth assumption; unusual annual embedded taxes must be reconciled manually. Fixed schedules do not automatically change with purchase-price sensitivities, including solved-price calculations. Legacy tax inputs remain available if the schedule is removed. Removed OtherOpex amounts are not silently restored; review that field.

IOS underwriting remains a session draft, consistent with the existing UI. Download its JSON snapshot to retain an applied schedule. Uploaded industrial Excel workbooks are preserved; automatic tax-schedule application is limited to the interactive IOS engine. The tax workspace can be exported for workbook review.

## Connected sources and explicit limits

- US Census coordinate geographies resolve county/state at a verified pin. Missing or imprecise pins can use the existing server geocoder where configured; no state is assumed from a bare city name.
- Texas: TxGIO’s supported `MapServer/identify` endpoint returns all intersecting candidate records. Its county appraisal roll provides parcel identity and dated market values, **not** taxable values, exemptions, issued bills or payment history. County-specific appraisal/collector bill extraction is not connected. No five-year bill history is fabricated.
- Gwinnett, GA: official county parcel GIS identifies accounts. The public Tax Master table has undated value fields; these are retained as raw evidence without being asserted as current or historical taxes. Dated assessor/collector records must be entered or attached manually.
- Other counties: automated dated bill/assessment extraction is not connected. The workspace supports sourced manual records, bill attachment and rules for those jurisdictions. A source gap is explicitly reported; login/CAPTCHA/access controls are never bypassed.
- Official Texas Comptroller and Georgia DOR rules are retrieved server-side when available. The Texas non-homestead temporary circuit-breaker expiration after 2026 is disclosed; no automatic cap or exemption is applied to an IOS parcel. County-specific applicability still requires review. Published future notices/bills remain in Annual records with their actual year/status; calculated scenarios always remain estimates.

Primary verification sources, retrieved October 21, 2026:

- [Georgia DOR worked example and assessment rules](https://dor.georgia.gov/property-tax-real-and-personal-property-faq): $100,000 market × 40%, less $2,000 example exemption, × 25 mills = $950. The exemption is tested as a worked example, not applied by default to commercial property.
- [Texas Comptroller valuation rules](https://comptroller.texas.gov/taxes/property-tax/valuing-property.php).
- [Texas Comptroller rate calculations and units](https://comptroller.texas.gov/taxes/property-tax/truth-in-taxation/calculations.php).
- [TxGIO official parcel layer](https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0): live identify verification at the public State Capitol parcel returned Travis account 197003, tax year 2026, market value $266,787,500. This verifies parser provenance and year handling; it establishes no taxable value or tax bill.
- [Gwinnett Property and Tax service](https://services3.arcgis.com/RfpmnkSAQleRbndX/ArcGIS/rest/services/Property_and_Tax/FeatureServer): field metadata verifies that the Tax Master fields do not identify a tax year.

## Storage and security

Pending migration: `supabase/migrations/20261021193133_deal_property_taxes.sql`. It creates deal-scoped structured state and immutable revision snapshots, with RLS and browser-role privileges revoked. Authenticated server routes follow Hopper’s existing shared acquisitions-workspace access model. Only the service role can call the atomic save RPC. Row locking and expected revisions reject stale overwrites; original evidence cannot be removed or rewritten. Research requests send only public location information to fixed official endpoints; user source URLs are never fetched server-side. Upload/signing paths are scoped to the selected deal.

The migration is **unapplied**. Apply it through the normal release process before using persistence. Tests use in-memory PGlite only; no production data is modified.

## Verification

`npx vitest run lib/property-taxes/__tests__ lib/uw lib/comps/__tests__` covers identity normalization, ambiguous matches, independent parcels, overlapping accounts, missing years, proposed figures, exemptions, rate conversions, caps/expiry, reassessment timing, manual override/identity retention, official-record parsing, access failures, SQL history/stale writes/privileges, authenticated API behavior, bill signatures and scoped links, and underwriting gross/recovery/expense/exit/price-solve treatment. The local production build and TypeScript checks also run. Browser verification uses the actual components against synthetic records and in-memory PostgreSQL, with environment-file loading disabled.
