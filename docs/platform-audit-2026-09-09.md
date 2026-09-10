# Hopper platform audit — September 9, 2026

The first priorities are database access control, financial and stage validation, and reliable intake. Automating Outlook before those are resolved would amplify existing data-quality problems.

## Scope and evidence

Reviewed the repository at commit `3cf976d` plus existing uncommitted work; inspected the signed-in production Home and Pipeline screens; queried the configured Supabase database using read-only SQL; made three minimal anonymous REST reads; ran TypeScript checking and the comp-matching suite. No business records, permissions, or deployments were changed in this audit. Audit scripts and this report were added locally.

This is a targeted application audit, not a complete penetration test or a desktop/mobile accessibility certification. No destructive API calls, email sends, bulk data exports, or exploit payloads were used. Backup restoration, production environment values, delivery logs, and every role's browser session were not verified.

## Current data snapshot

| Measure | Observed |
| --- | ---: |
| Active acquisition deals | 63 |
| Active deals without coordinates | 12 (19%) |
| Active deals without assigned analyst | 63 |
| Total property records | 484 |
| Property groups with repeated normalized address and city | 12 groups, 13 excess rows |
| Comps | 436 |
| Comps without asset class | 393 (90%): 271 lease, 122 sale |
| Comps with null latitude or longitude | 0 |
| Portfolio assets | 40 |
| Assets with null latitude or longitude | 0 |
| In-contract deals missing contract price | 1 of 6 |

Repeated property addresses are candidates for review, not proof that every row should be merged. Coordinates being present does not prove they identify the correct parcel. These counts do not establish why the three previously reported Austin comps failed to appear.

## Findings, in recommended order

### 1. Critical — anonymous database access bypasses the application login

**Confirmed against the configured live database.** `public.offers`, `public.assets`, and `public.app_settings` have RLS disabled and anonymous SELECT/INSERT privileges. Minimal requests using only the public anonymous key returned HTTP 200 and one row from each table. The checks selected IDs or a setting key only; no setting values were printed or exported. Anonymous writes were not exercised.

This exposes business records and permits operations through the Data API that bypass Hopper's authenticated routes. `app_settings` is especially sensitive because the code stores the export token and configurable webhook destinations there. Access to values could undermine the separate export-token gate; modification of webhook destinations could redirect subsequent notifications.

**Fix:** enable RLS and remove unnecessary anonymous/client grants on server-only tables, audit executable functions and views, and check client dependencies before rollout. Rotate the export token and any sensitive values stored in exposed settings after access is closed; review access logs for possible use. Do not infer a breach from exposure alone.

**Verify:** unauthenticated reads and writes cannot access these records; authenticated Hopper routes, exports with a newly issued token, portfolio views, and offer entry continue working. Other core tables currently have RLS enabled and no policies, which is consistent with their server-service-client access pattern.

Evidence: `scripts/audit-platform.mjs`, `lib/supabase.ts`, `app/api/export/route.ts:61`, `lib/webhooks.ts`, `app/api/cron/digest/route.ts`.

### 2. High — framework version is behind published security fixes

`package.json` pins Next.js 14.2.5. Vercel's May 2026 advisory includes all Next.js 14 versions and identifies fixed newer releases. This audit does not establish that every listed vulnerability is reachable in Hopper, but the framework needs a supported, patched baseline. A December 2025 patch within 14.x alone is no longer a sufficient upgrade target.

**Fix:** upgrade to a currently patched supported release, accommodate the App Router/auth API changes, and verify login, protected pages, uploads, and reports in a preview deployment before release.

Reference: [Vercel May 2026 security release](https://vercel.com/changelog/next-js-may-2026-security-release).

### 3. High — price parsing silently changes values

**Reproduced locally from the actual route function:** `$4.2M` becomes `4`; `-100` becomes `100`; `4,200,000` works correctly. The parser strips letters and signs and then rounds. Its own comment claims support for `$4.2M`.

**Fix:** use one validated money parser across intake, edit, offers, and closing. Explicitly support K/M suffixes or reject them with an actionable error. Reject negative and malformed values. Display the interpreted dollar amount before saving.

**Verify:** shorthand, currency symbols, separators, decimals, negative amounts, empty inputs, and malformed text have explicit outcomes; clearing optional fields remains distinct from invalid input.

Evidence: `app/api/deals/[id]/route.ts:10`; `scripts/audit-platform-code.mjs`.

### 4. High — stage correction bypasses the normal workflow gates

`set_acq_stage` accepts any acquisition stage without the `confirm_psa` allowlist or the closing date/price requirements in `mark_closed`. The comment describes a backward correction, but the server does not enforce backward movement. The database checks valid stage names and positive non-null prices, but does not require closing date and price for a closed deal. Ordinary detail editing can also clear a closed price.

**Fix:** put transitions, role checks, required fields, and audit events behind one transactional operation. Restrict correction to valid backward moves or authorized overrides with a recorded reason. Enforce closing completeness in the database. Use the current stage/version as a concurrency condition.

**Verify:** ordinary users cannot reach PSA through the correction route; no route can produce Closed without valid closing data; concurrent actions cannot silently overwrite each other. No production transitions were attempted during this audit.

Evidence: `app/api/deals/[id]/route.ts:151`, `:190`; live deal constraints.

### 5. High — retries can create duplicate or partially saved deals

`createDeal()` inserts property, deal, optional MLA, contacts, and events through separate calls. Duplicate detection runs at the end, after saving. A later failure can therefore report a failed operation after some records already exist; retrying can create another property and deal. The New Deal form uses only the returned deal and does not surface the duplicate list.

**Fix:** normalize addresses with city/state and parcel identity where available; check before creation; show possible matches; make creation transactional and idempotent. Email intake also needs unique source-message identity and a per-property candidate identifier. Do not merge properties on street address alone.

**Verify:** repeated and concurrent delivery of the same email creates one candidate/deal; a failed contact/event write rolls back or resumes the same operation; multiple properties in one email remain separate.

Evidence: `lib/deals.ts:151`, `:258`, `:365`; `components/DealForm.tsx`; live repeated-address counts.

### 6. High — classification does not reliably constrain underwriting evidence

393 of 436 comps lack `asset_class`. The scorer receives the subject asset class but does not enforce class compatibility. A synthetic Industrial lease comp was accepted into an IOS subject's recommended range in the local reproduction. The deal page loads confirmed comps without filtering class.

Deal intake also defaults both pipeline and property type to IOS. There is no implemented evidence-based classifier or stored confirmation of your yard rule.

**Fix:** record usable yard acreage, primary use, outdoor-storage evidence, classification explanation, and reviewer confirmation. Your confirmed rule is: **a warehouse with a substantial, separately usable outdoor storage yard is IOS**. Ordinary loading/parking or excess land alone is insufficient. Route uncertainty to review. Backfill comp classifications from evidence, preserve human corrections, and make cross-class evidence an explicit analyst override rather than silent inclusion. Keep asking price distinct from an offer or contract price.

**Verify:** classification fixtures cover warehouse-plus-yard, ordinary warehouse parking, pure yard, incomplete listings, and multi-property emails. Class-unknown comps remain visible for review but are distinguishable from approved class-matched evidence.

Evidence: `components/DealForm.tsx:142`, `lib/deals.ts:85`, `lib/comps/match.ts`, `scripts/audit-platform-code.mjs`.

### 7. High — incomplete locations and pending deployment obscure map completeness

The live IOS pipeline shows 40 active deals but 33 pins. Across both pipelines, 12 of 63 active deals have no coordinates. The live missing-pin message assumes vague addresses or placeholders, although it does not establish the cause for each record.

Existing local work adds Google-first precise lookup, property coordinate editing, improved comp save feedback, and map completeness handling. It is not all in deployed commit `3cf976d`. The database's closed-deal asset transfer and coordinate synchronization triggers are installed, but the live pipeline still exposes a Closed map layer while the requested policy is to transfer Closed deals to Our Assets.

**Fix:** reconcile and deploy the pending map workflow as one tested release; add a clickable Needs Location queue with reason, address verification, manual pin entry, and saved provenance. When a property address changes, invalidate or reverify its coordinates: the current deal detail update writes the address without updating the pin.

**Verify:** create/edit an address, fix a missing pin, transition every stage, close, correct a closing, and compare board/map/assets counts. Test portfolio placeholders and multi-parcel properties separately. Do not invent a precise pin for an unresolved location.

Evidence: live Pipeline UI; database counts; `app/api/deals/[id]/route.ts:190`; current git status and installed triggers.

### 8. Medium — analyst decisions disappear on refresh

Comp exclusions and demand-map tenant exclusions are held in component state. Refreshing loses the reviewed selection; demand reports are regenerated from live search rather than a stored reviewed snapshot.

**Fix:** save each reviewed comp set and demand report with inputs, source date, exclusions, reviewer, and version. Export the saved version so another analyst can reproduce the same IC evidence. Present keyword-selected businesses as potential IOS users until their yard use is verified.

**Verify:** refresh or open the deal as another authorized user and recover the same evidence set; regenerate as a new version rather than replacing the reviewed set.

Evidence: `components/DealCompsPanel.tsx:51`, `components/IcDeckPanel.tsx:27`, `:31`; demand-map keyword filters.

### 9. Medium — follow-ups need accountable ownership

All 63 active deals have no assigned analyst. The Home page correctly flags 12945 Market Street's DD and closing dates as 16 days overdue; that record also lacks a contract price. Missing analyst assignment does not prove no one owns the work outside Hopper.

**Fix:** put Owner, Next Action, and Due Date on pipeline cards and add My Deals / Needs Attention views. Convert overdue milestones into assigned resolution tasks, including extension or date-correction reasons. Maintain a data-quality queue for missing location, classification, pricing, owner, and source documents.

**Verify:** every active deal has a responsible person or a visible unassigned state; overdue tasks remain traceable until resolved. Review portfolio/package transactions so shared purchase prices are allocated or grouped instead of potentially counted twice.

### 10. Medium — deletion removes the audit history

Every pipeline card offers permanent deletion after a browser confirmation. Any signed-in user can call the DELETE route. Child history is deleted by cascade, while stored files remain. There is no recovery flow in this route.

**Fix:** use Archive for ordinary removal; reserve permanent deletion for authorized administrators. Add a recoverable trash period, a deletion reason, and a durable audit record outside the deleted deal. Handle linked assets and storage cleanup explicitly.

Evidence: `components/CardDeleteButton.tsx`, `app/api/deals/[id]/route.ts:283`.

### 11. Medium — uploads and version creation need stronger boundaries

The private documents bucket has no configured file-size or MIME allowlist. The upload route does not confirm the deal exists; the version route accepts a caller-supplied storage path without checking it belongs to that deal. Version numbers use read-then-increment, so concurrent uploads can collide after a document row has already been saved. Uploaded documents are listed without a general download workflow.

**Fix:** bind upload authorization to a deal and expected path, enforce supported types and size limits, make version creation atomic/idempotent, and provide authorized downloads. Surface stale/missing workbook cached values and preserve parser warnings. Use a quarantine/review path for future emailed attachments.

Evidence: `app/api/deals/[id]/upload-url/route.ts`, `app/api/deals/[id]/versions/route.ts`, `lib/excel-parser.ts`, live bucket settings.

### 12. Medium — monitoring and release checks are incomplete

TypeScript checking and the 91 existing comp-matching checks pass, but neither caught the reproduced class mismatch or money-parser defect. There is no checked-in GitHub Actions workflow and no consolidated test command. Several broad queries use fixed limits or default empty data on query failure, risking incomplete or misleading totals as volume grows.

The digest endpoint enforces authorization only if `CRON_SECRET` exists; missing configuration makes it fail open. Production configuration was not inspected and this sending endpoint was deliberately not called. Webhook delivery has no durable retry queue.

**Fix:** add required CI checks for money, transitions, permissions, duplicate retries, classification, and export validity. Reject missing cron credentials, use explicit error states, paginate complete datasets, and record job success/failure with retry status. Document and exercise database/storage restoration and a release checklist that reconciles migrations with app code.

Evidence: `package.json`, `lib/summary.ts:276`, `app/dashboard/page.tsx:125`, `app/api/cron/digest/route.ts:22`, `lib/webhooks.ts`, repository workflow inventory.

## Recommended release sequence

1. **Access and correctness:** close anonymous access, rotate exposed settings secrets, upgrade the framework, repair price parsing and transition gates.
2. **Reliable daily workflow:** transactional duplicate-safe creation, deploy and verify map fixes, assign owners, expose data-quality queues, improve recovery and upload boundaries.
3. **Outlook intake:** connect `hopper@dalfen.com` after IT creates it; store source messages, extract per-property candidates, apply the confirmed IOS rule, review uncertain cases, and retain provenance. Begin with reviewed classifications and evaluate accuracy before unattended promotion.
4. **Reproducible analysis:** version comp selections and demand maps, add package-aware reporting, monitor jobs, and enforce CI/release checks.

## Verification performed

- `npm run typecheck`: passed.
- `node scripts/test-comp-match.mjs`: 91 passed, 0 failed.
- `node scripts/audit-platform-code.mjs`: reproduced incorrect monetary parsing and cross-class comp inclusion using synthetic inputs.
- `node scripts/audit-platform.mjs`: read-only metadata/count queries and minimal anonymous reads. No financial values, credentials, or settings values were exported.
- Signed-in production Home and Pipeline inspection confirmed current stage counts, missing-pin notice, and overdue dates.

Security reference: [Supabase row-level security and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).
