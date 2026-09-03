-- 0023_comp_project_name.sql
-- Project/building name, and a dedupe key that accounts for it.
--
-- Found in a real broker workbook: two sale comps at "3513 N Loop 336 W",
-- same buyer, same $860,000, same 2026-03-20 close date -- distinguished only
-- by a Project Name column reading "Pine Crossing Business Park - Bldg. C" and
-- "- Bldg. D". They are two genuine sales of two different buildings that
-- share a business-park address.
--
-- The old unique index was (address, comp_type, date), so the second one would
-- have been silently counted as a duplicate and dropped. Business parks,
-- multi-building portfolios and suite-level leases all hit this, so the
-- project name joins the key.

alter table comps
  add column if not exists project_name text;

drop index if exists idx_comps_dedupe;
create unique index if not exists idx_comps_dedupe
  on comps (
    lower(address),
    comp_type,
    coalesce(date_commenced, closed_on),
    -- coalesce, because a null project name must still collide with another
    -- null one: NULLs are distinct in an index, so leaving it bare would let
    -- the same comp be imported twice.
    lower(coalesce(project_name, ''))
  )
  where address is not null;

create index if not exists idx_comps_project on comps(project_name) where project_name is not null;
