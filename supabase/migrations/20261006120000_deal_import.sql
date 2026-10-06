-- Create a deal from an OM or a broker email (New Deal > Import).
--
-- 1. deals.asking_price: the seller's ask from the OM. Deliberately NOT part
--    of dealValue() (that is our number: close > contract > last offer); it
--    shows as "Ask" and lets the Basis flag compare before an offer exists.
-- 2. documents.doc_type gains 'om' so the imported OM files to the deal.
-- 3. outlook_helper_jobs.kind gains 'fetch_om': email body + PDF attachments.
-- 4. agent_runs.agent gains 'deal-import': the form-filling extraction.

begin;

alter table deals add column if not exists asking_price numeric;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%doc_type%'
  loop execute format('alter table documents drop constraint %I', c); end loop;
  alter table documents add constraint documents_doc_type_check
    check (doc_type in ('mla', 'loi', 'psa', 'excel', 'om', 'other'));

  for c in select conname from pg_constraint
    where conrelid = 'outlook_helper_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop execute format('alter table outlook_helper_jobs drop constraint %I', c); end loop;
  alter table outlook_helper_jobs add constraint outlook_helper_jobs_kind_check
    check (kind in ('search', 'fetch', 'fetch_om'));
end $$;

alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative', 'off-market-sourcing', 'deal-import'
));

commit;
