begin;
create table public.deal_property_taxes (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  revision integer not null default 0 check(revision >= 0),
  state jsonb not null check(jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table public.deal_property_tax_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  revision integer not null,
  action text not null check(action in ('review','research','upload')),
  snapshot jsonb not null,
  actor text not null,
  created_at timestamptz not null default now(),
  unique(deal_id,revision)
);
alter table public.deal_property_taxes enable row level security;
alter table public.deal_property_tax_history enable row level security;
revoke all on public.deal_property_taxes,public.deal_property_tax_history from public,anon,authenticated;
grant select on public.deal_property_taxes,public.deal_property_tax_history to service_role;
-- Server RPC writes state and its immutable audit snapshot in one transaction.
-- SECURITY INVOKER: service role only; never exposed directly to browser roles.
grant insert,update on public.deal_property_taxes to service_role;
grant insert on public.deal_property_tax_history to service_role;
create function public.save_deal_tax_state(p_deal_id uuid,p_expected integer,p_state jsonb,p_actor text,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_revision integer; next_revision integer; saved public.deal_property_taxes;
begin
  perform 1 from public.deals where id=p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='22023'; end if;
  select revision into current_revision from public.deal_property_taxes where deal_id=p_deal_id for update;
  current_revision:=coalesce(current_revision,0);
  if current_revision<>p_expected then raise exception 'Tax workspace changed. Reload before saving; your local draft is retained.' using errcode='40001'; end if;
  if p_state->>'version' is distinct from '1' or jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text)>1500000 then raise exception 'Invalid tax workspace' using errcode='22023'; end if;
  -- Old source evidence is immutable and cannot be silently removed on refresh.
  if exists(select 1 from public.deal_property_taxes t, lateral jsonb_array_elements(t.state->'sources') old_source
    where t.deal_id=p_deal_id and not exists(select 1 from jsonb_array_elements(p_state->'sources') new_source where new_source=old_source)) then
    raise exception 'Original source evidence must be retained' using errcode='22023';
  end if;
  next_revision:=current_revision+1;
  insert into public.deal_property_taxes(deal_id,revision,state,updated_by) values(p_deal_id,next_revision,p_state,p_actor)
  on conflict(deal_id) do update set revision=excluded.revision,state=excluded.state,updated_by=excluded.updated_by,updated_at=now()
  returning * into saved;
  insert into public.deal_property_tax_history(deal_id,revision,action,snapshot,actor) values(p_deal_id,next_revision,p_action,p_state,p_actor);
  return to_jsonb(saved);
end $$;
revoke all on function public.save_deal_tax_state(uuid,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.save_deal_tax_state(uuid,integer,jsonb,text,text) to service_role;
comment on table public.deal_property_taxes is 'Shared authenticated Hopper deal tax workspace. Server validates all writes; no direct Data API browser access.';
comment on table public.deal_property_tax_history is 'Append-only tax research/review snapshots. Research never applies underwriting assumptions.';
commit;
