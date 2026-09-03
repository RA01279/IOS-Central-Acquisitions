-- 0019_comps_repository.sql
-- Turns the stub `comps` table into a real lease + sale comp repository.
--
-- The original table (0002) was lease-only and rigid: `rent` and
-- `date_commenced` were both NOT NULL, with no price, close date, or cap rate,
-- so a sale comp could not be stored at all. It is also empty -- verified 0
-- rows before writing this -- so it is widened in place rather than migrated
-- around, and nothing is dropped.
--
-- Two ideas drive the shape:
--
--   1. ONE table with a `comp_type` discriminator, not two tables. Lease and
--      sale comps are asked the same questions by the matcher (how close, how
--      big, how recent, same submarket?) and only diverge on the money
--      columns. Two tables would mean two of every query and two scorers.
--      Per-type required fields are enforced by CHECK constraints instead.
--
--   2. Rents are stored AS QUOTED, with their basis, and normalised at read
--      time. IOS rents arrive as $/acre/month, $/SF of land/month, or $/SF of
--      building/year depending on who is sending them, and converting on the
--      way in would destroy the original figure and bake in whatever land area
--      we believed at the time. lib/comps.ts owns the conversion so there is
--      one place to fix it.

-- 1. Type discriminator ---------------------------------------------------
alter table comps
  add column if not exists comp_type text not null default 'lease'
    check (comp_type in ('lease', 'sale'));

-- 2. Lease columns become optional (they are meaningless on a sale comp) ---
alter table comps alter column rent drop not null;
alter table comps alter column date_commenced drop not null;

alter table comps
  add column if not exists rent_basis text
    check (rent_basis in (
      'per_acre_monthly',      -- $/usable acre/month, the usual IOS quote
      'per_sf_land_monthly',   -- $/SF of land/month
      'per_sf_bldg_monthly',   -- $/SF of building/month
      'per_sf_bldg_annual',    -- $/SF of building/year, the industrial quote
      'total_monthly'          -- whole-site monthly rent
    )),
  add column if not exists lease_term_months int,
  add column if not exists tenant_name text,
  add column if not exists escalations_pct numeric;

-- 3. Sale columns ---------------------------------------------------------
alter table comps
  add column if not exists sale_price numeric
    constraint comps_sale_price_positive check (sale_price is null or sale_price > 0),
  add column if not exists closed_on date,
  add column if not exists cap_rate numeric
    constraint comps_cap_rate_fraction check (cap_rate is null or (cap_rate > 0 and cap_rate < 1)),
  add column if not exists buyer text,
  add column if not exists seller text;

-- 4. Shared descriptive columns the matcher scores on ---------------------
alter table comps
  add column if not exists city text,
  add column if not exists submarket text,
  add column if not exists asset_class text
    check (asset_class in ('ios', 'industrial')),
  add column if not exists occupancy_status text
    check (occupancy_status in ('vacant', 'occupied')),
  add column if not exists tenancy text
    check (tenancy in ('single_tenant', 'multi_tenant')),
  add column if not exists notes text,
  -- Where this comp came from, so a broker email can be traced back and a bad
  -- source can be re-checked or purged wholesale.
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'excel', 'email', 'import')),
  add column if not exists source_ref text,
  add column if not exists created_by text,
  -- Comps parsed out of an email or spreadsheet are not trusted until someone
  -- has looked at them. Only 'confirmed' comps feed a recommendation; 'draft'
  -- sits in a review queue, and 'rejected' is kept rather than deleted so the
  -- same bad comp isn't re-imported next week.
  add column if not exists status text not null default 'confirmed'
    check (status in ('draft', 'confirmed', 'rejected')),
  add column if not exists geocoded_at timestamptz;

-- 5. Per-type required fields --------------------------------------------
-- A lease comp needs a rent, its basis, and a commencement date; a sale comp
-- needs a price and a close date. Enforced here so no ingestion path -- form,
-- spreadsheet, or email parser -- can write a comp that the matcher then has
-- to defend against.
alter table comps drop constraint if exists comps_required_by_type;
alter table comps add constraint comps_required_by_type check (
  (comp_type = 'lease' and rent is not null and rent_basis is not null and date_commenced is not null)
  or
  (comp_type = 'sale' and sale_price is not null and closed_on is not null)
);

-- 6. Subject-property coordinates ----------------------------------------
-- 0 of 471 properties had coordinates, which is why distance matching was
-- impossible and the demand map re-geocodes on every call. latitude/longitude
-- already exist on properties (0001); this records WHEN they were resolved so
-- a backfill can be resumed and a corrected address can be re-geocoded.
alter table properties
  add column if not exists geocoded_at timestamptz;

-- 7. Lookup paths the matcher uses ---------------------------------------
create index if not exists idx_comps_type_status on comps(comp_type, status);
create index if not exists idx_comps_market on comps(market);
create index if not exists idx_comps_submarket on comps(submarket);
create index if not exists idx_comps_asset_class on comps(asset_class);
create index if not exists idx_comps_commenced on comps(date_commenced desc) where date_commenced is not null;
create index if not exists idx_comps_closed on comps(closed_on desc) where closed_on is not null;
-- Candidate comps are pulled by bounding box before exact distance is scored
-- in application code, so a plain composite index on the coordinates is enough
-- (no PostGIS dependency).
create index if not exists idx_comps_latlng on comps(latitude, longitude)
  where latitude is not null and longitude is not null;
create index if not exists idx_properties_geocoded on properties(geocoded_at)
  where latitude is not null;
