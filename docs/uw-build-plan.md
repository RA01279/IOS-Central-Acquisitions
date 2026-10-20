You are working in Hopper (Next.js 14 / TypeScript / Supabase). Goal: add a

multi-tenant IOS underwriting module whose assumptions are driven by the lease

and sale comps already stored in Hopper. Work in phases and STOP after each one

for my review. Do not modify existing tables or features in Phase 0.



Note: Windows/PowerShell. Re-navigate to the project root at the start of each

session and quote paths containing \[id] folders.



PHASE 0 — Read-only audit (no changes)

\- Find the existing lease comp and sale comp tables/types. Report columns,

&#x20; units, and how rent is stored (per acre, per SF, flat monthly, annual).

\- Report row counts, date range, % with acreage, % with source, any verified

&#x20; flag, and obvious data-quality problems (nulls, duplicates, unit mixing).

\- Propose a normalized view or adapter that converts every lease comp to

&#x20; $/acre/month NNN and every sale comp to $/acre and cap rate.

\- Report what is missing for this to work. Do not fix anything yet.



PHASE 1 — Calc engine (pure TypeScript, no UI)

\- Port fixtures/Rendon\_Rd\_IOS\_DCF.xlsx to lib/uw/engine.ts: rent roll with

&#x20; start/end/retention/scenario include %, opex, capex, debt (IO then amortizing,

&#x20; annual sums of monthly payments), unlevered and levered cash flow, IRR (Newton

&#x20; with bisection fallback), closed-form solved price, exit-cap x rent-growth

&#x20; sensitivities. Keep Excel's names so each function is traceable.

\- Vitest golden tests against the workbook at its default inputs. Match to 1e-6:

&#x20; Base: unlevered IRR 10.5295%, levered 13.8939%, Yr-1 NOI $427,815, solved

&#x20; price $5,656,335, gross exit $7,211,102, min DSCR 1.830.

&#x20; Upside: unlevered 18.68%, levered 27.14%, solved $8,609,193.

&#x20; Downside: unlevered 0.87%, levered -8.28%, solved $3,304,431.

&#x20; Hold 5: 10.65% / 14.30%. Hold 10: 10.44% / 13.48%.

&#x20; Reassessed taxes: 4.47% / 1.64%, solved $4,385,140.

\- Invariant tests: IRR at solved price equals target; sensitivity center equals

&#x20; headline IRR; tenant revenue sums to total.



PHASE 2 — Comp-driven assumptions

\- Select comps by submarket/radius, last 24-36 months, verified only; trim

&#x20; outliers (IQR); require n >= 5 or return "insufficient comps".

\- Output market rent/acre, exit cap, and price/acre as downside/base/upside

&#x20; (75th pct / median / 25th pct for caps, reversed for rents) with n, range,

&#x20; and comp IDs as provenance.



PHASE 3 — UW screen, then exports

\- Inputs show each value's source (comp-derived, manual, seller) and warn when

&#x20; a manual value is outside the comp range. Defaults: reassessed taxes ON,

&#x20; management and reserves above zero.

\- Freeze a snapshot of the comp set and inputs per saved underwriting.

\- Extend the existing pptxgenjs IC slide; add an Excel export built from the

&#x20; fixture workbook as a template.



Start with Phase 0 only and show me the report.



Addendum to docs/uw-build-plan.md (supersedes it where they conflict).

Phase 0 is approved with these decisions:



1\. "Multi-tenant" means multi-tenant properties (rent roll). No workspace

&#x20;  or tenant-isolation work.

2\. Lease comps with blank lease\_type: treat as NNN, flagged

&#x20;  nnnStatus="assumed". Report stats with and without them. Never mix silently.

3\. Verified: use two tiers. "screened" = automatic (status confirmed, not

&#x20;  flagged as duplicate/outlier, has source\_ref, has acreage). "verified" =

&#x20;  human review, needs verified\_at / verified\_by columns in a later additive

&#x20;  migration. Phase 2 must show n for each tier.

4\. Exit cap: comps have none. Keep exit cap a manual input labeled

&#x20;  source=manual until a market has at least 5 sale comps with a cap rate.

&#x20;  Do not derive cap rates by guessing NOI.

5\. Never delete comps. Duplicates and outliers get an excluded flag plus a

&#x20;  reason, in a later reviewed migration, after a dry-run report I approve.

6\. Treat yard\_acres as unreliable. Use lot\_sf / 43560 for acreage in the

&#x20;  adapter.

7\. Compute rent and sale stats within acreage bands (<3, 3-10, 10-25, 25+).

&#x20;  Warn when the subject is outside the comp size range or a band has fewer

&#x20;  than 5 comps. Do not use plain IQR trimming across all sizes; large-lot

&#x20;  month-to-month sales like 1700 Dowdy Ferry may be legitimate comps.

8\. Stack is Next 15.5 / React 19.



NEXT STEP - do A only, then stop:

A. Read-only audit of the existing uw\_versions table and the approved Excel

&#x20;  model flow: schema, the 123 rows, how versioning and approval work, and

&#x20;  what it computes. Recommend whether the new module should reuse its

&#x20;  versioning/approval, and whether its outputs should also become golden

&#x20;  tests. Make no changes.



Phase 1 - Calc engine (pure TypeScript). Branch: feat/uw-engine. Do not

commit; leave changes for my review. Read docs/uw-build-plan.md and

docs/uw-addendum section for context.



HARD RULES

\- Do not touch uw\_versions, any Supabase table, any existing route, lib/comps,

&#x20; lib/excel-parser.ts, or lib/ic-deck. No DB calls, no fetch, no Next imports

&#x20; inside lib/uw/. Pure functions only.

\- Install vitest as a devDependency and add an npm "test" script if missing.

\- Stack is Next 15.5 / React 19.



BUILD

lib/uw/types.ts, lib/uw/engine.ts, lib/uw/irr.ts, lib/uw/fixtures/rendon.ts,

lib/uw/\_\_tests\_\_/engine.golden.test.ts, lib/uw/\_\_tests\_\_/invariants.test.ts



Read fixtures/Rendon\_Rd\_IOS\_DCF.xlsx with exceljs (formulas and named ranges,

not just values) and port it faithfully. Tabs: Inputs, RentRoll, Capex,

CashFlow, Sens. Keep the workbook's names (Hold, ExitCap, RentGrowth, Vacancy,

TaxSwitch, etc.) so each function traces to the workbook. Put the workbook's

default inputs in fixtures/rendon.ts as a typed object; that is the test input.



Easy-to-get-wrong details (verify each against the workbook formulas):

1\. Tenant revenue per year t = annual rent x scenario include % x

&#x20;  (1+bump)^(t-1) x (months in lease + retention x months after lease end)/12,

&#x20;  where months are counted from closing, start month = start + lease-up delay

&#x20;  (pipeline tenants only), and blank lease end means no expiry. The bump is the

&#x20;  tenant's own bump, else market rent growth. Growth runs from year 1 even for

&#x20;  tenants that start later.

2\. Vacancy applies to total scenario revenue. Management fee applies to

&#x20;  effective gross revenue. Taxes/insurance/other grow at expense growth

&#x20;  (1+g)^(t-1). TaxSwitch=1 uses purchase price x tax rate.

3\. Capex: per-item include flag by scenario, cost x (1+overrun), booked in the

&#x20;  item's year. Reserves are per acre per year, grown by expense growth.

4\. Exit: gross value = forward NOI (year Hold+1) / exit cap; less sale costs;

&#x20;  less loan balance at end of the hold year. Years run 0..11; year 11 exists

&#x20;  only to supply forward NOI for a year-10 exit.

5\. Debt: interest-only for IOYrs, then monthly amortization over AmortYrs;

&#x20;  annual interest and principal are sums of monthly amounts (match

&#x20;  CUMIPMT/CUMPRINC). Guard zero loan, zero rate, and periods past

&#x20;  amortization.

6\. IRR: Newton with bisection fallback; try guesses 0.10, -0.15, -0.30; return

&#x20;  null (displayed "n/m") if none converge. Never return NaN.

7\. Solved price is closed form, including the reassessed-tax term. Do not

&#x20;  iterate or search for it.

8\. Sensitivities: rent-growth shift applies only to tenants with no stated

&#x20;  bump; exit cap shifts by step. Rebuild NOI per shift. Levered = unlevered +

&#x20;  debt service in hold + loan payoff.



TESTS (vitest)

A. Golden table. Dollars must equal the workbook after rounding to the nearest

&#x20;  dollar; IRRs must match to 4 decimal places of a percent.



Scenario    Unlev IRR  Lev IRR  Yr-1 NOI  Solved price  Gross exit  Min DSCR

Base        10.5295    13.8939  427,815   5,656,335     7,211,102   1.830

Upside      18.6759    27.1419  553,369   8,609,193     11,625,231  2.597

Downside     0.8742    -8.2791  287,210   3,304,431     3,985,410   1.180

Hold 5      10.6510    14.2977  427,815   5,646,088     6,797,155   1.830

Hold 10     10.4396    13.4767  427,815   5,669,388     7,879,766   1.830

Reassessed   4.4673     1.6442  311,815   4,385,140     5,173,025   1.339

(Reassessed = Base with property tax reassessed at the input price.)



B. Year-by-year check for Base: compare the engine to the fixture's cached

&#x20;  CashFlow values for years 1-11: total scenario revenue (row 19), effective

&#x20;  gross revenue (21), NOI (30), unlevered cash flow (46), debt service (53),

&#x20;  loan balance (54), levered cash flow (56). Report the max absolute

&#x20;  difference.

C. Invariants: IRR at the solved price equals the target IRR (10%); the center

&#x20;  cell of each sensitivity grid equals the headline IRR; tenant revenue sums to

&#x20;  total revenue; hold period 1 and 10 both run without error; leverage off

&#x20;  gives levered = unlevered.



DONE WHEN: all tests pass. Then STOP and report: files created, test output,

max cash-flow difference, any workbook behavior you could not reproduce and

why, and anything in the workbook formulas that looks wrong or inconsistent.

Do not start Phase 2.



Phase 1b - Workbook fixes. Branch: feat/uw-engine. Do not commit. The fixture

fixtures/Rendon\_Rd\_IOS\_DCF.xlsx has been replaced with a corrected version.

Same HARD RULES as Phase 1: touch only lib/uw/, package.json if needed, and the

fixture. No DB, no existing routes.



CHANGES TO PORT (verify each against the new workbook formulas):

1\. Capex include. Capex rows 1-2 (lease-up paving) no longer use fixed 1/0

&#x20;  flags. Row 1's include % per scenario = the large tenant's include % (RentRoll

&#x20;  M15:O15). Row 2's = MAX of the Prime-expansion and Straight 6-expansion include

&#x20;  % (RentRoll rows 13-14). Rows 3-4 (fencing, lighting) stay 1/0 flags.

&#x20;  Scenario cost = gross cost x include x (1 + CapexOverrun).

2\. Debt. If LoanRate = 0: interest is 0 and principal is loan / AmortYrs per

&#x20;  year after the IO period (straight-line). Reject negative rates (throw).

3\. Yield on cost = NOI in year MIN(2, Hold) / (price x (1 + CloseCost) + capex

&#x20;  scheduled inside the hold). Reserves are not in the cost basis.

4\. Add capexAfterExit to the output: sum of scenario capex cost for items whose

&#x20;  year > Hold. It is a warning only; those costs are still not charged to the

&#x20;  hold cash flows.



TESTS

\- Keep the existing 46 tests. The six golden rows are unchanged, and YoC for

&#x20; them is unchanged: Base 7.9070, Upside 11.3178, Downside 5.1465, Hold 5 7.9070,

&#x20; Hold 10 7.9070, Reassessed 5.8254 (percent).

\- Add golden cases (IRRs in percent, 4 dp; dollars rounded):



Case                    Edit to the fixture inputs          Unlev   Lev      Solved price  Gross exit  Min DSCR  YoC

LargeInBase             Base; large tenant include = 100%   16.4591 23.8145  7,681,876     10,015,214  2.505     10.9989

&#x20;                       (total scenario capex 358,750)

Rate0                   Base; LoanRate = 0                  10.5295 19.9099  5,656,335     7,211,102   3.793     7.9070

&#x20;                       (debt service yr 1 = 0, yr 4 = -121,000; loan balance end of yr 7 = 2,420,000)

Hold1                   Base; Hold = 1                      19.4688 32.9401  5,973,438     6,483,703   2.095     7.5121

&#x20;                       (capexAfterExit = 45,000)

CapexAfterExit          Base; lighting year = 9 (Hold 7)    10.6549 14.1510  5,692,976     7,211,102   1.830     7.9694

&#x20;                       (capexAfterExit = 45,000; total scenario capex still 157,500)



\- Add tests: negative rate throws; capexAfterExit is 0 in all six original

&#x20; cases; solved price still returns the target IRR in every new case.

\- Update lib/uw/fixtures/rendon.ts so capex include is derived from the

&#x20; tenants for items 1-2, not hard-coded.



DONE WHEN all tests pass (old and new) and typecheck is clean. STOP and report:

files changed, test output, and anything in the new workbook you could not

reproduce or that looks wrong. Do not start Phase 2.

