-- 20261110180000_outreach_stage.sql
--
-- Outreach: the stage before the pipeline. Sites picked from Sourcing are
-- created here and worked on the Outreach page (owner touches, follow-up
-- reminders) without appearing on the pipeline board or in pipeline counts.
-- When the owner will entertain an offer the deal moves forward to Prospect
-- (transition_deal, event 'moved_to_pipeline'); a Prospect can be corrected
-- back to Outreach. Archiving and restoring work as for any stage.
begin;

alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals add constraint deals_stage_check check (
  stage in (
    'outreach', 'prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence', 'closed',
    'tour', 'proposal', 'negotiation', 'executed',
    'archived'
  )
);

alter table public.deals drop constraint if exists deals_stage_for_type;
alter table public.deals add constraint deals_stage_for_type check (
  stage = 'archived'
  or (deal_type = 'acquisition'
      and stage in ('outreach', 'prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence', 'closed'))
  or (deal_type = 'lease'
      and stage in ('prospect', 'tour', 'proposal', 'negotiation', 'executed'))
);

-- When a deal entered the pipeline: its creation for a deal entered directly,
-- the move out of Outreach for a sourced site (null while in Outreach). Intake
-- counts and charts read this instead of created_at.
alter table public.deals add column if not exists entered_pipeline_at timestamptz default now();
update public.deals set entered_pipeline_at = created_at where stage <> 'outreach' and (entered_pipeline_at is null or entered_pipeline_at > created_at);
update public.deals set entered_pipeline_at = null where stage = 'outreach';

-- Same function as 20260909215353_intake_correctness, with 'outreach' first
-- in the stage order so Outreach -> Prospect is the next step, and that step
-- stamping entered_pipeline_at.
create or replace function public.transition_deal(p_id uuid,p_expected text,p_to text,p_event text,p_detail jsonb,p_actor text,p_columns jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.deals%rowtype; stages text[] := array['outreach','prospect','uw','offered','moving_to_psa','due_diligence','closed'];
begin
  select * into d from public.deals where id=p_id for update;
  if not found or d.stage <> p_expected then raise exception 'The deal changed. Refresh before retrying.'; end if;
  if d.deal_type <> 'acquisition' or array_position(stages,d.stage) is null or array_position(stages,p_to) is null then raise exception 'Invalid stage transition'; end if;
  if p_event='stage_corrected' then
    if array_position(stages,p_to) >= array_position(stages,d.stage) then raise exception 'Corrections must move backward'; end if;
  elsif array_position(stages,p_to) <> array_position(stages,d.stage)+1 then raise exception 'Use the next stage action'; end if;
  update public.deals set stage=p_to,
    entered_pipeline_at=case when p_to='outreach' then null when d.stage='outreach' then now() else entered_pipeline_at end,
    contract_price=case when p_columns ? 'contract_price' then (p_columns->>'contract_price')::numeric else contract_price end,
    closed_price=case when p_columns ? 'closed_price' then (p_columns->>'closed_price')::numeric else closed_price end,
    closed_on=case when p_columns ? 'closed_on' then (p_columns->>'closed_on')::date else closed_on end,
    closing_on=case when p_columns ? 'closing_on' then (p_columns->>'closing_on')::date else closing_on end,
    dd_end_on=case when p_columns ? 'dd_end_on' then (p_columns->>'dd_end_on')::date else dd_end_on end,
    updated_at=now() where id=p_id;
  insert into public.deal_events(deal_id,event_type,detail,actor) values(p_id,p_event,p_detail,p_actor);
end $$;
revoke all on function public.transition_deal(uuid,text,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.transition_deal(uuid,text,text,text,jsonb,text,jsonb) to service_role;

commit;
