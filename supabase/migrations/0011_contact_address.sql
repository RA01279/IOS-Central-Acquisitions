-- 0011_contact_address.sql
-- Contacts get a mailing address (nice-to-have alongside email/phone).
-- Company assignment and first+last name are enforced in the intake form,
-- not here -- 150 imported broker/owner contacts predate both rules and
-- must stay valid while the team backfills them.

alter table contacts
  add column if not exists address text;
