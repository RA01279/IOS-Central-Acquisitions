# Central Acquisitions

Deal intake -> underwriting -> offer -> PSA -> diligence -> closing tracker for
the Central acquisitions team. Built as a tracker first, not a polished product
-- lightweight, no IT dependency, running for the team this week rather than
gated on an enterprise review.

The product is called **Central Acquisitions**. The codebase, repo, and Vercel
project are still named `hopper` / `ios-central-acquisitions` -- renaming those
would change the production URL and every bookmark, so only the user-visible
naming changed. See `Acquisitions_Tracking_Tool_Spec_v2.docx` for the original
feature spec and `../HOPPER-HANDOFF.md` for the read-only export API.

## Two pipelines

Deals are split into **IOS** and **Industrial** by `deals.asset_class`, and the
Pipeline board toggles between them. `asset_class` is set at intake (defaulting
from the property's `asset_type`) and is editable per deal. It's a separate
field from `properties.asset_type` on purpose: asset_type has four values and
describes the property, asset_class has two and decides which book a deal is
reported in.

Stages: `prospect -> uw -> offered -> moving_to_psa -> due_diligence -> closed`,
with `archived` as the shared terminal. "In contract" in any roll-up means
`moving_to_psa + due_diligence`.

## Money

Three prices, in decreasing order of certainty, and reporting always uses the
best one available:

| Column | Set when | Meaning |
|---|---|---|
| `deals.closed_price` | Marking a deal Closed (**required**) | what it actually closed at |
| `deals.contract_price` | Confirming Moving to PSA, or entering DD (optional) | the agreed PSA price |
| latest `offers.price` | Any offer logged, or an LOI generated | what we last asked |

`dealValue()` in `lib/summary.ts` resolves them in that order and returns a
`valueBasis` alongside the number. **Every money figure carries its basis** --
subtotals report `estimated` (deals falling back to an offer) and `missing`
(deals with no price at all), and the UI prints those caveats. A half-inferred
total quoted as fact is the failure mode this exists to prevent.

Leasing was removed from the product in Aug 2026. Lease rows, lease stages, and
the `deal_type` column all remain in the database -- nothing reads them, nothing
creates them, and the decision is reversible.

## Architecture at a glance

- **Next.js 14 (App Router)**, deployed to Vercel from this repo.
- **Postgres via Supabase** -- see `supabase/migrations/`. If sharing a project
  with RIDGE Intel, run these against that same Supabase project; RIDGE Intel
  owns analysis/underwriting fields on shared tables, this app owns
  pipeline/contact/task fields.
- **Auth: plain Supabase email/password.** No Azure AD, no IT-approved app
  registration, no SSO. You create the accounts yourself in the Supabase
  dashboard. If this ever needs Dalfen SSO, that's a swap of `lib/auth.ts` only.
- **`lib/deals.ts`** holds the two write paths worth knowing about:
  `createDeal()` (single entry point for new deals) and `recordOffer()` (single
  entry point for offers -- called by the Log-offer form *and* by LOI
  generation, which is what makes the offer log self-maintaining).
- **`lib/summary.ts`** computes every number the home screen shows, and is
  shared with the export API and the morning brief so the three can't disagree.
  All date bucketing is America/Chicago, not UTC.
- **`lib/digest.ts`** is the single source of the morning brief; the cron route
  and the RSS feed are both just senders.
- **No CI pipeline.** Vercel deploys on push regardless; run `npm run build`
  locally before pushing if you want a sanity check.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev
```

Create your users in the Supabase dashboard (Authentication -> Users -> Add
user). `PSA_CONFIRM_ALLOWLIST` gates the Confirm-Moving-to-PSA action.

Apply migrations in order:

```bash
node scripts/apply-migration.mjs supabase/migrations/0016_pipeline_bifurcation.sql
node scripts/apply-migration.mjs supabase/migrations/0017_search_ranking.sql
node scripts/apply-migration.mjs supabase/migrations/0018_deal_prices.sql
```

(or paste the `.sql` files into the Supabase SQL editor). Both are written to be
safe to re-run.

## Screens

| Route | What it's for |
|---|---|
| `/` | Home screen: prospects / underwritten / offers submitted, toggled between last 7 days, month to date, and year to date; IOS vs Industrial subtotals; in-contract and closed roll-ups; DD expirations and closings inside 7 days |
| `/deals` | Pipeline board, six columns, IOS / Industrial / All toggle |
| `/deals/[id]` | Deal detail: returns summary, MLA, LOI generation, offers, contacts, documents, activity, stage actions |
| `/offers` | Offer log — every offer with date, price, land PSF, market, class, provenance; CSV download |
| `/targets` | Archived deals scored 1–5 with re-approach dates |
| `/contacts`, `/tasks` | CRM: people grouped by company, follow-ups |
| `/dashboard` | Operational detail: per-class funnels, intake/offer velocity, stale deals, where deals die, activity mix, archive |
| `/search` | Fuzzy search across deals, contacts, companies, notes, tasks (`/` focuses the box) |

## Automation

- **Morning brief** — `vercel.json` cron hits `/api/cron/digest` each weekday at
  13:00 UTC. Leads with DD expirations and closings inside 7 days, then overdue
  follow-ups, targets due, and stale deals. Sends via `REMINDER_WEBHOOK_URL`
  (a free Power Automate flow) or `RESEND_API_KEY`.
- **RSS mirror** — `/api/digest/rss?key=<export_token>` is the same brief as a
  feed with one item per weekday, because Power Automate's HTTP trigger needs a
  premium licence but Recurrence + RSS + Send-email are free.
  `node scripts/preview-digest.mjs out.html` renders it to a file.
- **Export API** — `/api/export?token=...`, read-only JSON for external
  dashboards. Documented in `../HOPPER-HANDOFF.md`.
  `node scripts/rollup-dashboard.mjs rollup.html` is a working reference
  consumer that renders a static roll-up page without ever putting the token in
  a browser.
- **Stage-change webhooks** — optional. Set `app_settings.stage_webhook_url`
  (or `STAGE_WEBHOOK_URL`) and every stage transition POSTs a small JSON body.
  Fire-and-forget by design: a dead endpoint logs a `webhook_failed` deal event
  and never fails the user's click. Consumers needing guaranteed delivery should
  poll the export API instead.

## Known gaps

- Documents are stored and listed but there's no signed-URL download button.
- Duplicate detection runs and logs an event at intake; nothing surfaces it in
  the UI yet.
- Historical deals have no `contract_price`, so anything already under contract
  before Aug 2026 reports at last-offer value until someone fills the price in
  (the home screen and export both say how many).
- `comp_weight_config` exists but is unused -- v1 comp scoring is recency +
  distance only (`lib/comps.ts`).
- Restore-from-archive returns a deal to its `death_stage`; that behaviour was
  never confirmed with Rhett (see the TODO in the archive route).
