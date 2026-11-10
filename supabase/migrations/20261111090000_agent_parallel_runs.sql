-- 20261111090000_agent_parallel_runs.sql
--
-- Agent runs no longer queue one at a time per person. The helper now works
-- several jobs at once (scripts/outlook-helper/agents.mjs, concurrency
-- setting), so a 130-site Sourcing qualify can be queued in one go. A cap on
-- active runs per person is enforced in app/api/agents (MAX_ACTIVE_RUNS), and
-- lib/agents/server.ts reap() now expires a run on how long it has waited or
-- run, rather than on its age alone.
begin;
drop index if exists public.agent_runs_one_active;
create index if not exists agent_runs_owner_active on public.agent_runs (owner_email, created_at)
  where status in ('queued', 'processing');
commit;
