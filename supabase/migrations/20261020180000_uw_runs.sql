-- 20261020180000_uw_runs.sql
--
-- Saved runs of Hopper's screening underwriting (the deal's Underwriting tab).
-- Each run freezes what it was run on: the engine inputs, where each one came
-- from, the comp set behind the comp-driven ones, the Excel model version it
-- was compared with, and the headline results. The Excel model in uw_versions
-- stays the approved underwriting; nothing here touches it.
begin;

create table if not exists public.uw_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  label text check (label is null or length(label) <= 120),
  engine_version text not null check (length(engine_version) <= 40),
  scenario text not null check (scenario in ('Base', 'Upside', 'Downside')),
  inputs jsonb not null,
  sources jsonb not null default '{}',
  comp_snapshot jsonb not null default '{}',
  -- The Excel model version the run started from / was compared with, if any.
  uw_version_id uuid references public.uw_versions(id) on delete set null,
  results jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists uw_runs_deal on public.uw_runs(deal_id, created_at desc);

alter table public.uw_runs enable row level security;
revoke all on public.uw_runs from anon, authenticated;

commit;
