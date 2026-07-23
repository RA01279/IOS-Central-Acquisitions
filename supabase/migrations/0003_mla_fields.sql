-- 0003_mla_fields.sql
-- The initial mla_data schema (asking_rent, opex) was a guess made
-- before seeing a real underwriting model. The actual "MLA - Base Case"
-- tab in the Dalfen template captures a richer, fairly standard set of
-- leasing assumptions -- promoting the common ones to real columns so
-- they're queryable (e.g. for future comp-weighting work), and keeping
-- other_assumptions for anything less standard.

alter table mla_data
  add column if not exists market_base_rent numeric,       -- $ / SF / Month
  add column if not exists term_years numeric,
  add column if not exists term_months numeric,
  add column if not exists renewal_probability numeric,     -- 0-1
  add column if not exists months_vacant numeric,
  add column if not exists free_rent_months numeric,
  add column if not exists ti_new numeric,                  -- $ amount
  add column if not exists ti_renew numeric,                -- $ amount
  add column if not exists lc_new_pct numeric,               -- 0-1
  add column if not exists lc_renew_pct numeric,             -- 0-1
  add column if not exists recovery_type text;

-- asking_rent/opex from 0002 stay as-is for backward compatibility with
-- anything already using them, but market_base_rent is the field that
-- actually maps to the template -- prefer it going forward.
comment on column mla_data.asking_rent is 'Deprecated in favor of market_base_rent -- kept for compatibility.';
