-- 20261019120000_uw_model_detail.sql
--
-- The parts of the acquisition model the Financials tab shows beyond the
-- returns summary: the deal-level and LP sensitivity tables (price x exit
-- cap), read at upload with the IC deck's parser (lib/ic-deck/model.ts).
-- Null when the workbook isn't the standard model or has no tables.
alter table public.uw_versions add column if not exists model_detail jsonb;
