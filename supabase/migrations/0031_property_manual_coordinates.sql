-- Allow user-placed pipeline property pins, matching comp and asset precision.
alter table properties drop constraint if exists properties_geocode_precision_check;
alter table properties add constraint properties_geocode_precision_check
  check (geocode_precision is null or geocode_precision in
    ('rooftop', 'range_interpolated', 'geometric_center', 'approximate', 'supplied', 'manual'));
