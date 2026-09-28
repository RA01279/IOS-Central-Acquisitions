begin;

alter table public.assets
  add column purchase_price numeric(14,2) check (purchase_price is null or purchase_price > 0),
  add column purchased_on date,
  add column sale_price numeric(14,2) check (sale_price is null or sale_price > 0),
  add column sold_on date,
  add column acquisition_costs numeric(14,2) check (acquisition_costs is null or acquisition_costs >= 0),
  add column selling_costs numeric(14,2) check (selling_costs is null or selling_costs >= 0),
  add constraint assets_sale_dates_order check (purchased_on is null or sold_on is null or sold_on >= purchased_on),
  add constraint assets_sale_requires_sold check ((sale_price is null and sold_on is null and coalesce(selling_costs,0)=0) or status='sold');

comment on column public.assets.acquisition_costs is 'Total acquisition transaction costs. NULL means not recorded; zero explicitly means no costs.';
comment on column public.assets.selling_costs is 'Total selling transaction costs. NULL means not recorded; zero explicitly means no costs.';

-- Portfolio data is read and written by the authenticated application through
-- its server-only service client, never directly through the public Data API.
alter table public.assets enable row level security;

-- Preserve a disposal when correcting or refreshing the originating deal.
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
        updated_at = now() where id = a.id and status <> 'sold';
    end if;
    new.portfolio_asset_id := a.id;
  elsif tg_op = 'UPDATE' and old.stage = 'closed' and new.stage <> 'archived' and old.portfolio_asset_id is not null then
    perform 1 from public.assets where id = old.portfolio_asset_id for update;
    if not exists(select 1 from public.deals where portfolio_asset_id = old.portfolio_asset_id
      and id <> new.id and (stage = 'closed' or (stage = 'archived' and closed_on is not null))) then
      update public.assets set status = coalesce(old.portfolio_previous_status,'owned'), updated_at = now()
      where id = old.portfolio_asset_id and status <> 'sold';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sync_closed_deal_asset() from public, anon, authenticated;

-- Use the actual closing price, never an offer or underwriting assumption.
-- Once entered, the asset's purchase figures are maintained in Our Assets.
create function public.capture_closed_asset_purchase() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.deal_type = 'acquisition' and new.stage = 'closed' and new.portfolio_asset_id is not null then
    update public.assets set
      purchase_price = coalesce(purchase_price, case when new.closed_price > 0 then new.closed_price end),
      purchased_on = coalesce(purchased_on, new.closed_on)
    where id = new.portfolio_asset_id and status = 'owned' and source_url = '/deals/' || new.id;
  end if;
  return new;
end $$;
revoke all on function public.capture_closed_asset_purchase() from public, anon, authenticated;
create trigger capture_closed_asset_purchase after insert or update of stage,closed_price,closed_on on public.deals
for each row execute function public.capture_closed_asset_purchase();

update public.assets a set purchase_price=d.closed_price,purchased_on=d.closed_on
from public.deals d where a.id=d.portfolio_asset_id and a.source_url='/deals/' || d.id
  and d.deal_type='acquisition' and d.stage='closed' and d.closed_price>0;

commit;
