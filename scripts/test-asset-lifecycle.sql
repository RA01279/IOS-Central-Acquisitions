begin;
do $$
declare p uuid; d uuid; a uuid; label text := 'Asset transaction test ' || gen_random_uuid();
begin
  insert into public.properties(address,city,asset_type,latitude,longitude,geocode_precision,lot_sf)
  values(label,'Houston','ios',29.9,-95.5,'rooftop',87120) returning id into p;
  insert into public.deals(property_id,deal_type,stage,created_by)
  values(p,'acquisition','prospect','transaction-test') returning id into d;
  update public.deals set stage='closed',closed_on='2020-01-01',closed_price=2000000 where id=d;
  select portfolio_asset_id into a from public.deals where id=d;
  if not exists(select 1 from public.assets where id=a and status='owned' and purchase_price=2000000 and purchased_on='2020-01-01') then raise exception 'Purchase was not captured'; end if;
  update public.assets set status='sold',sale_price=3000000,sold_on='2026-01-01',acquisition_costs=100000,selling_costs=150000 where id=a;
  if not exists(select 1 from public.assets where id=a and sale_price-selling_costs-purchase_price-acquisition_costs=750000) then raise exception 'Net gain wrong'; end if;
  update public.deals set stage='due_diligence' where id=d;
  if not exists(select 1 from public.assets where id=a and status='sold' and sale_price=3000000) then raise exception 'Reopening erased sale'; end if;
  update public.deals set stage='closed' where id=d;
  if not exists(select 1 from public.assets where id=a and status='sold' and purchase_price=2000000) then raise exception 'Reclosing erased sale'; end if;
  begin
    update public.assets set sold_on='2019-01-01' where id=a;
    raise exception 'Invalid date accepted';
  exception when check_violation then null; end;
  begin
    update public.assets set acquisition_costs=-1 where id=a;
    raise exception 'Negative cost accepted';
  exception when check_violation then null; end;
  begin
    update public.assets set status='owned' where id=a;
    raise exception 'Sale details on owned asset accepted';
  exception when check_violation then null; end;
  update public.assets set status='owned',sale_price=null,sold_on=null,selling_costs=null where id=a;
  if not exists(select 1 from public.assets where id=a and status='owned' and purchase_price=2000000 and acquisition_costs=100000) then raise exception 'Correction lost purchase'; end if;
end $$;
select 'Purchase capture, sale persistence, net calculation, constraints and sale correction passed; rolled back' as result;
rollback;
