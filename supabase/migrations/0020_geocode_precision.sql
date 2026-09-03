-- 0020_geocode_precision.sql
-- How exact a property's coordinates are, which decides whether they can be
-- trusted for comp distance scoring.
--
-- Google's geocoder always answers. When it can't find the address it returns
-- the city or ZIP centroid with location_type = APPROXIMATE, and a comp two
-- miles away then scores as if it were next door. Recording the precision lets
-- the matcher refuse to use a centroid, and lets a bad address be found and
-- fixed rather than quietly producing confident nonsense.
--
--   rooftop             -- exact building
--   range_interpolated  -- interpolated along a street range, good enough
--   geometric_center    -- centre of a street or parcel, usable
--   approximate         -- city/ZIP centroid, NOT usable for distance

alter table properties
  add column if not exists geocode_precision text
    check (geocode_precision in ('rooftop', 'range_interpolated', 'geometric_center', 'approximate'));

alter table comps
  add column if not exists geocode_precision text
    check (geocode_precision in ('rooftop', 'range_interpolated', 'geometric_center', 'approximate'));
