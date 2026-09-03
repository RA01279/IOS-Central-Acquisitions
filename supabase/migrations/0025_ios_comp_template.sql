-- 0025_ios_comp_template.sql
-- Fields carried by the standard TX IOS lease comp template.
--
-- That workbook ("TX IOS Lease Comps (ver.2.0)") is the team's canonical format
-- for IOS lease comps: 282 rows across Dallas, Houston, Fort Worth, San
-- Antonio, Austin and Laredo. Most of its 35 columns already have a home in
-- this table. These are the ones that don't, and each is here because it
-- changes how much a comp is worth as evidence -- not merely because the
-- column exists.

alter table comps
  -- New vs renewal. A renewal is negotiated against the tenant's cost of
  -- moving rather than against the market, so it lands off-market in either
  -- direction and deserves to be visible as such when it's carrying a range.
  add column if not exists deal_kind text
    constraint comps_deal_kind_check
      check (deal_kind is null or deal_kind in ('new', 'renewal', 'expansion', 'sublease')),

  -- What the tenant actually does with the yard. The whole point of the "true
  -- IOS users and yards" work: a trucking terminal, an equipment rental yard
  -- and a stone yard are not interchangeable comps even at identical rates.
  add column if not exists tenant_usage text,

  -- Institutional landlords underwrite to a different rent than private
  -- owners, and knowing which is which explains a lot of scatter.
  add column if not exists institutional_landlord boolean,

  -- Region, so a multi-market file stays sliceable without re-deriving it
  -- from market names.
  add column if not exists region text,

  -- Parking/trailer counts and the per-stall rate, which is how some yard
  -- deals are actually priced.
  add column if not exists parking_spaces integer
    constraint comps_parking_sane check (parking_spaces is null or parking_spaces >= 0),
  add column if not exists rate_per_stall numeric
    constraint comps_rate_per_stall_sane check (rate_per_stall is null or rate_per_stall > 0);

-- Double net. The template has one NN deal, and collapsing it into 'other'
-- would throw away a structure that changes what the rent means -- the same
-- reason the mixed-lease-structure caveat exists at all.
alter table comps drop constraint if exists comps_lease_type_check;
alter table comps add constraint comps_lease_type_check
  check (
    lease_type is null
    or lease_type in ('nnn', 'nn', 'gross', 'modified_gross', 'industrial_gross', 'absolute_net', 'other')
  );

-- Coordinates that came with the source file rather than from a geocoder.
--
-- The standard IOS comp table carries latitude and longitude on all 282 rows,
-- placed by the team at the yard rather than at a street centroid. Re-resolving
-- those addresses through Google would spend money to get a worse answer, so
-- they're stored as supplied -- and labelled as supplied, because "we did not
-- verify this point" is a different claim from "Google returned a rooftop
-- match", and comp distances are scored off it.
alter table comps drop constraint if exists comps_geocode_precision_check;
alter table comps add constraint comps_geocode_precision_check
  check (
    geocode_precision is null
    or geocode_precision in
      ('rooftop', 'range_interpolated', 'geometric_center', 'approximate', 'supplied')
  );

comment on column comps.geocode_precision is
  'How the coordinates were obtained. "supplied" means they arrived with the source file and were trusted as-is rather than geocoded.';
comment on column comps.deal_kind is
  'new | renewal | expansion | sublease. A renewal is priced against the cost of moving, not against the market.';
comment on column comps.tenant_usage is
  'What the tenant uses the yard for (trucking, equipment rental, stone, contractor storage). Two yards at the same rate are not the same comp if the use differs.';
comment on column comps.institutional_landlord is
  'True where the landlord is institutional. Explains rent scatter that site attributes do not.';
