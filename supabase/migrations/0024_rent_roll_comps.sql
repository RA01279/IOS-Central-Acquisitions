-- 0024_rent_roll_comps.sql
-- Support for comps sourced from a rent roll.
--
-- A rent roll is contracted rent actually being paid at a comparable property,
-- which is stronger evidence than an asking rate -- so its rows belong in the
-- comp repository. Two columns are needed to hold them honestly.
--
-- 1. date_estimated
--
-- Rent rolls carry a lease EXPIRATION and often no commencement and no term
-- (the Oakbrook roll has "Lease Expiration" and "Months Remaining", and
-- months-remaining is just expiration minus today -- there's no term to
-- subtract). The commencement is therefore backed into as expiration minus a
-- typical term, which is an estimate and has to be labelled as one: recency is
-- the heaviest factor in comp scoring, so a date nobody actually knows must
-- never be indistinguishable from one taken off an executed lease.
--
-- 2. cam_psf_annual
--
-- Rent rolls separate base rent from CAM recovery. Without CAM, a base rent
-- from a rent roll looks cheaper than an all-in gross rent from a broker's
-- table for no reason other than what was reported. Storing it keeps NNN and
-- gross comparable, and lets a gross-equivalent be derived when needed.

alter table comps
  add column if not exists date_estimated boolean not null default false,
  add column if not exists cam_psf_annual numeric
    constraint comps_cam_sane check (cam_psf_annual is null or cam_psf_annual >= 0),
  -- Suite or unit, for a comp that is one tenancy inside a multi-tenant
  -- building. project_name already distinguishes buildings that share a street
  -- address; this distinguishes tenancies that share a building.
  add column if not exists suite text;

-- Nine suites in one building, all at the same address, several sharing an
-- estimated commencement date -- the existing key would have collapsed them.
-- Suite joins it so each tenancy is its own comp.
drop index if exists idx_comps_dedupe;
create unique index if not exists idx_comps_dedupe
  on comps (
    lower(address),
    comp_type,
    coalesce(date_commenced, closed_on),
    lower(coalesce(project_name, '')),
    lower(coalesce(suite, ''))
  )
  where address is not null;

comment on column comps.date_estimated is
  'True when date_commenced was derived (e.g. rent-roll expiration minus a typical term) rather than taken from a stated commencement or close date.';
