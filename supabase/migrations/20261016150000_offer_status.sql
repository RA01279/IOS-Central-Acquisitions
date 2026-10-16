-- 20261016150000_offer_status.sql
--
-- Negotiation status on each offer: what the seller did with it, their
-- counter, and when they answered. Existing offers start as 'sent'.
begin;
alter table public.offers add column if not exists status text not null default 'sent';
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('sent', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired'));
alter table public.offers add column if not exists counter_price numeric;
alter table public.offers drop constraint if exists offers_counter_price_check;
alter table public.offers add constraint offers_counter_price_check check (counter_price is null or counter_price > 0);
alter table public.offers add column if not exists responded_on date;
commit;
