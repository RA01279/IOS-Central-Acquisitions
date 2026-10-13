-- 20261013120000_comp_asset_class.sql
-- Classify the comps that arrived without an asset class.
--
-- The 2026-09-09 platform audit found 393 of 436 comps (90%) with no
-- asset_class. The comp matcher excludes an unclassified comp from any deal
-- that has a class -- every deal does -- so nine in ten comps were invisible
-- to the Financials panel unless an analyst overrode the class filter.
--
-- Only unambiguous evidence classifies a comp, the same rules as
-- inferAssetClass() in lib/comps/match.ts (new comps get them at intake):
--   ios         quoted per acre or per land SF; yard acres, trailer stalls or
--               a per-stall rate stated; or building coverage under 25%
--   industrial  building coverage of 40% or more, with none of the above
-- Anything else (25-40% coverage, or no sizes at all) stays unclassified for a
-- person to decide. asset_class_basis records which rule fired, so an inferred
-- class is never mistaken for a stated one; a manual edit overwrites both.

begin;

alter table comps add column if not exists asset_class_basis text;

update comps set asset_class_basis = 'Stated at intake'
where asset_class is not null and asset_class_basis is null;

with inferred as (
  select id,
    case
      when rent_basis in ('per_acre_monthly', 'per_sf_land_monthly') then 'ios'
      when coalesce(yard_acres, 0) > 0 or coalesce(trailer_stalls, 0) > 0 or coalesce(rate_per_stall, 0) > 0 then 'ios'
      when cov < 0.25 then 'ios'
      when cov >= 0.40 then 'industrial'
    end as cls,
    case
      when rent_basis in ('per_acre_monthly', 'per_sf_land_monthly') then 'Inferred: quoted as a land rate'
      when coalesce(yard_acres, 0) > 0 or coalesce(trailer_stalls, 0) > 0 or coalesce(rate_per_stall, 0) > 0
        then 'Inferred: yard acreage or trailer stalls stated'
      when cov < 0.25 or cov >= 0.40 then 'Inferred: ' || round(cov * 100)::text || '% building coverage'
    end as basis
  from (
    select *, coalesce(coverage_pct,
      case when building_sf > 0 and lot_sf > 0 then building_sf::numeric / lot_sf end) as cov
    from comps
    where asset_class is null
  ) c
)
update comps set asset_class = inferred.cls, asset_class_basis = inferred.basis
from inferred
where comps.id = inferred.id and inferred.cls is not null;

commit;

-- What was left for a person (run after applying):
--   select comp_type, count(*) filter (where asset_class is null) as unclassified,
--          count(*) filter (where asset_class_basis like 'Inferred%') as inferred
--   from comps group by comp_type;
