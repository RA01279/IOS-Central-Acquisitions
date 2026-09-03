-- 0022_comp_detail_fields.sql
-- The data points a comp actually needs to be comparable, beyond price and area.
--
-- Grouped by what they're for. Everything nullable: broker emails carry a
-- handful of these at best, and the rest get filled in by hand as they're
-- learned. tenant_name, lease_term_months, escalations_pct, lease_type,
-- occupancy_status, tenancy, buyer, seller and cap_rate already exist (0019).
--
-- Bias in choosing these: IOS deals are priced on the YARD, not the building.
-- Two sites with identical building SF and price are not comparable if one has
-- a fenced concrete yard with trailer stalls and the other has a gravel lot
-- where outdoor storage isn't permitted. The site columns below are what make
-- that difference visible, and they are the ones a generic industrial comp
-- schema would leave out.

-- Site and improvements ---------------------------------------------------
alter table comps
  add column if not exists clear_height_ft numeric
    constraint comps_clear_height_sane check (clear_height_ft is null or (clear_height_ft > 0 and clear_height_ft < 100)),
  add column if not exists office_sf numeric
    constraint comps_office_sf_sane check (office_sf is null or office_sf >= 0),
  add column if not exists dock_high_doors int
    constraint comps_dock_doors_sane check (dock_high_doors is null or dock_high_doors >= 0),
  add column if not exists grade_level_doors int
    constraint comps_grade_doors_sane check (grade_level_doors is null or grade_level_doors >= 0),
  add column if not exists power_amps int
    constraint comps_power_sane check (power_amps is null or power_amps > 0);

-- The IOS-specific set ----------------------------------------------------
alter table comps
  -- Usable yard, which is rarely the whole site: setbacks, detention, and
  -- unpaved slope all come out of it. The number a yard tenant actually pays
  -- for, and the denominator for a defensible $/acre.
  add column if not exists yard_acres numeric
    constraint comps_yard_acres_sane check (yard_acres is null or yard_acres >= 0),
  -- Surface drives rent more than almost anything else on a yard deal: a
  -- concrete yard takes loaded trailers, a dirt one doesn't.
  add column if not exists surface_type text
    check (surface_type in ('concrete', 'asphalt', 'crushed_stone', 'gravel', 'dirt', 'mixed', 'unimproved')),
  add column if not exists fenced boolean,
  add column if not exists trailer_stalls int
    constraint comps_trailer_stalls_sane check (trailer_stalls is null or trailer_stalls >= 0),
  add column if not exists zoning text,
  -- Whether outdoor storage is actually allowed. A site that can't legally
  -- store outside is not an IOS comp at any price, however similar it looks.
  add column if not exists outdoor_storage_permitted boolean;

-- Lease economics ---------------------------------------------------------
alter table comps
  add column if not exists landlord_name text,
  add column if not exists lease_expires_on date,
  add column if not exists free_rent_months numeric
    constraint comps_free_rent_sane check (free_rent_months is null or free_rent_months >= 0),
  add column if not exists ti_psf numeric
    constraint comps_ti_sane check (ti_psf is null or ti_psf >= 0),
  add column if not exists renewal_options text,
  add column if not exists listing_broker text,
  add column if not exists tenant_rep_broker text;

-- Sale economics ----------------------------------------------------------
alter table comps
  -- Net operating income, so a quoted cap rate can be checked rather than
  -- taken on trust -- the same reason the parser re-derives $/SF.
  add column if not exists noi numeric
    constraint comps_noi_sane check (noi is null or noi > 0),
  add column if not exists sale_broker text,
  add column if not exists occupancy_at_sale numeric
    constraint comps_occ_at_sale_fraction check (occupancy_at_sale is null or (occupancy_at_sale >= 0 and occupancy_at_sale <= 1));

-- A yard can't be bigger than the site it sits on. Caught here because it's
-- the kind of transcription error that quietly halves a $/acre.
alter table comps drop constraint if exists comps_yard_within_lot;
alter table comps add constraint comps_yard_within_lot check (
  yard_acres is null or lot_sf is null or (yard_acres * 43560) <= (lot_sf * 1.05)
);

-- Editing a comp needs an audit trail, since these numbers end up in a
-- recommendation and "who changed this and when" becomes a real question.
alter table comps
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by text;

create index if not exists idx_comps_surface on comps(surface_type) where surface_type is not null;
