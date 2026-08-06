-- 0013_score_zero.sql
-- Pursuit score gains a 0: "never going to be a target". Scored at archive
-- time; 0-star deals are excluded from the Targets lists permanently.

alter table deals drop constraint if exists deals_pursuit_score_check;
alter table deals add constraint deals_pursuit_score_check
  check (pursuit_score between 0 and 5);
