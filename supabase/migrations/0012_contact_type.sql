-- 0012_contact_type.sql
-- Contacts are classified at creation: broker, owner-user, institutional
-- owner, tenant, or other. The /contacts page groups by these sections.
-- Nullable at the DB level (intake-created owner contacts can't always be
-- classified automatically); the add-contact form requires a choice.

alter table contacts
  add column if not exists contact_type text
    check (contact_type in ('broker', 'owner_user', 'institutional_owner', 'tenant', 'other'));
