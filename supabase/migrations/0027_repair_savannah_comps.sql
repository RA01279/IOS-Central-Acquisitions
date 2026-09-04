-- 0027_repair_savannah_comps.sql
-- Data repair for the Savannah rent roll, and the state backfill it exposed.
--
-- Two separate problems, both from the same import.
--
-- 1. Eight of the nine suites saved with market, city and submarket all NULL,
--    because the address field carried "2025 Louisville Road, Savannah, GA"
--    and the form's Market/City boxes were left empty. Their coordinates are
--    right (0026 and the re-geocode fixed those), so they DO appear on the
--    comps map under "All markets" -- but the map's market dropdown is built
--    from the market values present, so selecting "Savannah" showed one comp
--    out of nine and the rest were invisible under any filter.
--
-- 2. The ninth saved with market "Savannah" while the CoStar property report
--    calls it "Savannah, GA". One building, two market spellings, so the nine
--    suites would never group even once the nulls were filled.
--
-- Normalised to "Savannah" to match how every other market in this repository
-- is named -- Houston, Dallas, Fort Worth, San Antonio, Austin, Laredo, all
-- bare metro names with no state suffix. The state lives in its own column now.

-- The city and state belong in their own columns, not inside the address.
-- Leaving them there also means this building has two different dedupe keys,
-- so re-dropping the same roll would half-duplicate it.
update comps
set address = '2025 Louisville Rd',
    city = 'Savannah',
    state = 'GA',
    market = 'Savannah',
    submarket = coalesce(submarket, 'Greater Savannah')
where address ilike '%louisville%';

-- Anything still missing a state. 0026 backfilled by market name, but comps
-- saved between that migration and the geocoder fix came in with no state at
-- all -- and a null state now means the geocoder infers rather than knows.
update comps
set state = 'TX'
where state is null
  and market in ('Houston', 'Dallas', 'Fort Worth', 'San Antonio', 'Austin', 'Laredo', 'Conroe');
