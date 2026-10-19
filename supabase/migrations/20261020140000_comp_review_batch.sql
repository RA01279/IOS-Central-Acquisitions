-- 20261020140000_comp_review_batch.sql
--
-- Audit clean-up, reversible: comps that look like duplicates or bad data go
-- back to draft with a review flag, so they leave the underwriting evidence and
-- appear in the Comps page review queue for a person to keep, fix or delete.
-- Nothing is deleted here.
--   * 13 likely duplicates: same type, address, tenant and rent as another
--     comp (the later import is flagged, linked to the one kept).
--   * 3 rate outliers: 11603 I-10 ($17M/AC -- lot likely 47.35 AC entered as
--     SF), 6210 Cunningham ($34K/AC/mo -- likely a total monthly rent),
--     7185 Old Hwy 105 W ($2.40/SF -- building SF likely land SF).
--   * 1 future-dated lease: 8200 East Freeway (2026-11-01).
-- Each row changes only if it is still confirmed and unflagged.
begin;
update public.comps c set status = 'draft', duplicate_of = v.keep::uuid,
  review_flags = array(select distinct unnest(c.review_flags || array['possible_duplicate']))
from (values
  ('86d066a2-92a6-4a8c-9fbd-0598612a790c', '49558521-c931-48b1-9452-876c0c473cb2'),
  ('fa76cc05-53da-484d-97f8-ef22d619d3ca', 'ee9e47fa-23e2-4039-841a-baa77aba831d'),
  ('0e86c533-910d-4dac-81df-2c20de1e38e0', '55b0a9df-2cac-46e1-8fb8-b9723e0f17b9'),
  ('7c62a079-3a22-41de-b3ac-69a65c255622', '8b8a4f57-ac4d-4db5-b9cc-439b77e3a0cf'),
  ('b576d91b-3245-41d5-8f12-a378c05d44a1', '5ac504ce-f130-4396-892b-6528e3d4dc68'),
  ('bf7da405-e627-4c65-9612-b4621dd38473', '25e4c62f-43f7-45f5-b0f9-c391110fbd36'),
  ('2acf5c20-9313-40b9-a09e-ed8291c2780f', '4b428393-3b85-42d0-90e5-1a990eb64c8e'),
  ('02c559cb-c5ff-496a-ba49-796472f4195f', 'a6a4217e-a0cc-4222-8c87-f6530e381b3e'),
  ('3d3c2629-13a9-455a-9bd5-588cc6c8f964', 'd48a7f98-cd01-4aa4-b134-647c7bb1009e'),
  ('095ab6b8-f48d-4b3c-9a26-c2e4940d609e', '024f02f3-1e81-4d5d-ab32-1b6e46d10b24'),
  ('18d27dab-f21b-420a-b014-23a2fd65cc23', '086b0854-54c5-4f71-b1ab-d6facce57ec9'),
  ('2841dc01-3cd2-424a-a08f-e6e3817eb8bc', '3d22f055-9450-44dc-868d-b9c51c028741'),
  ('5447756f-e0de-474f-b823-9a6d7171450d', '5c4671e0-049a-42a3-bffb-d9a4db1274f8')
) as v(dup, keep)
where c.id = v.dup::uuid and c.status = 'confirmed' and c.duplicate_of is null;

update public.comps c set status = 'draft',
  review_flags = array(select distinct unnest(c.review_flags || array[v.flag]))
from (values
  ('2a72aeed-10f0-4f28-8824-e01e69eb91ff', 'rate_outlier'),
  ('a615a0bf-b7ff-4a3d-9b05-9243760e620a', 'rate_outlier'),
  ('867ec146-1257-42f5-86ab-4f7515a494a5', 'rate_outlier'),
  ('4e28f361-1787-4360-83a1-87c25eab8c39', 'future_date')
) as v(id, flag)
where c.id = v.id::uuid and c.status = 'confirmed';
commit;
