-- 20261109120000_deal_broker_contacts.sql
--
-- Brokers on a new deal arrive already resolved to contacts (lib/broker-contacts:
-- an exact match from the contact book, a pick from "did you mean", or a new
-- broker saved with their firm). create_deal_atomic links an entry's
-- contact_id as-is instead of re-matching the name, and ignores a repeat of
-- the same contact in the same role rather than failing the whole intake.
-- Entries without contact_id (the current owner) keep the name lookup.
--
-- Same function as 20260909215353_intake_correctness.sql otherwise.
create or replace function public.create_deal_atomic(p_key uuid,p_property jsonb,p_deal jsonb,p_mla jsonb,p_contacts jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.properties%rowtype; d public.deals%rowtype; matches jsonb; cp jsonb; v_contact uuid; identity_key text;
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
    -- v_contact, not contact_id: a variable named like the deal_contacts
    -- column is ambiguous in the duplicate check below.
    v_contact := nullif(cp->>'contact_id','')::uuid;
    if v_contact is not null then
      if not exists (select 1 from public.contacts c where c.id=v_contact) then raise exception 'Broker contact % not found', v_contact; end if;
    else
      if nullif(trim(cp->>'name'),'') is null then continue; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(trim(cp->>'name')),13));
      select c.id into v_contact from public.contacts c where lower(c.name)=lower(trim(cp->>'name')) order by c.created_at limit 1;
      if v_contact is null then insert into public.contacts(name,contact_type) values(trim(cp->>'name'),cp->>'type') returning id into v_contact; end if;
    end if;
    if not exists (select 1 from public.deal_contacts dc where dc.deal_id=d.id and dc.contact_id=v_contact and dc.role=cp->>'role') then
      insert into public.deal_contacts(deal_id,contact_id,role) values(d.id,v_contact,cp->>'role');
      insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'contact_linked',jsonb_build_object('contact_id',v_contact,'role',cp->>'role','via','intake'),p_actor);
    end if;
  end loop;
  insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'deal_created',jsonb_build_object('deal_type','acquisition','asset_class',d.asset_class,'mla_status',d.mla_status),p_actor);
  if d.mla_status='requested' then
    insert into public.deal_events(deal_id,event_type,detail,actor) values(d.id,'mla_requested',jsonb_build_object('address',p.address),'system');
  end if;
  return jsonb_build_object('deal',to_jsonb(d),'property',to_jsonb(p),'duplicates','[]'::jsonb);
end $$;
revoke all on function public.create_deal_atomic(uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_deal_atomic(uuid,jsonb,jsonb,jsonb,jsonb,text) to service_role;
