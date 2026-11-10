-- One-off clean-up approved 2026-11-10 (not a migration; run once with
-- `node scripts/apply-migration.mjs scripts/oneoff-20261110-stale-tasks-offers.sql`).
--
-- 1. Overdue automatic UW checklist tasks on deals that have moved past UW or
--    been archived are marked done (expected: 35). Hand-written tasks and
--    tasks on deals still in UW are untouched.
-- 2. 'Sent' offers on archived deals are marked 'expired' (expected: 141 for
--    2026), so they stop counting as outstanding.
begin;

with closed as (
  update public.tasks t
     set status = 'done', completed_at = now()
    from public.deals d
   where t.deal_id = d.id
     and t.status = 'open'
     and t.due_date < (now() at time zone 'America/Chicago')::date
     and t.title in ('Finish underwriting and review comps', 'Set the IC date')
     and d.stage in ('archived', 'offered', 'moving_to_psa', 'due_diligence', 'closed')
  returning t.id
), expired as (
  update public.offers o
     set status = 'expired'
    from public.deals d
   where o.deal_id = d.id
     and d.stage = 'archived'
     and o.status = 'sent'
  returning o.id
)
select (select count(*) from closed) as tasks_closed, (select count(*) from expired) as offers_expired;

commit;
