create table if not exists public.sourcing_sweeps (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists sourcing_sweeps_owner_created on public.sourcing_sweeps(owner_email, created_at desc);
alter table public.sourcing_sweeps enable row level security;
revoke all on public.sourcing_sweeps from public, anon, authenticated;
grant all on public.sourcing_sweeps to service_role;
comment on table public.sourcing_sweeps is 'Immutable reviewed sourcing snapshots. Server routes enforce owner_email; no direct browser grants.';
