-- 20261013130000_comp_review.sql
-- Hold suspect comps for a person, and keep one spelling per name.
--
-- Intake (app/api/comps/route.ts) now saves a comp as a 'draft' with
-- review_flags when it probably repeats an existing comp or its rate is far
-- outside its market; the Comps page lists drafts for Confirm / Reject. A
-- draft is out of every market figure until confirmed. This adds the columns
-- intake writes, then applies the same rules to the comps already here:
--
--   1. Names: typographic hyphens/quotes made plain, whitespace collapsed,
--      then each name unified to its most common spelling
--      ("Tri-county" -> "Tri County"). Mirrors cleanName / nameKey /
--      canonicalSpellings in lib/comps/review.ts.
--   2. Duplicates: the 2026-10-13 audit found ~10 leases the TX IOS workbook
--      carries twice (same tenant and rent, dated the 1st and the 24th). The
--      later-dated row of each pair is held as possible_duplicate, pointing at
--      the earlier one. Mirrors findDuplicate: same type, same site (address
--      or pins within 0.03 mi), same suite and project, within 60 days, and the
--      same money (+/-1%) or the same tenant/buyer.
--
-- Nothing is deleted; a person decides each held pair from the Comps page.
-- Requires 20261013120000_comp_asset_class.sql first.

begin;

alter table comps
  add column if not exists review_flags text[] not null default '{}',
  add column if not exists duplicate_of uuid references comps(id) on delete set null;

create index if not exists idx_comps_drafts on comps (created_at) where status = 'draft';

comment on column comps.review_flags is
  'Why a draft comp was held for review: possible_duplicate, rate_outlier. See lib/comps/review.ts.';
comment on column comps.duplicate_of is
  'For a possible_duplicate draft, the existing comp it appears to repeat.';

-- ---- helpers (session-only) -------------------------------------------------

create function pg_temp.clean_name(v text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(
    translate(v, '‐‑‒–—―−‘’“”', '-------''''""'),
    '\s+', ' ', 'g')), '')
$$;

create function pg_temp.name_key(v text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]', '', 'g'), '(llc|inc|corp|co|lp|ltd)$', '')
$$;

create function pg_temp.norm_addr(a text) returns text language sql immutable as $$
  select btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(split_part(lower(coalesce(a, '')), ',', 1), '[.#]', '', 'g'),
      '\mroad\M', 'rd', 'g'), '\mstreet\M', 'st', 'g'), '\mdrive\M', 'dr', 'g'),
      '\mhighway\M', 'hwy', 'g'), '\mboulevard\M', 'blvd', 'g'), '\mavenue\M', 'ave', 'g'),
      '\mlane\M', 'ln', 'g'), '\mparkway\M', 'pkwy', 'g'), '\mfreeway\M', 'fwy', 'g'),
      '\mnorth\M', 'n', 'g'), '\msouth\M', 's', 'g'), '\meast\M', 'e', 'g'), '\mwest\M', 'w', 'g'),
    '\s+', ' ', 'g'))
$$;

create function pg_temp.miles(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8 language sql immutable as $$
  select 3958.8 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ---- 1. names ---------------------------------------------------------------

do $$
declare col text;
begin
  foreach col in array array['tenant_name', 'buyer', 'seller', 'landlord_name', 'market', 'submarket', 'city'] loop
    execute format(
      'update comps set %1$I = pg_temp.clean_name(%1$I) where %1$I is distinct from pg_temp.clean_name(%1$I)', col);
    execute format($q$
      with spellings as (
        select pg_temp.name_key(%1$I) as k, %1$I as v, count(*) as n
        from comps where %1$I is not null and pg_temp.name_key(%1$I) <> ''
        group by 1, 2
      ), winner as (
        select distinct on (k) k, v from spellings order by k, n desc, v
      )
      update comps c set %1$I = w.v
      from winner w
      where c.%1$I is not null and pg_temp.name_key(c.%1$I) = w.k and c.%1$I <> w.v
    $q$, col);
  end loop;
end $$;

-- ---- 2. duplicates ----------------------------------------------------------

with d as (
  select id, comp_type, pg_temp.norm_addr(address) as addr, latitude, longitude,
    lower(coalesce(pg_temp.clean_name(suite), '')) as suite_k,
    lower(coalesce(pg_temp.clean_name(project_name), '')) as project_k,
    case when comp_type = 'sale' then closed_on else date_commenced end as dt,
    case when comp_type = 'sale' then sale_price else rent end as money,
    pg_temp.name_key(case when comp_type = 'sale' then buyer else tenant_name end) as party,
    created_at
  from comps
  where status <> 'rejected'
), pairs as (
  select distinct on (later.id) later.id, earlier.id as original_id
  from d later
  join d earlier
    on earlier.comp_type = later.comp_type
   and earlier.id <> later.id
   and later.dt is not null and earlier.dt is not null
   -- the later-dated row is the copy; on the same date, the later-created one
   and (earlier.dt, earlier.created_at, earlier.id) < (later.dt, later.created_at, later.id)
   and later.dt - earlier.dt <= 60
   and (earlier.addr = later.addr
        or (later.latitude is not null and earlier.latitude is not null
            and pg_temp.miles(later.latitude, later.longitude, earlier.latitude, earlier.longitude) <= 0.03))
   and earlier.suite_k = later.suite_k
   and earlier.project_k = later.project_k
   and ((earlier.money > 0 and abs(later.money - earlier.money) / earlier.money <= 0.01)
        or (earlier.party <> '' and earlier.party = later.party))
  order by later.id, earlier.dt, earlier.created_at
)
update comps c
set status = 'draft',
    review_flags = array['possible_duplicate'],
    duplicate_of = p.original_id
from pairs p
where c.id = p.id
  -- don't hold a comp whose own original is itself being held
  and not exists (select 1 from pairs q where q.id = p.original_id);

commit;

-- After applying:
--   select status, review_flags, count(*) from comps group by 1, 2;
