-- 0028_market_from_city.sql
-- Fill a missing market from the city, where the city IS a market.
--
-- One row in the IOS comp set (9765 Harry Hines Blvd, DeAngelo Contracting
-- Services) has a blank CoStar Market cell in the source file. It carries city
-- "Dallas" and submarket "South Stemmons", so the market is not in doubt --
-- but a comp with a null market is invisible under any market filter on the
-- comps map, which is a silent way to lose it.
--
-- Only applied where the city already matches a market this repository uses,
-- so it can't invent a market from a city that isn't one.

update comps c
set market = c.city
where c.market is null
  and c.city is not null
  and exists (
    select 1 from comps m
    where m.market is not null
      and lower(m.market) = lower(c.city)
  );
