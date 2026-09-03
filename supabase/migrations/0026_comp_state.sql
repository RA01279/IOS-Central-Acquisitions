-- 0026_comp_state.sql
-- Which state a comp is in.
--
-- The repository went multi-state the moment a Savannah, GEORGIA rent roll
-- landed next to 282 Texas IOS comps, and nothing recorded the difference. The
-- geocoder had been hard-coded to Texas -- appending ", TX" and restricting the
-- lookup with administrative_area:TX, which is a hard filter rather than a
-- tiebreak -- so those nine Savannah suites resolved to Savannah, Texas and to
-- the geographic centre of Texas. About 800 miles out.
--
-- Fixing the geocoder to infer the state from the address is most of the
-- answer, but inference has to run on every save and can't be corrected by a
-- human when it's wrong. Storing it makes the fact explicit, editable, and
-- available to filter a repository that now spans more than one state.

alter table comps
  add column if not exists state text
    constraint comps_state_len check (state is null or length(state) = 2);

comment on column comps.state is
  'Two-letter state code. Set from the source file where it says, otherwise inferred from the address at save time. Drives geocoding, which restricts to this state when known.';

-- Backfill from what the existing rows already say. Only where a comma-
-- separated segment IS a state, which is the same rule the geocoder uses --
-- "316 Georgia Avenue" is a Houston street, not a Georgia address.
update comps set state = 'GA'
where state is null
  and (
    market ilike '%, GA' or city ilike '%, GA' or address ilike '%, GA'
    or market ilike '%, Georgia' or address ilike '%, Georgia'
  );

-- Everything else in the repository predates the multi-state case and is
-- Texas: the IOS comp set is 282 TX rows, and the Conroe and Houston comps
-- are all TX. Applied only to rows that still have no state, so the Savannah
-- rows above are untouched.
update comps set state = 'TX'
where state is null
  and (
    market in ('Houston', 'Dallas', 'Fort Worth', 'San Antonio', 'Austin', 'Laredo', 'Conroe')
    or city in ('Conroe', 'Houston', 'Dallas', 'Fort Worth', 'San Antonio', 'Pasadena', 'Channelview')
  );
