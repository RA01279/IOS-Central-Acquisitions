-- A broker's call-for-offers deadline is separate from our LOI response date.
alter table public.deals add column if not exists call_for_offers_on date;
comment on column public.deals.call_for_offers_on is
  'Call-for-offers calendar date in America/Chicago; included in the brief and day-before reminder.';
create index if not exists deals_call_for_offers_on_idx
  on public.deals(call_for_offers_on)
  where call_for_offers_on is not null and stage not in ('closed', 'archived');
