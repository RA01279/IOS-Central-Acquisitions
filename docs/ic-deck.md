# IC deck from the acquisition model

On a deal page, **IC Deck — Executive Summary** builds the 23-slide executive summary in the Golden Spike v2 order and Dalfen template.

1. Choose the current UW workbook (`.xlsx`/`.xlsm`). It is read in the browser; only the extracted figures are sent to Hopper.
2. Review the headline numbers and **model checks**.
3. Download the `.pptx`. All text and tables are editable.

## Where each slide's content comes from

| Source | Slides |
|---|---|
| Model, cached values as Excel last calculated (visible tabs only: ES Summary, Pro Forma, Market Leasing Summary, Rent Roll, Memo Pro Forma) | Exec summary metrics and tables, Model, Market leasing assumptions, Cash flow, Sensitivities |
| Hopper deal record and saved LOI terms | Deal status, Pursuit terms, DD budget deposit |
| Hopper comps (confirmed, ranked like the deal page: 15 mi, 24 months, top 10) | Lease comps, Sale comps (+ maps) |
| Hopper owned assets within 50 mi | Portfolio context and summary |
| Google Static Maps of the recorded pin | Cover, location, aerials, comp and portfolio maps |
| IC deck narrative agent (optional, below) | Location highlights, zoning, tenant overview, market — tagged "Agent draft — verify", sources in notes |
| Dalfen ArcGIS IOS inventory (below) | Market canvas tables and maps |
| Not available to Hopper: left as orange `[Analyst: …]` text or grey "Exhibit needed" boxes | Anything the agent could not source, photos, DD costs |

Values are found by row label, not cell address, so they survive inserted rows. Nothing is recalculated except labelled display arithmetic (PSF, coverage).

## Automatic drafts

Every UW upload builds the deck from the saved workbook and files it in the deal's Documents (`… - Exec Summary v{N} (auto draft).pptx`). If the uploader's Hopper helper is running, IC research is queued too; when it finishes, the deck is rebuilt as `(auto draft, researched)`. The helper copies each new deck to `F:\Investments\Acquisitions\Live\IOS\<ST>\<ST> (<City>) <Address>\01. Exec Sum\` (`--exec-summary-root` to change, `--no-exec-summaries` to turn off), matched by street address and never overwriting. Code: `lib/ic-deck/auto.ts`, `app/api/exec-summaries/outbox`, `scripts/outlook-helper/exec-summaries.mjs`.

## Computed site exhibits

- **Slide 5 parcel outline:** the parcel under the pin plus touching parcels with the same owner of record (TxGIO in Texas; county layers in Georgia). Acreage is the assessor's recorded legal area, compared with the underwritten acreage; a difference over 5% is shown in orange.
- **Slide 4 highway access:** nearest numbered highway from Census TIGERweb, with Google Routes (no traffic) drive distance and time to the closest point of the highway and to that highway's nearest on-ramp (H and R on the map).
- **Slides 12-15 market canvas:** every IOS property in the team's ArcGIS inventory within 5 miles of the pin. Slide 12 has the Tenant Usage and Owner Profile tables (properties, gross acres, share, occupied acres, vacancy by acreage, mean and sample std. dev. of site acres); slides 13-15 plot the properties over satellite imagery, colored by verified occupancy, tenant use and owner type (dots are native shapes). Inventories are tried newest first (`CANVAS_SOURCES` in `lib/ic-deck/canvas.ts`: South Central/Houston, Central, Southeast, West, Northeast) and the first with 10+ properties in range is used; one over a year old is flagged. Needs `ARCGIS_API_KEY` or `ARCGIS_USERNAME`/`ARCGIS_PASSWORD`; without them, or outside every inventory, the slides keep their placeholders.
- **Slide 7 tenant credit:** the research agent's `tenantCredit` section — public information only, sourced, never a credit conclusion.

## Model checks

The UW template carries hidden sheets and blocks from earlier deals, and Excel data tables that only refresh on a full recalc. The builder reports these instead of copying them:

- Site SF on ES Summary not matching the acreage. The deck uses acreage.
- Pro Forma's fixed "Base Case" exit-cap table not matching the base-case IRR (stale price).
- Sensitivity tables inconsistent with the base case. Recalculate (F9) and save.
- Pro Forma / Rent Roll / Market Leasing Summary titled for a different property.
- Model price differing from Hopper's contract price or latest offer (flagged on Pursuit Terms).

Checks also appear in slide 2's speaker notes. Hidden tabs (Deal Overview, Summary Table, Memo Table) are never read: they can carry stale figures from an earlier version of the model. Debt terms use Pro Forma's pre-stabilization rate block; LTPP is the initial loan over the purchase price; the acquisition date is the cash flow's Year 1 start; "Model as of" is the date Excel last saved the file.

## Agent drafts

**Draft with agent** in the panel queues the *IC deck narrative* agent on your connected computer (the same helper as the other agents; web search enabled). It receives only the address, city, acreage, building SF and tenant names — never price, returns or rent. It must cite a source for every bullet; a result with an unsourced bullet is rejected. Leads it could not confirm go to the notes as "Unverified". Credit always stays an analyst item.

The latest completed run for the deal is included when you build (untick to leave it out). Only your own runs, for that deal, are used.

Install: apply `20261001200000_ic_narrative_agent.sql`, deploy, and restart `npm run outlook:helper` so the helper knows the new agent.

## Template

`lib/ic-deck/templates/ic-deck.pptx` was built with `scripts/prepare-ic-template.cjs` from the Golden Spike v2 deck. It keeps only the master, two layouts, theme and Dalfen logos; no deal content.

Validation: `node scripts/test-ic-deck.mjs`, typecheck/build, and opening the rendered deck in installed PowerPoint.
