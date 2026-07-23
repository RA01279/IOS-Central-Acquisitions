# Hopper

Deal intake -> underwriting -> offer -> PSA tracker for the acquisitions
team. Built as a tracker first, not a polished product -- lightweight,
no IT dependency, running for 3 people this week rather than gated on
an enterprise review.

See `Acquisitions_Tracking_Tool_Spec_v2.docx` for the full feature spec.

## Architecture at a glance

- **Next.js (App Router)**, deployed to Vercel from this repo.
- **Postgres via Supabase** -- see `supabase/migrations/`. If sharing a
  project with RIDGE Intel, run these against that same Supabase
  project; RIDGE Intel owns analysis/underwriting fields on shared
  tables, Hopper owns pipeline/contact/task fields.
- **Auth: plain Supabase email/password.** No Azure AD, no IT-approved
  app registration, no SSO. You create the 3 accounts yourself in the
  Supabase dashboard. If this ever needs Dalfen SSO later, that's a
  swap of `lib/auth.ts` only -- nothing else in the app changes.
- **`lib/deals.ts` -> `createDeal()`** is the single entry point for new
  deals. The New Deal form calls it today; an email-triggered intake
  agent could become a second caller later, with zero schema changes.
- **No CI pipeline for now.** Vercel deploys on push regardless; run
  `npm run build` locally before pushing if you want a sanity check.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
```

Create your 3 users in the Supabase dashboard (Authentication -> Users
-> Add user) -- Rhett, Jadon, John.

Run migrations against your Supabase project:

```bash
supabase db push   # or paste the .sql files into the SQL editor
```

```bash
npm run dev
```

## What's built vs. stubbed

**Built:**
- Schema (`supabase/migrations/`)
- `createDeal()` with duplicate detection and MLA-request logging
- New Deal form + API route
- v1 comp scoring (recency + distance blend, see `lib/comps.ts`)
- Excel parsing (`lib/excel-parser.ts`) -- reads the `Summary Table` tab
  of the underwriting model for IRR, multiple, cap rates, etc.
- Archive/restore and UW-version API routes
- Simple auth with a PSA-confirm allowlist (`canConfirmPsa()`)

**Stubbed -- needs finishing:**
- **Deal detail page UI** (`app/deals/[id]/page.tsx`) -- data is wired
  up, UI is a placeholder. Needs the Offered/PSA-confirm buttons,
  version history list, and document list built out.
- **Pipeline board** (`app/deals/page.tsx`) -- currently a plain
  list-by-stage; swap for a real kanban layout when there's time.
- **Login page** -- Supabase auth is wired server-side; needs a basic
  sign-in form in the UI.

## Deferred (see spec doc for reasoning)

- Weighted comp scoring (location / SF / lease-commencement date) --
  `comp_weight_config` table exists but is unused until there's a real
  basis for the weights.
- Stage aging / stale-deal flags, pipeline dashboard.
- Email-triggered intake (if a shared inbox ever gets provisioned).
- SSO / Azure AD, if this ever needs to go through Dalfen IT review.
