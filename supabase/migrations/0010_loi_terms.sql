-- 0010_loi_terms.sql
-- Persists the last-used LOI form values per deal (deposit, DD/closing
-- periods, attn, signers, ...). The Generate LOI form prefills from here
-- first, so terms typed once are never re-typed -- and future templated
-- documents (PSA etc.) can tag the same data.

alter table deals
  add column if not exists loi_terms jsonb;
