-- 20261110120000_asset_occupancy_manual.sql
--
-- Occupancy edited by hand on Our Assets (a tenant moved out, a vacancy got
-- leased) wins over the dalfen.com/ios seed: scripts/seed-assets.mjs keeps
-- the occupancy of any asset where these are set. Who and when show in the table.
begin;
alter table public.assets add column if not exists occupancy_set_by text;
alter table public.assets add column if not exists occupancy_set_at timestamptz;
comment on column public.assets.occupancy_set_at is
  'When someone last set occupancy by hand; the seed leaves occupancy alone once this is set.';
commit;
