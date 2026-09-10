begin;
alter table public.deals add column if not exists intake_key uuid;
alter table public.deals add column if not exists classification_basis text;
create unique index if not exists deals_intake_key_unique on public.deals(intake_key) where intake_key is not null;
-- Existing closing rows are checked before application; no records are repaired implicitly.
alter table public.deals drop constraint if exists deals_closed_complete;
alter table public.deals add constraint deals_closed_complete check
  (stage <> 'closed' or (closed_price > 0 and closed_price is not null and closed_on is not null));

create or replace function public.transition_deal(p_id uuid,p_expected text,p_to text,p_event text,p_detail jsonb,p_actor text,p_columns jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.deals%rowtype; stages text[] := array['prospect','uw','offered','moving_to_psa','due_diligence','closed'];
begin
  select * into d from public.deals where id=p_id for update;
  if not found or d.stage <> p_expected then raise exception 'The deal changed. Refresh before retrying.'; end if;
  if d.deal_type <> 'acquisition' or array_position(stages,d.stage) is null or array_position(stages,p_to) is null then raise exception 'Invalid stage transition'; end if;
  if p_event='stage_corrected' then
    if array_position(stages,p_to) >= array_position(stages,d.stage) then raise exception 'Corrections must move backward'; end if;
  elsif array_position(stages,p_to) <> array_position(stages,d.stage)+1 then raise exception 'Use the next stage action'; end if;
  update public.deals set stage=p_to,
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

create or replace function public.create_deal_atomic(p_key uuid,p_property jsonb,p_deal jsonb,p_mla jsonb,p_contacts jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.properties%rowtype; d public.deals%rowtype; matches jsonb; cp jsonb; contact_id uuid; identity_key text;
begin
  if p_key is null or nullif(trim(p_property->>'address'),'') is null then raise exception 'Address and intake key required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,11));
  select * into d from public.deals where intake_key=p_key;
  if found then
    if d.created_by<>p_actor then raise exception 'Intake key already used'; end if;
    select * into p from public.properties where id=d.property_id;
    return jsonb_build_object('deal',to_jsonb(d),'property',to_jsonb(p),'duplicates','[]'::jsonb,'replayed',true);
  end if;
  identity_key := lower(regexp_replace(p_property->>'address','[^a-zA-Z0-9]','','g'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(identity_key,12));
  select jsonb_agg(jsonb_build_object('id',dd.id,'stage',dd.stage,'address',pp.address,'city',pp.city)) into matches
  from public.properties pp join public.deals dd on dd.property_id=pp.id
  where lower(regexp_replace(pp.address,'[^a-zA-Z0-9]','','g'))=identity_key
    and (nullif(trim(pp.city),'') is null or nullif(trim(p_property->>'city'),'') is null or lower(trim(pp.city))=lower(trim(p_property->>'city')))
    and dd.deal_type='acquisition';
  if matches is not null then return jsonb_build_object('duplicates',matches); end if;
  insert into public.properties select (jsonb_populate_record(null::public.properties,
    p_property || jsonb_build_object('id',gen_random_uuid(),'created_at',now()))).* returning * into p;
  insert into public.deals(property_id,deal_type,stage,asset_class,source_broker_id,mla_status,marketing_status,acquisition_type,created_by,intake_key,classification_basis)
  values(p.id,'acquisition','prospect',p_deal->>'asset_class',(p_deal->>'source_broker_id')::uuid,
    p_deal->>'mla_status',p_deal->>'marketing_status',p_deal->>'acquisition_type',p_actor,p_key,p_deal->>'classification_basis') returning * into d;
  if p_mla is not null then
    insert into public.mla_data select (jsonb_populate_record(null::public.mla_data,
      p_mla || jsonb_build_object('id',gen_random_uuid(),'deal_id',d.id,'provided_by',p_actor,'provided_at',now(),'created_at',now()))).*;
  end if;
  for cp in select * from jsonb_array_elements(p_contacts) loop
    if nullif(trim(cp->>'name'),'') is null then continue; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(trim(cp->>'name')),13));
    select id into contact_id from public.contacts where lower(name)=lower(trim(cp->>'name')) order by created_at limit 1;
    if contact_id is null then insert into public.contacts(name,contact_type) values(trim(cp->>'name'),cp->>'type') returning id into contact_id; end if;
    insert into public.deal_contacts(deal_id,contact_id,role) values(d.id,contact_id,cp->>'role');
    insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'contact_linked',jsonb_build_object('contact_id',contact_id,'role',cp->>'role','via','intake'),p_actor);
  end loop;
  insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'deal_created',jsonb_build_object('deal_type','acquisition','asset_class',d.asset_class,'mla_status',d.mla_status),p_actor);
  if d.mla_status='requested' then
    insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'mla_requested',jsonb_build_object('address',p.address),'system');
  end if;
  return jsonb_build_object('deal',to_jsonb(d),'property',to_jsonb(p),'duplicates','[]'::jsonb);
end $$;
revoke all on function public.create_deal_atomic(uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_deal_atomic(uuid,jsonb,jsonb,jsonb,jsonb,text) to service_role;

create table if not exists public.deal_analysis_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null check(kind in ('comps','demand')),
  version int not null check(version>0),
  payload jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique(deal_id,kind,version)
);
alter table public.deal_analysis_versions enable row level security;
revoke all on public.deal_analysis_versions from anon,authenticated;
grant all on public.deal_analysis_versions to service_role;
create or replace function public.save_deal_analysis(p_deal uuid,p_kind text,p_expected int,p_payload jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare latest int; saved public.deal_analysis_versions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deal::text||p_kind,14));
  select coalesce(max(version),0) into latest from public.deal_analysis_versions where deal_id=p_deal and kind=p_kind;
  if latest<>p_expected then raise exception 'Another version was saved. Reload before saving your changes.'; end if;
  insert into public.deal_analysis_versions(deal_id,kind,version,payload,created_by) values(p_deal,p_kind,latest+1,p_payload,p_actor) returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_deal_analysis(uuid,text,int,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_deal_analysis(uuid,text,int,jsonb,text) to service_role;
commit;
