-- 0021_comp_fields_from_broker_emails.sql
-- Three columns the schema was missing, added after looking at how comps
-- actually arrive: a real Matthews comp email (Doc Perrier, Conroe, Sep 2026)
-- pastes two HTML tables into the body with these columns:
--
--   sale:  Address | Year Built | SF | AC | Coverage | Sale Date | Price | Price/SF
--   lease: Address | Year Built | SF | AC | Coverage | Lease Type | Monthly Base | Price/SF
--
-- Verified by arithmetic rather than assumption: 9,900 SF / (1.40 AC x 43,560)
-- = 16.2% against a stated 16.40% coverage, and $1,485,000 / 9,900 = $150.00
-- exactly. So SF is BUILDING area, AC is LAND area, and the quoted $/SF is per
-- building SF -- not per land SF. Both are derivable from sale_price with
-- building_sf and lot_sf already on the table, so no basis column is needed for
-- sales; lib/comps.ts computes whichever the caller wants.

alter table comps
  -- Building coverage ratio (building SF / land SF). The single most telling
  -- number for IOS: low coverage is what makes a site a yard rather than a
  -- warehouse, so two otherwise similar comps at 6% and 17% are not comparable.
  add column if not exists coverage_pct numeric
    constraint comps_coverage_fraction check (coverage_pct is null or (coverage_pct >= 0 and coverage_pct <= 1)),
  add column if not exists year_built int
    constraint comps_year_built_sane check (year_built is null or (year_built between 1900 and 2100)),
  -- A gross rent is not comparable to an NNN rent, so the structure has to
  -- travel with the number. Brokers write "NNN"; the rest are here because
  -- older industrial comps arrive as gross or industrial gross.
  add column if not exists lease_type text
    check (lease_type in ('nnn', 'gross', 'modified_gross', 'industrial_gross', 'absolute_net', 'other'));

-- Comp dates from brokers are routinely month-only ("Jan 2026", "Sep 2025").
-- Those are stored as the first of the month, and this records that the day is
-- unknown so nothing later treats it as an exact close date.
alter table comps
  add column if not exists date_precision text not null default 'day'
    check (date_precision in ('day', 'month', 'quarter', 'year'));

-- The same property can legitimately appear as both a sale and a lease comp
-- ("12087 Highway 105 E" is in both of Doc's tables), so uniqueness is per
-- address + type + date, not per address. Partial and case-insensitive so
-- re-importing the same email twice can't duplicate rows.
create unique index if not exists idx_comps_dedupe
  on comps (lower(address), comp_type, coalesce(date_commenced, closed_on))
  where address is not null;
