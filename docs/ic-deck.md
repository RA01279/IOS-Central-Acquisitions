# IC deck from the acquisition model

On a deal page, **IC Deck — Executive Summary** builds the 23-slide executive summary in the Golden Spike v2 order and Dalfen template.

1. Choose the current UW workbook (`.xlsx`/`.xlsm`). It is read in the browser; only the extracted figures are sent to Hopper.
2. Review the headline numbers and **model checks**.
3. Download the `.pptx`. All text and tables are editable.

## Where each slide's content comes from

| Source | Slides |
|---|---|
| Model, cached values as Excel last calculated (ES Summary, Pro Forma, Deal Overview, Rent Roll, Memo Pro Forma) | Exec summary metrics and tables, Model, Market leasing assumptions, Cash flow, Sensitivities |
| Hopper deal record and saved LOI terms | Deal status, Pursuit terms, DD budget deposit |
| Hopper comps (confirmed, ranked like the deal page: 15 mi, 24 months, top 10) | Lease comps, Sale comps (+ maps) |
| Hopper owned assets within 50 mi | Portfolio context and summary |
| Google Static Maps of the recorded pin | Cover, location, aerials, comp and portfolio maps |
| Not available to Hopper: left as orange `[Analyst: …]` text or grey "Exhibit needed" boxes | Location highlights, zoning, tenant credit, photos, market canvas, DD costs |

Values are found by row label, not cell address, so they survive inserted rows. Nothing is recalculated except labelled display arithmetic (PSF, coverage).

## Model checks

The UW template carries hidden sheets and blocks from earlier deals, and Excel data tables that only refresh on a full recalc. The builder reports these instead of copying them:

- Site SF on ES Summary not matching the acreage. The deck uses acreage.
- Deal Overview's MLA name not matching the rent roll. The row is dropped.
- Pro Forma's fixed "Base Case" exit-cap table not matching the base-case IRR (stale price).
- Sensitivity tables inconsistent with the base case. Recalculate (F9) and save.
- Deal Overview / Rent Roll titled for a different property.
- Model price differing from Hopper's contract price or latest offer (flagged on Pursuit Terms).

Checks also appear in slide 2's speaker notes. Hidden sheets such as Memo Table are never read.

## Template

`lib/ic-deck/templates/ic-deck.pptx` was built with `scripts/prepare-ic-template.cjs` from the Golden Spike v2 deck. It keeps only the master, two layouts, theme and Dalfen logos; no deal content.

Validation: `node scripts/test-ic-deck.mjs`, typecheck/build, and opening the rendered deck in installed PowerPoint.
