-- 20261020150000_deal_pins.sql
--
-- Precise Google locations for active deals that had no pin (or only a
-- street/city-centre one), where Google returns the building or the exact
-- house number. Each row changes only if its pin is still what was read.
-- The rest -- multi-site deals and addresses Google only knows to the street --
-- are left for a hand-placed pin on the Demand Map tab.
begin;
update public.properties p set latitude = v.lat, longitude = v.lng, geocode_precision = v.precision, geocoded_at = now()
from (values
  ('77c303ba-7a67-4668-9fd9-f2ff110a7202'::uuid, 29.5950912, -98.3000611, 'rooftop', null::numeric, null::numeric), -- D-1058 17105 Beyer John Dr -> 17105 Beyer John Dr, Selma, TX 78154, USA
  ('9f15e9e9-3b77-4382-bb75-b65dd31a20fd'::uuid, 29.791804, -95.2734653, 'rooftop', 29.7997056::numeric, -95.2270173::numeric), -- D-1082 3650 McCarty St (8787 Wallisville Rd) -> 8787 Wallisville Rd, Houston, TX 77029, USA
  ('531712b1-1bef-45ba-89e2-000adb1c6a0b'::uuid, 32.6224815, -96.75193929999999, 'rooftop', null::numeric, null::numeric), -- D-1036 10710-10820 Bonnie View Dr -> 10710 Bonnie View Rd, Dallas, TX 75241, USA
  ('7ad98a80-c485-4423-8a64-b2ebd0620142'::uuid, 33.024544, -97.2812876, 'rooftop', null::numeric, null::numeric), -- D-1037 3532 Highway 114 -> 3532 TX-114, Fort Worth, TX 76177, USA
  ('741f0e2e-becf-4a80-a2cd-515d109de300'::uuid, 29.9114243, -95.62499079999999, 'rooftop', null::numeric, null::numeric), -- D-1040 9210-9320 Highway 6 N -> 9210 Hwy 6 N, Houston, TX 77095, USA
  ('f5d81eab-7a2a-4d64-b967-8e96ad328f9e'::uuid, 32.8609351, -97.3594924, 'range_interpolated', null::numeric, null::numeric) -- D-1069 355 E McLeroy Blvd -> 355 E McLeroy Blvd, Saginaw, TX 76179, USA
) as v(id, lat, lng, precision, old_lat, old_lng)
where p.id = v.id and p.latitude is not distinct from v.old_lat and p.longitude is not distinct from v.old_lng;
commit;
