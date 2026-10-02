begin;

-- Allow the off-market sourcing agent (same pattern as 20261001200000).
alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative', 'off-market-sourcing'
));

commit;
