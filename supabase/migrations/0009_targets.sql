-- 0009_targets.sql
-- Turns the archive into a target repository: deals we lost or where the
-- owner isn't a seller *yet*. Each archived deal can carry:
--   * disposition   -- why it's parked (lost / not_selling / passed / other)
--   * pursuit_score -- 1-5, how badly we want it (5 = white whale)
--   * follow_up_on  -- when to re-approach the owner
-- Surfaced on the /targets page, due-first. Reopening a deal (restore)
-- clears none of these -- history of wanting it stays.

alter table deals
  add column if not exists disposition text
    check (disposition in ('lost', 'not_selling', 'passed', 'other')),
  add column if not exists pursuit_score int
    check (pursuit_score between 1 and 5),
  add column if not exists follow_up_on date;

create index if not exists idx_deals_follow_up
  on deals(follow_up_on) where follow_up_on is not null;
