-- 20261016160000_ic_decisions.sql
--
-- What Investment Committee decided on a deal: outcome, the approved price
-- and conditions, and when. One row per IC sitting; the newest is the
-- deal's standing decision. Moving to PSA can be made to require an approval
-- (env REQUIRE_IC_APPROVAL_FOR_PSA=1).
begin;
create table if not exists public.ic_decisions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  decided_on date not null,
  outcome text not null check (outcome in ('approved', 'conditional', 'declined', 'deferred')),
  approved_price numeric check (approved_price is null or approved_price > 0),
  conditions text check (conditions is null or length(conditions) <= 4000),
  notes text check (notes is null or length(notes) <= 4000),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists ic_decisions_deal on public.ic_decisions(deal_id, decided_on desc, created_at desc);
alter table public.ic_decisions enable row level security;
revoke all on public.ic_decisions from anon, authenticated;
commit;
