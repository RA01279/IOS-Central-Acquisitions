# Acquisitions Tracking Tool

Deal intake → underwriting → offer → PSA pipeline for the acquisitions
team, with manual in-app intake (no shared inbox required for v1) and
room to add email-triggered intake later without rework.

See `Acquisitions_Tracking_Tool_Spec_v2.docx` for the full feature spec
and rationale behind each decision below.

## Architecture at a glance

- **Next.js (App Router)**, deployed to Vercel from this repo.
- **Postgres via Supabase** — see `supabase/migrations/`. If this is
  sharing a project with RIDGE Intel, run these migrations against that
  same Supabase project; RIDGE Intel owns analysis/underwriting fields
  on shared tables, this app owns pipeline/contact/task fields.
- **Auth via NextAuth + Microsoft Entra ID (Azure AD)** — team SSO using
  existing Dalfen 365 accounts. Needs an app registration from IT
  (same review track as RIDGE Intel's Azure access).
- **`lib/deals.ts` → `createDeal()`** is the single entry point for new
  deals. The New Deal form calls it today; an email-triggered intake
  agent becomes a second caller later, with zero schema changes.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Azure AD values
```

Run migrations against your Supabase project (via the Supabase CLI or
SQL editor):

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
- Archive/restore and UW-version API routes
- Auth scaffolding with a PSA-confirm allowlist (`canConfirmPsa()`)

**Stubbed — needs your input before finishing:**
- **Excel parsing** (`app/api/deals/[id]/versions/route.ts`) — needs
  Jadon's underwriting template to map cells to `returns_summary` fields.
- **Notifications** — `notifyMarketLeadForMla()` in `lib/deals.ts` and
  the UW v1 notification in the versions route both log an event but
  don't send mail yet. Wire up Microsoft Graph `sendMail` once the
  Azure AD app registration has `Mail.Send` approved.
- **Deal detail page UI** (`app/deals/[id]/page.tsx`) — data is wired up,
  UI is a placeholder. Needs the Offered/PSA-confirm buttons, version
  history list, and document list built out.
- **Pipeline board** (`app/deals/page.tsx`) — currently a plain
  list-by-stage; swap for a real kanban layout when there's time.

## Deferred to v2 (see spec doc for reasoning)

- Weighted comp scoring (location / SF / lease-commencement date) —
  `comp_weight_config` table exists but is unused until there's a real
  basis for the weights.
- Stage aging / stale-deal flags.
- Pipeline dashboard.
- Email-triggered intake (once the shared inbox is provisioned).
