begin;
alter table public.deals add column if not exists portfolio_asset_id uuid references public.assets(id) on delete restrict;
alter table public.deals add column if not exists portfolio_previous_status text;
create index if not exists deals_portfolio_asset_idx on public.deals(portfolio_asset_id) where portfolio_asset_id is not null;
create or replace function public.sync_closed_deal_asset() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare p public.properties%rowtype; a public.assets%rowtype;
begin
  if new.deal_type <> 'acquisition' then return new; end if;
  if new.stage = 'closed' then
    if tg_op = 'UPDATE' and old.stage = 'closed' and new.portfolio_asset_id is not null then return new; end if;
    select * into p from public.properties where id = new.property_id;
    if not found or nullif(trim(p.address), '') is null then raise exception 'A property address is required before closing'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(p.address), 0));
    if new.portfolio_asset_id is not null then
      select * into a from public.assets where id = new.portfolio_asset_id for update;
    else
      select * into a from public.assets where lower(address) = lower(p.address) for update;
    end if;
    if a.id is null then
      insert into public.assets(address,city,market,submarket,asset_class,status,occupancy,
        site_acres,building_sf,latitude,longitude,geocode_precision,geocoded_at,source_url)
      values(p.address,p.city,p.market,p.submarket,new.asset_class,'owned',
        case p.occupancy_status when 'vacant' then 'available' when 'occupied' then 'occupied' else null end,
        case when p.lot_sf > 0 then p.lot_sf / 43560.0 else null end,
        case when p.building_sf > 0 then p.building_sf else null end,
        p.latitude,p.longitude,p.geocode_precision,p.geocoded_at,'/deals/' || new.id)
      returning * into a;
      new.portfolio_previous_status := 'under_contract';
    else
      if a.city is not null and p.city is not null and lower(trim(a.city)) <> lower(trim(p.city)) then
        raise exception 'An asset with this address exists in a different city. Resolve the match before closing.';
      end if;
      new.portfolio_previous_status := a.status;
      update public.assets set status = 'owned',
        latitude = coalesce(latitude,p.latitude), longitude = coalesce(longitude,p.longitude),
        geocode_precision = case when latitude is null or longitude is null then p.geocode_precision else geocode_precision end,
        updated_at = now() where id = a.id;
    end if;
    new.portfolio_asset_id := a.id;
  elsif tg_op = 'UPDATE' and old.stage = 'closed' and new.stage <> 'archived' and old.portfolio_asset_id is not null then
    perform 1 from public.assets where id = old.portfolio_asset_id for update;
    if not exists(select 1 from public.deals where portfolio_asset_id = old.portfolio_asset_id
      and id <> new.id and (stage = 'closed' or (stage = 'archived' and closed_on is not null))) then
      update public.assets set status = coalesce(old.portfolio_previous_status,'owned'), updated_at = now()
      where id = old.portfolio_asset_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sync_closed_deal_asset() from public, anon, authenticated;
drop trigger if exists sync_closed_deal_asset on public.deals;
create trigger sync_closed_deal_asset before insert or update of stage on public.deals
for each row execute function public.sync_closed_deal_asset();
update public.deals set stage = stage where stage = 'closed' and deal_type = 'acquisition' and portfolio_asset_id is null;

-- A closed property may receive its first pin later. Keep the transferred pin
-- aligned unless someone has independently corrected the asset's location.
create or replace function public.sync_closed_property_location() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.assets a set latitude=new.latitude, longitude=new.longitude,
    geocode_precision=new.geocode_precision, geocoded_at=new.geocoded_at, updated_at=now()
  where a.id in (select portfolio_asset_id from public.deals where property_id=new.id and stage='closed')
    and a.latitude is not distinct from old.latitude
    and a.longitude is not distinct from old.longitude;
  return new;
end $$;
revoke all on function public.sync_closed_property_location() from public, anon, authenticated;
drop trigger if exists sync_closed_property_location on public.properties;
create trigger sync_closed_property_location after update of latitude,longitude on public.properties
for each row execute function public.sync_closed_property_location();
commit;
