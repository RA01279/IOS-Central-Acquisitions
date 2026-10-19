-- 20261019130000_asset_leases.sql
--
-- The rent roll of an owned asset: one row per lease, with the dates and rent
-- asset management runs on. Drives the asset page's underwritten-vs-actual
-- view (actual rent, occupancy, yield on cost) and the lease-expiry alerts in
-- the morning brief.
begin;
create table if not exists public.asset_leases (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  tenant text not null check (length(trim(tenant)) between 1 and 200),
  suite text check (suite is null or length(suite) <= 60),
  leased_sf numeric check (leased_sf is null or leased_sf > 0),
  leased_acres numeric check (leased_acres is null or leased_acres > 0),
  commenced_on date,
  expires_on date,
  base_rent_monthly numeric check (base_rent_monthly is null or base_rent_monthly >= 0),
  escalation_pct numeric check (escalation_pct is null or (escalation_pct >= 0 and escalation_pct < 0.5)),
  lease_type text check (lease_type is null or lease_type in ('nnn', 'modified_gross', 'gross', 'ground', 'month_to_month')),
  options text check (options is null or length(options) <= 1000),
  status text not null default 'active' check (status in ('active', 'expired', 'terminated')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or commenced_on is null or expires_on >= commenced_on)
);
create index if not exists asset_leases_asset on public.asset_leases(asset_id);
create index if not exists asset_leases_expiring on public.asset_leases(expires_on) where status = 'active';
alter table public.asset_leases enable row level security;
revoke all on public.asset_leases from anon, authenticated;
commit;
