-- 0029_manual_coordinates.sql
-- A precision for coordinates a person pinned by hand.
--
-- Some addresses will never geocode, and no amount of fixing the geocoder
-- changes that. From the IOS comp set alone: "IH10 East BTS", "BTS on I-10",
-- "Beltway 8 & Fellows Road", "Victory Circle", "Ash St", "3300 Rock Island
-- Rd". Build-to-suits with no street number, intersections, and stubs. Google
-- answers all of them with a ZIP or city centroid flagged APPROXIMATE, which
-- the matcher now refuses to measure distance from -- correctly, because the
-- middle of a ZIP code is not where the deal is.
--
-- The only fix for those is a human dropping a pin, so there has to be
-- somewhere to record that they did, distinct from a geocoder result:
--
--   supplied   came with the source file, trusted as given
--   manual     a person entered these coordinates deliberately
--
-- Both count as located for distance. The distinction is for auditing -- "who
-- decided this point" is a different question from "how precise is it".

alter table comps drop constraint if exists comps_geocode_precision_check;
alter table comps add constraint comps_geocode_precision_check
  check (
    geocode_precision is null
    or geocode_precision in
      ('rooftop', 'range_interpolated', 'geometric_center', 'approximate', 'supplied', 'manual')
  );

-- Sanity bounds. A transposed pair or a stray minus sign puts a Texas yard in
-- Kazakhstan, and nothing downstream would question it.
alter table comps drop constraint if exists comps_latitude_range;
alter table comps add constraint comps_latitude_range
  check (latitude is null or (latitude >= -90 and latitude <= 90));
alter table comps drop constraint if exists comps_longitude_range;
alter table comps add constraint comps_longitude_range
  check (longitude is null or (longitude >= -180 and longitude <= 180));

comment on column comps.geocode_precision is
  'How the coordinates were obtained. rooftop/range_interpolated/geometric_center come from Google; approximate is a city or ZIP centroid and is NOT used for distance; supplied came with the source file; manual was pinned by a person.';
