-- Bid rounds. Brokers often run a call for offers, short-list, then call for
-- best & final (sometimes a third round). deals.offer_round is the round the
-- deal is in now; offers.round is the round each offer was made in. From
-- round 2 on, deals.call_for_offers_on is that round's due date and wins over
-- any leftover round-1 "Call for offers" task (lib/call-for-offers.ts).
alter table public.deals add column if not exists offer_round smallint not null default 1;
alter table public.offers add column if not exists round smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_offer_round_check') then
    alter table public.deals add constraint deals_offer_round_check check (offer_round between 1 and 9);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'offers_round_check') then
    alter table public.offers add constraint offers_round_check check (round between 1 and 9);
  end if;
end $$;

comment on column public.deals.offer_round is
  'Current bid round: 1 = initial call for offers, 2 = best & final, 3+ = further rounds.';
comment on column public.offers.round is 'Bid round the offer was submitted in (see deals.offer_round).';
