begin;

-- Allow the IC deck narrative agent. The original check was declared inline,
-- so find it by definition rather than trusting the generated name.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.agent_runs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%investment-memo%'
  loop
    execute format('alter table public.agent_runs drop constraint %I', c);
  end loop;
end $$;

alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative'
));

-- The deck builder looks up the latest narrative per owner and deal.
create index if not exists agent_runs_owner_deal_agent on public.agent_runs(owner_email, deal_id, agent, created_at desc);

commit;
