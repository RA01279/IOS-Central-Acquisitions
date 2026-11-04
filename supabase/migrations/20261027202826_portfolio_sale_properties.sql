begin;
alter table public.comps add column is_portfolio boolean not null default false,
  add column portfolio_transaction_id uuid references public.comps(id) on delete set null,
  add column portfolio_details jsonb;
alter table public.comps add constraint portfolio_sale_only check (not is_portfolio or (comp_type='sale' and latitude is null and longitude is null));
create index comps_portfolio_transaction_idx on public.comps(portfolio_transaction_id) where portfolio_transaction_id is not null;
create table public.comp_sale_properties (
 id uuid primary key default gen_random_uuid(),
 sale_comp_id uuid not null references public.comps(id) on delete cascade,
 source_comp_id uuid references public.comps(id),
 address text not null check(length(trim(address))>0), building_identifier text,
 original_address text not null, source_page integer check(source_page>0), source_row integer check(source_row>0),
 allocation_status text not null check(allocation_status in ('unknown','source_reported')),
 allocated_price numeric check(allocated_price>0), building_sf numeric check(building_sf>=0),lot_sf numeric check(lot_sf>=0), cap_rate numeric check(cap_rate>0 and cap_rate<1),
 source_metrics jsonb not null default '{}',latitude numeric,longitude numeric,geocode_precision text,location_warning text,
 check((allocation_status='unknown' and allocated_price is null) or (allocation_status='source_reported' and allocated_price is not null)),
 check((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
 ,check((latitude is null)=(longitude is null))
);
create unique index comp_sale_properties_identity on public.comp_sale_properties(sale_comp_id,lower(address),lower(coalesce(building_identifier,'')));
alter table public.comp_sale_properties enable row level security;
-- Match comps: service-only access behind Hopper's authenticated server routes.
revoke all on public.comp_sale_properties from anon,authenticated;
grant all on public.comp_sale_properties to service_role;

-- One transaction and all its properties commit together. No SECURITY DEFINER.
create function public.save_comp_sale_portfolio(transaction_data jsonb, property_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare parent public.comps; pid uuid; item jsonb; prior public.comps; linked uuid; is_duplicate boolean:=false;
begin
 if jsonb_array_length(property_data)<1 or jsonb_array_length(property_data)>100 then raise exception 'Portfolio requires 1–100 constituent entries'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(transaction_data->>'address')||':'||(transaction_data->>'closed_on'),0));
 select * into parent from public.comps where is_portfolio and lower(address)=lower(transaction_data->>'address') and closed_on=(transaction_data->>'closed_on')::date for update;
 if found then
  pid:=parent.id; is_duplicate:=true;
  if parent.sale_price is distinct from (transaction_data->>'sale_price')::numeric or parent.buyer is distinct from transaction_data->>'buyer' or parent.seller is distinct from transaction_data->>'seller'
   or parent.building_sf is distinct from (transaction_data->>'building_sf')::numeric or parent.lot_sf is distinct from (transaction_data->>'lot_sf')::numeric
   or parent.cap_rate is distinct from (transaction_data->>'cap_rate')::numeric or parent.coverage_pct is distinct from (transaction_data->>'coverage_pct')::numeric
   or (parent.portfolio_details-'warnings'-'reviewAcknowledged') is distinct from ((transaction_data->'portfolio_details')-'warnings'-'reviewAcknowledged')
   or (parent.portfolio_details->'sourceMetrics') is distinct from (transaction_data->'portfolio_details'->'sourceMetrics')
   or (select count(*) from public.comp_sale_properties where sale_comp_id=pid)<>jsonb_array_length(property_data)
  then raise exception 'Existing portfolio preserved: conflicting transaction evidence'; end if;
 else
  insert into public.comps(address,project_name,comp_type,is_portfolio,closed_on,date_precision,sale_price,buyer,seller,building_sf,lot_sf,coverage_pct,cap_rate,city,state,market,asset_class,notes,source,source_ref,created_by,status,portfolio_details)
  values(transaction_data->>'address',transaction_data->>'project_name','sale',true,(transaction_data->>'closed_on')::date,transaction_data->>'date_precision',(transaction_data->>'sale_price')::numeric,transaction_data->>'buyer',transaction_data->>'seller',(transaction_data->>'building_sf')::numeric,(transaction_data->>'lot_sf')::numeric,(transaction_data->>'coverage_pct')::numeric,(transaction_data->>'cap_rate')::numeric,transaction_data->>'city',transaction_data->>'state',transaction_data->>'market',transaction_data->>'asset_class',transaction_data->>'notes',transaction_data->>'source',transaction_data->>'source_ref',transaction_data->>'created_by','confirmed',transaction_data->'portfolio_details') returning id into pid;
 end if;
 for item in select value from jsonb_array_elements(property_data) loop
  if is_duplicate then
   if not exists(select 1 from public.comp_sale_properties p where p.sale_comp_id=pid and lower(p.address)=lower(item->>'address') and coalesce(p.building_identifier,'')=coalesce(item->>'building_identifier','') and p.allocated_price is not distinct from (item->>'allocated_price')::numeric and p.building_sf is not distinct from (item->>'building_sf')::numeric and p.lot_sf is not distinct from (item->>'lot_sf')::numeric and p.source_metrics=item->'source_metrics') then raise exception 'Existing portfolio preserved: conflicting property evidence'; end if;
   continue;
  end if;
  linked:=null;
  -- Link already-saved component observations only on corroborating evidence.
  for prior in select * from public.comps c where not c.is_portfolio and c.comp_type='sale' and c.closed_on=(transaction_data->>'closed_on')::date and lower(regexp_replace(c.address,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(item->>'address','[^a-zA-Z0-9]','','g')) and coalesce(c.project_name,'')=coalesce(item->>'building_identifier','') and lower(coalesce(c.buyer,''))=lower(coalesce(transaction_data->>'buyer','')) and lower(coalesce(c.seller,''))=lower(coalesce(transaction_data->>'seller','')) for update loop
   if prior.sale_price is distinct from (item->>'allocated_price')::numeric or (prior.portfolio_transaction_id is not null and prior.portfolio_transaction_id<>pid) then raise exception 'Existing component preserved: conflicting allocation or portfolio linkage for %',prior.address; end if;
   update public.comps set portfolio_transaction_id=pid where id=prior.id;
   linked:=prior.id;
  end loop;
  insert into public.comp_sale_properties(sale_comp_id,source_comp_id,address,building_identifier,original_address,source_page,source_row,allocation_status,allocated_price,building_sf,lot_sf,cap_rate,source_metrics,latitude,longitude,geocode_precision,location_warning)
  values(pid,linked,item->>'address',item->>'building_identifier',item->>'original_address',(item->>'source_page')::int,(item->>'source_row')::int,item->>'allocation_status',(item->>'allocated_price')::numeric,(item->>'building_sf')::numeric,(item->>'lot_sf')::numeric,(item->>'cap_rate')::numeric,item->'source_metrics',(item->>'latitude')::numeric,(item->>'longitude')::numeric,item->>'geocode_precision',item->>'location_warning');
 end loop;
 return jsonb_build_object('id',pid,'duplicate',is_duplicate);
end $$;
revoke all on function public.save_comp_sale_portfolio(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_comp_sale_portfolio(jsonb,jsonb) to service_role;
commit;
