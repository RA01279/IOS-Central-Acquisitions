-- 20261110150000_outreach.sql
--
-- Off-market owner outreach (the Outreach page and the deal page's Outreach
-- box, lib/outreach.ts):
--   * activities.outcome -- what a touch achieved (left a voicemail, spoke,
--     interested, not selling...), so a prospect's outreach status can be read
--     off its latest touch.
--   * activities gains 'letter' and 'text' types: mailers and texts are how
--     much off-market outreach is done.
--   * tasks.kind -- 'outreach' marks the one open "next touch" reminder per
--     deal, so logging a new touch can replace it rather than stack another.
begin;

alter table public.activities add column if not exists outcome text;
alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (
  outcome is null or outcome in ('no_answer', 'left_message', 'spoke', 'interested', 'not_now', 'not_selling', 'wrong_contact'));

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.activities'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%activity_type%'
  loop
    execute format('alter table public.activities drop constraint %I', c);
  end loop;
  alter table public.activities add constraint activities_activity_type_check check (
    activity_type in ('call','email','meeting','tour','note','site_visit','letter','text','other'));
end $$;

alter table public.tasks add column if not exists kind text;
create index if not exists idx_tasks_deal_kind_open on public.tasks (deal_id, kind) where status = 'open';
create index if not exists idx_activities_deal_occurred on public.activities (deal_id, occurred_at desc);

commit;
