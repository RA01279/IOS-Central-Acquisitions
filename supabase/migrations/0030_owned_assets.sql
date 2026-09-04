-- 0030_owned_assets.sql
-- Dalfen's own IOS portfolio, so a prospect can be judged against what we
-- already own nearby.
--
-- A SEPARATE TABLE from properties, deliberately. properties holds the subjects
-- of deals -- things we are looking at -- and every count, roll-up and pipeline
-- view is built on it. The portfolio is a different kind of thing: assets we
-- hold, which are context for a prospect rather than entries in the pipeline.
-- Putting them in properties would inflate every deal count in the app and
-- there would be no honest way to tell the two apart afterwards.
--
-- Seeded from dalfen.com/ios, which is a marketing page and therefore an
-- imperfect source: it gives address, city, state and occupancy, and no
-- acreage or building size at all. Those columns exist here and start null,
-- because a portfolio comparison wants "how big" and the answer has to be
-- typed in rather than invented. source_url records where each row came from.

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),

  address text not null,
  city text,
  state text constraint assets_state_len check (state is null or length(state) = 2),
  market text,
  submarket text,

  -- 'ios' unless someone says otherwise; this is the IOS portfolio.
  asset_class text not null default 'ios'
    constraint assets_class_check check (asset_class in ('ios', 'industrial')),

  -- Held or disposed. A sold asset stays in the table -- it's still the answer
  -- to "have we been in this submarket before" -- but shouldn't be presented
  -- as something we own.
  status text not null default 'owned'
    constraint assets_status_check check (status in ('owned', 'sold', 'under_contract')),

  -- What the website publishes. Not a substitute for a rent roll, but it does
  -- answer "is there space here" when a prospect turns up next door.
  occupancy text
    constraint assets_occupancy_check check (occupancy is null or occupancy in ('occupied', 'available', 'partial')),

  -- Null until someone fills them in. The source page carries neither.
  site_acres numeric constraint assets_acres_sane check (site_acres is null or site_acres > 0),
  building_sf numeric constraint assets_sf_sane check (building_sf is null or building_sf > 0),

  latitude numeric constraint assets_lat_range check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude numeric constraint assets_lng_range check (longitude is null or (longitude >= -180 and longitude <= 180)),
  -- Same vocabulary as comps and properties, including 'manual' for a pin
  -- dropped by hand and 'supplied' for coordinates that arrived with a file.
  geocode_precision text
    constraint assets_geocode_precision_check check (
      geocode_precision is null
      or geocode_precision in ('rooftop', 'range_interpolated', 'geometric_center', 'approximate', 'supplied', 'manual')
    ),
  geocoded_at timestamptz,

  notes text,
  source_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by text
);

-- One row per address. Re-running the seed updates rather than duplicating.
create unique index if not exists idx_assets_address on assets (lower(address));
create index if not exists idx_assets_market on assets (market) where market is not null;
create index if not exists idx_assets_located on assets (latitude, longitude)
  where latitude is not null;

comment on table assets is
  'Assets we own. Context for judging a prospect, NOT part of the deal pipeline -- that is properties.';
comment on column assets.site_acres is
  'Usable site acreage. Null until entered by hand; dalfen.com/ios does not publish it.';
comment on column assets.occupancy is
  'As published: occupied | available | partial. Not a rent roll.';
