-- 20261020170000_georgia_markets.sql
--
-- Atlanta and Savannah are now covered by randerson@dalfen.com. The market ->
-- owner map lives in app_settings (lib/market-owners.ts): new deals in those
-- markets default to that owner. Existing Atlanta / Savannah acquisition
-- deals take the same owner.
begin;
insert into public.app_settings (key, value, updated_at)
values ('market_owners', '{"atlanta":"randerson@dalfen.com","savannah":"randerson@dalfen.com"}', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.deals d set assigned_analyst = 'randerson@dalfen.com'
from public.properties p
where d.property_id = p.id
  and d.deal_type = 'acquisition'
  and lower(p.market) in ('atlanta', 'savannah')
  and d.assigned_analyst is distinct from 'randerson@dalfen.com';
commit;
