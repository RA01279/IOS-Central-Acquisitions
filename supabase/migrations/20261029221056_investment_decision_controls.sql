-- Additive only. No historical deal/model data is rewritten.
alter table public.deals add column if not exists investment_review jsonb;
comment on column public.deals.investment_review is 'Explicit analyst evidence, income status, next action and dated price provenance. Unknown legacy values remain null.';
