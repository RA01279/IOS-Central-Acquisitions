-- Shared Hopper workspace, accessed only by authenticated server routes.
create table public.uw_handoffs (
  id uuid primary key,
  deal_id uuid references public.deals(id) on delete set null,
  title text not null,
  payload jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create index uw_handoffs_deal on public.uw_handoffs(deal_id);
create index uw_handoffs_updated on public.uw_handoffs(updated_at desc);
alter table public.uw_handoffs enable row level security;
revoke all on public.uw_handoffs from anon, authenticated;
grant select, insert, update, delete on public.uw_handoffs to service_role;
