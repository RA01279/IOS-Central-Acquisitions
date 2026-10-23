# Historical property tax bills

The deal's Property Taxes overview now leads with a five-year bill-history table. It displays published historical billed amounts, actual tax years, account IDs, source links and review status. Paid bills remain bill history; payment amounts and remaining balances are separate metrics. Unknown years stay unavailable. Assessed values and forecasts never stand in for bill amounts.

## Connected historical sources

- **Harris County, Texas:** follows the public account page's normal session into its published five-year comparison. Imports `Total Tax Bill by Year` for the five latest available tax years after verifying the collector account and situs address, aligning year columns and reconciling authority bill charges to the total. Retains the collector table and matched account evidence. Rates retain their published per-$100 units. Collector totals may exclude separately billed authorities, including school districts; that scope is shown with the records.
- **Travis County, Texas:** retrieves the official original bill PDF using the geographic parcel evidence, then verifies both the collector account printed on the PDF and its situs address. Extracts the five most recent historical `Tax Imposed / Total` amounts from the PDF's positioned table. It verifies the year labels, column positions and sum of authority charges. The PDF layout fails closed if unrecognized. Its original bill URL and positioned source text are retained. Published latest bill years are shown as-is; a 2025 source is never relabeled 2026.
- **Gwinnett County, Georgia:** existing latest-bill PDF retrieval remains available. Its prior-year search requires interactive CAPTCHA access. No historical values are invented and no CAPTCHA is bypassed.
- **Other counties:** this release does not claim universal historical-bill coverage. Dallas's public payment history and balances were inspected and deliberately not imported as historical bill amounts. Tarrant's collector search required an interactive access check; Bexar's collector site was inaccessible from the server. Those gaps require supported official records or a bill upload.

The table distinguishes an issued statement from a collector-reported bill-history comparison. Published history may reflect corrections or amended levies; it is not claimed to be the immutable first bill originally mailed. Multi-year source labels list the actual imported years and retrieval date. Source history and manual overrides are preserved on refresh. Parcel matches still need review before combined property totals or underwriting schedules can be used.

## Verification

Representative public records retrieved October 22, 2026:

- Harris account 0612170060008, 1626 Central Park Drive: 2025 $27,462.14; 2024 $26,947.83; 2023 $25,333.80; 2022 $3,450.45; 2021 $2,505.29. Official source: https://www.hctax.net/Property/ViewStatementReceipts (account page → 5 Year Account History). Collector scope applies.
- Travis geographic account 02371408060000, 8319 N Lamar Blvd: 2025 $157,106.14; 2024 $152,141.43; 2023 $153,718.49; 2022 $157,993.84; 2021 $156,720.89. Official PDF: https://travis.go2gov.net/export?account=02371408060000&type=org . The rendered PDF table was visually checked against the parsed year/amount pairs.

Tests cover retained official fixtures, live read-only retrieval, wrong account/address, missing years, blank-vs-zero amounts, mismatched sums, changed layouts, source-year labels, overview display, excluded neighbors, manual overrides, source validation, ordinary session isolation and refusal of unapproved redirect hosts. Tests do not write production data. No schema migration is required: bill provenance is an optional structured field in the existing versioned tax workspace. Underwriting is never changed by research.
